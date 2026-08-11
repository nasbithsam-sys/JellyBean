CREATE OR REPLACE FUNCTION public.cs_leads_status_counts()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _all_access boolean;
  _total bigint;
  _by_status jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid
      AND role::text IN ('admin','sub_admin','cs','cs_admin')
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  _all_access := EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid
      AND role::text IN ('admin','sub_admin','cs_admin')
  );

  SELECT count(*)::bigint INTO _total
  FROM public.qualified_leads q
  WHERE _all_access
     OR q.assigned_to = _uid
     OR q.assigned_to IS NULL
     OR q.created_by = _uid;

  SELECT COALESCE(jsonb_object_agg(cs_status::text, cnt), '{}'::jsonb)
    INTO _by_status
  FROM (
    SELECT q.cs_status, count(*)::bigint AS cnt
    FROM public.qualified_leads q
    WHERE _all_access
       OR q.assigned_to = _uid
       OR q.assigned_to IS NULL
       OR q.created_by = _uid
    GROUP BY q.cs_status
  ) s;

  RETURN jsonb_build_object('all', _total, 'statuses', _by_status);
END;
$function$;