CREATE OR REPLACE FUNCTION public.report_not_found_by_user(_from timestamp with time zone DEFAULT NULL, _to timestamp with time zone DEFAULT NULL)
 RETURNS TABLE(user_id uuid, user_name text, user_email text, not_found_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (current_user_has_role_text('admin') OR current_user_has_role_text('sub_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY
  SELECT
    r.categorized_by,
    COALESCE(p.full_name, p.username, p.email, 
             CASE 
               WHEN r.categorized_by IS NULL THEN '(unknown)' 
               ELSE 'Unknown user ' || substr(r.categorized_by::text, 1, 8) 
             END),
    p.email,
    COUNT(*)::bigint
  FROM public.raw_lead_cache r
  LEFT JOIN public.profiles p ON p.user_id = r.categorized_by
  WHERE r.category = 'not_found'
    AND (_from IS NULL OR r.categorized_at >= _from)
    AND (_to   IS NULL OR r.categorized_at <  _to)
  GROUP BY r.categorized_by, p.full_name, p.username, p.email
  ORDER BY COUNT(*) DESC;
END;
$function$;
