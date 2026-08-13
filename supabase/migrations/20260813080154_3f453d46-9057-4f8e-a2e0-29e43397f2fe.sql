WITH live AS (
  SELECT public.raw_lead_count_key(category, assigned_myself_at) AS category_key,
         CASE WHEN public.raw_lead_count_key(category, assigned_myself_at) = 'assigned_myself'
              THEN assigned_to ELSE '00000000-0000-0000-0000-000000000000'::uuid END AS assigned_to,
         count(*)::bigint AS total
  FROM public.raw_lead_cache
  WHERE public.raw_lead_count_key(category, assigned_myself_at) IS NOT NULL
  GROUP BY 1, 2
), differences AS (
  SELECT COALESCE(l.category_key, c.category_key) AS category_key,
         COALESCE(l.assigned_to, c.assigned_to) AS assigned_to,
         COALESCE(l.total, 0) AS live_total,
         COALESCE(c.total, 0) AS counter_total
  FROM live l
  FULL JOIN public.raw_lead_cache_counts c USING (category_key, assigned_to)
  WHERE COALESCE(l.total, 0) <> COALESCE(c.total, 0)
)
SELECT count(*) AS mismatched_counter_rows FROM differences;