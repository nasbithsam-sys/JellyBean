
-- Shared key/value app settings (for syncing the Raw Leads "next start row" across all users)
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read app_settings"
  ON public.app_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert app_settings"
  ON public.app_settings FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can update app_settings"
  ON public.app_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Add the google sheet row index to raw_lead_cache (for display + reference)
ALTER TABLE public.raw_lead_cache
  ADD COLUMN IF NOT EXISTS sheet_row INTEGER;

CREATE INDEX IF NOT EXISTS idx_raw_lead_cache_sheet_row ON public.raw_lead_cache(sheet_row);
