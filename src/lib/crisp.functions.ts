import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const syncCrispHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { websiteId?: string }) => {
    const websiteId = input?.websiteId ? String(input.websiteId).trim() : undefined;
    return { websiteId };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: roleRows, error: roleErr } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (roleErr) throw new Error("Could not verify user roles");
    const roles = (roleRows ?? []).map((r) => String(r.role));
    if (!roles.some((r) => ["admin", "cs_admin", "cs"].includes(r))) {
      throw new Error("Forbidden: Crisp Chat is restricted to admin, cs_admin and cs roles.");
    }

    const { data: resData, error: fnErr } = await supabase.functions.invoke("crisp-sync-history", {
      body: { websiteId: data.websiteId },
    });

    if (fnErr) {
      return { ok: false as const, error: fnErr.message || "Failed to invoke sync history function" };
    }

    if (resData?.error) {
      return { ok: false as const, error: resData.error };
    }

    return {
      ok: true as const,
      synced_conversations: resData?.synced_conversations ?? 0,
      synced_messages: resData?.synced_messages ?? 0,
    };
  });

export const sendCrispMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { conversationId: string; content: string }) => {
    const conversationId = String(input?.conversationId ?? "").trim();
    const content = String(input?.content ?? "").trim();
    if (!conversationId || !content) throw new Error("conversationId and non-empty content are required");
    return { conversationId, content };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: roleRows, error: roleErr } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (roleErr) throw new Error("Could not verify user roles");
    const roles = (roleRows ?? []).map((r) => String(r.role));
    if (!roles.some((r) => ["admin", "cs_admin", "cs"].includes(r))) {
      throw new Error("Forbidden: Crisp Chat is restricted to admin, cs_admin and cs roles.");
    }

    const { data: resData, error: fnErr } = await supabase.functions.invoke("crisp-send-message", {
      body: { conversationId: data.conversationId, content: data.content },
    });

    if (fnErr) {
      return { ok: false as const, error: fnErr.message || "Failed to invoke send message function" };
    }

    if (resData?.error) {
      return { ok: false as const, error: resData.error };
    }

    return {
      ok: true as const,
      crisp_message_id: resData?.crisp_message_id,
      sent_at: resData?.sent_at,
    };
  });

async function assertAdmin(supabase: any, userId: string) {
  const { data: roleRows, error: roleErr } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (roleErr) throw new Error("Could not verify user roles");
  const roles = (roleRows ?? []).map((r: { role: string }) => String(r.role));
  if (!roles.includes("admin")) {
    throw new Error("Forbidden: Workspace management is restricted to JellyBean admin users only.");
  }
}

function newWebhookSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function webhookUrlFor(secret: string) {
  const url = process.env["SUPABASE_URL"]?.trim();
  if (!url) throw new Error("SUPABASE_URL is not configured");
  const ref = url.replace("https://", "").split(".")[0];
  return `https://${ref}.supabase.co/functions/v1/crisp-webhook?key=${secret}`;
}

/** Validate a Crisp Website Token against the website it belongs to. */
async function verifyCrispCredentials(websiteId: string, tokenId: string, tokenKey: string) {
  const auth = btoa(`${tokenId}:${tokenKey}`);

  const res = await fetch(`https://api.crisp.chat/v1/website/${websiteId}`, {
    method: "GET",
    headers: {
      Authorization: `Basic ${auth}`,
      "X-Crisp-Tier": "website",
      "Content-Type": "application/json",
    },
  });

  const json: any = await res.json().catch(() => ({}));

  if (!res.ok) {
    const reason = json?.reason || json?.data?.message || json?.message || `HTTP ${res.status}`;
    const details = json?.data?.message && json?.data?.message !== reason ? ` — ${json.data.message}` : "";

    return {
      ok: false as const,
      error:
        res.status === 401 || reason === "invalid_session"
          ? `Crisp rejected this Website Token (${reason}${details}). Verify the Website ID, Token Identifier and Token Key all belong to the same workspace and that the token is still valid.`
          : `Crisp API error (${res.status}): ${reason}${details}`,
    };
  }

  return { ok: true as const, info: json?.data ?? {} };
}

