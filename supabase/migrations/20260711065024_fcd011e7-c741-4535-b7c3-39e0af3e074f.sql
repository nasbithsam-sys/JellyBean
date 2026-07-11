CREATE TABLE public.lead_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK (source_type IN ('raw_lead','manual_lead')),
  source_lead_id uuid,
  form_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_drafts TO authenticated;
GRANT ALL ON public.lead_drafts TO service_role;

ALTER TABLE public.lead_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own drafts"
  ON public.lead_drafts FOR SELECT
  TO authenticated
  USING (auth.uid() = created_by);

CREATE POLICY "Users can insert own drafts"
  ON public.lead_drafts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update own drafts"
  ON public.lead_drafts FOR UPDATE
  TO authenticated
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can delete own drafts"
  ON public.lead_drafts FOR DELETE
  TO authenticated
  USING (auth.uid() = created_by);

CREATE UNIQUE INDEX lead_drafts_unique_source
  ON public.lead_drafts (created_by, source_type, source_lead_id)
  WHERE source_lead_id IS NOT NULL;

CREATE INDEX lead_drafts_owner_updated_idx
  ON public.lead_drafts (created_by, updated_at DESC);

CREATE INDEX lead_drafts_source_idx
  ON public.lead_drafts (source_type, source_lead_id);

CREATE TRIGGER trg_lead_drafts_updated_at
  BEFORE UPDATE ON public.lead_drafts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();