-- Ensure admin can read all qualified_leads (needed for CS Reports)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'qualified_leads'
      AND policyname = 'admin_read_all_qualified_leads'
  ) THEN
    CREATE POLICY admin_read_all_qualified_leads
      ON public.qualified_leads
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.user_roles
          WHERE user_id = auth.uid()
            AND role IN ('admin', 'sub_admin')
        )
      );
  END IF;
END $$;

-- Ensure admin can read user_roles (needed to list CS users)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_roles'
      AND policyname = 'admin_read_all_user_roles'
  ) THEN
    CREATE POLICY admin_read_all_user_roles
      ON public.user_roles
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
            AND ur.role IN ('admin', 'sub_admin')
        )
      );
  END IF;
END $$;
