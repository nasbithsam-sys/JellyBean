
CREATE TABLE public.lead_reminders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES public.qualified_leads(id) ON DELETE CASCADE,
  sender_user_id UUID NOT NULL,
  recipient_user_id UUID NOT NULL,
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 1000),
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);

CREATE INDEX idx_lead_reminders_recipient_unread
  ON public.lead_reminders (recipient_user_id, created_at DESC)
  WHERE is_read = false;
CREATE INDEX idx_lead_reminders_recipient
  ON public.lead_reminders (recipient_user_id, created_at DESC);
CREATE INDEX idx_lead_reminders_sender
  ON public.lead_reminders (sender_user_id, created_at DESC);

GRANT SELECT, UPDATE ON public.lead_reminders TO authenticated;
GRANT ALL ON public.lead_reminders TO service_role;

ALTER TABLE public.lead_reminders ENABLE ROW LEVEL SECURITY;

-- Recipient or sender can read
CREATE POLICY "Users can read reminders addressed to or sent by them"
  ON public.lead_reminders
  FOR SELECT
  TO authenticated
  USING (auth.uid() = recipient_user_id OR auth.uid() = sender_user_id);

-- Only recipient may mark as read; sender_user_id/recipient_user_id/lead_id/message frozen
CREATE POLICY "Recipient can mark their reminder as read"
  ON public.lead_reminders
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = recipient_user_id)
  WITH CHECK (auth.uid() = recipient_user_id);

-- No direct INSERT policy: inserts go through the SECURITY DEFINER RPC only.

ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_reminders;

CREATE OR REPLACE FUNCTION public.send_lead_reminder(_lead_id UUID, _message TEXT)
RETURNS public.lead_reminders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _sender UUID := auth.uid();
  _recipient UUID;
  _msg TEXT := btrim(coalesce(_message, ''));
  _row public.lead_reminders;
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

  -- Sender must hold a role permitted to work with Manual (forwarded) leads.
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

  IF _recipient IS NULL THEN
    RAISE EXCEPTION 'No CS user is assigned to this lead';
  END IF;

  -- Recipient must still exist and be an active CS user
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = _recipient AND p.is_active = true
  ) THEN
    RAISE EXCEPTION 'Assigned CS user is no longer available';
  END IF;

  INSERT INTO public.lead_reminders (lead_id, sender_user_id, recipient_user_id, message)
  VALUES (_lead_id, _sender, _recipient, _msg)
  RETURNING * INTO _row;

  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.send_lead_reminder(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_lead_reminder(UUID, TEXT) TO authenticated;
