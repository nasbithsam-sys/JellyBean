-- Let every lead forwarder manage only the leads they personally sent.
-- CS users can still compose/update any pipeline lead, even after it is assigned.

DROP POLICY IF EXISTS "qualified_leads: read" ON public.qualified_leads;
CREATE POLICY "qualified_leads: read" ON public.qualified_leads
FOR SELECT TO authenticated
USING (
  public.current_user_has_role_text('admin')
  OR public.current_user_has_role_text('sub_admin')
  OR public.current_user_has_role_text('cs')
  OR created_by = auth.uid()
);

DROP POLICY IF EXISTS "qualified_leads: update" ON public.qualified_leads;
CREATE POLICY "qualified_leads: update" ON public.qualified_leads
FOR UPDATE TO authenticated
USING (
  public.current_user_has_role_text('admin')
  OR public.current_user_has_role_text('sub_admin')
  OR public.current_user_has_role_text('cs')
  OR created_by = auth.uid()
)
WITH CHECK (
  public.current_user_has_role_text('admin')
  OR public.current_user_has_role_text('sub_admin')
  OR public.current_user_has_role_text('cs')
  OR created_by = auth.uid()
);

DROP POLICY IF EXISTS "qualified_leads: delete" ON public.qualified_leads;
CREATE POLICY "qualified_leads: delete" ON public.qualified_leads
FOR DELETE TO authenticated
USING (
  public.current_user_has_role_text('admin')
  OR public.current_user_has_role_text('sub_admin')
  OR created_by = auth.uid()
);
