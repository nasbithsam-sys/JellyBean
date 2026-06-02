ALTER TABLE public.raw_leads REPLICA IDENTITY FULL;
ALTER TABLE public.qualified_leads REPLICA IDENTITY FULL;
ALTER TABLE public.incogniton_profiles REPLICA IDENTITY FULL;
ALTER TABLE public.raw_lead_cache REPLICA IDENTITY FULL;
ALTER TABLE public.shared_state REPLICA IDENTITY FULL;
ALTER TABLE public.accounts REPLICA IDENTITY FULL;
ALTER TABLE public.activity_logs REPLICA IDENTITY FULL;
ALTER TABLE public.profiles REPLICA IDENTITY FULL;
ALTER TABLE public.app_settings REPLICA IDENTITY FULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['raw_leads','qualified_leads','incogniton_profiles','raw_lead_cache','shared_state','accounts','activity_logs','profiles','app_settings']
  LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;