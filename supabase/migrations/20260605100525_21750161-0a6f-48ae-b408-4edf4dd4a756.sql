
-- 1. Rename marketing → scraping (in-place; preserves all user_roles assignments)
ALTER TYPE public.app_role RENAME VALUE 'marketing' TO 'scraping';

-- 2. Add new 'processor' role (same permissions tier as scraping)
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'processor';

-- 3. Helper that compares role as text, so policies can reference 'processor'
--    in the SAME migration where it was added (enum literal casts in policy
--    expressions would otherwise fail because the new value can't be used
--    in the same transaction it was added in).
CREATE OR REPLACE FUNCTION public.current_user_has_role_text(_role text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role::text = _role
  )
$$;

-- 4. qualified_leads: forwarded-by + CS outcome
ALTER TABLE public.qualified_leads
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS cs_outcome text;

ALTER TABLE public.qualified_leads
  DROP CONSTRAINT IF EXISTS qualified_leads_cs_outcome_chk;
ALTER TABLE public.qualified_leads
  ADD CONSTRAINT qualified_leads_cs_outcome_chk
  CHECK (cs_outcome IS NULL OR cs_outcome IN ('already_done','wrong_number','processed'));

CREATE INDEX IF NOT EXISTS qualified_leads_created_by_idx ON public.qualified_leads(created_by);
CREATE INDEX IF NOT EXISTS qualified_leads_assigned_to_idx ON public.qualified_leads(assigned_to);

-- 5. Replace qualified_leads RLS so CS only sees their own + unassigned,
--    admin sees all, scraping/processor see only leads they forwarded.
DROP POLICY IF EXISTS "qualified_leads: cs+admin read"   ON public.qualified_leads;
DROP POLICY IF EXISTS "qualified_leads: cs+admin update" ON public.qualified_leads;
DROP POLICY IF EXISTS "qualified_leads: marketing+admin insert" ON public.qualified_leads;
DROP POLICY IF EXISTS "qualified_leads: admin delete"    ON public.qualified_leads;

CREATE POLICY "qualified_leads: read"
ON public.qualified_leads FOR SELECT TO authenticated
USING (
  current_user_has_role('admin'::app_role)
  OR (current_user_has_role('cs'::app_role) AND (assigned_to = auth.uid() OR assigned_to IS NULL))
  OR ((current_user_has_role_text('scraping') OR current_user_has_role_text('processor'))
      AND created_by = auth.uid())
);

CREATE POLICY "qualified_leads: insert"
ON public.qualified_leads FOR INSERT TO authenticated
WITH CHECK (
  current_user_has_role('admin'::app_role)
  OR current_user_has_role_text('scraping')
  OR current_user_has_role_text('processor')
);

CREATE POLICY "qualified_leads: update"
ON public.qualified_leads FOR UPDATE TO authenticated
USING (
  current_user_has_role('admin'::app_role)
  OR (current_user_has_role('cs'::app_role) AND (assigned_to = auth.uid() OR assigned_to IS NULL))
);

CREATE POLICY "qualified_leads: delete"
ON public.qualified_leads FOR DELETE TO authenticated
USING (current_user_has_role('admin'::app_role));

-- 6. Give 'processor' the same access scraping has on the other tables.
--    (Existing 'scraping' policies keep working since the enum value was renamed.)
CREATE POLICY "raw_lead_cache: processor read"
ON public.raw_lead_cache FOR SELECT TO authenticated
USING (current_user_has_role_text('processor'));

CREATE POLICY "raw_lead_cache: processor write"
ON public.raw_lead_cache FOR ALL TO authenticated
USING (current_user_has_role_text('processor'))
WITH CHECK (current_user_has_role_text('processor'));

CREATE POLICY "raw_leads: processor read"
ON public.raw_leads FOR SELECT TO authenticated
USING (current_user_has_role_text('processor'));

CREATE POLICY "raw_leads: processor update"
ON public.raw_leads FOR UPDATE TO authenticated
USING (current_user_has_role_text('processor'));

CREATE POLICY "accounts: processor read"
ON public.accounts FOR SELECT TO authenticated
USING (current_user_has_role_text('processor'));

CREATE POLICY "accounts: processor write"
ON public.accounts FOR ALL TO authenticated
USING (current_user_has_role_text('processor'))
WITH CHECK (current_user_has_role_text('processor'));

CREATE POLICY "incog: processor read"
ON public.incogniton_profiles FOR SELECT TO authenticated
USING (current_user_has_role_text('processor'));

CREATE POLICY "incog: processor write"
ON public.incogniton_profiles FOR ALL TO authenticated
USING (current_user_has_role_text('processor'))
WITH CHECK (current_user_has_role_text('processor'));

CREATE POLICY "shared_state: processor write"
ON public.shared_state FOR ALL TO authenticated
USING (current_user_has_role_text('processor'))
WITH CHECK (current_user_has_role_text('processor'));
