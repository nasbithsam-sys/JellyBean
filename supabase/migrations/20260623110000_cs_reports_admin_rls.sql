-- Allow admin/sub_admin to read all qualified_leads (needed for CS Reports stats)
-- NOTE: Do NOT add a policy on user_roles here - that causes infinite recursion.
-- CS user list is fetched via the listCsTeam server function (supabaseAdmin bypasses RLS).
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
        auth.uid() IN (
          SELECT user_id FROM public.user_roles
          WHERE role IN ('admin', 'sub_admin')
        )
      );
  END IF;
END $$;
