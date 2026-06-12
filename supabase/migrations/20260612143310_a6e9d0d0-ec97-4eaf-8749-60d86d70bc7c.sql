-- 1. Add facebook & seo roles
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'facebook';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'seo';

-- 2. New columns for direct-submission leads
ALTER TABLE public.qualified_leads
  ADD COLUMN IF NOT EXISTS service text,
  ADD COLUMN IF NOT EXISTS images jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS submitted_by_role text;

-- 3. Any authenticated user can INSERT a lead they own
DROP POLICY IF EXISTS "Authenticated users insert own leads" ON public.qualified_leads;
CREATE POLICY "Authenticated users insert own leads"
  ON public.qualified_leads
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

-- 4. Submitters can read their own submissions
DROP POLICY IF EXISTS "Submitters can read own leads" ON public.qualified_leads;
CREATE POLICY "Submitters can read own leads"
  ON public.qualified_leads
  FOR SELECT
  TO authenticated
  USING (created_by = auth.uid());

-- 5. Storage policies for the `lead-attachments` bucket (bucket created via Dashboard)
DROP POLICY IF EXISTS "Authenticated can upload lead attachments" ON storage.objects;
CREATE POLICY "Authenticated can upload lead attachments"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'lead-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Anyone can read lead attachments" ON storage.objects;
CREATE POLICY "Anyone can read lead attachments"
  ON storage.objects
  FOR SELECT
  TO authenticated, anon
  USING (bucket_id = 'lead-attachments');

DROP POLICY IF EXISTS "Owners or admins can delete lead attachments" ON storage.objects;
CREATE POLICY "Owners or admins can delete lead attachments"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'lead-attachments' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.current_user_has_role('admin'::app_role)));