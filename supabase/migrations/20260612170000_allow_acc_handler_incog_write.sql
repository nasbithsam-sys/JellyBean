DROP POLICY IF EXISTS "incog: acc_handler insert" ON public.incogniton_profiles;
DROP POLICY IF EXISTS "incog: acc_handler update" ON public.incogniton_profiles;

CREATE POLICY "incog: acc_handler insert"
ON public.incogniton_profiles FOR INSERT TO authenticated
WITH CHECK (public.current_user_has_role('acc_handler'::public.app_role));

CREATE POLICY "incog: acc_handler update"
ON public.incogniton_profiles FOR UPDATE TO authenticated
USING (public.current_user_has_role('acc_handler'::public.app_role))
WITH CHECK (public.current_user_has_role('acc_handler'::public.app_role));
