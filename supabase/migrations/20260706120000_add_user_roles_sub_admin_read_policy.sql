-- Allow sub_admin to read all user roles (so they can resolve user names in leads view)
DROP POLICY IF EXISTS "user_roles: sub_admin reads all" ON public.user_roles;
CREATE POLICY "user_roles: sub_admin reads all"
  ON public.user_roles FOR SELECT TO authenticated
  USING (public.current_user_has_role('sub_admin'::public.app_role));
