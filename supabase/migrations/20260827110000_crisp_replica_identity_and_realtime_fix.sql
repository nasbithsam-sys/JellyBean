-- Migration: Enable REPLICA IDENTITY FULL on Crisp tables for instant Supabase Realtime broadcast
-- Ensures full row data is included on UPDATE events so Realtime RLS policies and frontend listeners receive all updates immediately.

ALTER TABLE public.crisp_conversations REPLICA IDENTITY FULL;
ALTER TABLE public.crisp_messages REPLICA IDENTITY FULL;
ALTER TABLE public.crisp_webhook_events REPLICA IDENTITY FULL;
