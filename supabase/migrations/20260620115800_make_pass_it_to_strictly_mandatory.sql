ALTER TABLE public.qualified_leads
  ADD CONSTRAINT check_pass_it_to_not_empty
  CHECK (
    (submitted_by_role IN ('facebook', 'seo'))
    OR (pass_it_to IS NOT NULL AND TRIM(pass_it_to) <> '')
  );
