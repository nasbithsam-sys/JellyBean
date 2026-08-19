-- Migration: Add last_customer_unread_at column, index, and active workspace summary RPC

-- 1. Add last_customer_unread_at column to crisp_conversations
ALTER TABLE public.crisp_conversations ADD COLUMN IF NOT EXISTS last_customer_unread_at TIMESTAMPTZ;

-- Backfill last_customer_unread_at for existing unread conversations
UPDATE public.crisp_conversations
SET last_customer_unread_at = last_message_at
WHERE (unread_count > 0 OR unread_count IS NULL) AND last_customer_unread_at IS NULL;

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
