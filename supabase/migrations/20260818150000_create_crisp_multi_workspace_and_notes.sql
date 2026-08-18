-- Migration: Add multi-workspace Crisp integration using Supabase Vault secrets and internal notes
-- Access strictly limited to admin, cs_admin, and cs roles. Credentials managed by admin only.

-- Enable Vault extension safely
CREATE EXTENSION IF NOT EXISTS supabase_vault CASCADE;

-- 1. Create crisp_workspaces table
CREATE TABLE IF NOT EXISTS public.crisp_workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    crisp_website_id TEXT NOT NULL UNIQUE,
    workspace_name TEXT,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    credential_secret_id UUID,
    installed_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ,
    last_synced_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure connection_mode column is dropped if it existed from previous iteration
ALTER TABLE public.crisp_workspaces DROP COLUMN IF EXISTS connection_mode;
ALTER TABLE public.crisp_workspaces ADD COLUMN IF NOT EXISTS credential_secret_id UUID;

-- 2. Modify crisp_conversations for multi-workspace uniqueness
ALTER TABLE public.crisp_conversations DROP CONSTRAINT IF EXISTS crisp_conversations_crisp_session_id_key;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'crisp_conversations_website_session_key'
    ) THEN
        ALTER TABLE public.crisp_conversations ADD CONSTRAINT crisp_conversations_website_session_key UNIQUE (crisp_website_id, crisp_session_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_crisp_conversations_website_id ON public.crisp_conversations(crisp_website_id);
CREATE INDEX IF NOT EXISTS idx_crisp_conversations_website_session ON public.crisp_conversations(crisp_website_id, crisp_session_id);
CREATE INDEX IF NOT EXISTS idx_crisp_conversations_last_message_at ON public.crisp_conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_crisp_conversations_status ON public.crisp_conversations(status);

-- 3. Modify crisp_messages for multi-workspace safety (NO DELETE statements)
ALTER TABLE public.crisp_messages ADD COLUMN IF NOT EXISTS crisp_website_id TEXT;

-- Backfill crisp_website_id in existing messages from parent crisp_conversations
UPDATE public.crisp_messages m
SET crisp_website_id = c.crisp_website_id
FROM public.crisp_conversations c
WHERE m.conversation_id = c.id AND m.crisp_website_id IS NULL;

-- Validation 1: Fail if any orphan messages exist without matching workspace
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.crisp_messages WHERE crisp_website_id IS NULL
    ) THEN
        RAISE EXCEPTION 'Crisp migration stopped: messages exist without a matching conversation/workspace.';
    END IF;
END $$;

-- Validation 2: Fail if duplicate messages exist for (crisp_website_id, crisp_message_id)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.crisp_messages
        WHERE crisp_website_id IS NOT NULL AND crisp_message_id IS NOT NULL
        GROUP BY crisp_website_id, crisp_message_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Crisp migration stopped: duplicate crisp_messages found for (crisp_website_id, crisp_message_id).';
    END IF;
END $$;

-- Make crisp_website_id NOT NULL after validation passes
ALTER TABLE public.crisp_messages ALTER COLUMN crisp_website_id SET NOT NULL;

-- Drop old single-column unique constraint on crisp_message_id if exists
ALTER TABLE public.crisp_messages DROP CONSTRAINT IF EXISTS crisp_messages_crisp_message_id_key;

