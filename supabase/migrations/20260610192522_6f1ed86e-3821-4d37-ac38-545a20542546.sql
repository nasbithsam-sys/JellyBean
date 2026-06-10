CREATE OR REPLACE FUNCTION public.report_leads_by_account()
RETURNS TABLE(account text, yes_count bigint, no_count bigint, pending_count bigint, total_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT
    COALESCE(NULLIF(TRIM(data->>'Account Name'), ''), '(unknown)') AS account,
    COUNT(*) FILTER (WHERE lead = 'yes')::bigint,
    COUNT(*) FILTER (WHERE lead = 'no')::bigint,
    COUNT(*) FILTER (WHERE lead IS NULL)::bigint,
    COUNT(*)::bigint
  FROM public.raw_lead_cache
  GROUP BY 1
  ORDER BY 5 DESC, 1 ASC
$$;
REVOKE ALL ON FUNCTION public.report_leads_by_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_leads_by_account() TO authenticated;