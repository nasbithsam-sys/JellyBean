-- Migration: Crisp Workspace Management Helpers (delete Vault secret)
-- Restricted to service_role ONLY

CREATE OR REPLACE FUNCTION public.crisp_delete_workspace_secret(
    p_secret_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    DELETE FROM vault.secrets WHERE id = p_secret_id;
    RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
    RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.crisp_delete_workspace_secret(UUID)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.crisp_delete_workspace_secret(UUID)
TO service_role;
