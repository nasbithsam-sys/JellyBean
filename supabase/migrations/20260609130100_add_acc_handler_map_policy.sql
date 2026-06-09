CREATE POLICY "incog: acc_handler read"
ON public.incogniton_profiles FOR SELECT TO authenticated
USING (public.current_user_has_role('acc_handler'::public.app_role));
