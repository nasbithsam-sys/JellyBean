
ALTER TABLE public.raw_lead_cache
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS raw_lead_cache_assigned_to_idx
  ON public.raw_lead_cache(assigned_to);

-- Drop existing select/update policies and rebuild with assignment-aware rules.
DROP POLICY IF EXISTS "raw_lead_cache: marketing+admin read" ON public.raw_lead_cache;
DROP POLICY IF EXISTS "raw_lead_cache: marketing+admin update" ON public.raw_lead_cache;
DROP POLICY IF EXISTS "raw_lead_cache: processor read" ON public.raw_lead_cache;
DROP POLICY IF EXISTS "raw_lead_cache: processor write" ON public.raw_lead_cache;

-- Admin: full read/write.
CREATE POLICY "raw_lead_cache: admin read"
  ON public.raw_lead_cache FOR SELECT
  USING (public.current_user_has_role('admin'::app_role));

CREATE POLICY "raw_lead_cache: admin write"
  ON public.raw_lead_cache FOR UPDATE
  USING (public.current_user_has_role('admin'::app_role))
  WITH CHECK (public.current_user_has_role('admin'::app_role));

-- Processor & account handler: see only unassigned rows or their own claimed rows.
CREATE POLICY "raw_lead_cache: assignable read"
  ON public.raw_lead_cache FOR SELECT
  USING (
    (public.current_user_has_role_text('processor')
      OR public.current_user_has_role_text('acc_handler'))
    AND (assigned_to IS NULL OR assigned_to = auth.uid())
  );

CREATE POLICY "raw_lead_cache: assignable write"
  ON public.raw_lead_cache FOR UPDATE
  USING (
    (public.current_user_has_role_text('processor')
      OR public.current_user_has_role_text('acc_handler'))
    AND (assigned_to IS NULL OR assigned_to = auth.uid())
  )
  WITH CHECK (
    (public.current_user_has_role_text('processor')
      OR public.current_user_has_role_text('acc_handler'))
    AND (assigned_to IS NULL OR assigned_to = auth.uid())
  );
