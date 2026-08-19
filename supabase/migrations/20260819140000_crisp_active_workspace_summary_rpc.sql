-- Migration: Add last_customer_unread_at column, index, and active workspace summary RPC

-- 1. Add last_customer_unread_at column to crisp_conversations
ALTER TABLE public.crisp_conversations ADD COLUMN IF NOT EXISTS last_customer_unread_at TIMESTAMPTZ;

-- Backfill last_customer_unread_at from latest customer-direction message per conversation
-- This is intentionally conservative: only updates rows with no value yet
UPDATE public.crisp_conversations cc
SET last_customer_unread_at = (
    SELECT MAX(m.sent_at)
    FROM public.crisp_messages m
    WHERE m.conversation_id = cc.id
      AND m.direction = 'incoming'
)
WHERE cc.unread_count > 0
  AND cc.last_customer_unread_at IS NULL;

-- 2. Index for fast unread customer activity lookup
CREATE INDEX IF NOT EXISTS idx_crisp_conversations_customer_unread
ON public.crisp_conversations(crisp_website_id, last_customer_unread_at DESC)
WHERE unread_count > 0;

-- 3. RPC: Summary statistics for ENABLED workspaces only
CREATE OR REPLACE FUNCTION public.get_crisp_workspace_summaries()
RETURNS TABLE (
    crisp_website_id TEXT,
    total_chat_count BIGINT,
    has_unread BOOLEAN,
    latest_unread_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT
        w.crisp_website_id,
        COALESCE(COUNT(c.id), 0)::BIGINT AS total_chat_count,
        COALESCE(BOOL_OR(c.unread_count > 0), FALSE) AS has_unread,
        MAX(CASE WHEN c.unread_count > 0 THEN c.last_customer_unread_at ELSE NULL END) AS latest_unread_at
    FROM public.crisp_workspaces w
    LEFT JOIN public.crisp_conversations c ON w.crisp_website_id = c.crisp_website_id
    WHERE w.enabled = TRUE
    GROUP BY w.crisp_website_id;
$$;

-- 4. Restrict execution: revoke public, grant only to authenticated + service_role
REVOKE ALL ON FUNCTION public.get_crisp_workspace_summaries() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_crisp_workspace_summaries() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_crisp_workspace_summaries() TO service_role;

-- 5. RPC: Paginated conversation list with global unread-first ordering
--    Returns conversations scoped to active (enabled=true) workspaces
--    Ordered globally: unread first, then latest activity
CREATE OR REPLACE FUNCTION public.get_crisp_conversations_page(
    p_website_ids TEXT[],
    p_limit INT DEFAULT 30,
    p_offset INT DEFAULT 0,
    p_search TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    crisp_website_id TEXT,
    crisp_session_id TEXT,
    customer_name TEXT,
    customer_email TEXT,
    customer_phone TEXT,
    customer_avatar TEXT,
    status TEXT,
    last_message TEXT,
    last_message_at TIMESTAMPTZ,
    last_customer_unread_at TIMESTAMPTZ,
    unread_count INT,
    metadata JSONB,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT
        c.id,
        c.crisp_website_id,
        c.crisp_session_id,
        c.customer_name,
        c.customer_email,
        c.customer_phone,
        c.customer_avatar,
        c.status,
        c.last_message,
        c.last_message_at,
        c.last_customer_unread_at,
        c.unread_count,
        c.metadata,
        c.created_at,
        c.updated_at
    FROM public.crisp_conversations c
    WHERE c.crisp_website_id = ANY(p_website_ids)
      AND (
        p_search IS NULL
        OR p_search = ''
        OR c.customer_name ILIKE '%' || p_search || '%'
        OR c.customer_email ILIKE '%' || p_search || '%'
        OR c.last_message ILIKE '%' || p_search || '%'
        OR c.crisp_session_id ILIKE '%' || p_search || '%'
      )
    ORDER BY
        (c.unread_count > 0) DESC,
        c.last_message_at DESC NULLS LAST
    LIMIT p_limit
    OFFSET p_offset;
$$;

REVOKE ALL ON FUNCTION public.get_crisp_conversations_page(TEXT[], INT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_crisp_conversations_page(TEXT[], INT, INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_crisp_conversations_page(TEXT[], INT, INT, TEXT) TO service_role;
