
ALTER TABLE public.incogniton_profiles
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS account_area text,
  ADD COLUMN IF NOT EXISTS launch_history jsonb NOT NULL DEFAULT '[]'::jsonb;
