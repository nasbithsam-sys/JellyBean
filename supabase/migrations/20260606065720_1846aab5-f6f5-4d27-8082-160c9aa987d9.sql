
-- Add post_text column to qualified_leads to store the original auto-filled
-- post text separately from the manually-written CS context.
ALTER TABLE public.qualified_leads
  ADD COLUMN IF NOT EXISTS post_text text;

-- Ensure realtime fires INSERT/UPDATE/DELETE payloads for qualified_leads
-- so the CS pipeline can show a live pop-up + sound the moment a lead is
-- forwarded. Idempotent: skip if the table is already in the publication.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'qualified_leads'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.qualified_leads';
  END IF;
END $$;

ALTER TABLE public.qualified_leads REPLICA IDENTITY FULL;
