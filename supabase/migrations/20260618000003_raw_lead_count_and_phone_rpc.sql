CREATE OR REPLACE FUNCTION public.raw_lead_cache_category_counts(
  _user_id uuid,
  _is_admin boolean DEFAULT false
)
RETURNS TABLE(
  new bigint,
  forwarded bigint,
  not_found bigint,
  wrong bigint,
  duplicate bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    count(*) FILTER (WHERE category IS NULL) AS new,
    count(*) FILTER (WHERE category = 'forwarded') AS forwarded,
    count(*) FILTER (WHERE category = 'not_found') AS not_found,
    count(*) FILTER (WHERE category = 'wrong') AS wrong,
    count(*) FILTER (WHERE category = 'duplicate') AS duplicate
  FROM public.raw_lead_cache
  WHERE _is_admin
     OR assigned_to IS NULL
     OR assigned_to = _user_id;
$$;

GRANT EXECUTE ON FUNCTION public.raw_lead_cache_category_counts(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.check_qualified_lead_phone_duplicates(
  _phone_digits text,
  _since timestamp with time zone
)
RETURNS TABLE(
  id uuid,
  customer_name text,
  customer_number text,
  customer_number_2 text,
  assigned_at timestamp with time zone
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    q.id,
    q.customer_name,
    q.customer_number,
    q.customer_number_2,
    q.assigned_at
  FROM public.qualified_leads q
  WHERE q.assigned_at >= _since
    AND (
      RIGHT(
        CASE
          WHEN LENGTH(regexp_replace(COALESCE(q.customer_number, ''), '\D', '', 'g')) = 11
            AND regexp_replace(COALESCE(q.customer_number, ''), '\D', '', 'g') LIKE '1%'
          THEN SUBSTRING(regexp_replace(COALESCE(q.customer_number, ''), '\D', '', 'g') FROM 2)
          ELSE regexp_replace(COALESCE(q.customer_number, ''), '\D', '', 'g')
        END,
        10
      ) = RIGHT(_phone_digits, 10)
      OR RIGHT(
        CASE
          WHEN LENGTH(regexp_replace(COALESCE(q.customer_number_2, ''), '\D', '', 'g')) = 11
            AND regexp_replace(COALESCE(q.customer_number_2, ''), '\D', '', 'g') LIKE '1%'
          THEN SUBSTRING(regexp_replace(COALESCE(q.customer_number_2, ''), '\D', '', 'g') FROM 2)
          ELSE regexp_replace(COALESCE(q.customer_number_2, ''), '\D', '', 'g')
        END,
        10
      ) = RIGHT(_phone_digits, 10)
    )
  ORDER BY q.assigned_at DESC
  LIMIT 5;
$$;

GRANT EXECUTE ON FUNCTION public.check_qualified_lead_phone_duplicates(text, timestamp with time zone) TO authenticated;
