
-- 1) Hide login_otp columns from authenticated/anon (admin reads via service_role / SECURITY DEFINER paths)
REVOKE SELECT (login_otp, login_otp_updated_at) ON public.profiles FROM authenticated;
REVOKE SELECT (login_otp, login_otp_updated_at) ON public.profiles FROM anon;
REVOKE UPDATE (login_otp, login_otp_updated_at) ON public.profiles FROM authenticated;
REVOKE UPDATE (login_otp, login_otp_updated_at) ON public.profiles FROM anon;

-- 2) Track server-side OTP verification timestamp (not user-writable)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS otp_verified_at timestamptz;

REVOKE UPDATE (otp_verified_at) ON public.profiles FROM authenticated;
REVOKE UPDATE (otp_verified_at) ON public.profiles FROM anon;

-- 3) Enable RLS on extension_devices (admin/service_role only)
ALTER TABLE public.extension_devices ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.extension_devices TO service_role;
REVOKE ALL ON public.extension_devices FROM anon;
GRANT SELECT ON public.extension_devices TO authenticated;
DROP POLICY IF EXISTS "extension_devices: admin manages" ON public.extension_devices;
CREATE POLICY "extension_devices: admin manages"
  ON public.extension_devices
  FOR ALL
  TO authenticated
  USING (public.current_user_has_role('admin'::app_role))
  WITH CHECK (public.current_user_has_role('admin'::app_role));

-- 4) Enable RLS on extension_licenses (admin/service_role only)
ALTER TABLE public.extension_licenses ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.extension_licenses TO service_role;
REVOKE ALL ON public.extension_licenses FROM anon;
GRANT SELECT ON public.extension_licenses TO authenticated;
DROP POLICY IF EXISTS "extension_licenses: admin manages" ON public.extension_licenses;
CREATE POLICY "extension_licenses: admin manages"
  ON public.extension_licenses
  FOR ALL
  TO authenticated
  USING (public.current_user_has_role('admin'::app_role))
  WITH CHECK (public.current_user_has_role('admin'::app_role));
