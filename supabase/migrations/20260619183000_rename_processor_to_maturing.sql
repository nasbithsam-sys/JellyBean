-- 1. Rename 'processor' value to 'maturing' in public.app_role enum
ALTER TYPE public.app_role RENAME VALUE 'processor' TO 'maturing';

-- 2. Update existing policies that check for 'processor' string
-- qualified_leads: insert
DROP POLICY IF EXISTS "qualified_leads: insert" ON public.qualified_leads;
CREATE POLICY "qualified_leads: insert" ON public.qualified_leads
FOR INSERT TO authenticated
WITH CHECK (
  current_user_has_role('admin'::app_role)
  OR current_user_has_role_text('scraping')
  OR current_user_has_role_text('maturing')
  OR current_user_has_role_text('acc_handler')
);

-- qualified_leads: read
DROP POLICY IF EXISTS "qualified_leads: read" ON public.qualified_leads;
CREATE POLICY "qualified_leads: read" ON public.qualified_leads
FOR SELECT TO authenticated
USING (
  current_user_has_role('admin'::app_role)
  OR (current_user_has_role('cs'::app_role) AND (assigned_to = auth.uid() OR assigned_to IS NULL))
  OR ((current_user_has_role_text('scraping') OR current_user_has_role_text('maturing') OR current_user_has_role_text('acc_handler')) AND created_by = auth.uid())
);

-- raw_lead_cache: raw team read
DROP POLICY IF EXISTS "raw_lead_cache: raw team read" ON public.raw_lead_cache;
CREATE POLICY "raw_lead_cache: raw team read"
  ON public.raw_lead_cache
  FOR SELECT
  TO authenticated
  USING (
    (
      public.current_user_has_role_text('maturing')
      OR public.current_user_has_role_text('acc_handler')
    )
    AND (assigned_to IS NULL OR assigned_to = auth.uid())
  );

-- raw_lead_cache: raw team write
DROP POLICY IF EXISTS "raw_lead_cache: raw team write" ON public.raw_lead_cache;
CREATE POLICY "raw_lead_cache: raw team write"
  ON public.raw_lead_cache
  FOR UPDATE
  TO authenticated
  USING (
    (
      public.current_user_has_role_text('maturing')
      OR public.current_user_has_role_text('acc_handler')
    )
    AND (assigned_to IS NULL OR assigned_to = auth.uid())
  )
  WITH CHECK (
    (
      public.current_user_has_role_text('maturing')
      OR public.current_user_has_role_text('acc_handler')
    )
    AND (assigned_to IS NULL OR assigned_to = auth.uid())
  );

-- shared_state: raw team write
DROP POLICY IF EXISTS "shared_state: raw team write" ON public.shared_state;
CREATE POLICY "shared_state: raw team write"
  ON public.shared_state
  FOR ALL
  TO authenticated
  USING (
    public.current_user_has_role('admin'::app_role)
    OR public.current_user_has_role('scraping'::app_role)
    OR public.current_user_has_role_text('maturing')
    OR public.current_user_has_role_text('acc_handler')
  )
  WITH CHECK (
    public.current_user_has_role('admin'::app_role)
    OR public.current_user_has_role('scraping'::app_role)
    OR public.current_user_has_role_text('maturing')
    OR public.current_user_has_role_text('acc_handler')
  );

-- realtime: authorized roles can subscribe
DROP POLICY IF EXISTS "realtime: authorized roles can subscribe" ON realtime.messages;
CREATE POLICY "realtime: authorized roles can subscribe"
ON realtime.messages FOR SELECT TO authenticated
USING (
  public.current_user_has_role_text('admin')
  OR public.current_user_has_role_text('sub_admin')
  OR public.current_user_has_role_text('cs')
  OR public.current_user_has_role_text('scraping')
  OR public.current_user_has_role_text('maturing')
  OR public.current_user_has_role_text('acc_handler')
  OR public.current_user_has_role_text('facebook')
  OR public.current_user_has_role_text('seo')
);
