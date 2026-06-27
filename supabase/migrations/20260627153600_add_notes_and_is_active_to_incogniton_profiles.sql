-- Add notes and is_active columns to incogniton_profiles

ALTER TABLE public.incogniton_profiles 
ADD COLUMN IF NOT EXISTS notes text DEFAULT '',
ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
