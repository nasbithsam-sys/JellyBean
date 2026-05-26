ALTER TABLE public.incogniton_profiles
  ADD COLUMN IF NOT EXISTS launched_by_name  text,
  ADD COLUMN IF NOT EXISTS launched_by_email text;