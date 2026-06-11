DROP POLICY IF EXISTS "qualified_leads: insert" ON public.qualified_leads;
CREATE POLICY "qualified_leads: insert" ON public.qualified_leads
FOR INSERT TO authenticated
WITH CHECK (
  current_user_has_role('admin'::app_role)
  OR current_user_has_role_text('scraping')
  OR current_user_has_role_text('processor')
  OR current_user_has_role_text('acc_handler')
);

DROP POLICY IF EXISTS "qualified_leads: read" ON public.qualified_leads;
CREATE POLICY "qualified_leads: read" ON public.qualified_leads
FOR SELECT TO authenticated
USING (
  current_user_has_role('admin'::app_role)
  OR (current_user_has_role('cs'::app_role) AND (assigned_to = auth.uid() OR assigned_to IS NULL))
  OR ((current_user_has_role_text('scraping') OR current_user_has_role_text('processor') OR current_user_has_role_text('acc_handler')) AND created_by = auth.uid())
);