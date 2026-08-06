CREATE INDEX IF NOT EXISTS idx_rlc_category_assigned ON public.raw_lead_cache (category, assigned_to) WHERE category IS NOT NULL;

CREATE OR REPLACE FUNCTION public.raw_lead_cache_category_counts(_user_id uuid, _is_admin boolean DEFAULT false)
 RETURNS TABLE(new bigint, forwarded bigint, not_found bigint, wrong bigint, duplicate bigint, assigned_myself bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  effective_admin boolean;
  uid uuid;
BEGIN
  effective_admin := current_user_has_role_text('admin') OR current_user_has_role_text('sub_admin');
  uid := auth.uid();

  RETURN QUERY
  SELECT
    (SELECT count(*) FROM public.raw_lead_cache r
      WHERE r.category IS NULL AND r.assigned_myself_at IS NULL
        AND (effective_admin OR r.assigned_to IS NULL OR r.assigned_to = uid)),
    (SELECT count(*) FROM public.raw_lead_cache r
      WHERE r.category = 'forwarded'
        AND (effective_admin OR r.assigned_to IS NULL OR r.assigned_to = uid)),
    (SELECT count(*) FROM public.raw_lead_cache r
      WHERE r.category = 'not_found'
        AND (effective_admin OR r.assigned_to IS NULL OR r.assigned_to = uid)),
    (SELECT count(*) FROM public.raw_lead_cache r
      WHERE r.category = 'wrong'
        AND (effective_admin OR r.assigned_to IS NULL OR r.assigned_to = uid)),
    (SELECT count(*) FROM public.raw_lead_cache r
      WHERE r.category = 'duplicate'
        AND (effective_admin OR r.assigned_to IS NULL OR r.assigned_to = uid)),
    (SELECT count(*) FROM public.raw_lead_cache r
      WHERE r.category IS NULL AND r.assigned_myself_at IS NOT NULL AND r.assigned_to = uid);
END;
$function$;