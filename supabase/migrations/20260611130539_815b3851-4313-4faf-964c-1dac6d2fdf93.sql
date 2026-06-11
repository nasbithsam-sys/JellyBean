DROP POLICY IF EXISTS "raw_lead_cache: admin read" ON public.raw_lead_cache;
DROP POLICY IF EXISTS "raw_lead_cache: admin write" ON public.raw_lead_cache;
DROP POLICY IF EXISTS "raw_lead_cache: assignable read" ON public.raw_lead_cache;
DROP POLICY IF EXISTS "raw_lead_cache: assignable write" ON public.raw_lead_cache;

CREATE POLICY "raw_lead_cache: admin read"
  ON public.raw_lead_cache
  FOR SELECT
  TO authenticated
  USING (public.current_user_has_role('admin'::app_role));

CREATE POLICY "raw_lead_cache: admin write"
  ON public.raw_lead_cache
  FOR UPDATE
  TO authenticated
  USING (public.current_user_has_role('admin'::app_role))
  WITH CHECK (public.current_user_has_role('admin'::app_role));

CREATE POLICY "raw_lead_cache: raw team read"
  ON public.raw_lead_cache
  FOR SELECT
  TO authenticated
  USING (
    (
      public.current_user_has_role_text('processor')
      OR public.current_user_has_role_text('acc_handler')
    )
    AND (assigned_to IS NULL OR assigned_to = auth.uid())
  );

CREATE POLICY "raw_lead_cache: raw team write"
  ON public.raw_lead_cache
  FOR UPDATE
  TO authenticated
  USING (
    (
      public.current_user_has_role_text('processor')
      OR public.current_user_has_role_text('acc_handler')
    )
    AND (assigned_to IS NULL OR assigned_to = auth.uid())
  )
  WITH CHECK (
    (
      public.current_user_has_role_text('processor')
      OR public.current_user_has_role_text('acc_handler')
    )
    AND (assigned_to IS NULL OR assigned_to = auth.uid())
  );

DROP POLICY IF EXISTS "shared_state: marketing+admin insert" ON public.shared_state;
DROP POLICY IF EXISTS "shared_state: marketing+admin update" ON public.shared_state;
DROP POLICY IF EXISTS "shared_state: processor write" ON public.shared_state;
DROP POLICY IF EXISTS "shared_state: raw team write" ON public.shared_state;

CREATE POLICY "shared_state: raw team write"
  ON public.shared_state
  FOR ALL
  TO authenticated
  USING (
    public.current_user_has_role('admin'::app_role)
    OR public.current_user_has_role('scraping'::app_role)
    OR public.current_user_has_role_text('processor')
    OR public.current_user_has_role_text('acc_handler')
  )
  WITH CHECK (
    public.current_user_has_role('admin'::app_role)
    OR public.current_user_has_role('scraping'::app_role)
    OR public.current_user_has_role_text('processor')
    OR public.current_user_has_role_text('acc_handler')
  );