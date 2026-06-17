DROP POLICY IF EXISTS "shared_state: cs compose template write" ON public.shared_state;

CREATE POLICY "shared_state: cs compose template write"
  ON public.shared_state
  FOR ALL
  TO authenticated
  USING (
    key = 'cs_compose_template'
    AND (
      public.current_user_has_role_text('admin')
      OR public.current_user_has_role_text('cs')
    )
  )
  WITH CHECK (
    key = 'cs_compose_template'
    AND (
      public.current_user_has_role_text('admin')
      OR public.current_user_has_role_text('cs')
    )
  );
