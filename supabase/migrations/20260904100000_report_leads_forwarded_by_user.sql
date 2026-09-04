-- Migration: Report leads forwarded per user with complete lead status breakdown
-- Returns total forwarded leads per user and jsonb status_counts containing counts for every cs_status.

CREATE OR REPLACE FUNCTION public.report_leads_forwarded_by_user(
  _from timestamp with time zone DEFAULT NULL,
  _to timestamp with time zone DEFAULT NULL
)
RETURNS TABLE(
  user_id uuid,
  user_name text,
  user_email text,
  forwarded_count bigint,
  status_counts jsonb
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (current_user_has_role_text('admin') OR current_user_has_role_text('sub_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  WITH forwarded AS (
    SELECT
      COALESCE(q.created_by, q.assigned_by) AS f_user_id,
      COALESCE(q.cs_status::text, 'new') AS f_status,
      COUNT(*)::bigint AS f_count
    FROM public.qualified_leads q
    WHERE (_from IS NULL OR q.assigned_at >= _from)
      AND (_to IS NULL OR q.assigned_at <  _to)
    GROUP BY COALESCE(q.created_by, q.assigned_by), COALESCE(q.cs_status::text, 'new')
  ),
  aggregated AS (
    SELECT
      f.f_user_id AS uid,
      SUM(f.f_count)::bigint AS total_forwarded,
      jsonb_object_agg(f.f_status, f.f_count) AS statuses
    FROM forwarded f
    GROUP BY f.f_user_id
  )
  SELECT
    a.uid,
    COALESCE(
      NULLIF(BTRIM(p.full_name), ''),
      NULLIF(BTRIM(p.username), ''),
      NULLIF(BTRIM(au.raw_user_meta_data->>'full_name'), ''),
      NULLIF(BTRIM(au.raw_user_meta_data->>'name'), ''),
      NULLIF(BTRIM(p.email), ''),
      NULLIF(BTRIM(au.email), '')
    ) AS user_name,
    COALESCE(NULLIF(BTRIM(p.email), ''), NULLIF(BTRIM(au.email), '')) AS user_email,
    a.total_forwarded AS forwarded_count,
    COALESCE(a.statuses, '{}'::jsonb) AS status_counts
  FROM aggregated a
  LEFT JOIN LATERAL (
    SELECT p1.full_name, p1.username, p1.email
    FROM public.profiles p1
    WHERE p1.user_id = a.uid OR p1.id = a.uid
    ORDER BY CASE WHEN p1.user_id = a.uid THEN 0 ELSE 1 END
    LIMIT 1
  ) p ON TRUE
  LEFT JOIN auth.users au ON au.id = a.uid
  WHERE a.uid IS NOT NULL
    AND COALESCE(
      NULLIF(BTRIM(p.full_name), ''),
      NULLIF(BTRIM(p.username), ''),
      NULLIF(BTRIM(au.raw_user_meta_data->>'full_name'), ''),
      NULLIF(BTRIM(au.raw_user_meta_data->>'name'), ''),
      NULLIF(BTRIM(p.email), ''),
      NULLIF(BTRIM(au.email), '')
    ) IS NOT NULL
  ORDER BY a.total_forwarded DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.report_leads_forwarded_by_user(timestamp with time zone, timestamp with time zone) TO authenticated;

-- Backwards-compatibility proxy for existing callers (e.g. app.analytics.tsx)
CREATE OR REPLACE FUNCTION public.report_leads_forwarded_by_maturing(
  _from timestamp with time zone DEFAULT NULL,
  _to timestamp with time zone DEFAULT NULL
)
RETURNS TABLE(
  maturing_id uuid,
  maturing_name text,
  maturing_email text,
  forwarded_count bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT u.user_id, u.user_name, u.user_email, u.forwarded_count
  FROM public.report_leads_forwarded_by_user(_from, _to) u;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.report_leads_forwarded_by_maturing(timestamp with time zone, timestamp with time zone) TO authenticated;
