CREATE OR REPLACE FUNCTION public.report_leads_by_account()
RETURNS TABLE(account text, yes_count bigint, no_count bigint, pending_count bigint, total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE(NULLIF(TRIM(data->>'Account Name'), ''), '(unknown)') AS account,
    COUNT(*) FILTER (WHERE lead = 'yes')::bigint AS yes_count,
    COUNT(*) FILTER (WHERE lead = 'no')::bigint AS no_count,
    COUNT(*) FILTER (WHERE lead IS NULL)::bigint AS pending_count,
    COUNT(*)::bigint AS total_count
  FROM public.raw_lead_cache
  GROUP BY 1
  ORDER BY total_count DESC, account ASC
$$;
GRANT EXECUTE ON FUNCTION public.report_leads_by_account() TO authenticated;