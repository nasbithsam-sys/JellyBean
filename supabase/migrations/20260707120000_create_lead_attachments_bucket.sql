-- Create the lead-attachments storage bucket if it does not exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('lead-attachments', 'lead-attachments', true)
ON CONFLICT (id) DO NOTHING;
