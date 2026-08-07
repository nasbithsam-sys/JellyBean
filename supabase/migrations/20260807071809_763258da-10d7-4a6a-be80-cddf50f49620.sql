CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- 1) Webhook duplicate lookup: data->>'Posted Date & Time' = ANY(...)
CREATE INDEX IF NOT EXISTS idx_raw_lead_cache_posted_datetime
  ON public.raw_lead_cache ((data ->> 'Posted Date & Time'));

-- 2) Per-user category buckets (category + categorized_by)
CREATE INDEX IF NOT EXISTS idx_raw_lead_cache_categorized_by_category
  ON public.raw_lead_cache (categorized_by, category);

-- 3) CS Pipeline keyword filters (ILIKE %term% across several columns)
CREATE INDEX IF NOT EXISTS idx_qleads_trgm_service
  ON public.qualified_leads USING gin (service extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_qleads_trgm_pass_it_to
  ON public.qualified_leads USING gin (pass_it_to extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_qleads_trgm_context
  ON public.qualified_leads USING gin (context extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_qleads_trgm_post_text
  ON public.qualified_leads USING gin (post_text extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_qleads_trgm_requirement_1
  ON public.qualified_leads USING gin (requirement_1 extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_qleads_trgm_requirement_2
  ON public.qualified_leads USING gin (requirement_2 extensions.gin_trgm_ops);

ANALYZE public.raw_lead_cache;
ANALYZE public.qualified_leads;