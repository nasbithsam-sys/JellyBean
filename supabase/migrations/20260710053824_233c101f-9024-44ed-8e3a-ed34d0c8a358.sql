UPDATE public.qualified_leads q
SET images = sub.new_images
FROM (
  SELECT
    id,
    (
      SELECT jsonb_agg(
        CASE
          WHEN elem LIKE '%/storage/v1/object/public/lead-attachments/%'
            THEN substring(elem FROM '/storage/v1/object/public/lead-attachments/(.+)$')
          WHEN elem LIKE '%/storage/v1/object/sign/lead-attachments/%'
            THEN substring(elem FROM '/storage/v1/object/sign/lead-attachments/([^?]+)')
          ELSE elem
        END
      )
      FROM jsonb_array_elements_text(images) AS elem
    ) AS new_images
  FROM public.qualified_leads
  WHERE jsonb_typeof(images) = 'array'
    AND jsonb_array_length(images) > 0
    AND images::text LIKE '%/storage/v1/object/%/lead-attachments/%'
) sub
WHERE q.id = sub.id AND sub.new_images IS NOT NULL;
