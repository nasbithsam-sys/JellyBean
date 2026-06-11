
ALTER TABLE public.raw_leads DROP CONSTRAINT raw_leads_reviewed_by_fkey,
  ADD CONSTRAINT raw_leads_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.qualified_leads DROP CONSTRAINT qualified_leads_assigned_by_fkey,
  ADD CONSTRAINT qualified_leads_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.qualified_leads DROP CONSTRAINT qualified_leads_assigned_to_fkey,
  ADD CONSTRAINT qualified_leads_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.accounts DROP CONSTRAINT accounts_created_by_fkey,
  ADD CONSTRAINT accounts_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.activity_logs DROP CONSTRAINT activity_logs_actor_id_fkey,
  ADD CONSTRAINT activity_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;
