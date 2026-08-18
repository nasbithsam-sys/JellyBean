GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.crisp_conversations TO authenticated;
GRANT ALL ON TABLE public.crisp_conversations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.crisp_messages TO authenticated;
GRANT ALL ON TABLE public.crisp_messages TO service_role;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;

DROP POLICY IF EXISTS "Crisp conversations access for cs roles" ON public.crisp_conversations;
CREATE POLICY "Crisp conversations access for cs roles"
ON public.crisp_conversations
FOR ALL
TO authenticated
USING (
  (SELECT public.current_user_has_role_text('admin'))
  OR (SELECT public.current_user_has_role_text('cs_admin'))
  OR (SELECT public.current_user_has_role_text('cs'))
)
WITH CHECK (
  (SELECT public.current_user_has_role_text('admin'))
  OR (SELECT public.current_user_has_role_text('cs_admin'))
  OR (SELECT public.current_user_has_role_text('cs'))
);

DROP POLICY IF EXISTS "Crisp messages access for cs roles" ON public.crisp_messages;
CREATE POLICY "Crisp messages access for cs roles"
ON public.crisp_messages
FOR ALL
TO authenticated
USING (
  (SELECT public.current_user_has_role_text('admin'))
  OR (SELECT public.current_user_has_role_text('cs_admin'))
  OR (SELECT public.current_user_has_role_text('cs'))
)
WITH CHECK (
  (SELECT public.current_user_has_role_text('admin'))
  OR (SELECT public.current_user_has_role_text('cs_admin'))
  OR (SELECT public.current_user_has_role_text('cs'))
);