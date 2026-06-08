
-- 1) Realtime: restrict channel subscriptions to authorized roles
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "realtime: authorized roles can subscribe" ON realtime.messages;
CREATE POLICY "realtime: authorized roles can subscribe"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  public.current_user_has_role('admin'::public.app_role)
  OR public.current_user_has_role('cs'::public.app_role)
  OR public.current_user_has_role('marketing'::public.app_role)
);

-- 2) activity_logs: enforce role-backed actor metadata
DROP POLICY IF EXISTS "logs: authenticated insert" ON public.activity_logs;
CREATE POLICY "logs: role-backed insert"
ON public.activity_logs
FOR INSERT
TO authenticated
WITH CHECK (
  actor_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid())
  AND (
    actor_role IS NULL
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role::text = actor_role
    )
  )
);

-- 3) Lock down SECURITY DEFINER helpers not meant for direct API use
REVOKE EXECUTE ON FUNCTION public.tg_set_updated_at() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.current_user_has_role(public.app_role) FROM anon, public;
-- current_user_has_role must remain callable by authenticated (RLS policies invoke it in user context)
GRANT EXECUTE ON FUNCTION public.current_user_has_role(public.app_role) TO authenticated;
-- email_for_username is used during login (anon) - keep accessible
GRANT EXECUTE ON FUNCTION public.email_for_username(text) TO anon, authenticated;
