REVOKE ALL ON FUNCTION public.raw_lead_count_key(text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.adjust_raw_lead_cache_count(text, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_raw_lead_cache_counts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raw_lead_cache_category_counts_json(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.raw_lead_cache_category_counts_json(uuid, boolean) TO authenticated, service_role;