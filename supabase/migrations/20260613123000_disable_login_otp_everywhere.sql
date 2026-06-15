UPDATE public.profiles
SET
  otp_required = false,
  login_otp = null,
  login_otp_updated_at = null,
  otp_verified_at = null;

UPDATE public.app_settings
SET
  admin_otp_required = false,
  updated_at = now();
