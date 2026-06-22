ALTER TABLE public.qualified_leads
  ADD COLUMN IF NOT EXISTS reference text;
