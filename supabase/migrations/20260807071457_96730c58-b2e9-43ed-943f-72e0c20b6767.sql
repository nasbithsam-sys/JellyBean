CREATE INDEX IF NOT EXISTS idx_raw_lead_cache_captured_at_category
  ON public.raw_lead_cache (captured_at, category);

ANALYZE public.raw_lead_cache;