-- Add composite unique constraint for message deduplication per website
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'crisp_messages_website_message_key'
    ) THEN
        ALTER TABLE public.crisp_messages ADD CONSTRAINT crisp_messages_website_message_key UNIQUE (crisp_website_id, crisp_message_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_crisp_messages_conversation_id ON public.crisp_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_crisp_messages_website_id ON public.crisp_messages(crisp_website_id);
CREATE INDEX IF NOT EXISTS idx_crisp_messages_website_session ON public.crisp_messages(crisp_website_id, crisp_session_id);
CREATE INDEX IF NOT EXISTS idx_crisp_messages_sent_at ON public.crisp_messages(sent_at ASC);

-- 4. Modify crisp_webhook_events
ALTER TABLE public.crisp_webhook_events ADD COLUMN IF NOT EXISTS crisp_website_id TEXT;
CREATE INDEX IF NOT EXISTS idx_crisp_webhook_events_website_id ON public.crisp_webhook_events(crisp_website_id);

-- 5. Secure Vault Helpers (service_role ONLY)
CREATE OR REPLACE FUNCTION public.crisp_create_workspace_secret(
    p_website_id TEXT,
    p_token_id TEXT,
    p_token_key TEXT,
    p_webhook_secret TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
    v_secret_json TEXT;
    v_secret_id UUID;
BEGIN
    v_secret_json := json_build_object(
        'token_id', p_token_id,
        'token_key', p_token_key,
        'webhook_secret', p_webhook_secret
    )::text;

    BEGIN
        v_secret_id := vault.create_secret(v_secret_json, 'crisp_ws_' || p_website_id, 'Crisp credentials for ' || p_website_id);
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO vault.secrets (secret, name, description)
        VALUES (v_secret_json, 'crisp_ws_' || p_website_id, 'Crisp credentials for ' || p_website_id)
        RETURNING id INTO v_secret_id;
    END;

    RETURN v_secret_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.crisp_update_workspace_secret(
    p_secret_id UUID,
    p_token_id TEXT,
    p_token_key TEXT,
    p_webhook_secret TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
    v_secret_json TEXT;
BEGIN
    v_secret_json := json_build_object(
        'token_id', p_token_id,
        'token_key', p_token_key,
        'webhook_secret', p_webhook_secret
    )::text;

    UPDATE vault.secrets
    SET secret = v_secret_json, updated_at = NOW()
    WHERE id = p_secret_id;

    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.crisp_get_workspace_secret(
    p_secret_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
    v_secret TEXT;
BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE id = p_secret_id;

    IF v_secret IS NULL THEN
        SELECT secret INTO v_secret
        FROM vault.secrets
        WHERE id = p_secret_id;
    END IF;

    IF v_secret IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN v_secret::jsonb;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

-- Restrict Vault Helper Execution STRICTLY to service_role
REVOKE ALL ON FUNCTION public.crisp_create_workspace_secret FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.crisp_update_workspace_secret FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.crisp_get_workspace_secret FROM PUBLIC, authenticated;

GRANT EXECUTE ON FUNCTION public.crisp_create_workspace_secret TO service_role;
GRANT EXECUTE ON FUNCTION public.crisp_update_workspace_secret TO service_role;
GRANT EXECUTE ON FUNCTION public.crisp_get_workspace_secret TO service_role;

-- 6. Create crisp_conversation_notes table
CREATE TABLE IF NOT EXISTS public.crisp_conversation_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.crisp_conversations(id) ON DELETE CASCADE,
    created_by UUID NOT NULL,
    note TEXT NOT NULL,
    is_edited BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crisp_conversation_notes_conv_created ON public.crisp_conversation_notes (conversation_id, created_at DESC);

-- 7. Enable RLS and Grant Permissions
ALTER TABLE public.crisp_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crisp_conversation_notes ENABLE ROW LEVEL SECURITY;

-- crisp_workspaces: SELECT ONLY for authenticated roles. Service role retains ALL.
GRANT SELECT ON TABLE public.crisp_workspaces TO authenticated;
GRANT ALL ON TABLE public.crisp_workspaces TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.crisp_conversation_notes TO authenticated;
GRANT ALL ON TABLE public.crisp_conversation_notes TO service_role;

-- RLS Policy for crisp_workspaces (SELECT ONLY for admin, cs_admin, cs)
DROP POLICY IF EXISTS "Crisp workspaces access for cs roles" ON public.crisp_workspaces;
DROP POLICY IF EXISTS "Crisp workspaces select access for cs roles" ON public.crisp_workspaces;

CREATE POLICY "Crisp workspaces select access for cs roles"
ON public.crisp_workspaces
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('admin', 'cs_admin', 'cs')
    )
);

-- Granular RLS Policies for crisp_conversation_notes
DROP POLICY IF EXISTS "Crisp conversation notes access for cs roles" ON public.crisp_conversation_notes;
DROP POLICY IF EXISTS "Crisp conversation notes select for cs roles" ON public.crisp_conversation_notes;
DROP POLICY IF EXISTS "Crisp conversation notes insert for cs roles" ON public.crisp_conversation_notes;
DROP POLICY IF EXISTS "Crisp conversation notes update/delete" ON public.crisp_conversation_notes;
DROP POLICY IF EXISTS "Crisp conversation notes update for cs roles" ON public.crisp_conversation_notes;
DROP POLICY IF EXISTS "Crisp conversation notes delete for cs roles" ON public.crisp_conversation_notes;

CREATE POLICY "Crisp conversation notes select for cs roles"
ON public.crisp_conversation_notes
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('admin', 'cs_admin', 'cs')
    )
);

CREATE POLICY "Crisp conversation notes insert for cs roles"
ON public.crisp_conversation_notes
FOR INSERT
TO authenticated
WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('admin', 'cs_admin', 'cs')
    )
);

CREATE POLICY "Crisp conversation notes update for cs roles"
ON public.crisp_conversation_notes
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('admin', 'cs_admin', 'cs')
    )
    AND (
        created_by = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.user_roles
            WHERE user_roles.user_id = auth.uid()
            AND user_roles.role IN ('admin', 'cs_admin')
        )
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('admin', 'cs_admin', 'cs')
    )
    AND (
        created_by = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.user_roles
            WHERE user_roles.user_id = auth.uid()
            AND user_roles.role IN ('admin', 'cs_admin')
        )
    )
);

CREATE POLICY "Crisp conversation notes delete for cs roles"
ON public.crisp_conversation_notes
FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('admin', 'cs_admin', 'cs')
    )
    AND (
        created_by = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.user_roles
            WHERE user_roles.user_id = auth.uid()
            AND user_roles.role IN ('admin', 'cs_admin')
        )
    )
);

-- 8. Add new tables to Realtime Publication safely
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'crisp_workspaces'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.crisp_workspaces;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'crisp_conversation_notes'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.crisp_conversation_notes;
        END IF;
    END IF;
END $$;
