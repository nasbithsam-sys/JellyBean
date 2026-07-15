ALTER TABLE public.qualified_leads
  ADD COLUMN IF NOT EXISTS is_landline boolean NOT NULL DEFAULT false;