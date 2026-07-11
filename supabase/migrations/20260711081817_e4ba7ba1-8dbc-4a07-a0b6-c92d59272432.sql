CREATE INDEX IF NOT EXISTS idx_raw_lead_cache_new_tab
  ON public.raw_lead_cache (captured_at DESC)
  WHERE category IS NULL AND assigned_myself_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_raw_lead_cache_assigned_myself
  ON public.raw_lead_cache (assigned_to, captured_at DESC)
  WHERE assigned_myself_at IS NOT NULL AND category IS NULL;

CREATE INDEX IF NOT EXISTS idx_raw_lead_cache_category_captured
  ON public.raw_lead_cache (category, captured_at DESC)
  WHERE category IS NOT NULL;

ANALYZE public.raw_lead_cache;
ANALYZE public.qualified_leads;