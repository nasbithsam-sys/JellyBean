-- Update update/delete RLS policies on qualified_leads to allow creators to update/delete when status is 'new'

DROP POLICY IF EXISTS "qualified_leads: update" ON public.qualified_leads;

CREATE POLICY "qualified_leads: update"
ON public.qualified_leads FOR UPDATE TO authenticated
USING (
  current_user_has_role('admin'::app_role)
  OR (current_user_has_role('cs'::app_role) AND (assigned_to = auth.uid() OR assigned_to IS NULL))
  OR (created_by = auth.uid() AND cs_status = 'new')
)
WITH CHECK (
  current_user_has_role('admin'::app_role)
  OR (current_user_has_role('cs'::app_role) AND (assigned_to = auth.uid() OR assigned_to IS NULL))
  OR (created_by = auth.uid() AND cs_status = 'new')
);

DROP POLICY IF EXISTS "qualified_leads: delete" ON public.qualified_leads;

CREATE POLICY "qualified_leads: delete"
ON public.qualified_leads FOR DELETE TO authenticated
USING (
  current_user_has_role('admin'::app_role)
  OR (created_by = auth.uid() AND cs_status = 'new')
);
