-- Migration: Create Crisp Chat tables, RLS policies, and Realtime settings
-- Access restricted strictly to admin, cs_admin, and cs roles.

CREATE TABLE IF NOT EXISTS public.crisp_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    crisp_session_id TEXT UNIQUE NOT NULL,
    crisp_website_id TEXT NOT NULL,
    customer_name TEXT,
    customer_email TEXT,
    customer_phone TEXT,
    customer_avatar TEXT,
    status TEXT DEFAULT 'unresolved',
    last_message TEXT,
    last_message_at TIMESTAMPTZ DEFAULT NOW(),
    unread_count INT DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.crisp_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.crisp_conversations(id) ON DELETE CASCADE,
    crisp_session_id TEXT NOT NULL,
    crisp_message_id TEXT UNIQUE,
    sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'customer', 'operator')),
    direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
    content TEXT NOT NULL,
    message_type TEXT DEFAULT 'text',
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    raw_payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.crisp_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_fingerprint TEXT UNIQUE NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    processed BOOLEAN DEFAULT TRUE,
    error TEXT,
    received_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance and deduplication queries
CREATE INDEX IF NOT EXISTS idx_crisp_conversations_session_id ON public.crisp_conversations(crisp_session_id);
CREATE INDEX IF NOT EXISTS idx_crisp_conversations_last_message_at ON public.crisp_conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_crisp_messages_conversation_id ON public.crisp_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_crisp_messages_crisp_message_id ON public.crisp_messages(crisp_message_id);
CREATE INDEX IF NOT EXISTS idx_crisp_messages_sent_at ON public.crisp_messages(sent_at ASC);

-- Enable RLS on Crisp tables
ALTER TABLE public.crisp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crisp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crisp_webhook_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Strictly limit access to admin, cs_admin, and cs roles only
CREATE POLICY "Allow Crisp conversations access to admin, cs_admin, cs"
ON public.crisp_conversations
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

CREATE POLICY "Allow Crisp messages access to admin, cs_admin, cs"
ON public.crisp_messages
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

CREATE POLICY "Allow Crisp webhook events read to admin, cs_admin, cs"
ON public.crisp_webhook_events
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('admin', 'cs_admin', 'cs')
    )
);

-- Realtime Publication for Crisp tables
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.crisp_conversations;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.crisp_messages;
    END IF;
EXCEPTION
    WHEN OTHERS THEN NULL;
END $$;
