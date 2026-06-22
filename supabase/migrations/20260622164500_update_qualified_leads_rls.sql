-- Update SELECT, INSERT, UPDATE, DELETE RLS policies on qualified_leads to support all roles

DROP POLICY IF EXISTS "qualified_leads: read" ON public.qualified_leads;
DROP POLICY IF EXISTS "qualified_leads: insert" ON public.qualified_leads;
DROP POLICY IF EXISTS "qualified_leads: update" ON public.qualified_leads;
DROP POLICY IF EXISTS "qualified_leads: delete" ON public.qualified_leads;

-- SELECT policy: Allow admin, cs (for their own + unassigned), and any creator to read their own leads
CREATE POLICY "qualified_leads: read"
ON public.qualified_leads FOR SELECT TO authenticated
USING (
  current_user_has_role('admin'::app_role)
  OR (current_user_has_role('cs'::app_role) AND (assigned_to = auth.uid() OR assigned_to IS NULL))
  OR (created_by = auth.uid())
);

-- INSERT policy: Allow admin, scraping, processor, acc_handler, facebook, and seo roles to insert
CREATE POLICY "qualified_leads: insert"
ON public.qualified_leads FOR INSERT TO authenticated
WITH CHECK (
  current_user_has_role('admin'::app_role)
  OR current_user_has_role_text('scraping')
  OR current_user_has_role_text('processor')
  OR current_user_has_role_text('acc_handler')
  OR current_user_has_role_text('facebook')
  OR current_user_has_role_text('seo')
);

-- UPDATE policy: Allow admin, cs (assigned to them/unassigned), and creators (if status is 'new')
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

-- DELETE policy: Allow admin, and creators (if status is 'new')
CREATE POLICY "qualified_leads: delete"
ON public.qualified_leads FOR DELETE TO authenticated
USING (
  current_user_has_role('admin'::app_role)
  OR (created_by = auth.uid() AND cs_status = 'new')
);
