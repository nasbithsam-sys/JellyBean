ALTER TABLE public.qualified_leads
  ADD COLUMN IF NOT EXISTS customer_number_2 text;

ALTER TABLE public.raw_lead_cache
  DROP CONSTRAINT IF EXISTS raw_lead_cache_category_chk;

ALTER TABLE public.raw_lead_cache
  ADD CONSTRAINT raw_lead_cache_category_chk
  CHECK (category IS NULL OR category IN ('forwarded','not_found','wrong','duplicate'));
