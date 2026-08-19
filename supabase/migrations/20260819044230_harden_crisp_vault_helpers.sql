-- Keep Crisp workspace credentials Vault-only and fail loudly on Vault errors.
-- This migration matches the hardening already applied to the live Supabase project.

CREATE OR REPLACE FUNCTION public.crisp_create_workspace_secret(
    p_website_id TEXT,
    p_token_id TEXT,
    p_token_key TEXT,
    p_webhook_secret TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_secret_json TEXT;
    v_secret_id UUID;
BEGIN
    v_secret_json := pg_catalog.json_build_object(
        'token_id', p_token_id,
        'token_key', p_token_key,
        'webhook_secret', p_webhook_secret
    )::TEXT;

    v_secret_id := vault.create_secret(
        v_secret_json,
        'crisp_ws_' || p_website_id,
        'Crisp credentials for ' || p_website_id
    );

    RETURN v_secret_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.crisp_update_workspace_secret(
    p_secret_id UUID,
    p_token_id TEXT,
    p_token_key TEXT,
    p_webhook_secret TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_secret_json TEXT;
BEGIN
    v_secret_json := pg_catalog.json_build_object(
        'token_id', p_token_id,
        'token_key', p_token_key,
        'webhook_secret', p_webhook_secret
    )::TEXT;

    PERFORM vault.update_secret(
        p_secret_id,
        v_secret_json,
        NULL,
        NULL
    );

    RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.crisp_get_workspace_secret(
    p_secret_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_secret TEXT;
BEGIN
    SELECT decrypted_secret
    INTO v_secret
    FROM vault.decrypted_secrets
    WHERE id = p_secret_id;

    IF v_secret IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN v_secret::JSONB;
END;
$$;

REVOKE ALL ON FUNCTION public.crisp_create_workspace_secret(TEXT, TEXT, TEXT, TEXT)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crisp_update_workspace_secret(UUID, TEXT, TEXT, TEXT)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crisp_get_workspace_secret(UUID)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.crisp_create_workspace_secret(TEXT, TEXT, TEXT, TEXT)
TO service_role;
GRANT EXECUTE ON FUNCTION public.crisp_update_workspace_secret(UUID, TEXT, TEXT, TEXT)
TO service_role;
GRANT EXECUTE ON FUNCTION public.crisp_get_workspace_secret(UUID)
TO service_role;
