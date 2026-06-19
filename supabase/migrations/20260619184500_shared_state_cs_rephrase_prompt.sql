-- Allow authenticated admins and CS team to read and write the CS rephrase prompt
DROP POLICY IF EXISTS "shared_state: cs rephrase prompt write" ON public.shared_state;

CREATE POLICY "shared_state: cs rephrase prompt write"
  ON public.shared_state
  FOR ALL
  TO authenticated
  USING (
    key = 'cs_rephrase_prompt'
    AND (
      public.current_user_has_role_text('admin')
      OR public.current_user_has_role_text('cs')
    )
  )
  WITH CHECK (
    key = 'cs_rephrase_prompt'
    AND (
      public.current_user_has_role_text('admin')
      OR public.current_user_has_role_text('cs')
    )
  );
