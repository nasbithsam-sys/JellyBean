REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_user_has_role(public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_has_role(public.app_role) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.email_for_username(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_for_username(TEXT) TO anon, authenticated;
