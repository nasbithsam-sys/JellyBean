-- Cache role helper results once per statement on the hottest table.
-- Semantics are intentionally identical to the existing policies; only the
-- helper evaluation strategy changes.

ALTER POLICY "qualified_leads: delete"
ON public.qualified_leads
USING (
  (SELECT public.current_user_has_role('admin'::public.app_role))
  OR (SELECT public.current_user_has_role_text('sub_admin'))
  OR (SELECT public.current_user_has_role_text('cs_admin'))
  OR (
    created_by = (SELECT auth.uid())
    AND cs_status = 'new'::public.cs_status
  )
);

ALTER POLICY "qualified_leads: insert"
ON public.qualified_leads
WITH CHECK (
  (SELECT public.current_user_has_role('admin'::public.app_role))
  OR (SELECT public.current_user_has_role_text('sub_admin'))
  OR (SELECT public.current_user_has_role_text('cs_admin'))
  OR (SELECT public.current_user_has_role_text('scraping'))
  OR (SELECT public.current_user_has_role_text('maturing'))
  OR (SELECT public.current_user_has_role_text('acc_handler'))
  OR (SELECT public.current_user_has_role_text('facebook'))
  OR (SELECT public.current_user_has_role_text('seo'))
);

ALTER POLICY "qualified_leads: read"
ON public.qualified_leads
USING (
  (SELECT public.current_user_has_role('admin'::public.app_role))
  OR (SELECT public.current_user_has_role_text('sub_admin'))
  OR (SELECT public.current_user_has_role_text('cs_admin'))
  OR (
    (SELECT public.current_user_has_role('cs'::public.app_role))
    AND (assigned_to = (SELECT auth.uid()) OR assigned_to IS NULL)
  )
  OR created_by = (SELECT auth.uid())
);

ALTER POLICY "qualified_leads: update"
ON public.qualified_leads
USING (
  (SELECT public.current_user_has_role('admin'::public.app_role))
  OR (SELECT public.current_user_has_role_text('sub_admin'))
  OR (SELECT public.current_user_has_role_text('cs_admin'))
  OR (
    (SELECT public.current_user_has_role('cs'::public.app_role))
    AND (assigned_to = (SELECT auth.uid()) OR assigned_to IS NULL)
  )
  OR (
    created_by = (SELECT auth.uid())
    AND cs_status = 'new'::public.cs_status
  )
)
WITH CHECK (
  (SELECT public.current_user_has_role('admin'::public.app_role))
  OR (SELECT public.current_user_has_role_text('sub_admin'))
  OR (SELECT public.current_user_has_role_text('cs_admin'))
  OR (
    (SELECT public.current_user_has_role('cs'::public.app_role))
    AND (assigned_to = (SELECT auth.uid()) OR assigned_to IS NULL)
  )
  OR (
    created_by = (SELECT auth.uid())
    AND cs_status = 'new'::public.cs_status
  )
);
