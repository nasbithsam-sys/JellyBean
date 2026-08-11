CREATE OR REPLACE FUNCTION public.raw_lead_cache_category_counts_json(_user_id uuid DEFAULT NULL::uuid, _is_admin boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'new', count(*) filter (where r.category is null and r.assigned_myself_at is null),
    'forwarded', count(*) filter (where r.category = 'forwarded'),
    'not_found', count(*) filter (where r.category = 'not_found'),
    'wrong', count(*) filter (where r.category = 'wrong'),
    'duplicate', count(*) filter (where r.category = 'duplicate'),
    'assigned_myself', count(*) filter (
      where r.category is null
        and r.assigned_myself_at is not null
        and r.assigned_to = auth.uid()
    )
  )
  from public.raw_lead_cache r;
$function$;