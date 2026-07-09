ALTER TABLE public.raw_lead_cache 
  ADD COLUMN IF NOT EXISTS duplicate_detected boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS duplicate_reason text,
  ADD COLUMN IF NOT EXISTS duplicate_match_type text,
  ADD COLUMN IF NOT EXISTS duplicate_key text,
  ADD COLUMN IF NOT EXISTS duplicate_of_raw_lead_id uuid,
  ADD COLUMN IF NOT EXISTS duplicate_of_qualified_lead_id uuid,
  ADD COLUMN IF NOT EXISTS canonical_post_id text,
  ADD COLUMN IF NOT EXISTS canonical_lead_link text;

CREATE INDEX IF NOT EXISTS idx_raw_lead_canonical_post_id ON public.raw_lead_cache(canonical_post_id) WHERE canonical_post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_raw_lead_canonical_lead_link ON public.raw_lead_cache(canonical_lead_link) WHERE canonical_lead_link IS NOT NULL;

ALTER TABLE public.qualified_leads 
  ADD COLUMN IF NOT EXISTS canonical_post_id text,
  ADD COLUMN IF NOT EXISTS canonical_lead_link text;

CREATE INDEX IF NOT EXISTS idx_qualified_leads_canonical_post_id ON public.qualified_leads(canonical_post_id) WHERE canonical_post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qualified_leads_canonical_lead_link ON public.qualified_leads(canonical_lead_link) WHERE canonical_lead_link IS NOT NULL;