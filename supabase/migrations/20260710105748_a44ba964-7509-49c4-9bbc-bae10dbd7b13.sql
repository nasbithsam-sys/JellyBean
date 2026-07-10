-- Add new role: cs_admin (CS pipeline only, with admin-level access there)
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'cs_admin';

-- Update qualified_leads RLS to grant cs_admin same access as admin within CS pipeline
DROP POLICY IF EXISTS "qualified_leads: read" ON public.qualified_leads;
DROP POLICY IF EXISTS "qualified_leads: update" ON public.qualified_leads;
DROP POLICY IF EXISTS "qualified_leads: delete" ON public.qualified_leads;

CREATE POLICY "qualified_leads: read"
ON public.qualified_leads FOR SELECT TO authenticated
USING (
  current_user_has_role_text('admin')
  OR current_user_has_role_text('sub_admin')
  OR current_user_has_role_text('cs_admin')
  OR (current_user_has_role_text('cs') AND (assigned_to = auth.uid() OR assigned_to IS NULL))
  OR (created_by = auth.uid())
);

CREATE POLICY "qualified_leads: update"
ON public.qualified_leads FOR UPDATE TO authenticated
USING (
  current_user_has_role_text('admin')
  OR current_user_has_role_text('sub_admin')
  OR current_user_has_role_text('cs_admin')
  OR (current_user_has_role_text('cs') AND (assigned_to = auth.uid() OR assigned_to IS NULL))
  OR (created_by = auth.uid() AND cs_status = 'new')
)
WITH CHECK (
  current_user_has_role_text('admin')
  OR current_user_has_role_text('sub_admin')
  OR current_user_has_role_text('cs_admin')
  OR (current_user_has_role_text('cs') AND (assigned_to = auth.uid() OR assigned_to IS NULL))
  OR (created_by = auth.uid() AND cs_status = 'new')
);

CREATE POLICY "qualified_leads: delete"
ON public.qualified_leads FOR DELETE TO authenticated
USING (
  current_user_has_role_text('admin')
  OR current_user_has_role_text('sub_admin')
  OR current_user_has_role_text('cs_admin')
  OR (created_by = auth.uid() AND cs_status = 'new')
);

-- Allow cs_admin to access CS compose templates
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
      OR public.current_user_has_role_text('cs_admin')
    )
  )
  WITH CHECK (
    key = 'cs_compose_templates_list'
    AND (
      public.current_user_has_role_text('admin')
      OR public.current_user_has_role_text('cs')
      OR public.current_user_has_role_text('cs_admin')
    )
  );

-- Update CS status counts RPC to include cs_admin
CREATE OR REPLACE FUNCTION public.cs_leads_status_counts()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _total bigint;
  _by_status jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role::text IN ('admin','sub_admin','cs','cs_admin')
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT count(*)::bigint INTO _total FROM public.qualified_leads;

  SELECT COALESCE(jsonb_object_agg(cs_status::text, cnt), '{}'::jsonb)
    INTO _by_status
  FROM (
    SELECT cs_status, count(*)::bigint AS cnt
    FROM public.qualified_leads
    GROUP BY cs_status
  ) s;

  RETURN jsonb_build_object('all', _total, 'statuses', _by_status);
END;
$function$;