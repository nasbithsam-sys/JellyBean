
-- 1. Add cs_admin to enum (must commit before use — Supabase migration runner handles this)
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'cs_admin';
