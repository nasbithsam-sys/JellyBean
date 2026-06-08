
-- Admin-issued, one-time-use login OTP code for marketing/cs users.
-- Stored on profiles; rotates automatically each time it is consumed.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS login_otp text,
  ADD COLUMN IF NOT EXISTS login_otp_updated_at timestamptz;

-- Generator: 6-digit numeric code
CREATE OR REPLACE FUNCTION public.generate_login_otp()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  SELECT lpad((floor(random() * 1000000))::int::text, 6, '0')
$$;
