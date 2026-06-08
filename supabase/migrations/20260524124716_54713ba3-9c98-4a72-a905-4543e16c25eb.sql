-- =========================================================
-- Roles enum + user_roles (separate table to prevent privilege escalation)
-- =========================================================
CREATE TYPE public.app_role AS ENUM ('admin', 'marketing', 'cs');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.current_user_has_role(_role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = _role)
$$;

CREATE POLICY "user_roles: user reads own"
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "user_roles: admin reads all"
  ON public.user_roles FOR SELECT TO authenticated
  USING (public.current_user_has_role('admin'));

CREATE POLICY "user_roles: admin manages"
  ON public.user_roles FOR ALL TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

-- =========================================================
-- Profiles
-- =========================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  username TEXT UNIQUE,
  email TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  otp_required BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles: user reads own" ON public.profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "profiles: user updates own" ON public.profiles
  FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "profiles: admin reads all" ON public.profiles
  FOR SELECT TO authenticated USING (public.current_user_has_role('admin'));
CREATE POLICY "profiles: admin manages" ON public.profiles
  FOR ALL TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

-- Username lookup helper (security definer so login flow can resolve username->email)
CREATE OR REPLACE FUNCTION public.email_for_username(_username TEXT)
RETURNS TEXT LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT email FROM public.profiles WHERE username = _username AND is_active = true LIMIT 1
$$;

-- =========================================================
-- Updated_at trigger
-- =========================================================
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =========================================================
-- Raw leads (from Google Sheets)
-- =========================================================
CREATE TYPE public.raw_lead_status AS ENUM ('new', 'qualified', 'cancelled');
CREATE TYPE public.raw_lead_cancel_reason AS ENUM (
  'not_a_lead','general_post','spam','duplicate','irrelevant','number_not_found'
);

CREATE TABLE public.raw_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poster_name TEXT,
  sub_area TEXT,
  posted_at TIMESTAMPTZ,
  post_text TEXT,
  lead_link TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  account_name TEXT,
  account_area TEXT,
  status public.raw_lead_status NOT NULL DEFAULT 'new',
  cancel_reason public.raw_lead_cancel_reason,
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  external_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.raw_leads ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_raw_leads_status_created ON public.raw_leads (status, created_at DESC);

CREATE TRIGGER trg_raw_leads_updated_at BEFORE UPDATE ON public.raw_leads
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE POLICY "raw_leads: marketing+admin read" ON public.raw_leads
  FOR SELECT TO authenticated
  USING (public.current_user_has_role('admin') OR public.current_user_has_role('marketing'));

CREATE POLICY "raw_leads: marketing+admin update" ON public.raw_leads
  FOR UPDATE TO authenticated
  USING (public.current_user_has_role('admin') OR public.current_user_has_role('marketing'));

CREATE POLICY "raw_leads: admin insert" ON public.raw_leads
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_has_role('admin'));

CREATE POLICY "raw_leads: admin delete" ON public.raw_leads
  FOR DELETE TO authenticated
  USING (public.current_user_has_role('admin'));

-- =========================================================
-- Qualified leads (sent to CS)
-- =========================================================
CREATE TYPE public.cs_status AS ENUM (
  'new','called','messaged','follow_up','interested','converted','closed_won','closed_lost'
);

CREATE TABLE public.qualified_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_lead_id UUID REFERENCES public.raw_leads(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_number TEXT NOT NULL,
  context TEXT,
  pass_it_to TEXT,
  sub_area TEXT,
  main_area TEXT,
  marketing_notes TEXT,
  original_lead_link TEXT,
  assigned_by UUID REFERENCES auth.users(id),
  assigned_to UUID REFERENCES auth.users(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cs_status public.cs_status NOT NULL DEFAULT 'new',
  cs_notes JSONB NOT NULL DEFAULT '[]'::jsonb,
  followup_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.qualified_leads ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_qualified_leads_status_created ON public.qualified_leads (cs_status, created_at DESC);

CREATE TRIGGER trg_qualified_leads_updated_at BEFORE UPDATE ON public.qualified_leads
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE POLICY "qualified_leads: cs+admin read" ON public.qualified_leads
  FOR SELECT TO authenticated
  USING (
    public.current_user_has_role('admin')
    OR public.current_user_has_role('cs')
    OR public.current_user_has_role('marketing')
  );

CREATE POLICY "qualified_leads: marketing+admin insert" ON public.qualified_leads
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_has_role('admin') OR public.current_user_has_role('marketing'));

CREATE POLICY "qualified_leads: cs+admin update" ON public.qualified_leads
  FOR UPDATE TO authenticated
  USING (public.current_user_has_role('admin') OR public.current_user_has_role('cs'));

CREATE POLICY "qualified_leads: admin delete" ON public.qualified_leads
  FOR DELETE TO authenticated
  USING (public.current_user_has_role('admin'));

-- Realtime
ALTER TABLE public.qualified_leads REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.qualified_leads;

-- =========================================================
-- Accounts
-- =========================================================
CREATE TABLE public.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  area TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  notes TEXT,
  last_opened_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_accounts_updated_at BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE POLICY "accounts: marketing+admin read" ON public.accounts
  FOR SELECT TO authenticated
  USING (public.current_user_has_role('admin') OR public.current_user_has_role('marketing'));

CREATE POLICY "accounts: marketing+admin write" ON public.accounts
  FOR ALL TO authenticated
  USING (public.current_user_has_role('admin') OR public.current_user_has_role('marketing'))
  WITH CHECK (public.current_user_has_role('admin') OR public.current_user_has_role('marketing'));

-- =========================================================
-- Activity logs
-- =========================================================
CREATE TABLE public.activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users(id),
  actor_name TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_activity_logs_created ON public.activity_logs (created_at DESC);

CREATE POLICY "logs: authenticated insert" ON public.activity_logs
  FOR INSERT TO authenticated WITH CHECK (actor_id = auth.uid());
CREATE POLICY "logs: admin read" ON public.activity_logs
  FOR SELECT TO authenticated USING (public.current_user_has_role('admin'));

-- =========================================================
-- App settings (singleton)
-- =========================================================
CREATE TABLE public.app_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
  admin_otp_required BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.app_settings (id) VALUES (true);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "settings: auth read" ON public.app_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "settings: admin update" ON public.app_settings
  FOR UPDATE TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));
