ALTER TABLE public.qualified_leads ADD COLUMN IF NOT EXISTS is_important_by_cs boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS qualified_leads_important_by_cs_idx ON public.qualified_leads (is_important_by_cs DESC, assigned_at DESC);
