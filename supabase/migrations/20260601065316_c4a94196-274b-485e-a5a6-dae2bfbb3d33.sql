
-- 1) Restrict profile self-updates so users cannot change security-sensitive columns
DROP POLICY IF EXISTS "profiles: user updates own" ON public.profiles;

CREATE POLICY "profiles: user updates own"
ON public.profiles
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (
  user_id = auth.uid()
  AND is_active = (SELECT p.is_active FROM public.profiles p WHERE p.user_id = auth.uid())
  AND otp_required = (SELECT p.otp_required FROM public.profiles p WHERE p.user_id = auth.uid())
  AND email = (SELECT p.email FROM public.profiles p WHERE p.user_id = auth.uid())
  AND username IS NOT DISTINCT FROM (SELECT p.username FROM public.profiles p WHERE p.user_id = auth.uid())
);

-- 2) Prevent activity log actor_name forgery: must match the caller's profile full_name (or be null)
DROP POLICY IF EXISTS "logs: role-backed insert" ON public.activity_logs;

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
      WHERE ur.user_id = auth.uid() AND ur.role::text = activity_logs.actor_role
    )
  )
  AND (
    actor_name IS NULL
    OR actor_name = (SELECT p.full_name FROM public.profiles p WHERE p.user_id = auth.uid())
  )
);
