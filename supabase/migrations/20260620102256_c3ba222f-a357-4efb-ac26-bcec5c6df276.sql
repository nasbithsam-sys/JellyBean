
ALTER TABLE public.qualified_leads
  ADD COLUMN IF NOT EXISTS extra_numbers text[] NOT NULL DEFAULT '{}'::text[];

CREATE OR REPLACE FUNCTION public.check_qualified_lead_phone_duplicates(_phone_digits text, _since timestamp with time zone)
 RETURNS TABLE(id uuid, customer_name text, customer_number text, customer_number_2 text, assigned_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  LIMIT 20
$function$;
