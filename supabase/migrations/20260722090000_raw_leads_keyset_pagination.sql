-- Raw Leads keyset pagination support.

CREATE INDEX IF NOT EXISTS idx_raw_lead_cache_new_tab_cursor
  ON public.raw_lead_cache (captured_at DESC NULLS LAST, id DESC)
  WHERE category IS NULL AND assigned_myself_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_raw_lead_cache_assigned_myself_cursor
  ON public.raw_lead_cache (assigned_to, captured_at DESC NULLS LAST, id DESC)
  WHERE assigned_myself_at IS NOT NULL AND category IS NULL;

CREATE INDEX IF NOT EXISTS idx_raw_lead_cache_category_cursor
  ON public.raw_lead_cache (category, captured_at DESC NULLS LAST, id DESC)
  WHERE category IS NOT NULL;

ANALYZE public.raw_lead_cache;

DROP FUNCTION IF EXISTS public.get_raw_leads_cursor_page(
  integer,
  text,
  timestamp with time zone,
  uuid,
  text,
  text,
  text,
  text,
  text
);

CREATE OR REPLACE FUNCTION public.raw_leads_filtered_match(
  r public.raw_lead_cache,
  p_user_id uuid,
  p_category text,
  p_area text,
  p_lead_filter text,
  p_duplicate_filter text,
  p_search text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    CASE
      WHEN coalesce(p_category, 'all') = 'new' THEN r.category IS NULL AND r.assigned_myself_at IS NULL
      WHEN coalesce(p_category, 'all') = 'assigned_myself' THEN r.assigned_to = p_user_id AND r.assigned_myself_at IS NOT NULL AND r.category IS NULL
      WHEN coalesce(p_category, 'all') IN ('forwarded', 'not_found', 'wrong', 'duplicate') THEN r.category = p_category
      ELSE true
    END
    AND NOT EXISTS (
      SELECT 1
      FROM public.lead_drafts d
      WHERE d.created_by = p_user_id
        AND d.source_type = 'raw_lead'
        AND d.source_lead_id = r.id
    )
    AND (coalesce(p_lead_filter, 'all') = 'all' OR r.lead = p_lead_filter)
    AND (
      coalesce(p_area, 'all') = 'all'
      OR r.data->>'Account Area' = p_area
      OR r.data->>'Sub Area / Neighborhood' = p_area
    )
    AND (
      coalesce(p_duplicate_filter, 'all') = 'all'
      OR (coalesce(p_duplicate_filter, 'all') = 'duplicates' AND r.duplicate_detected IS TRUE)
      OR (coalesce(p_duplicate_filter, 'all') = 'unique' AND coalesce(r.duplicate_detected, false) IS FALSE)
    )
    AND (
      btrim(coalesce(p_search, '')) = ''
      OR r.phone ILIKE ('%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%') ESCAPE '\'
      OR r.lead_link ILIKE ('%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%') ESCAPE '\'
      OR r.data->>'Account Name' ILIKE ('%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%') ESCAPE '\'
      OR r.data->>'Post Text' ILIKE ('%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%') ESCAPE '\'
      OR r.data->>'Account Area' ILIKE ('%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%') ESCAPE '\'
      OR r.data->>'Sub Area / Neighborhood' ILIKE ('%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%') ESCAPE '\'
      OR r.data->>'Incog Account' ILIKE ('%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%') ESCAPE '\'
    );
$$;

CREATE OR REPLACE FUNCTION public.count_raw_leads_filtered(
  p_category text DEFAULT 'all',
  p_area text DEFAULT 'all',
  p_lead_filter text DEFAULT 'all',
  p_duplicate_filter text DEFAULT 'all',
  p_search text DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
  SELECT count(*)
  FROM public.raw_lead_cache r
  WHERE public.raw_leads_filtered_match(
    r,
    auth.uid(),
    p_category,
    p_area,
    p_lead_filter,
    p_duplicate_filter,
    p_search
  );
$$;

CREATE OR REPLACE FUNCTION public.get_raw_leads_cursor_page(
  p_area text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_cursor_captured_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_direction text DEFAULT 'first',
  p_duplicate_filter text DEFAULT NULL,
  p_lead_filter text DEFAULT NULL,
  p_page_size integer DEFAULT 200,
  p_search text DEFAULT ''
)
RETURNS TABLE (
  id uuid,
  row_key text,
  data jsonb,
  lead text,
  phone text,
  category text,
  captured_at timestamptz,
  lead_link text,
  sheet_row integer,
  assigned_to uuid,
  assigned_myself_at timestamptz,
  duplicate_detected boolean,
  duplicate_reason text,
  duplicate_match_type text,
  duplicate_key text,
  duplicate_of_raw_lead_id uuid,
  duplicate_of_qualified_lead_id uuid,
  canonical_post_id text,
  canonical_lead_link text
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  requested_size integer := greatest(0, least(coalesce(p_page_size, 500), 500));
BEGIN
  IF requested_size = 0 THEN
    RETURN;
  END IF;

  IF coalesce(p_direction, 'first') = 'last' THEN
    RETURN QUERY
    SELECT q.*
    FROM (
      SELECT
        r.id, r.row_key, r.data, r.lead, r.phone, r.category, r.captured_at,
        r.lead_link, r.sheet_row, r.assigned_to, r.assigned_myself_at,
        r.duplicate_detected, r.duplicate_reason, r.duplicate_match_type,
        r.duplicate_key, r.duplicate_of_raw_lead_id, r.duplicate_of_qualified_lead_id,
        r.canonical_post_id, r.canonical_lead_link
      FROM public.raw_lead_cache r
      WHERE public.raw_leads_filtered_match(r, auth.uid(), p_category, p_area, p_lead_filter, p_duplicate_filter, p_search)
      ORDER BY r.captured_at ASC NULLS FIRST, r.id ASC
      LIMIT requested_size
    ) q
    ORDER BY q.captured_at DESC NULLS LAST, q.id DESC;
    RETURN;
  END IF;

  IF coalesce(p_direction, 'first') = 'previous' THEN
    RETURN QUERY
    SELECT q.*
    FROM (
      SELECT
        r.id, r.row_key, r.data, r.lead, r.phone, r.category, r.captured_at,
        r.lead_link, r.sheet_row, r.assigned_to, r.assigned_myself_at,
        r.duplicate_detected, r.duplicate_reason, r.duplicate_match_type,
        r.duplicate_key, r.duplicate_of_raw_lead_id, r.duplicate_of_qualified_lead_id,
        r.canonical_post_id, r.canonical_lead_link
      FROM public.raw_lead_cache r
      WHERE p_cursor_id IS NOT NULL
        AND public.raw_leads_filtered_match(r, auth.uid(), p_category, p_area, p_lead_filter, p_duplicate_filter, p_search)
        AND (
          (p_cursor_captured_at IS NULL AND (
            r.captured_at IS NOT NULL OR (r.captured_at IS NULL AND r.id > p_cursor_id)
          ))
          OR (p_cursor_captured_at IS NOT NULL AND r.captured_at IS NOT NULL AND (
            r.captured_at > p_cursor_captured_at
            OR (r.captured_at = p_cursor_captured_at AND r.id > p_cursor_id)
          ))
        )
      ORDER BY r.captured_at ASC NULLS FIRST, r.id ASC
      LIMIT requested_size
    ) q
    ORDER BY q.captured_at DESC NULLS LAST, q.id DESC;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    r.id, r.row_key, r.data, r.lead, r.phone, r.category, r.captured_at,
    r.lead_link, r.sheet_row, r.assigned_to, r.assigned_myself_at,
    r.duplicate_detected, r.duplicate_reason, r.duplicate_match_type,
    r.duplicate_key, r.duplicate_of_raw_lead_id, r.duplicate_of_qualified_lead_id,
    r.canonical_post_id, r.canonical_lead_link
  FROM public.raw_lead_cache r
  WHERE public.raw_leads_filtered_match(r, auth.uid(), p_category, p_area, p_lead_filter, p_duplicate_filter, p_search)
    AND (
      coalesce(p_direction, 'first') = 'first'
      OR p_cursor_id IS NULL
      OR (
        p_cursor_captured_at IS NOT NULL
        AND (
          r.captured_at IS NULL
          OR r.captured_at < p_cursor_captured_at
          OR (r.captured_at = p_cursor_captured_at AND r.id < p_cursor_id)
        )
      )
      OR (
        p_cursor_captured_at IS NULL
        AND r.captured_at IS NULL
        AND r.id < p_cursor_id
      )
    )
  ORDER BY r.captured_at DESC NULLS LAST, r.id DESC
  LIMIT requested_size;
END;
$$;

REVOKE ALL ON FUNCTION public.get_raw_leads_cursor_page(
  text,
  text,
  timestamp with time zone,
  uuid,
  text,
  text,
  text,
  integer,
  text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_raw_leads_cursor_page(
  text,
  text,
  timestamp with time zone,
  uuid,
  text,
  text,
  text,
  integer,
  text
) TO authenticated;

REVOKE ALL ON FUNCTION public.count_raw_leads_filtered(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_raw_leads_filtered(text, text, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.raw_leads_filtered_match(public.raw_lead_cache, uuid, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.raw_leads_filtered_match(public.raw_lead_cache, uuid, text, text, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
