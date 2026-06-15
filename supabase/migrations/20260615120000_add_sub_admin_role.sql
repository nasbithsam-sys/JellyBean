ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'sub_admin';

DROP POLICY IF EXISTS "realtime: authorized roles can subscribe" ON realtime.messages;
CREATE POLICY "realtime: authorized roles can subscribe"
ON realtime.messages FOR SELECT TO authenticated
USING (
  public.current_user_has_role_text('admin')
  OR public.current_user_has_role_text('sub_admin')
  OR public.current_user_has_role_text('cs')
  OR public.current_user_has_role_text('scraping')
  OR public.current_user_has_role_text('processor')
  OR public.current_user_has_role_text('acc_handler')
  OR public.current_user_has_role_text('facebook')
  OR public.current_user_has_role_text('seo')
);

DROP POLICY IF EXISTS "profiles: sub_admin reads all" ON public.profiles;
CREATE POLICY "profiles: sub_admin reads all"
ON public.profiles FOR SELECT TO authenticated
USING (public.current_user_has_role_text('sub_admin'));

DROP POLICY IF EXISTS "raw_lead_cache: sub_admin read" ON public.raw_lead_cache;
CREATE POLICY "raw_lead_cache: sub_admin read"
ON public.raw_lead_cache FOR SELECT TO authenticated
USING (public.current_user_has_role_text('sub_admin'));

DROP POLICY IF EXISTS "raw_lead_cache: sub_admin update" ON public.raw_lead_cache;
CREATE POLICY "raw_lead_cache: sub_admin update"
ON public.raw_lead_cache FOR UPDATE TO authenticated
USING (public.current_user_has_role_text('sub_admin'))
WITH CHECK (public.current_user_has_role_text('sub_admin'));

DROP POLICY IF EXISTS "raw_lead_cache: sub_admin delete" ON public.raw_lead_cache;
CREATE POLICY "raw_lead_cache: sub_admin delete"
ON public.raw_lead_cache FOR DELETE TO authenticated
USING (public.current_user_has_role_text('sub_admin'));

DROP POLICY IF EXISTS "qualified_leads: sub_admin read" ON public.qualified_leads;
CREATE POLICY "qualified_leads: sub_admin read"
ON public.qualified_leads FOR SELECT TO authenticated
USING (public.current_user_has_role_text('sub_admin'));

DROP POLICY IF EXISTS "qualified_leads: sub_admin insert" ON public.qualified_leads;
CREATE POLICY "qualified_leads: sub_admin insert"
ON public.qualified_leads FOR INSERT TO authenticated
WITH CHECK (public.current_user_has_role_text('sub_admin'));

DROP POLICY IF EXISTS "qualified_leads: sub_admin update" ON public.qualified_leads;
CREATE POLICY "qualified_leads: sub_admin update"
ON public.qualified_leads FOR UPDATE TO authenticated
USING (public.current_user_has_role_text('sub_admin'))
WITH CHECK (public.current_user_has_role_text('sub_admin'));

DROP POLICY IF EXISTS "qualified_leads: sub_admin delete" ON public.qualified_leads;
CREATE POLICY "qualified_leads: sub_admin delete"
ON public.qualified_leads FOR DELETE TO authenticated
USING (public.current_user_has_role_text('sub_admin'));

DROP POLICY IF EXISTS "accounts: sub_admin read" ON public.accounts;
CREATE POLICY "accounts: sub_admin read"
ON public.accounts FOR SELECT TO authenticated
USING (public.current_user_has_role_text('sub_admin'));

DROP POLICY IF EXISTS "accounts: sub_admin write" ON public.accounts;
CREATE POLICY "accounts: sub_admin write"
ON public.accounts FOR ALL TO authenticated
USING (public.current_user_has_role_text('sub_admin'))
WITH CHECK (public.current_user_has_role_text('sub_admin'));

DROP POLICY IF EXISTS "incog: sub_admin read" ON public.incogniton_profiles;
CREATE POLICY "incog: sub_admin read"
ON public.incogniton_profiles FOR SELECT TO authenticated
USING (public.current_user_has_role_text('sub_admin'));

DROP POLICY IF EXISTS "incog: sub_admin write" ON public.incogniton_profiles;
CREATE POLICY "incog: sub_admin write"
ON public.incogniton_profiles FOR ALL TO authenticated
USING (public.current_user_has_role_text('sub_admin'))
WITH CHECK (public.current_user_has_role_text('sub_admin'));

DROP POLICY IF EXISTS "shared_state: sub_admin write" ON public.shared_state;
CREATE POLICY "shared_state: sub_admin write"
ON public.shared_state FOR ALL TO authenticated
USING (public.current_user_has_role_text('sub_admin'))
WITH CHECK (public.current_user_has_role_text('sub_admin'));

DROP POLICY IF EXISTS "lead attachments: sub_admin delete" ON storage.objects;
CREATE POLICY "lead attachments: sub_admin delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'lead-attachments' AND public.current_user_has_role_text('sub_admin'));
