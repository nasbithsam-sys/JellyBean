ALTER TABLE public.qualified_leads
  ADD COLUMN IF NOT EXISTS requirement_1 text,
  ADD COLUMN IF NOT EXISTS requirement_2 text;

CREATE OR REPLACE FUNCTION public.report_leads_forwarded_by_processor(
  _from timestamp with time zone DEFAULT NULL,
  _to   timestamp with time zone DEFAULT NULL
)
RETURNS TABLE(
  processor_id    uuid,
  processor_name  text,
  processor_email text,
  forwarded_count bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH forwarded AS (
    SELECT
      COALESCE(q.created_by, q.assigned_by) AS user_id,
      COUNT(*)::bigint AS forwarded_count
    FROM public.qualified_leads q
    WHERE (_from IS NULL OR q.assigned_at >= _from)
      AND (_to   IS NULL OR q.assigned_at <  _to)
    GROUP BY COALESCE(q.created_by, q.assigned_by)
  )
  SELECT
    f.user_id AS processor_id,
    COALESCE(NULLIF(BTRIM(p.full_name), ''), p.username, p.email, '(unknown)') AS processor_name,
    p.email AS processor_email,
    f.forwarded_count
  FROM forwarded f
  LEFT JOIN public.profiles p
    ON p.user_id = f.user_id
  ORDER BY f.forwarded_count DESC, processor_name ASC;
$$;

CREATE OR REPLACE FUNCTION public.report_not_found_by_user(
  _from timestamp with time zone DEFAULT NULL,
  _to   timestamp with time zone DEFAULT NULL
)
RETURNS TABLE(
  user_id        uuid,
  user_name      text,
  user_email     text,
  not_found_count bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.categorized_by AS user_id,
    COALESCE(NULLIF(BTRIM(p.full_name), ''), p.username, p.email, '(unknown)') AS user_name,
    p.email AS user_email,
    COUNT(*)::bigint AS not_found_count
  FROM public.raw_lead_cache r
  LEFT JOIN public.profiles p
    ON p.user_id = r.categorized_by
  WHERE r.category = 'not_found'
    AND (_from IS NULL OR r.categorized_at >= _from)
    AND (_to   IS NULL OR r.categorized_at <  _to)
  GROUP BY r.categorized_by, p.full_name, p.username, p.email
  ORDER BY not_found_count DESC, user_name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.report_leads_forwarded_by_processor(timestamp with time zone, timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_not_found_by_user(timestamp with time zone, timestamp with time zone) TO authenticated;
