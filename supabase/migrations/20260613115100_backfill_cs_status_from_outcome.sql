UPDATE public.qualified_leads
SET cs_status = CASE cs_outcome
  WHEN 'wrong_lead' THEN 'wrong_lead'::public.cs_status
  WHEN 'wrong_number' THEN 'wrong_number'::public.cs_status
  WHEN 'processed' THEN 'converted'::public.cs_status
  WHEN 'already_done' THEN 'already_got_someone'::public.cs_status
  ELSE cs_status
END
WHERE cs_outcome IS NOT NULL;
