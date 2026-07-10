-- 1. Drop redundant SELECT policy that re-runs 4 role subqueries per row.
--    The remaining "qualified_leads: select" policy uses STABLE current_user_has_role
--    functions and (SELECT auth.uid()) so it caches per-query.
DROP POLICY IF EXISTS "qualified_leads: read" ON public.qualified_leads;

-- 2. Composite index matching the CS pipeline's real sort:
--    WHERE cs_status = ? ORDER BY pinned_important DESC, assigned_at DESC
CREATE INDEX IF NOT EXISTS idx_qualified_leads_status_pinned_assigned
  ON public.qualified_leads (cs_status, pinned_important DESC, assigned_at DESC);

-- 3. Partial index for Raw Leads "New" queue (category IS NULL AND assigned_myself_at IS NULL)
CREATE INDEX IF NOT EXISTS idx_raw_lead_cache_new_queue
  ON public.raw_lead_cache (assigned_to, captured_at DESC)
  WHERE category IS NULL AND assigned_myself_at IS NULL;

-- 4. Drop duplicate indexes (they slow every INSERT/UPDATE with no read benefit)
DROP INDEX IF EXISTS public.raw_lead_cache_captured_at_idx1;
DROP INDEX IF EXISTS public.raw_lead_cache_captured_at_idx2;
DROP INDEX IF EXISTS public.qualified_leads_assigned_by_idx2;
DROP INDEX IF EXISTS public.qualified_leads_updated_at_idx2;