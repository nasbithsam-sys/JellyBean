CREATE TABLE public.raw_lead_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  row_key text NOT NULL UNIQUE,
  data jsonb NOT NULL,
  lead text,
  phone text,
  category text,
  captured_at timestamptz,
  lead_link text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT raw_lead_cache_lead_chk CHECK (lead IS NULL OR lead IN ('yes','no')),
  CONSTRAINT raw_lead_cache_category_chk CHECK (category IS NULL OR category IN ('forwarded','not_found','wrong'))
);

CREATE INDEX raw_lead_cache_category_idx ON public.raw_lead_cache(category);
CREATE INDEX raw_lead_cache_captured_at_idx ON public.raw_lead_cache(captured_at DESC);

ALTER TABLE public.raw_lead_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "raw_lead_cache: marketing+admin read"
  ON public.raw_lead_cache FOR SELECT
  TO authenticated
  USING (current_user_has_role('admin'::app_role) OR current_user_has_role('marketing'::app_role));

CREATE POLICY "raw_lead_cache: marketing+admin insert"
  ON public.raw_lead_cache FOR INSERT
  TO authenticated
  WITH CHECK (current_user_has_role('admin'::app_role) OR current_user_has_role('marketing'::app_role));

CREATE POLICY "raw_lead_cache: marketing+admin update"
  ON public.raw_lead_cache FOR UPDATE
  TO authenticated
  USING (current_user_has_role('admin'::app_role) OR current_user_has_role('marketing'::app_role))
  WITH CHECK (current_user_has_role('admin'::app_role) OR current_user_has_role('marketing'::app_role));

CREATE POLICY "raw_lead_cache: admin delete"
  ON public.raw_lead_cache FOR DELETE
  TO authenticated
  USING (current_user_has_role('admin'::app_role));

CREATE TRIGGER raw_lead_cache_updated_at
  BEFORE UPDATE ON public.raw_lead_cache
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();