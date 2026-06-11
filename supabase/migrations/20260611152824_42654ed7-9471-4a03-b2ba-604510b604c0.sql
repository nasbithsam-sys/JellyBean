CREATE POLICY "raw_lead_cache: scraping read"
  ON public.raw_lead_cache
  FOR SELECT
  TO authenticated
  USING (public.current_user_has_role('scraping'::app_role));

CREATE POLICY "raw_lead_cache: scraping write"
  ON public.raw_lead_cache
  FOR UPDATE
  TO authenticated
  USING (public.current_user_has_role('scraping'::app_role))
  WITH CHECK (public.current_user_has_role('scraping'::app_role));