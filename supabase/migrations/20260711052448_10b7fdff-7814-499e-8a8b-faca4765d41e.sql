CREATE OR REPLACE FUNCTION public.get_raw_lead_duplicate_match_preview(_current_raw_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _is_admin boolean;
  _current record;
  _raw_match jsonb;
  _qual_match jsonb;
  _assignee jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  _is_admin := current_user_has_role_text('admin') OR current_user_has_role_text('sub_admin');

  SELECT r.id, r.assigned_to, r.duplicate_of_raw_lead_id, r.duplicate_of_qualified_lead_id
    INTO _current
  FROM public.raw_lead_cache r
  WHERE r.id = _current_raw_lead_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not found';
  END IF;

  -- Caller must have visibility to the current raw lead (mirrors raw_lead_cache RLS spirit).
  IF NOT (_is_admin OR _current.assigned_to IS NULL OR _current.assigned_to = _uid) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

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

    IF _qual_match IS NOT NULL AND (_qual_match->>'assigned_to') IS NOT NULL THEN
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

    RETURN jsonb_build_object('type', 'raw', 'data', _raw_match);
  END IF;

  RETURN jsonb_build_object('type', null);
END;
$$;

REVOKE ALL ON FUNCTION public.get_raw_lead_duplicate_match_preview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_raw_lead_duplicate_match_preview(uuid) TO authenticated;
