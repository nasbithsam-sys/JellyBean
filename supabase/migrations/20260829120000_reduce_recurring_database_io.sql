-- Reduce recurring database I/O without rewriting or deleting application data.
--
-- Production observations on 2026-08-29:
--   * mv_raw_lead_cache_counts was refreshed every 15 minutes even though the
--     application reads the trigger-maintained raw_lead_cache_counts table.
--   * raw_lead_cache and activity_logs were in the Realtime publication even
--     though the current application has no Postgres Changes subscriptions for
--     either table.
--
-- This migration is deliberately conservative: it does not drop materialized
-- views, tables, indexes, or data. The jobs/views can be restored independently
-- if an external consumer is discovered.

DO $migration$
DECLARE
  target_job_id bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    FOR target_job_id IN
      SELECT jobid
      FROM cron.job
      WHERE command IN (
        'refresh materialized view concurrently public.mv_raw_lead_cache_counts;',
        'refresh materialized view concurrently public.mv_qualified_leads_status_counts;'
      )
    LOOP
      PERFORM cron.unschedule(target_job_id);
    END LOOP;
  END IF;
END
$migration$;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'raw_lead_cache'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.raw_lead_cache;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'activity_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.activity_logs;
  END IF;
END
$migration$;

-- Return all CS status counts with one qualified_leads scan. The previous
-- implementation scanned the same visible rows twice: once for the total and
-- once for the per-status JSON object.
CREATE OR REPLACE FUNCTION public.cs_leads_status_counts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  requester_id uuid := (SELECT auth.uid());
  has_all_access boolean;
  result jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = requester_id
      AND role::text IN ('admin', 'sub_admin', 'cs', 'cs_admin')
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  has_all_access := EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = requester_id
      AND role::text IN ('admin', 'sub_admin', 'cs_admin')
  );

  SELECT jsonb_build_object(
    'all', COALESCE(sum(status_count), 0),
    'statuses', COALESCE(
      jsonb_object_agg(cs_status::text, status_count),
      '{}'::jsonb
    )
  )
  INTO result
  FROM (
    SELECT q.cs_status, count(*)::bigint AS status_count
    FROM public.qualified_leads AS q
    WHERE has_all_access
       OR q.assigned_to = requester_id
       OR q.assigned_to IS NULL
       OR q.created_by = requester_id
    GROUP BY q.cs_status
  ) AS counts;

  RETURN COALESCE(
    result,
    jsonb_build_object('all', 0, 'statuses', '{}'::jsonb)
  );
END
$function$;

REVOKE ALL ON FUNCTION public.cs_leads_status_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cs_leads_status_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cs_leads_status_counts() TO service_role;

-- Keep frequently changed table statistics fresh without forcing manual
-- VACUUM FULL operations. These settings do not shrink existing files; an
-- off-peak pg_repack remains a separate, explicitly approved maintenance step.
ALTER TABLE public.raw_lead_cache SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 500,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_analyze_threshold = 250
);

ALTER TABLE public.qualified_leads SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 500,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_analyze_threshold = 250
);
