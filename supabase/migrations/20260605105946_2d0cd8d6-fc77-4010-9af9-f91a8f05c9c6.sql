
-- 1) Lock down login_otp self-write via profiles RLS
DROP POLICY IF EXISTS "profiles: user updates own" ON public.profiles;
CREATE POLICY "profiles: user updates own"
  ON public.profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND is_active = (SELECT p.is_active FROM public.profiles p WHERE p.user_id = auth.uid())
    AND otp_required = (SELECT p.otp_required FROM public.profiles p WHERE p.user_id = auth.uid())
    AND email = (SELECT p.email FROM public.profiles p WHERE p.user_id = auth.uid())
    AND username IS NOT DISTINCT FROM (SELECT p.username FROM public.profiles p WHERE p.user_id = auth.uid())
    AND login_otp IS NOT DISTINCT FROM (SELECT p.login_otp FROM public.profiles p WHERE p.user_id = auth.uid())
    AND login_otp_updated_at IS NOT DISTINCT FROM (SELECT p.login_otp_updated_at FROM public.profiles p WHERE p.user_id = auth.uid())
  );

-- 2) Add processor role to realtime channel subscription policy
DROP POLICY IF EXISTS "realtime: authorized roles can subscribe" ON realtime.messages;
CREATE POLICY "realtime: authorized roles can subscribe"
  ON realtime.messages FOR SELECT TO authenticated
  USING (
    public.current_user_has_role('admin'::app_role)
    OR public.current_user_has_role('cs'::app_role)
    OR public.current_user_has_role('scraping'::app_role)
    OR public.current_user_has_role_text('processor')
  );
