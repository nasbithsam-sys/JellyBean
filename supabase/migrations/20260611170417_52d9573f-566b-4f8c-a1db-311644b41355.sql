
-- 1) Expand qualified_leads.cs_outcome to include wrong_lead
ALTER TABLE public.qualified_leads DROP CONSTRAINT IF EXISTS qualified_leads_cs_outcome_chk;
ALTER TABLE public.qualified_leads ADD CONSTRAINT qualified_leads_cs_outcome_chk
  CHECK (cs_outcome IS NULL OR cs_outcome = ANY (ARRAY['already_done','wrong_number','processed','wrong_lead']::text[]));

-- 2) Expand raw_lead_cache.lead to include review
ALTER TABLE public.raw_lead_cache DROP CONSTRAINT IF EXISTS raw_lead_cache_lead_chk;
ALTER TABLE public.raw_lead_cache ADD CONSTRAINT raw_lead_cache_lead_chk
  CHECK (lead IS NULL OR lead = ANY (ARRAY['yes','no','review']::text[]));

-- 3) Map snapshots table
CREATE TABLE IF NOT EXISTS public.map_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  image_url text,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS map_snapshots_date_uidx ON public.map_snapshots(snapshot_date);

GRANT SELECT ON public.map_snapshots TO authenticated;
GRANT ALL ON public.map_snapshots TO service_role;

ALTER TABLE public.map_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read map snapshots" ON public.map_snapshots;
CREATE POLICY "Admins can read map snapshots"
ON public.map_snapshots
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- 4) Report function — leads forwarded per processor
CREATE OR REPLACE FUNCTION public.report_leads_forwarded_by_processor(
  _from timestamptz DEFAULT NULL,
  _to timestamptz DEFAULT NULL
)
RETURNS TABLE(processor_id uuid, processor_name text, processor_email text, forwarded_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT
    q.assigned_by AS processor_id,
    COALESCE(p.full_name, p.username, p.email, '(unknown)') AS processor_name,
    p.email AS processor_email,
    COUNT(*)::bigint AS forwarded_count
  FROM public.qualified_leads q
  LEFT JOIN public.profiles p ON p.id = q.assigned_by
  WHERE (_from IS NULL OR q.assigned_at >= _from)
    AND (_to   IS NULL OR q.assigned_at <  _to)
  GROUP BY q.assigned_by, p.full_name, p.username, p.email
  ORDER BY forwarded_count DESC, processor_name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.report_leads_forwarded_by_processor(timestamptz, timestamptz) TO authenticated;
