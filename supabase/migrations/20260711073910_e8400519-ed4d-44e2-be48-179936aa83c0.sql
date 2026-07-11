DROP INDEX IF EXISTS public.lead_drafts_unique_source;
CREATE UNIQUE INDEX lead_drafts_unique_source
  ON public.lead_drafts (created_by, source_type, source_lead_id);