-- Migration: Function to calculate accurate today's visitors count
-- Accurately counts visitors whose session started today (first message or session creation >= today_start)
-- Properly ignores old conversations from previous days/weeks even if replied to today.

CREATE OR REPLACE FUNCTION public.get_crisp_today_visitors_summary(p_today_start TIMESTAMPTZ)
RETURNS TABLE (
    crisp_website_id TEXT,
    today_visitor_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    WITH conv_first_msg AS (
        SELECT 
            c.id AS conversation_id,
            c.crisp_website_id,
            c.created_at AS conv_created_at,
            MIN(m.sent_at) AS first_msg_at,
            COUNT(m.id) AS msg_count
        FROM public.crisp_conversations c
        LEFT JOIN public.crisp_messages m ON m.conversation_id = c.id
        GROUP BY c.id, c.crisp_website_id, c.created_at
    ),
    today_convs AS (
        SELECT 
            crisp_website_id,
            conversation_id
        FROM conv_first_msg
        WHERE 
            (msg_count > 0 AND first_msg_at >= p_today_start)
            OR
            (msg_count = 0 AND conv_created_at >= p_today_start)
    )
    SELECT 
        w.crisp_website_id,
        COUNT(tc.conversation_id)::BIGINT AS today_visitor_count
    FROM public.crisp_workspaces w
    LEFT JOIN today_convs tc ON tc.crisp_website_id = w.crisp_website_id
    WHERE w.enabled = true
    GROUP BY w.crisp_website_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_crisp_today_visitors_summary(TIMESTAMPTZ) TO authenticated, service_role, anon;