export const addCrispWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { websiteId: string; tokenId: string; tokenKey: string }) => {
    const websiteId = String(input?.websiteId ?? "").trim();
    const tokenId = String(input?.tokenId ?? "").trim();
    const tokenKey = String(input?.tokenKey ?? "").trim();
    if (!websiteId || !tokenId || !tokenKey) throw new Error("Website ID, API Identifier, and API Key are required");
    return { websiteId, tokenId, tokenKey };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    // const verified = await verifyCrispCredentials(data.websiteId, data.tokenId, data.tokenKey);
    // if (!verified.ok) return { ok: false as const, error: verified.error };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existingWs, error: existingWsErr } = await supabaseAdmin
      .from("crisp_workspaces")
      .select("id, credential_secret_id")
      .eq("crisp_website_id", data.websiteId)
      .maybeSingle();

    if (existingWsErr) {
      return { ok: false as const, error: `Failed to read workspace record: ${existingWsErr.message}` };
    }

    let secretId = existingWs?.credential_secret_id ?? null;
    let webhookSecret = newWebhookSecret();

    if (secretId) {
      const { data: current, error: currentErr } = await supabaseAdmin.rpc("crisp_get_workspace_secret", {
        p_secret_id: secretId,
      });

      if (currentErr || !current) {
        return {
          ok: false as const,
          error: `Failed to read stored Vault credentials: ${currentErr?.message ?? "secret not found"}`,
        };
      }

      webhookSecret = (current as any)?.webhook_secret || webhookSecret;

      const { data: updated, error: updErr } = await supabaseAdmin.rpc("crisp_update_workspace_secret", {
        p_secret_id: secretId,
        p_token_id: data.tokenId,
        p_token_key: data.tokenKey,
        p_webhook_secret: webhookSecret,
      });

      if (updErr || updated !== true) {
        return {
          ok: false as const,
          error: `Failed to update stored credentials: ${updErr?.message ?? "Vault update returned false"}`,
        };
      }
    } else {
      const { data: newSecretId, error: vaultErr } = await supabaseAdmin.rpc("crisp_create_workspace_secret", {
        p_website_id: data.websiteId,
        p_token_id: data.tokenId,
        p_token_key: data.tokenKey,
        p_webhook_secret: webhookSecret,
      });
      if (vaultErr || !newSecretId) {
        return { ok: false as const, error: `Failed to store credentials: ${vaultErr?.message ?? "unknown error"}` };
      }
      secretId = newSecretId as unknown as string;
    }

    const info: any = verified.info ?? {};
    const workspaceName = info.name ?? null;

    const { error: wsErr } = await supabaseAdmin.from("crisp_workspaces").upsert(
      {
        ...(existingWs?.id ? { id: existingWs.id } : {}),
        crisp_website_id: data.websiteId,
        workspace_name: workspaceName,
        enabled: true,
        credential_secret_id: secretId,
        installed_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: { domain: info.domain ?? null, logo: info.logo ?? null, tier: "website" },
      },
      { onConflict: "crisp_website_id" },
    );

    if (wsErr) return { ok: false as const, error: `Failed to save workspace: ${wsErr.message}` };

    return {
      ok: true as const,
      workspace_name: workspaceName ?? `Workspace • ${data.websiteId.slice(0, 5)}`,
      webhook_url: webhookUrlFor(webhookSecret),
    };
  });

export const toggleCrispWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { websiteId: string; enabled: boolean }) => {
    const websiteId = String(input?.websiteId ?? "").trim();
    if (!websiteId) throw new Error("websiteId is required");
    return { websiteId, enabled: Boolean(input.enabled) };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("crisp_workspaces")
      .update({ enabled: data.enabled, updated_at: new Date().toISOString() })
      .eq("crisp_website_id", data.websiteId);

    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, enabled: data.enabled };
  });

export const regenerateCrispWebhookSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { websiteId: string }) => {
    const websiteId = String(input?.websiteId ?? "").trim();
    if (!websiteId) throw new Error("websiteId is required");
    return { websiteId };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ws, error: fetchErr } = await supabaseAdmin
      .from("crisp_workspaces")
      .select("credential_secret_id")
      .eq("crisp_website_id", data.websiteId)
      .maybeSingle();

    if (fetchErr || !ws?.credential_secret_id) {
      return { ok: false as const, error: "Workspace credentials not found. Re-connect the workspace first." };
    }

    const { data: current, error: currentErr } = await supabaseAdmin.rpc("crisp_get_workspace_secret", {
      p_secret_id: ws.credential_secret_id,
    });

    const currentTokenId = (current as any)?.token_id ?? "";
    const currentTokenKey = (current as any)?.token_key ?? "";

    if (currentErr || !currentTokenId || !currentTokenKey) {
      return {
        ok: false as const,
        error: `Stored workspace credentials are missing: ${currentErr?.message ?? "re-connect the workspace"}`,
      };
    }

    const secret = newWebhookSecret();
    const { data: updated, error: updErr } = await supabaseAdmin.rpc("crisp_update_workspace_secret", {
      p_secret_id: ws.credential_secret_id,
      p_token_id: currentTokenId,
      p_token_key: currentTokenKey,
      p_webhook_secret: secret,
    });

    if (updErr || updated !== true) {
      return { ok: false as const, error: updErr?.message ?? "Vault update returned false" };
    }

    return { ok: true as const, webhook_url: webhookUrlFor(secret) };
  });


export const addCrispConversationNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { conversationId: string; note: string }) => {
    const conversationId = String(input?.conversationId ?? "").trim();
    const note = String(input?.note ?? "").trim();
    if (!conversationId || !note) throw new Error("conversationId and non-empty note are required");
    return { conversationId, note };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: roleRows, error: roleErr } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (roleErr) throw new Error("Could not verify user roles");
    const roles = (roleRows ?? []).map((r) => String(r.role));
    if (!roles.some((r) => ["admin", "cs_admin", "cs"].includes(r))) {
      throw new Error("Forbidden: Crisp notes are restricted to admin, cs_admin and cs roles.");
    }

    const { data: created, error } = await supabase
      .from("crisp_conversation_notes")
      .insert({
        conversation_id: data.conversationId,
        created_by: userId,
        note: data.note,
      })
      .select()
      .single();

    if (error) {
      return { ok: false as const, error: error.message };
    }

    return { ok: true as const, note: created };
  });

export const deleteCrispConversationNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { noteId: string }) => {
    const noteId = String(input?.noteId ?? "").trim();
    if (!noteId) throw new Error("noteId is required");
    return { noteId };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: roleRows, error: roleErr } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (roleErr) throw new Error("Could not verify user roles");
    const roles = (roleRows ?? []).map((r) => String(r.role));
    if (!roles.some((r) => ["admin", "cs_admin", "cs"].includes(r))) {
      throw new Error("Forbidden: Crisp notes are restricted to admin, cs_admin and cs roles.");
    }

    const { error } = await supabase
      .from("crisp_conversation_notes")
      .delete()
      .eq("id", data.noteId);

    if (error) {
      return { ok: false as const, error: error.message };
    }

    return { ok: true as const };
  });
