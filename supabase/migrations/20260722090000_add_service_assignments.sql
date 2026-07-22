-- Service-based CS lead assignment. Extends the existing state-routing trigger
-- without reassigning historical qualified leads.

CREATE OR REPLACE FUNCTION public.normalize_lead_service(_input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT NULLIF(regexp_replace(lower(btrim(_input)), '\s+', ' ', 'g'), '')
$$;

CREATE TABLE public.service_assignments (
  service_key text PRIMARY KEY,
  service_name text NOT NULL,
  service_category text,
  assigned_cs_user_id uuid NOT NULL,
  assigned_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_assignments_service_name_not_blank CHECK (public.normalize_lead_service(service_name) IS NOT NULL),
  CONSTRAINT service_assignments_key_matches_name CHECK (service_key = public.normalize_lead_service(service_name))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_assignments TO authenticated;
GRANT ALL ON public.service_assignments TO service_role;

ALTER TABLE public.service_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage service assignments"
  ON public.service_assignments FOR ALL
  TO authenticated
  USING (public.current_user_has_role_text('admin') OR public.current_user_has_role_text('cs_admin'))
  WITH CHECK (public.current_user_has_role_text('admin') OR public.current_user_has_role_text('cs_admin'));

CREATE TRIGGER service_assignments_set_updated_at
  BEFORE UPDATE ON public.service_assignments
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Supports exact normalized service counts and routing lookups without scanning
-- every qualified lead for each service assignment row.
CREATE INDEX qualified_leads_normalized_service_idx
  ON public.qualified_leads (public.normalize_lead_service(service));

CREATE OR REPLACE FUNCTION public.tg_qualified_leads_route_by_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  resolved text;
  owner uuid;
  service_owner uuid;
BEGIN
  IF NEW.state_code IS NULL THEN
    resolved := public.normalize_us_state(NEW.main_area);
    IF resolved IS NULL THEN
      resolved := public.normalize_us_state(NEW.sub_area);
    END IF;
    NEW.state_code := resolved;
  END IF;

  IF NEW.assigned_to IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT assigned_cs_user_id INTO service_owner
  FROM public.service_assignments
  WHERE service_key = public.normalize_lead_service(NEW.service)
  LIMIT 1;

  IF service_owner IS NOT NULL THEN
    NEW.assigned_to := service_owner;
    NEW.assigned_at := COALESCE(NEW.assigned_at, now());
    RETURN NEW;
  END IF;

  IF NEW.state_code IS NOT NULL THEN
    SELECT assigned_cs_user_id INTO owner
    FROM public.state_assignments
    WHERE state_code = NEW.state_code
    LIMIT 1;
    IF owner IS NOT NULL THEN
      NEW.assigned_to := owner;
      NEW.assigned_at := COALESCE(NEW.assigned_at, now());
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_qualified_leads_route_by_state() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.list_service_assignments()
RETURNS TABLE(
  service_key text,
  service_name text,
  service_category text,
  assigned_cs_user_id uuid,
  cs_user_name text,
  cs_user_email text,
  total_leads bigint,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (current_user_has_role_text('admin') OR current_user_has_role_text('cs_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  WITH lead_counts AS (
    SELECT public.normalize_lead_service(q.service) AS service_key, count(*)::bigint AS total
    FROM public.qualified_leads q
    WHERE public.normalize_lead_service(q.service) IS NOT NULL
    GROUP BY public.normalize_lead_service(q.service)
  )
  SELECT
    sa.service_key,
    sa.service_name,
    sa.service_category,
    sa.assigned_cs_user_id,
    COALESCE(NULLIF(BTRIM(p.full_name), ''), NULLIF(BTRIM(p.username), ''), p.email),
    p.email,
    COALESCE(lc.total, 0),
    sa.updated_at
  FROM public.service_assignments sa
  LEFT JOIN public.profiles p ON p.user_id = sa.assigned_cs_user_id
  LEFT JOIN lead_counts lc ON lc.service_key = sa.service_key
  ORDER BY sa.service_name;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_lead_service(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_service_assignments() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.normalize_lead_service(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_service_assignments() TO authenticated;
