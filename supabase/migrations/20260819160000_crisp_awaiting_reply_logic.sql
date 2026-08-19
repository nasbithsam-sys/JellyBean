-- Migration: Update Crisp unread/needs-reply logic and workspace summaries

-- 1. Recalculate unread_count and last_customer_unread_at for all conversations
-- A conversation needs reply (unread_count = 1) IF its newest customer message
-- is newer than its newest operator reply (or if no operator reply exists).
WITH conversation_latest_msgs AS (
    SELECT
        conversation_id,
        MAX(CASE WHEN direction = 'incoming' OR sender_type = 'customer' OR sender_type = 'user' THEN sent_at ELSE NULL END) AS latest_customer_at,
        MAX(CASE WHEN direction = 'outgoing' OR sender_type = 'operator' THEN sent_at ELSE NULL END) AS latest_operator_at
    FROM public.crisp_messages
    GROUP BY conversation_id
)
UPDATE public.crisp_conversations cc
SET
    unread_count = CASE
        WHEN clm.latest_customer_at IS NOT NULL AND (clm.latest_operator_at IS NULL OR clm.latest_customer_at > clm.latest_operator_at)
        THEN 1
        ELSE 0
    END,
    last_customer_unread_at = CASE
        WHEN clm.latest_customer_at IS NOT NULL AND (clm.latest_operator_at IS NULL OR clm.latest_customer_at > clm.latest_operator_at)
        THEN clm.latest_customer_at
        ELSE NULL
    END
FROM conversation_latest_msgs clm
WHERE cc.id = clm.conversation_id;

-- 2. Update get_crisp_workspace_summaries RPC to return unreplied_chat_count
CREATE OR REPLACE FUNCTION public.get_crisp_workspace_summaries()
RETURNS TABLE (
    crisp_website_id TEXT,
    unreplied_chat_count BIGINT,
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
        COALESCE(COUNT(c.id) FILTER (WHERE c.unread_count > 0), 0)::BIGINT AS unreplied_chat_count,
        COALESCE(COUNT(c.id), 0)::BIGINT AS total_chat_count,
        COALESCE(BOOL_OR(c.unread_count > 0), FALSE) AS has_unread,
        MAX(CASE WHEN c.unread_count > 0 THEN c.last_customer_unread_at ELSE NULL END) AS latest_unread_at
    FROM public.crisp_workspaces w
    LEFT JOIN public.crisp_conversations c ON w.crisp_website_id = c.crisp_website_id
    WHERE w.enabled = TRUE
    GROUP BY w.crisp_website_id;
$$;

REVOKE ALL ON FUNCTION public.get_crisp_workspace_summaries() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_crisp_workspace_summaries() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_crisp_workspace_summaries() TO service_role;

-- 3. Ensure get_crisp_conversations_page globally orders unread/needs-reply first
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
