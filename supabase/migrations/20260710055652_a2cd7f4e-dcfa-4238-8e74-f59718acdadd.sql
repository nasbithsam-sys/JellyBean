
CREATE OR REPLACE FUNCTION public.cs_leads_status_counts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _total bigint;
  _by_status jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role::text IN ('admin','sub_admin','cs')
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT count(*)::bigint INTO _total FROM public.qualified_leads;

  SELECT COALESCE(jsonb_object_agg(cs_status::text, cnt), '{}'::jsonb)
    INTO _by_status
  FROM (
    SELECT cs_status, count(*)::bigint AS cnt
    FROM public.qualified_leads
    GROUP BY cs_status
  ) s;

  RETURN jsonb_build_object('all', _total, 'statuses', _by_status);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cs_leads_status_counts() TO authenticated;

DROP INDEX IF EXISTS public.raw_lead_cache_categorized_by_idx1;
DROP INDEX IF EXISTS public.raw_lead_cache_category_idx1;
DROP INDEX IF EXISTS public.raw_lead_cache_category_idx2;
DROP INDEX IF EXISTS public.raw_lead_cache_captured_at_idx;
