-- Migration: Add default for unread_count and partial index for Crisp unread conversation tracking
ALTER TABLE public.crisp_conversations ALTER COLUMN unread_count SET DEFAULT 0;

-- Update null unread_count values to 0
UPDATE public.crisp_conversations SET unread_count = 0 WHERE unread_count IS NULL;

-- Create partial index for fast Crisp unread conversation queries & aggregation
CREATE INDEX IF NOT EXISTS idx_crisp_conversations_unread_website ON public.crisp_conversations(crisp_website_id, unread_count) WHERE unread_count > 0;
CREATE INDEX IF NOT EXISTS idx_crisp_conversations_unread_active ON public.crisp_conversations(unread_count) WHERE unread_count > 0;
