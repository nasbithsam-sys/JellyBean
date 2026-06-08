
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS incogniton_profile_id text,
  ADD COLUMN IF NOT EXISTS profile_group text,
  ADD COLUMN IF NOT EXISTS imported_at timestamptz,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

CREATE UNIQUE INDEX IF NOT EXISTS accounts_incogniton_profile_id_key
  ON public.accounts (incogniton_profile_id)
  WHERE incogniton_profile_id IS NOT NULL;

ALTER TABLE public.accounts ALTER COLUMN latitude DROP NOT NULL;
ALTER TABLE public.accounts ALTER COLUMN longitude DROP NOT NULL;
ALTER TABLE public.accounts ALTER COLUMN area DROP NOT NULL;

ALTER TYPE public.cs_status ADD VALUE IF NOT EXISTS 'not_interested';
ALTER TYPE public.cs_status ADD VALUE IF NOT EXISTS 'already_done';
ALTER TYPE public.cs_status ADD VALUE IF NOT EXISTS 'no_response';
