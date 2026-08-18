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

    const { data: roleRows, error: roleErr } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (roleErr) throw new Error("Could not verify user roles");
    const roles = (roleRows ?? []).map((r) => String(r.role));
    if (!roles.includes("admin")) {
      throw new Error("Forbidden: Workspace management is restricted to JellyBean admin users only.");
    }

    const { data: resData, error: fnErr } = await supabase.functions.invoke("crisp-workspace-admin", {
      body: {
        action: "add_workspace",
        website_id: data.websiteId,
        token_id: data.tokenId,
        token_key: data.tokenKey,
      },
    });

    if (fnErr) {
      return { ok: false as const, error: fnErr.message || "Failed to invoke workspace admin function" };
    }

    if (resData?.error) {
      return { ok: false as const, error: resData.error };
    }

    return {
      ok: true as const,
      workspace_name: resData?.workspace_name,
      webhook_url: resData?.webhook_url,
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

    const { data: roleRows, error: roleErr } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (roleErr) throw new Error("Could not verify user roles");
    const roles = (roleRows ?? []).map((r) => String(r.role));
    if (!roles.includes("admin")) {
      throw new Error("Forbidden: Workspace management is restricted to JellyBean admin users only.");
    }

    const { data: resData, error: fnErr } = await supabase.functions.invoke("crisp-workspace-admin", {
      body: {
        action: "toggle_workspace_enabled",
        website_id: data.websiteId,
        enabled: data.enabled,
      },
    });

    if (fnErr) {
      return { ok: false as const, error: fnErr.message };
    }

    if (resData?.error) {
      return { ok: false as const, error: resData.error };
    }

    return { ok: true as const, enabled: resData?.enabled };
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

    const { data: roleRows, error: roleErr } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (roleErr) throw new Error("Could not verify user roles");
    const roles = (roleRows ?? []).map((r) => String(r.role));
    if (!roles.includes("admin")) {
      throw new Error("Forbidden: Workspace management is restricted to JellyBean admin users only.");
    }

    const { data: resData, error: fnErr } = await supabase.functions.invoke("crisp-workspace-admin", {
      body: {
        action: "regenerate_webhook_secret",
        website_id: data.websiteId,
      },
    });

    if (fnErr) {
      return { ok: false as const, error: fnErr.message };
    }

    if (resData?.error) {
      return { ok: false as const, error: resData.error };
    }

    return { ok: true as const, webhook_url: resData?.webhook_url };
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
