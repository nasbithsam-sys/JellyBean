CREATE TABLE public.incogniton_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_name text NOT NULL,
  incogniton_profile_id text NOT NULL UNIQUE,
  group_name text,
  platform text,
  linked_lead_id uuid REFERENCES public.qualified_leads(id) ON DELETE SET NULL,
  last_launched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE INDEX idx_incogniton_profiles_group ON public.incogniton_profiles(group_name);
CREATE INDEX idx_incogniton_profiles_lead ON public.incogniton_profiles(linked_lead_id);

ALTER TABLE public.incogniton_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "incog: marketing+admin read"
ON public.incogniton_profiles FOR SELECT TO authenticated
USING (current_user_has_role('admin'::app_role) OR current_user_has_role('marketing'::app_role) OR current_user_has_role('cs'::app_role));

CREATE POLICY "incog: marketing+admin insert"
ON public.incogniton_profiles FOR INSERT TO authenticated
WITH CHECK (current_user_has_role('admin'::app_role) OR current_user_has_role('marketing'::app_role));

CREATE POLICY "incog: marketing+admin+cs update"
ON public.incogniton_profiles FOR UPDATE TO authenticated
USING (current_user_has_role('admin'::app_role) OR current_user_has_role('marketing'::app_role) OR current_user_has_role('cs'::app_role))
WITH CHECK (current_user_has_role('admin'::app_role) OR current_user_has_role('marketing'::app_role) OR current_user_has_role('cs'::app_role));

CREATE POLICY "incog: admin delete"
ON public.incogniton_profiles FOR DELETE TO authenticated
USING (current_user_has_role('admin'::app_role) OR current_user_has_role('marketing'::app_role));