-- 1. Replace send_lead_reminder (return type changed → drop first)
DROP FUNCTION IF EXISTS public.send_lead_reminder(uuid, text);

CREATE OR REPLACE FUNCTION public.send_lead_reminder(_lead_id uuid, _message text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _sender UUID := auth.uid();
  _recipient UUID;
  _msg TEXT := btrim(coalesce(_message, ''));
  _inserted_count int := 0;
  _mode text;
BEGIN
  IF _sender IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF char_length(_msg) = 0 THEN
    RAISE EXCEPTION 'Reminder note is required';
  END IF;
  IF char_length(_msg) > 1000 THEN
    RAISE EXCEPTION 'Reminder note is too long (max 1000 characters)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _sender
      AND role::text IN ('admin','sub_admin','maturing','acc_handler','facebook','seo')
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT assigned_to INTO _recipient
  FROM public.qualified_leads
  WHERE id = _lead_id;

  IF _recipient IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = _recipient AND p.is_active = true
    ) THEN
      RAISE EXCEPTION 'Assigned CS user is no longer available';
    END IF;

    INSERT INTO public.lead_reminders (lead_id, sender_user_id, recipient_user_id, message)
    VALUES (_lead_id, _sender, _recipient, _msg);
    _inserted_count := 1;
    _mode := 'assigned';
  ELSE
    WITH cs_users AS (
      SELECT DISTINCT ur.user_id
      FROM public.user_roles ur
      JOIN public.profiles p ON p.user_id = ur.user_id
      WHERE ur.role::text = 'cs'
        AND p.is_active = true
    ),
    ins AS (
      INSERT INTO public.lead_reminders (lead_id, sender_user_id, recipient_user_id, message)
      SELECT _lead_id, _sender, cu.user_id, _msg FROM cs_users cu
      RETURNING 1
    )
    SELECT count(*)::int INTO _inserted_count FROM ins;

    IF _inserted_count = 0 THEN
      RAISE EXCEPTION 'No active CS users are available to receive this reminder';
    END IF;
    _mode := 'broadcast';
  END IF;

  RETURN jsonb_build_object('mode', _mode, 'recipient_count', _inserted_count);
END;
$$;

REVOKE ALL ON FUNCTION public.send_lead_reminder(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_lead_reminder(uuid, text) TO authenticated;

-- 2. Tighten shared_state SELECT policy: role-holders only
DROP POLICY IF EXISTS "shared_state: read" ON public.shared_state;
CREATE POLICY "shared_state: read"
  ON public.shared_state
  FOR SELECT
  TO authenticated
  USING (
    current_user_has_role_text('admin')
    OR current_user_has_role_text('sub_admin')
    OR current_user_has_role_text('cs')
    OR current_user_has_role_text('cs_admin')
    OR current_user_has_role_text('maturing')
    OR current_user_has_role_text('acc_handler')
    OR current_user_has_role_text('facebook')
    OR current_user_has_role_text('seo')
  );