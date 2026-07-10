
DROP FUNCTION IF EXISTS public.raw_lead_cache_category_counts(uuid, boolean);

CREATE OR REPLACE FUNCTION public.raw_lead_cache_category_counts(_user_id uuid, _is_admin boolean DEFAULT false)
 RETURNS TABLE(new bigint, forwarded bigint, not_found bigint, wrong bigint, duplicate bigint, assigned_myself bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  effective_admin boolean;
BEGIN
  effective_admin := current_user_has_role_text('admin') OR current_user_has_role_text('sub_admin');
  RETURN QUERY
  SELECT
    count(*) FILTER (WHERE category IS NULL AND assigned_myself_at IS NULL),
    count(*) FILTER (WHERE category = 'forwarded'),
    count(*) FILTER (WHERE category = 'not_found'),
    count(*) FILTER (WHERE category = 'wrong'),
    count(*) FILTER (WHERE category = 'duplicate'),
    count(*) FILTER (WHERE category IS NULL AND assigned_myself_at IS NOT NULL AND assigned_to = auth.uid())
  FROM public.raw_lead_cache
  WHERE effective_admin
     OR assigned_to IS NULL
     OR assigned_to = auth.uid();
END;
$function$;
