-- Ensure the lead-attachments storage bucket is public so image URLs are accessible
UPDATE storage.buckets
SET public = true
WHERE id = 'lead-attachments';
