ALTER TABLE public.qualified_leads
  ADD COLUMN IF NOT EXISTS zipcode text,
  ADD COLUMN IF NOT EXISTS address text;
