CREATE INDEX IF NOT EXISTS idx_raw_lead_cache_lead ON public.raw_lead_cache(lead);

DROP TABLE IF EXISTS public.extension_devices;
DROP TABLE IF EXISTS public.extension_licenses;