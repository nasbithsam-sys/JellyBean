ALTER TYPE public.cs_status ADD VALUE IF NOT EXISTS 'undeliver';
ALTER TYPE public.cs_status ADD VALUE IF NOT EXISTS 'wrong_number';
ALTER TYPE public.cs_status ADD VALUE IF NOT EXISTS 'already_got_someone';
ALTER TYPE public.cs_status ADD VALUE IF NOT EXISTS 'service_provider_himself';
ALTER TYPE public.cs_status ADD VALUE IF NOT EXISTS 'need_follow_up';