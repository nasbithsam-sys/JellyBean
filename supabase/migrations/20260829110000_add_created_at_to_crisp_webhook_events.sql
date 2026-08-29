-- Migration: Add created_at column to crisp_webhook_events
-- Resolves PostgreSQL error 42703 (column crisp_webhook_events.created_at does not exist)

ALTER TABLE public.crisp_webhook_events 
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Backfill existing records to match received_at
UPDATE public.crisp_webhook_events 
SET created_at = received_at 
WHERE created_at IS NULL;

-- Add index for performance and sorting
CREATE INDEX IF NOT EXISTS idx_crisp_webhook_events_created_at 
ON public.crisp_webhook_events (created_at DESC);
