
-- 1. state_assignments table
CREATE TABLE public.state_assignments (
  state_code text PRIMARY KEY,
  state_name text NOT NULL,
  assigned_cs_user_id uuid NOT NULL,
  assigned_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.state_assignments TO authenticated;
GRANT ALL ON public.state_assignments TO service_role;

ALTER TABLE public.state_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage state assignments"
  ON public.state_assignments FOR ALL
  TO authenticated
  USING (public.current_user_has_role_text('admin') OR public.current_user_has_role_text('cs_admin'))
  WITH CHECK (public.current_user_has_role_text('admin') OR public.current_user_has_role_text('cs_admin'));

CREATE TRIGGER state_assignments_set_updated_at
  BEFORE UPDATE ON public.state_assignments
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 2. state_code column on qualified_leads (nullable; no backfill)
ALTER TABLE public.qualified_leads ADD COLUMN state_code text;
CREATE INDEX qualified_leads_state_code_idx ON public.qualified_leads(state_code);

-- 3. State normalization helper
CREATE OR REPLACE FUNCTION public.normalize_us_state(_input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  s text;
  m text;
  code text;
  names jsonb := '{
    "ALABAMA":"AL","ALASKA":"AK","ARIZONA":"AZ","ARKANSAS":"AR","CALIFORNIA":"CA",
    "COLORADO":"CO","CONNECTICUT":"CT","DELAWARE":"DE","FLORIDA":"FL","GEORGIA":"GA",
    "HAWAII":"HI","IDAHO":"ID","ILLINOIS":"IL","INDIANA":"IN","IOWA":"IA","KANSAS":"KS",
    "KENTUCKY":"KY","LOUISIANA":"LA","MAINE":"ME","MARYLAND":"MD","MASSACHUSETTS":"MA",
    "MICHIGAN":"MI","MINNESOTA":"MN","MISSISSIPPI":"MS","MISSOURI":"MO","MONTANA":"MT",
    "NEBRASKA":"NE","NEVADA":"NV","NEW HAMPSHIRE":"NH","NEW JERSEY":"NJ","NEW MEXICO":"NM",
    "NEW YORK":"NY","NORTH CAROLINA":"NC","NORTH DAKOTA":"ND","OHIO":"OH","OKLAHOMA":"OK",
    "OREGON":"OR","PENNSYLVANIA":"PA","RHODE ISLAND":"RI","SOUTH CAROLINA":"SC",
    "SOUTH DAKOTA":"SD","TENNESSEE":"TN","TEXAS":"TX","UTAH":"UT","VERMONT":"VT",
    "VIRGINIA":"VA","WASHINGTON":"WA","WEST VIRGINIA":"WV","WISCONSIN":"WI","WYOMING":"WY",
    "DISTRICT OF COLUMBIA":"DC"
  }'::jsonb;
  codes text[] := ARRAY[
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY',
    'LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND',
    'OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'
  ];
BEGIN
  IF _input IS NULL THEN RETURN NULL; END IF;
  s := upper(btrim(_input));
  IF s = '' THEN RETURN NULL; END IF;

  -- Exact 2-letter code
  IF length(s) = 2 AND s = ANY(codes) THEN RETURN s; END IF;

  -- Exact full name
  IF names ? s THEN RETURN names->>s; END IF;

  -- Trailing " XX" or ", XX" 2-letter token
  m := (regexp_match(s, '(?:^|[ ,])([A-Z]{2})(?:[ ,.\-]|$)'))[1];
  IF m IS NOT NULL AND m = ANY(codes) THEN
    -- guard against false positives like "OR" as conjunction: only accept if it appears
    -- as a trailing token (last word) or preceded by comma
    IF s ~ ('(,\s*|\s)' || m || '\s*[0-9]*\s*$') THEN
      RETURN m;
    END IF;
  END IF;

  -- Full name as substring (word-boundary)
  FOR m IN SELECT k FROM jsonb_object_keys(names) k LOOP
    IF s ~ ('(^|[^A-Z])' || m || '([^A-Z]|$)') THEN
      RETURN names->>m;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

-- 4. Trigger function: resolve state and auto-assign
CREATE OR REPLACE FUNCTION public.tg_qualified_leads_route_by_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  resolved text;
  owner uuid;
BEGIN
  IF NEW.state_code IS NULL THEN
    resolved := public.normalize_us_state(NEW.main_area);
    IF resolved IS NULL THEN
      resolved := public.normalize_us_state(NEW.sub_area);
    END IF;
    NEW.state_code := resolved;
  END IF;

  IF NEW.assigned_to IS NULL AND NEW.state_code IS NOT NULL THEN
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

CREATE TRIGGER qualified_leads_route_by_state
  BEFORE INSERT ON public.qualified_leads
  FOR EACH ROW EXECUTE FUNCTION public.tg_qualified_leads_route_by_state();

-- 5. RPCs

-- List assignments with joined CS user info and total lead counts
CREATE OR REPLACE FUNCTION public.list_state_assignments()
RETURNS TABLE(
  state_code text,
  state_name text,
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
  SELECT
    sa.state_code,
    sa.state_name,
    sa.assigned_cs_user_id,
    COALESCE(NULLIF(BTRIM(p.full_name), ''), NULLIF(BTRIM(p.username), ''), p.email),
    p.email,
    (SELECT count(*)::bigint FROM public.qualified_leads q
       WHERE COALESCE(q.state_code, public.normalize_us_state(q.main_area), public.normalize_us_state(q.sub_area)) = sa.state_code),
    sa.updated_at
  FROM public.state_assignments sa
  LEFT JOIN public.profiles p ON p.user_id = sa.assigned_cs_user_id
  ORDER BY sa.state_name;
END;
$$;

-- Per-state analytics by cs_status
CREATE OR REPLACE FUNCTION public.state_assignment_analytics(_from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL)
RETURNS TABLE(
  state_code text,
  state_name text,
  assigned_cs_user_id uuid,
  cs_user_name text,
  total_leads bigint,
  by_status jsonb
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
  WITH resolved AS (
    SELECT
      q.id,
      COALESCE(q.state_code, public.normalize_us_state(q.main_area), public.normalize_us_state(q.sub_area)) AS sc,
      q.cs_status::text AS status,
      q.assigned_at
    FROM public.qualified_leads q
    WHERE (_from IS NULL OR q.assigned_at >= _from)
      AND (_to IS NULL OR q.assigned_at < _to)
  ),
  grouped AS (
    SELECT sc, status, count(*)::bigint AS c
    FROM resolved
    WHERE sc IS NOT NULL
    GROUP BY sc, status
  ),
  totals AS (
    SELECT sc, sum(c)::bigint AS total, jsonb_object_agg(status, c) AS statuses
    FROM grouped GROUP BY sc
  )
  SELECT
    sa.state_code,
    sa.state_name,
    sa.assigned_cs_user_id,
    COALESCE(NULLIF(BTRIM(p.full_name), ''), NULLIF(BTRIM(p.username), ''), p.email),
    COALESCE(t.total, 0),
    COALESCE(t.statuses, '{}'::jsonb)
  FROM public.state_assignments sa
  LEFT JOIN public.profiles p ON p.user_id = sa.assigned_cs_user_id
  LEFT JOIN totals t ON t.sc = sa.state_code
  ORDER BY sa.state_name;
END;
$$;

-- Per-CS-user totals
CREATE OR REPLACE FUNCTION public.cs_user_assignment_totals(_from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL)
RETURNS TABLE(
  cs_user_id uuid,
  cs_user_name text,
  cs_user_email text,
  assigned_states text[],
  total_leads bigint,
  processed_leads bigint,
  pending_leads bigint,
  by_state jsonb,
  by_status jsonb
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
  WITH sa_agg AS (
    SELECT assigned_cs_user_id, array_agg(state_code ORDER BY state_name) AS states
    FROM public.state_assignments
    GROUP BY assigned_cs_user_id
  ),
  leads AS (
    SELECT
      q.id,
      COALESCE(q.state_code, public.normalize_us_state(q.main_area), public.normalize_us_state(q.sub_area)) AS sc,
      q.cs_status::text AS status
    FROM public.qualified_leads q
    JOIN public.state_assignments sa2 ON sa2.state_code = COALESCE(q.state_code, public.normalize_us_state(q.main_area), public.normalize_us_state(q.sub_area))
    WHERE (_from IS NULL OR q.assigned_at >= _from)
      AND (_to IS NULL OR q.assigned_at < _to)
      AND q.assigned_to = sa2.assigned_cs_user_id
  ),
  per_user AS (
    SELECT
      sa2.assigned_cs_user_id AS uid,
      count(l.id)::bigint AS total,
      count(l.id) FILTER (WHERE l.status = 'converted')::bigint AS processed,
      count(l.id) FILTER (WHERE l.status <> 'converted' AND l.status IS NOT NULL)::bigint AS pending,
      COALESCE(jsonb_object_agg(l.sc, cnt) FILTER (WHERE l.sc IS NOT NULL), '{}'::jsonb) AS by_state_agg,
      COALESCE(jsonb_object_agg(l.status, sc_cnt) FILTER (WHERE l.status IS NOT NULL), '{}'::jsonb) AS by_status_agg
    FROM public.state_assignments sa2
    LEFT JOIN LATERAL (
      SELECT l1.sc, l1.status, count(*)::bigint AS cnt, count(*)::bigint AS sc_cnt, min(l1.id) AS id
      FROM leads l1 WHERE l1.sc = sa2.state_code
      GROUP BY l1.sc, l1.status
    ) l ON true
    GROUP BY sa2.assigned_cs_user_id
  )
  SELECT
    pu.uid,
    COALESCE(NULLIF(BTRIM(p.full_name), ''), NULLIF(BTRIM(p.username), ''), p.email),
    p.email,
    COALESCE(sa.states, ARRAY[]::text[]),
    pu.total, pu.processed, pu.pending,
    pu.by_state_agg, pu.by_status_agg
  FROM per_user pu
  LEFT JOIN public.profiles p ON p.user_id = pu.uid
  LEFT JOIN sa_agg sa ON sa.assigned_cs_user_id = pu.uid
  ORDER BY pu.total DESC;
END;
$$;
