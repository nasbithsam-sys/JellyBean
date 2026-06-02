
-- Revert the accidentally permissive policies on app_settings
DROP POLICY IF EXISTS "Authenticated can read app_settings" ON public.app_settings;
DROP POLICY IF EXISTS "Authenticated can insert app_settings" ON public.app_settings;
DROP POLICY IF EXISTS "Authenticated can update app_settings" ON public.app_settings;

-- New table for shared cross-user state (key/value)
CREATE TABLE IF NOT EXISTS public.shared_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_state TO authenticated;
GRANT ALL ON public.shared_state TO service_role;

ALTER TABLE public.shared_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shared_state: auth read"
  ON public.shared_state FOR SELECT TO authenticated USING (true);

CREATE POLICY "shared_state: marketing+admin insert"
  ON public.shared_state FOR INSERT TO authenticated
  WITH CHECK (current_user_has_role('admin'::app_role) OR current_user_has_role('marketing'::app_role));

CREATE POLICY "shared_state: marketing+admin update"
  ON public.shared_state FOR UPDATE TO authenticated
  USING (current_user_has_role('admin'::app_role) OR current_user_has_role('marketing'::app_role))
  WITH CHECK (current_user_has_role('admin'::app_role) OR current_user_has_role('marketing'::app_role));
