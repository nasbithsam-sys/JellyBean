-- Migration: Add 'already_received_before' to cs_status enum

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'cs_status'
      AND e.enumlabel = 'already_received_before'
  ) THEN
    ALTER TYPE public.cs_status ADD VALUE 'already_received_before';
  END IF;
END $$;
