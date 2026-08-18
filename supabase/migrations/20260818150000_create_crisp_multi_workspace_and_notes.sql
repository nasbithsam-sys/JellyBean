-- Migration: Add multi-workspace support and internal conversation notes to Crisp integration
-- Access strictly limited to admin, cs_admin, and cs roles.

-- 1. Create crisp_workspaces table
CREATE TABLE IF NOT EXISTS public.crisp_workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    crisp_website_id TEXT NOT NULL UNIQUE,
    workspace_name TEXT,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    installed_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ,
    last_synced_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

-- 3. Modify crisp_messages for multi-workspace safety
ALTER TABLE public.crisp_messages ADD COLUMN IF NOT EXISTS crisp_website_id TEXT;

-- Backfill crisp_website_id in existing messages from parent crisp_conversations
UPDATE public.crisp_messages m
SET crisp_website_id = c.crisp_website_id
FROM public.crisp_conversations c
WHERE m.conversation_id = c.id AND m.crisp_website_id IS NULL;

-- Make composite uniqueness for message deduplication per website
ALTER TABLE public.crisp_messages DROP CONSTRAINT IF EXISTS crisp_messages_crisp_message_id_key;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'crisp_messages_website_message_key'
    ) THEN
        ALTER TABLE public.crisp_messages ADD CONSTRAINT crisp_messages_website_message_key UNIQUE (crisp_website_id, crisp_message_id);
    END IF;
EXCEPTION
    WHEN OTHERS THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_crisp_messages_conversation_id ON public.crisp_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_crisp_messages_website_id ON public.crisp_messages(crisp_website_id);
CREATE INDEX IF NOT EXISTS idx_crisp_messages_website_session ON public.crisp_messages(crisp_website_id, crisp_session_id);
CREATE INDEX IF NOT EXISTS idx_crisp_messages_sent_at ON public.crisp_messages(sent_at ASC);

-- 4. Modify crisp_webhook_events
ALTER TABLE public.crisp_webhook_events ADD COLUMN IF NOT EXISTS crisp_website_id TEXT;
CREATE INDEX IF NOT EXISTS idx_crisp_webhook_events_website_id ON public.crisp_webhook_events(crisp_website_id);

-- 5. Create crisp_conversation_notes table
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

-- 6. Enable RLS and Grant Permissions
ALTER TABLE public.crisp_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crisp_conversation_notes ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.crisp_workspaces TO authenticated;
GRANT ALL ON TABLE public.crisp_workspaces TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.crisp_conversation_notes TO authenticated;
GRANT ALL ON TABLE public.crisp_conversation_notes TO service_role;

-- RLS Policies for crisp_workspaces
DROP POLICY IF EXISTS "Crisp workspaces access for cs roles" ON public.crisp_workspaces;
CREATE POLICY "Crisp workspaces access for cs roles"
ON public.crisp_workspaces
FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('admin', 'cs_admin', 'cs')
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('admin', 'cs_admin', 'cs')
    )
);

-- RLS Policies for crisp_conversation_notes
DROP POLICY IF EXISTS "Crisp conversation notes access for cs roles" ON public.crisp_conversation_notes;
CREATE POLICY "Crisp conversation notes access for cs roles"
ON public.crisp_conversation_notes
FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('admin', 'cs_admin', 'cs')
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('admin', 'cs_admin', 'cs')
    )
);

-- 7. Add new tables to Realtime Publication
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.crisp_workspaces;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.crisp_conversation_notes;
    END IF;
EXCEPTION
    WHEN OTHERS THEN NULL;
END $$;
