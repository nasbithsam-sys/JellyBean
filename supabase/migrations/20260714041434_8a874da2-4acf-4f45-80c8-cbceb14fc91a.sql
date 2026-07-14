
-- Notifications table
CREATE TABLE public.crm_update_notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL,
  affected_section text,
  target_roles text[] NOT NULL DEFAULT '{}',
  priority text NOT NULL DEFAULT 'normal',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.crm_update_notifications TO authenticated;
GRANT ALL ON public.crm_update_notifications TO service_role;

ALTER TABLE public.crm_update_notifications ENABLE ROW LEVEL SECURITY;

-- Any signed-in user can read active notifications targeted to one of their roles
CREATE POLICY "Users read active notifications for their roles"
  ON public.crm_update_notifications
  FOR SELECT
  TO authenticated
  USING (
    is_active = true
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role::text = ANY (target_roles)
    )
  );

-- Admins can read everything (history view)
CREATE POLICY "Admins read all notifications"
  ON public.crm_update_notifications
  FOR SELECT
  TO authenticated
  USING (public.current_user_has_role_text('admin'));

CREATE POLICY "Admins insert notifications"
  ON public.crm_update_notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (public.current_user_has_role_text('admin') AND created_by = auth.uid());

CREATE POLICY "Admins update notifications"
  ON public.crm_update_notifications
  FOR UPDATE
  TO authenticated
  USING (public.current_user_has_role_text('admin'))
  WITH CHECK (public.current_user_has_role_text('admin'));

CREATE POLICY "Admins delete notifications"
  ON public.crm_update_notifications
  FOR DELETE
  TO authenticated
  USING (public.current_user_has_role_text('admin'));

CREATE INDEX crm_update_notifications_active_published_idx
  ON public.crm_update_notifications (is_active, published_at DESC);

-- Receipts table
CREATE TABLE public.crm_update_notification_receipts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  notification_id uuid NOT NULL REFERENCES public.crm_update_notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notification_id, user_id)
);

GRANT SELECT, INSERT ON public.crm_update_notification_receipts TO authenticated;
GRANT ALL ON public.crm_update_notification_receipts TO service_role;

ALTER TABLE public.crm_update_notification_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own receipts"
  ON public.crm_update_notification_receipts
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.current_user_has_role_text('admin'));

CREATE POLICY "Users insert own receipts"
  ON public.crm_update_notification_receipts
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE INDEX crm_update_receipts_user_notif_idx
  ON public.crm_update_notification_receipts (user_id, notification_id);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_update_notifications;
