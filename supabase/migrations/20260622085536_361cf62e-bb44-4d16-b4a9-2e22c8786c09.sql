
-- 1. qualified_leads: remove roleless policies
DROP POLICY IF EXISTS "Authenticated users insert own leads" ON public.qualified_leads;
DROP POLICY IF EXISTS "Submitters can read own leads" ON public.qualified_leads;

-- Replace update policy: drop bare created_by branch
DROP POLICY IF EXISTS "qualified_leads: update" ON public.qualified_leads;
CREATE POLICY "qualified_leads: update" ON public.qualified_leads
  FOR UPDATE
  USING (
    current_user_has_role_text('admin')
    OR current_user_has_role_text('sub_admin')
    OR current_user_has_role_text('cs')
  )
  WITH CHECK (
    current_user_has_role_text('admin')
    OR current_user_has_role_text('sub_admin')
    OR current_user_has_role_text('cs')
  );

-- 2. RPC role guards
CREATE OR REPLACE FUNCTION public.check_qualified_lead_phone_duplicates(_phone_digits text, _since timestamp with time zone)
 RETURNS TABLE(id uuid, customer_name text, customer_number text, customer_number_2 text, assigned_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY
   SELECT q.id, q.customer_name, q.customer_number, q.customer_number_2, q.assigned_at
   FROM public.qualified_leads q
   WHERE q.assigned_at >= _since
     AND _phone_digits <> ''
     AND (
       regexp_replace(COALESCE(q.customer_number, ''), '\D', '', 'g') LIKE '%' || _phone_digits || '%'
       OR regexp_replace(COALESCE(q.customer_number_2, ''), '\D', '', 'g') LIKE '%' || _phone_digits || '%'
       OR EXISTS (
         SELECT 1 FROM unnest(COALESCE(q.extra_numbers, '{}'::text[])) AS xn
         WHERE regexp_replace(xn, '\D', '', 'g') LIKE '%' || _phone_digits || '%'
       )
     )
   ORDER BY q.assigned_at DESC
   LIMIT 20;
END;
$function$;

CREATE OR REPLACE FUNCTION public.report_leads_forwarded_by_maturing(_from timestamp with time zone DEFAULT NULL, _to timestamp with time zone DEFAULT NULL)
 RETURNS TABLE(maturing_id uuid, maturing_name text, maturing_email text, forwarded_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (current_user_has_role_text('admin') OR current_user_has_role_text('sub_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY
  WITH forwarded AS (
    SELECT
      COALESCE(q.created_by, q.assigned_by) AS user_id,
      COUNT(*)::bigint AS forwarded_count
    FROM public.qualified_leads q
    WHERE (_from IS NULL OR q.assigned_at >= _from)
      AND (_to IS NULL OR q.assigned_at <  _to)
    GROUP BY COALESCE(q.created_by, q.assigned_by)
  )
  SELECT
    f.user_id,
    COALESCE(
      NULLIF(BTRIM(p.full_name), ''),
      NULLIF(BTRIM(p.username), ''),
      NULLIF(BTRIM(au.raw_user_meta_data->>'full_name'), ''),
      NULLIF(BTRIM(au.raw_user_meta_data->>'name'), ''),
      NULLIF(BTRIM(p.email), ''),
      NULLIF(BTRIM(au.email), ''),
      CASE WHEN f.user_id IS NULL THEN '(unknown)' ELSE 'Unknown user ' || LEFT(f.user_id::text, 8) END
    ),
    COALESCE(NULLIF(BTRIM(p.email), ''), NULLIF(BTRIM(au.email), '')),
    f.forwarded_count
  FROM forwarded f
  LEFT JOIN LATERAL (
    SELECT p1.full_name, p1.username, p1.email
    FROM public.profiles p1
    WHERE p1.user_id = f.user_id OR p1.id = f.user_id
    ORDER BY CASE WHEN p1.user_id = f.user_id THEN 0 ELSE 1 END
    LIMIT 1
  ) p ON TRUE
  LEFT JOIN auth.users au ON au.id = f.user_id
  ORDER BY f.forwarded_count DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.report_not_found_by_user(_from timestamp with time zone DEFAULT NULL, _to timestamp with time zone DEFAULT NULL)
 RETURNS TABLE(user_id uuid, user_name text, user_email text, not_found_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (current_user_has_role_text('admin') OR current_user_has_role_text('sub_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY
  SELECT
    r.categorized_by,
    COALESCE(p.full_name, p.username, p.email, '(unknown)'),
    p.email,
    COUNT(*)::bigint
  FROM public.raw_lead_cache r
  LEFT JOIN public.profiles p ON p.id = r.categorized_by
  WHERE r.category = 'not_found'
    AND (_from IS NULL OR r.categorized_at >= _from)
    AND (_to   IS NULL OR r.categorized_at <  _to)
  GROUP BY r.categorized_by, p.full_name, p.username, p.email
  ORDER BY COUNT(*) DESC;
END;
$function$;

-- raw_lead_cache_category_counts: ignore caller-supplied _is_admin; resolve internally
CREATE OR REPLACE FUNCTION public.raw_lead_cache_category_counts(_user_id uuid, _is_admin boolean DEFAULT false)
 RETURNS TABLE(new bigint, forwarded bigint, not_found bigint, wrong bigint, duplicate bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  effective_admin boolean;
BEGIN
  effective_admin := current_user_has_role_text('admin') OR current_user_has_role_text('sub_admin');
  RETURN QUERY
  SELECT
    count(*) FILTER (WHERE category IS NULL),
    count(*) FILTER (WHERE category = 'forwarded'),
    count(*) FILTER (WHERE category = 'not_found'),
    count(*) FILTER (WHERE category = 'wrong'),
    count(*) FILTER (WHERE category = 'duplicate')
  FROM public.raw_lead_cache
  WHERE effective_admin
     OR assigned_to IS NULL
     OR assigned_to = auth.uid();
END;
$function$;

-- 3. Storage: lock down lead-attachments reads
DROP POLICY IF EXISTS "Anyone can read lead attachments" ON storage.objects;
CREATE POLICY "Authorized roles can read lead attachments" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'lead-attachments'
    AND (
      current_user_has_role_text('admin')
      OR current_user_has_role_text('sub_admin')
      OR current_user_has_role_text('cs')
      OR current_user_has_role_text('scraping')
      OR current_user_has_role_text('maturing')
      OR current_user_has_role_text('acc_handler')
    )
  );

-- 4. map_snapshots: explicit admin/sub_admin write policies (writes still typically go through service role)
CREATE POLICY "map_snapshots: admin insert" ON public.map_snapshots
  FOR INSERT TO authenticated
  WITH CHECK (current_user_has_role_text('admin') OR current_user_has_role_text('sub_admin'));
CREATE POLICY "map_snapshots: admin update" ON public.map_snapshots
  FOR UPDATE TO authenticated
  USING (current_user_has_role_text('admin') OR current_user_has_role_text('sub_admin'))
  WITH CHECK (current_user_has_role_text('admin') OR current_user_has_role_text('sub_admin'));
CREATE POLICY "map_snapshots: admin delete" ON public.map_snapshots
  FOR DELETE TO authenticated
  USING (current_user_has_role_text('admin') OR current_user_has_role_text('sub_admin'));
