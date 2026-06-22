ALTER TABLE public.qualified_leads
  ADD COLUMN IF NOT EXISTS pinned_important boolean NOT NULL DEFAULT false;

-- Backfill existing important leads that are still in "new" status as pinned_important
UPDATE public.qualified_leads
SET pinned_important = true
WHERE is_important = true AND cs_status = 'new';
