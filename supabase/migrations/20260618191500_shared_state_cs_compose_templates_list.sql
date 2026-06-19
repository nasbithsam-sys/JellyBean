-- Allow authenticated admins and CS team to read and write the multiple compose templates list
DROP POLICY IF EXISTS "shared_state: cs compose templates list write" ON public.shared_state;

CREATE POLICY "shared_state: cs compose templates list write"
  ON public.shared_state
  FOR ALL
  TO authenticated
  USING (
    key = 'cs_compose_templates_list'
    AND (
      public.current_user_has_role_text('admin')
      OR public.current_user_has_role_text('cs')
    )
  )
  WITH CHECK (
    key = 'cs_compose_templates_list'
    AND (
      public.current_user_has_role_text('admin')
      OR public.current_user_has_role_text('cs')
    )
  );
