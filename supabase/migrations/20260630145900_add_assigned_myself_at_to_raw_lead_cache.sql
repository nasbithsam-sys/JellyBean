-- Add self-assignment timestamp marker to raw_lead_cache.
-- Old rows stay NULL so they are excluded from the new "Assigned Myself" tab.
ALTER TABLE public.raw_lead_cache
  ADD COLUMN IF NOT EXISTS assigned_myself_at timestamp with time zone;
