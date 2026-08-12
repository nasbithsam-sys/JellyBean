CREATE TABLE public.raw_lead_cache_counts (
  category_key text NOT NULL,
  assigned_to uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  total bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (category_key, assigned_to)
);

GRANT SELECT ON public.raw_lead_cache_counts TO authenticated;
GRANT ALL ON public.raw_lead_cache_counts TO service_role;

ALTER TABLE public.raw_lead_cache_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "raw lead users can read counters"
ON public.raw_lead_cache_counts
FOR SELECT TO authenticated
USING (
  (SELECT public.current_user_has_role_text('admin'))
  OR (SELECT public.current_user_has_role_text('sub_admin'))
  OR (SELECT public.current_user_has_role_text('scraping'))
  OR (SELECT public.current_user_has_role_text('maturing'))
  OR (SELECT public.current_user_has_role_text('acc_handler'))
);

CREATE OR REPLACE FUNCTION public.raw_lead_count_key(_category text, _assigned_myself_at timestamptz)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _category IS NULL AND _assigned_myself_at IS NULL THEN 'new'
    WHEN _category IS NULL AND _assigned_myself_at IS NOT NULL THEN 'assigned_myself'
    WHEN _category IN ('forwarded', 'not_found', 'wrong', 'duplicate') THEN _category
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public.adjust_raw_lead_cache_count(
  _category_key text,
  _assigned_to uuid,
  _delta integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _category_key IS NULL OR _delta = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.raw_lead_cache_counts (category_key, assigned_to, total)
  VALUES (_category_key, COALESCE(_assigned_to, '00000000-0000-0000-0000-000000000000'::uuid), _delta)
  ON CONFLICT (category_key, assigned_to) DO UPDATE
    SET total = GREATEST(0, public.raw_lead_cache_counts.total + EXCLUDED.total);

  DELETE FROM public.raw_lead_cache_counts
  WHERE category_key = _category_key
    AND assigned_to = COALESCE(_assigned_to, '00000000-0000-0000-0000-000000000000'::uuid)
    AND total <= 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_raw_lead_cache_counts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _old_key text;
  _new_key text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    _old_key := public.raw_lead_count_key(OLD.category, OLD.assigned_myself_at);
    PERFORM public.adjust_raw_lead_cache_count(
      _old_key,
      CASE WHEN _old_key = 'assigned_myself' THEN OLD.assigned_to ELSE NULL END,
      -1
    );
  END IF;

  IF TG_OP <> 'DELETE' THEN
    _new_key := public.raw_lead_count_key(NEW.category, NEW.assigned_myself_at);
    PERFORM public.adjust_raw_lead_cache_count(
      _new_key,
      CASE WHEN _new_key = 'assigned_myself' THEN NEW.assigned_to ELSE NULL END,
      1
    );
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER raw_lead_cache_maintain_counts
AFTER INSERT OR DELETE OR UPDATE OF category, assigned_myself_at, assigned_to
ON public.raw_lead_cache
FOR EACH ROW
EXECUTE FUNCTION public.tg_raw_lead_cache_counts();

INSERT INTO public.raw_lead_cache_counts (category_key, assigned_to, total)
SELECT
  public.raw_lead_count_key(category, assigned_myself_at),
  CASE
    WHEN public.raw_lead_count_key(category, assigned_myself_at) = 'assigned_myself'
      THEN assigned_to
    ELSE '00000000-0000-0000-0000-000000000000'::uuid
  END,
  count(*)::bigint
FROM public.raw_lead_cache
WHERE public.raw_lead_count_key(category, assigned_myself_at) IS NOT NULL
GROUP BY 1, 2;

CREATE OR REPLACE FUNCTION public.raw_lead_cache_category_counts_json(
  _user_id uuid DEFAULT NULL,
  _is_admin boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH counters AS (
    SELECT
      category_key,
      sum(total) FILTER (
        WHERE category_key <> 'assigned_myself'
           OR assigned_to = COALESCE(_user_id, auth.uid())
      )::bigint AS total
    FROM public.raw_lead_cache_counts
    GROUP BY category_key
  )
  SELECT jsonb_build_object(
    'new', COALESCE((SELECT total FROM counters WHERE category_key = 'new'), 0),
    'forwarded', COALESCE((SELECT total FROM counters WHERE category_key = 'forwarded'), 0),
    'not_found', COALESCE((SELECT total FROM counters WHERE category_key = 'not_found'), 0),
    'wrong', COALESCE((SELECT total FROM counters WHERE category_key = 'wrong'), 0),
    'duplicate', COALESCE((SELECT total FROM counters WHERE category_key = 'duplicate'), 0),
    'assigned_myself', COALESCE((SELECT total FROM counters WHERE category_key = 'assigned_myself'), 0)
  )
$$;

DROP POLICY IF EXISTS "raw_lead_cache: read" ON public.raw_lead_cache;
CREATE POLICY "raw_lead_cache: read"
ON public.raw_lead_cache
FOR SELECT TO authenticated
USING (
  (SELECT public.current_user_has_role_text('admin'))
  OR (SELECT public.current_user_has_role_text('scraping'))
  OR (SELECT public.current_user_has_role_text('sub_admin'))
  OR (
    (
      (SELECT public.current_user_has_role_text('maturing'))
      OR (SELECT public.current_user_has_role_text('acc_handler'))
    )
    AND (assigned_to IS NULL OR assigned_to = (SELECT auth.uid()))
  )
);

DROP POLICY IF EXISTS "raw_lead_cache: update" ON public.raw_lead_cache;
CREATE POLICY "raw_lead_cache: update"
ON public.raw_lead_cache
FOR UPDATE TO authenticated
USING (
  (SELECT public.current_user_has_role_text('admin'))
  OR (SELECT public.current_user_has_role_text('scraping'))
  OR (SELECT public.current_user_has_role_text('sub_admin'))
  OR (
    (
      (SELECT public.current_user_has_role_text('maturing'))
      OR (SELECT public.current_user_has_role_text('acc_handler'))
    )
    AND (assigned_to IS NULL OR assigned_to = (SELECT auth.uid()))
  )
)
WITH CHECK (
  (SELECT public.current_user_has_role_text('admin'))
  OR (SELECT public.current_user_has_role_text('scraping'))
  OR (SELECT public.current_user_has_role_text('sub_admin'))
  OR (
    (
      (SELECT public.current_user_has_role_text('maturing'))
      OR (SELECT public.current_user_has_role_text('acc_handler'))
    )
    AND (assigned_to IS NULL OR assigned_to = (SELECT auth.uid()))
  )
);