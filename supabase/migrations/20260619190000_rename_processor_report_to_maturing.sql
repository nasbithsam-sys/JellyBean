-- Create the new function with maturing naming
CREATE OR REPLACE FUNCTION public.report_leads_forwarded_by_maturing(
  _from timestamp with time zone DEFAULT NULL,
  _to   timestamp with time zone DEFAULT NULL
)
RETURNS TABLE(
  maturing_id    uuid,
  maturing_name  text,
  maturing_email text,
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
    f.user_id AS maturing_id,
    COALESCE(
      NULLIF(BTRIM(p.full_name), ''),
      NULLIF(BTRIM(p.username), ''),
      NULLIF(BTRIM(au.raw_user_meta_data->>'full_name'), ''),
      NULLIF(BTRIM(au.raw_user_meta_data->>'name'), ''),
      NULLIF(BTRIM(p.email), ''),
      NULLIF(BTRIM(au.email), ''),
      CASE
        WHEN f.user_id IS NULL THEN '(unknown)'
        ELSE 'Unknown user ' || LEFT(f.user_id::text, 8)
      END
    ) AS maturing_name,
    COALESCE(NULLIF(BTRIM(p.email), ''), NULLIF(BTRIM(au.email), '')) AS maturing_email,
    f.forwarded_count
  FROM forwarded f
  LEFT JOIN LATERAL (
    SELECT p1.full_name, p1.username, p1.email
    FROM public.profiles p1
    WHERE p1.user_id = f.user_id
       OR p1.id = f.user_id
    ORDER BY CASE WHEN p1.user_id = f.user_id THEN 0 ELSE 1 END
    LIMIT 1
  ) p ON TRUE
  LEFT JOIN auth.users au
    ON au.id = f.user_id
  ORDER BY f.forwarded_count DESC, maturing_name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.report_leads_forwarded_by_maturing(timestamp with time zone, timestamp with time zone) TO authenticated;

-- Drop the old processor report function
DROP FUNCTION IF EXISTS public.report_leads_forwarded_by_processor(timestamp with time zone, timestamp with time zone);
