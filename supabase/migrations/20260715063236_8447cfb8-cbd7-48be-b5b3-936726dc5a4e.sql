-- Fix cs_user_assignment_totals: remove min(uuid), aggregate cleanly
CREATE OR REPLACE FUNCTION public.cs_user_assignment_totals(
  _from timestamp with time zone DEFAULT NULL,
  _to   timestamp with time zone DEFAULT NULL
)
RETURNS TABLE(
  cs_user_id uuid,
  cs_user_name text,
  cs_user_email text,
  assigned_states text[],
  total_leads bigint,
  processed_leads bigint,
  pending_leads bigint,
  by_state jsonb,
  by_status jsonb
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (current_user_has_role_text('admin') OR current_user_has_role_text('cs_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  WITH sa_agg AS (
    SELECT assigned_cs_user_id AS uid,
           array_agg(state_code ORDER BY state_name) AS states
    FROM public.state_assignments
    GROUP BY assigned_cs_user_id
  ),
  leads AS (
    SELECT
      q.assigned_to AS uid,
      COALESCE(q.state_code, public.normalize_us_state(q.main_area), public.normalize_us_state(q.sub_area)) AS sc,
      q.cs_status::text AS status
    FROM public.qualified_leads q
    WHERE q.assigned_to IS NOT NULL
      AND (_from IS NULL OR q.assigned_at >= _from)
      AND (_to   IS NULL OR q.assigned_at <  _to)
  ),
  totals AS (
    SELECT uid,
           count(*)::bigint AS total,
           count(*) FILTER (WHERE status = 'converted')::bigint AS processed,
           count(*) FILTER (WHERE status IS NOT NULL AND status <> 'converted')::bigint AS pending
    FROM leads
    GROUP BY uid
  ),
  by_state_agg AS (
    SELECT uid, jsonb_object_agg(sc, c) AS m
    FROM (
      SELECT uid, sc, count(*)::bigint AS c
      FROM leads WHERE sc IS NOT NULL
      GROUP BY uid, sc
    ) s
    GROUP BY uid
  ),
  by_status_agg AS (
    SELECT uid, jsonb_object_agg(status, c) AS m
    FROM (
      SELECT uid, status, count(*)::bigint AS c
      FROM leads WHERE status IS NOT NULL
      GROUP BY uid, status
    ) s
    GROUP BY uid
  ),
  users AS (
    SELECT uid FROM totals
    UNION
    SELECT uid FROM sa_agg
  )
  SELECT
    u.uid,
    COALESCE(NULLIF(BTRIM(p.full_name), ''), NULLIF(BTRIM(p.username), ''), p.email),
    p.email,
    COALESCE(sa.states, ARRAY[]::text[]),
    COALESCE(t.total, 0),
    COALESCE(t.processed, 0),
    COALESCE(t.pending, 0),
    COALESCE(bs.m, '{}'::jsonb),
    COALESCE(bst.m, '{}'::jsonb)
  FROM users u
  LEFT JOIN public.profiles p ON p.user_id = u.uid
  LEFT JOIN sa_agg sa ON sa.uid = u.uid
  LEFT JOIN totals t ON t.uid = u.uid
  LEFT JOIN by_state_agg bs ON bs.uid = u.uid
  LEFT JOIN by_status_agg bst ON bst.uid = u.uid
  ORDER BY COALESCE(t.total, 0) DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.cs_user_assignment_totals(timestamp with time zone, timestamp with time zone) TO authenticated;

-- Fix list_state_assignments: single scan of qualified_leads
CREATE OR REPLACE FUNCTION public.list_state_assignments()
RETURNS TABLE(
  state_code text,
  state_name text,
  assigned_cs_user_id uuid,
  cs_user_name text,
  cs_user_email text,
  total_leads bigint,
  updated_at timestamp with time zone
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (current_user_has_role_text('admin') OR current_user_has_role_text('cs_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  WITH resolved AS (
    SELECT COALESCE(q.state_code, public.normalize_us_state(q.main_area), public.normalize_us_state(q.sub_area)) AS sc
    FROM public.qualified_leads q
  ),
  counts AS (
    SELECT sc, count(*)::bigint AS c
    FROM resolved
    WHERE sc IS NOT NULL
    GROUP BY sc
  )
  SELECT
    sa.state_code,
    sa.state_name,
    sa.assigned_cs_user_id,
    COALESCE(NULLIF(BTRIM(p.full_name), ''), NULLIF(BTRIM(p.username), ''), p.email),
    p.email,
    COALESCE(c.c, 0),
    sa.updated_at
  FROM public.state_assignments sa
  LEFT JOIN public.profiles p ON p.user_id = sa.assigned_cs_user_id
  LEFT JOIN counts c ON c.sc = sa.state_code
  ORDER BY sa.state_name;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.list_state_assignments() TO authenticated;

-- Ensure PostgREST notices the changed signatures
NOTIFY pgrst, 'reload schema';
