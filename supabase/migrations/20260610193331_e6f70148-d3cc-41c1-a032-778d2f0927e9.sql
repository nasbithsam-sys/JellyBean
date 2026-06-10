CREATE OR REPLACE FUNCTION public.report_leads_by_account(
  _from timestamptz DEFAULT NULL,
  _to timestamptz DEFAULT NULL
)
RETURNS TABLE(account text, yes_count bigint, no_count bigint, pending_count bigint, total_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT
    COALESCE(NULLIF(TRIM(data->>'Incog Account'), ''), '(unknown)') AS account,
    COUNT(*) FILTER (WHERE lead = 'yes')::bigint,
    COUNT(*) FILTER (WHERE lead = 'no')::bigint,
    COUNT(*) FILTER (WHERE lead IS NULL)::bigint,
    COUNT(*)::bigint
  FROM public.raw_lead_cache
  WHERE (_from IS NULL OR captured_at >= _from)
    AND (_to IS NULL OR captured_at < _to)
  GROUP BY 1
  ORDER BY 5 DESC, 1 ASC
$$;