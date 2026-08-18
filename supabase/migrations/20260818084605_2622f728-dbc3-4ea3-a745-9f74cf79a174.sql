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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crisp_conversations TO authenticated;
GRANT ALL ON public.crisp_conversations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crisp_messages TO authenticated;
GRANT ALL ON public.crisp_messages TO service_role;
GRANT SELECT ON public.crisp_webhook_events TO authenticated;
GRANT ALL ON public.crisp_webhook_events TO service_role;

CREATE INDEX IF NOT EXISTS idx_crisp_conversations_last_message_at ON public.crisp_conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_crisp_messages_conversation_id ON public.crisp_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_crisp_messages_sent_at ON public.crisp_messages(sent_at ASC);

ALTER TABLE public.crisp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crisp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crisp_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Crisp conversations access for cs roles"
ON public.crisp_conversations FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'cs_admin') OR public.has_role(auth.uid(), 'cs'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'cs_admin') OR public.has_role(auth.uid(), 'cs'));

CREATE POLICY "Crisp messages access for cs roles"
ON public.crisp_messages FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'cs_admin') OR public.has_role(auth.uid(), 'cs'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'cs_admin') OR public.has_role(auth.uid(), 'cs'));

CREATE POLICY "Crisp webhook events read for cs roles"
ON public.crisp_webhook_events FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'cs_admin') OR public.has_role(auth.uid(), 'cs'));

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crisp_conversations;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crisp_messages;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;