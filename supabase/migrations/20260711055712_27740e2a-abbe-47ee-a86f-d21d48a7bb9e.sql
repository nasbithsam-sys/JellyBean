-- Add duplicate_snapshot column and enhance duplicate preview RPC with fallbacks
ALTER TABLE public.raw_lead_cache
  ADD COLUMN IF NOT EXISTS duplicate_snapshot jsonb;

CREATE OR REPLACE FUNCTION public.get_raw_lead_duplicate_match_preview(_current_raw_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _is_admin boolean;
  _current record;
  _raw_match jsonb;
  _qual_match jsonb;
  _assignee jsonb;
  _q_id uuid;
  _r_id uuid;
  _reason text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  _is_admin := current_user_has_role_text('admin') OR current_user_has_role_text('sub_admin');

  SELECT r.id,
         r.assigned_to,
         r.duplicate_of_raw_lead_id,
         r.duplicate_of_qualified_lead_id,
         r.duplicate_match_type,
         r.duplicate_key,
         r.duplicate_snapshot
    INTO _current
  FROM public.raw_lead_cache r
  WHERE r.id = _current_raw_lead_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not found';
  END IF;

  IF NOT (_is_admin OR _current.assigned_to IS NULL OR _current.assigned_to = _uid) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  -- 1. Stored qualified reference
  IF _current.duplicate_of_qualified_lead_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id', q.id,
      'customer_name', q.customer_name,
      'customer_number', q.customer_number,
      'main_area', q.main_area,
      'sub_area', q.sub_area,
      'post_text', q.post_text,
      'cs_status', q.cs_status,
      'assigned_to', q.assigned_to,
      'assigned_at', q.assigned_at,
      'created_at', q.created_at
    ) INTO _qual_match
    FROM public.qualified_leads q
    WHERE q.id = _current.duplicate_of_qualified_lead_id;

    IF _qual_match IS NOT NULL THEN
      IF (_qual_match->>'assigned_to') IS NOT NULL THEN
        SELECT jsonb_build_object(
          'name', COALESCE(NULLIF(BTRIM(p.full_name), ''), NULLIF(BTRIM(p.username), '')),
          'email', p.email
        ) INTO _assignee
        FROM public.profiles p
        WHERE p.user_id = (_qual_match->>'assigned_to')::uuid
        LIMIT 1;
      END IF;
      RETURN jsonb_build_object('type', 'qualified', 'data', _qual_match, 'assignee', _assignee);
    END IF;
  END IF;

  -- 2. Stored raw reference
  IF _current.duplicate_of_raw_lead_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id', r.id,
      'category', r.category,
      'assigned_myself_at', r.assigned_myself_at,
      'assigned_to', r.assigned_to,
      'phone', r.phone,
      'captured_at', r.captured_at,
      'data', r.data
    ) INTO _raw_match
    FROM public.raw_lead_cache r
    WHERE r.id = _current.duplicate_of_raw_lead_id;

    IF _raw_match IS NOT NULL THEN
      RETURN jsonb_build_object('type', 'raw', 'data', _raw_match);
    END IF;
  END IF;

  -- 3. Fallback via duplicate_match_type + duplicate_key (exact only)
  IF _current.duplicate_match_type IN ('post_id', 'canonical_link')
     AND _current.duplicate_key IS NOT NULL
     AND BTRIM(_current.duplicate_key) <> '' THEN

    -- 3a. Prefer an exact qualified match (oldest deterministically)
    IF _current.duplicate_match_type = 'post_id' THEN
      SELECT q.id INTO _q_id
      FROM public.qualified_leads q
      WHERE q.canonical_post_id = _current.duplicate_key
      ORDER BY q.created_at ASC NULLS LAST, q.id ASC
      LIMIT 1;
    ELSE
      SELECT q.id INTO _q_id
      FROM public.qualified_leads q
      WHERE q.canonical_lead_link = _current.duplicate_key
      ORDER BY q.created_at ASC NULLS LAST, q.id ASC
      LIMIT 1;
    END IF;

    IF _q_id IS NOT NULL THEN
      SELECT jsonb_build_object(
        'id', q.id,
        'customer_name', q.customer_name,
        'customer_number', q.customer_number,
        'main_area', q.main_area,
        'sub_area', q.sub_area,
        'post_text', q.post_text,
        'cs_status', q.cs_status,
        'assigned_to', q.assigned_to,
        'assigned_at', q.assigned_at,
        'created_at', q.created_at
      ) INTO _qual_match
      FROM public.qualified_leads q
      WHERE q.id = _q_id;

      IF (_qual_match->>'assigned_to') IS NOT NULL THEN
        SELECT jsonb_build_object(
          'name', COALESCE(NULLIF(BTRIM(p.full_name), ''), NULLIF(BTRIM(p.username), '')),
          'email', p.email
        ) INTO _assignee
        FROM public.profiles p
        WHERE p.user_id = (_qual_match->>'assigned_to')::uuid
        LIMIT 1;
      END IF;
      RETURN jsonb_build_object('type', 'qualified', 'data', _qual_match, 'assignee', _assignee, 'fallback', true);
    END IF;

    -- 3b. Exact raw match (oldest deterministically, excluding current row)
    IF _current.duplicate_match_type = 'post_id' THEN
      SELECT r.id INTO _r_id
      FROM public.raw_lead_cache r
      WHERE r.canonical_post_id = _current.duplicate_key
        AND r.id <> _current_raw_lead_id
      ORDER BY r.captured_at ASC NULLS LAST, r.id ASC
      LIMIT 1;
    ELSE
      SELECT r.id INTO _r_id
      FROM public.raw_lead_cache r
      WHERE r.canonical_lead_link = _current.duplicate_key
        AND r.id <> _current_raw_lead_id
      ORDER BY r.captured_at ASC NULLS LAST, r.id ASC
      LIMIT 1;
    END IF;

    IF _r_id IS NOT NULL THEN
      SELECT jsonb_build_object(
        'id', r.id,
        'category', r.category,
        'assigned_myself_at', r.assigned_myself_at,
        'assigned_to', r.assigned_to,
        'phone', r.phone,
        'captured_at', r.captured_at,
        'data', r.data
      ) INTO _raw_match
      FROM public.raw_lead_cache r
      WHERE r.id = _r_id;

      RETURN jsonb_build_object('type', 'raw', 'data', _raw_match, 'fallback', true);
    END IF;
  END IF;

  _reason := CASE _current.duplicate_match_type
    WHEN 'post_id' THEN 'Same Nextdoor post ID'
    WHEN 'canonical_link' THEN 'Same canonical post link'
    WHEN 'details_all_four' THEN 'Same account, area, posted time & post text'
    ELSE 'Duplicate detected'
  END;

  -- 4. Snapshot fallback
  IF _current.duplicate_snapshot IS NOT NULL THEN
    RETURN jsonb_build_object(
      'type', 'snapshot',
      'original_missing', true,
      'match_type', _current.duplicate_match_type,
      'duplicate_key', _current.duplicate_key,
      'data', _current.duplicate_snapshot,
      'reason', _reason
    );
  END IF;

  -- 5. Missing
  RETURN jsonb_build_object(
    'type', 'missing',
    'original_missing', true,
    'match_type', _current.duplicate_match_type,
    'duplicate_key', _current.duplicate_key,
    'reason', 'Previous matched lead is no longer available'
  );
END;
$function$;