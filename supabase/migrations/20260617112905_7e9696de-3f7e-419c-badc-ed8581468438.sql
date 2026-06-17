CREATE OR REPLACE FUNCTION public.check_qualified_lead_phone_duplicates(_phone_digits text, _since timestamptz)
RETURNS TABLE(id uuid, customer_name text, customer_number text, customer_number_2 text, assigned_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT q.id, q.customer_name, q.customer_number, q.customer_number_2, q.assigned_at
  FROM public.qualified_leads q
  WHERE q.assigned_at >= _since
    AND _phone_digits <> ''
    AND (
      regexp_replace(COALESCE(q.customer_number, ''), '\D', '', 'g') LIKE '%' || _phone_digits || '%'
      OR regexp_replace(COALESCE(q.customer_number_2, ''), '\D', '', 'g') LIKE '%' || _phone_digits || '%'
    )
  ORDER BY q.assigned_at DESC
  LIMIT 20
$$;

GRANT EXECUTE ON FUNCTION public.check_qualified_lead_phone_duplicates(text, timestamptz) TO authenticated, service_role;