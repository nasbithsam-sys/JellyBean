-- Replace one PostgREST UPDATE transaction per AI decision with one RPC call.
-- The row trigger still maintains raw_lead_cache_counts for every changed row.

CREATE OR REPLACE FUNCTION public.batch_update_raw_lead_decisions(
  decisions jsonb
)
RETURNS bigint
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH valid_decisions AS (
    SELECT DISTINCT ON (item.row_key)
      item.row_key,
      item.lead
    FROM jsonb_to_recordset(
      CASE
        WHEN jsonb_typeof(decisions) = 'array' THEN decisions
        ELSE '[]'::jsonb
      END
    )
      AS item(row_key text, lead text)
    WHERE item.row_key IS NOT NULL
      AND item.lead IN ('yes', 'no')
    ORDER BY item.row_key
  ),
  updated AS (
    UPDATE public.raw_lead_cache AS target
    SET lead = input.lead
    FROM valid_decisions AS input
    WHERE target.row_key = input.row_key
      AND target.lead IS DISTINCT FROM input.lead
    RETURNING 1
  )
  SELECT count(*)::bigint
  FROM updated;
$function$;

REVOKE ALL ON FUNCTION public.batch_update_raw_lead_decisions(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.batch_update_raw_lead_decisions(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.batch_update_raw_lead_decisions(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.batch_update_raw_lead_decisions(jsonb) TO service_role;
