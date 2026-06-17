CREATE OR REPLACE FUNCTION public.raw_lead_cache_category_counts(_user_id uuid, _is_admin boolean)
RETURNS TABLE(new bigint, forwarded bigint, not_found bigint, wrong bigint, duplicate bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    COUNT(*) FILTER (WHERE category IS NULL)::bigint AS new,
    COUNT(*) FILTER (WHERE category = 'forwarded')::bigint AS forwarded,
    COUNT(*) FILTER (WHERE category = 'not_found')::bigint AS not_found,
    COUNT(*) FILTER (WHERE category = 'wrong')::bigint AS wrong,
    COUNT(*) FILTER (WHERE category = 'duplicate')::bigint AS duplicate
  FROM public.raw_lead_cache
  WHERE _is_admin OR assigned_to IS NULL OR assigned_to = _user_id
$$;

GRANT EXECUTE ON FUNCTION public.raw_lead_cache_category_counts(uuid, boolean) TO authenticated, service_role;