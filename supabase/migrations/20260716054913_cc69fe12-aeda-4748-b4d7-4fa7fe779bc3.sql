
-- 1. Table
CREATE TABLE public.user_access_codes (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  verified_session_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_access_codes_code_format CHECK (code ~ '^[0-9]{6}$')
);

-- Only service_role can touch the table directly. Non-admin users must never
-- be able to SELECT their own or anyone else's raw code.
GRANT ALL ON public.user_access_codes TO service_role;
ALTER TABLE public.user_access_codes ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies for authenticated/anon: all access is via
-- SECURITY DEFINER functions below.

-- 2. Helpers
CREATE OR REPLACE FUNCTION public.generate_access_code()
RETURNS TEXT
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  SELECT lpad((floor(random() * 1000000))::int::text, 6, '0')
$$;

-- 3. Admin: list all users' access codes
CREATE OR REPLACE FUNCTION public.admin_list_access_codes()
RETURNS TABLE(user_id UUID, code TEXT, verified BOOLEAN, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT current_user_has_role_text('admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT c.user_id, c.code, (c.verified_session_id IS NOT NULL), c.updated_at
  FROM public.user_access_codes c;
END;
$$;

-- 4. Admin: regenerate a user's code (invalidates any active verification)
CREATE OR REPLACE FUNCTION public.admin_regenerate_access_code(_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new TEXT := public.generate_access_code();
BEGIN
  IF NOT current_user_has_role_text('admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _user_id) THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  INSERT INTO public.user_access_codes (user_id, code, verified_session_id, updated_at)
    VALUES (_user_id, _new, NULL, now())
    ON CONFLICT (user_id) DO UPDATE
      SET code = EXCLUDED.code,
          verified_session_id = NULL,
          updated_at = now();
  RETURN _new;
END;
$$;

-- 5. Admin: ensure a code exists for a user (used by user-creation flow)
CREATE OR REPLACE FUNCTION public.admin_ensure_access_code(_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _existing TEXT;
  _new TEXT;
BEGIN
  IF NOT current_user_has_role_text('admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT code INTO _existing FROM public.user_access_codes WHERE user_id = _user_id;
  IF _existing IS NOT NULL THEN
    RETURN _existing;
  END IF;
  _new := public.generate_access_code();
  INSERT INTO public.user_access_codes (user_id, code) VALUES (_user_id, _new);
  RETURN _new;
END;
$$;

-- 6. User verifies their OWN code. auth.uid() is the ONLY user identity used.
-- On success, we bind the verification to the caller's current session_id
-- (from the JWT). A new login = new session_id = re-verification required.
CREATE OR REPLACE FUNCTION public.verify_my_access_code(_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _session TEXT := (auth.jwt() ->> 'session_id');
  _stored TEXT;
  _clean TEXT := regexp_replace(coalesce(_code, ''), '\D', '', 'g');
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF _clean !~ '^[0-9]{6}$' THEN
    RETURN FALSE;
  END IF;
  SELECT code INTO _stored FROM public.user_access_codes WHERE user_id = _uid;
  IF _stored IS NULL OR _stored <> _clean THEN
    RETURN FALSE;
  END IF;
  UPDATE public.user_access_codes
    SET verified_session_id = _session,
        updated_at = now()
    WHERE user_id = _uid;
  RETURN TRUE;
END;
$$;

-- 7. Route gate: is the current session verified? Admins always pass.
CREATE OR REPLACE FUNCTION public.is_my_access_verified()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _session TEXT := (auth.jwt() ->> 'session_id');
  _verified TEXT;
BEGIN
  IF _uid IS NULL THEN RETURN FALSE; END IF;
  IF current_user_has_role_text('admin') THEN RETURN TRUE; END IF;
  SELECT verified_session_id INTO _verified
    FROM public.user_access_codes WHERE user_id = _uid;
  RETURN _verified IS NOT NULL AND _session IS NOT NULL AND _verified = _session;
END;
$$;

-- 8. Function grants
REVOKE ALL ON FUNCTION public.generate_access_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_access_codes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_regenerate_access_code(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_ensure_access_code(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_my_access_code(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_my_access_verified() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_list_access_codes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_regenerate_access_code(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ensure_access_code(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_my_access_code(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_my_access_verified() TO authenticated;

-- 9. Backfill: ensure every non-admin user has a code
INSERT INTO public.user_access_codes (user_id, code)
SELECT p.user_id, public.generate_access_code()
FROM public.profiles p
WHERE NOT EXISTS (SELECT 1 FROM public.user_access_codes c WHERE c.user_id = p.user_id)
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p.user_id AND ur.role = 'admin'
  );
