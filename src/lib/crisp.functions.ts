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

    const {
      getCrispPluginCredentials,
      getLegacyCrispWebsiteCredentials,
      crispPluginHeaders,
      crispWebsiteHeaders,
      crispApiError,
      messageText,
    } = await import("./crisp.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const pluginCreds = getCrispPluginCredentials();
    const legacyCreds = getLegacyCrispWebsiteCredentials();

    if (!pluginCreds && !legacyCreds) {
      return { ok: false as const, error: "Crisp integration is not configured. Missing Crisp API credentials." };
    }

    let totalWorkspacesSynced = 0;
    let totalSyncedConversations = 0;
    let totalSyncedMessages = 0;
    const workspaceResults: Array<{ website_id: string; conversations: number; messages: number }> = [];

    if (pluginCreds) {
      // PLUGIN MODE: Sync ONLY registered, enabled crisp_workspaces
      let query = supabaseAdmin
        .from("crisp_workspaces")
        .select("crisp_website_id, workspace_name")
        .eq("enabled", true);

      if (data.websiteId) {
        query = query.eq("crisp_website_id", data.websiteId);
      }

      const { data: workspaces } = await query;
      const targetWorkspaces = workspaces || [];

      // If a specific websiteId was requested but not found or disabled
      if (data.websiteId && targetWorkspaces.length === 0) {
        return { ok: false as const, error: "Workspace is not registered or is disabled." };
      }

      // If zero registered plugin workspaces for "All Workspaces"
      if (targetWorkspaces.length === 0) {
        return {
          ok: true as const,
          workspaces_synced: 0,
          synced_conversations: 0,
          synced_messages: 0,
          workspace_results: [],
          message: "No registered Crisp Plugin workspaces found.",
        };
      }

      const headers = crispPluginHeaders(pluginCreds);

      for (const ws of targetWorkspaces) {
        const websiteId = ws.crisp_website_id;
        let wsConversations = 0;
        let wsMessages = 0;

        for (let page = 1; page <= 5; page++) {
          const listRes = await fetch(
            `https://api.crisp.chat/v1/website/${websiteId}/conversations/${page}`,
            { headers },
          );
          if (!listRes.ok) {
            if (page === 1 && targetWorkspaces.length === 1) {
              const err = (await listRes.json().catch(() => ({}))) as Record<string, unknown>;
              return { ok: false as const, error: crispApiError(listRes.status, err, "plugin") };
            }
            break;
          }

          const listData = (await listRes.json()) as { data?: Record<string, any>[] };
          const sessions = listData.data ?? [];
          if (sessions.length === 0) break;

          for (const session of sessions) {
            const sessionId = session["session_id"] as string | undefined;
            if (!sessionId) continue;
            const meta = (session["meta"] ?? {}) as Record<string, any>;

            // Preserve existing customer details
            const { data: existingConv } = await supabaseAdmin
              .from("crisp_conversations")
              .select("customer_name, customer_email, customer_phone, customer_avatar")
              .eq("crisp_website_id", websiteId)
              .eq("crisp_session_id", sessionId)
              .maybeSingle();

            const name = meta["nickname"] ?? session["nickname"] ?? existingConv?.customer_name ?? null;
            const email = meta["email"] ?? session["email"] ?? existingConv?.customer_email ?? null;
            const phone = meta["phone"] ?? session["phone"] ?? existingConv?.customer_phone ?? null;
            const avatar = meta["avatar"] ?? session["avatar"] ?? existingConv?.customer_avatar ?? null;

            const { data: conv, error: convErr } = await supabaseAdmin
              .from("crisp_conversations")
              .upsert(
                {
                  crisp_website_id: websiteId,
                  crisp_session_id: sessionId,
                  customer_name: name,
                  customer_email: email,
                  customer_phone: phone,
                  customer_avatar: avatar,
                  status: (session["state"] as string) ?? "unresolved",
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "crisp_website_id,crisp_session_id" },
              )
              .select("id")
              .single();

            if (convErr || !conv) continue;
            wsConversations++;

            const msgsRes = await fetch(
              `https://api.crisp.chat/v1/website/${websiteId}/conversation/${sessionId}/messages`,
              { headers },
            );
            if (!msgsRes.ok) continue;

            const msgsData = (await msgsRes.json()) as { data?: Record<string, any>[] };
            for (const msg of msgsData.data ?? []) {
              const isOperator = String(msg["from"]).toLowerCase() === "operator";
              const crispMsgId = String(msg["fingerprint"] ?? `${sessionId}_${msg["timestamp"]}`);

              const { error: msgErr } = await supabaseAdmin.from("crisp_messages").insert({
                conversation_id: conv.id,
                crisp_website_id: websiteId,
                crisp_session_id: sessionId,
                crisp_message_id: crispMsgId,
                sender_type: isOperator ? "operator" : "customer",
                direction: isOperator ? "outgoing" : "incoming",
                content: messageText(msg["content"]) || "[Attachment/Content]",
                message_type: (msg["type"] as string) ?? "text",
                sent_at: msg["timestamp"]
                  ? new Date(msg["timestamp"] as number).toISOString()
                  : new Date().toISOString(),
                raw_payload: msg,
              });
              if (!msgErr) wsMessages++;
            }
          }
        }

        await supabaseAdmin
          .from("crisp_workspaces")
          .update({ last_synced_at: new Date().toISOString() })
          .eq("crisp_website_id", websiteId);

        totalWorkspacesSynced++;
        totalSyncedConversations += wsConversations;
        totalSyncedMessages += wsMessages;
        workspaceResults.push({ website_id: websiteId, conversations: wsConversations, messages: wsMessages });
      }
    } else if (legacyCreds) {
      // LEGACY MODE: Sync ONLY configured CRISP_WEBSITE_ID using X-Crisp-Tier: website
      const websiteId = legacyCreds.websiteId;
      if (data.websiteId && data.websiteId !== websiteId) {
        return { ok: false as const, error: "Legacy credentials can only sync the configured CRISP_WEBSITE_ID." };
      }

      const headers = crispWebsiteHeaders(legacyCreds);
      let wsConversations = 0;
      let wsMessages = 0;

      for (let page = 1; page <= 5; page++) {
        const listRes = await fetch(
          `https://api.crisp.chat/v1/website/${websiteId}/conversations/${page}`,
          { headers },
        );
        if (!listRes.ok) {
          if (page === 1) {
            const err = (await listRes.json().catch(() => ({}))) as Record<string, unknown>;
            return { ok: false as const, error: crispApiError(listRes.status, err, "website") };
          }
          break;
        }

        const listData = (await listRes.json()) as { data?: Record<string, any>[] };
        const sessions = listData.data ?? [];
        if (sessions.length === 0) break;

        for (const session of sessions) {
          const sessionId = session["session_id"] as string | undefined;
          if (!sessionId) continue;
          const meta = (session["meta"] ?? {}) as Record<string, any>;

          // Preserve existing customer details in legacy mode too
          const { data: existingConv } = await supabaseAdmin
            .from("crisp_conversations")
            .select("customer_name, customer_email, customer_phone, customer_avatar")
            .eq("crisp_website_id", websiteId)
            .eq("crisp_session_id", sessionId)
            .maybeSingle();

          const name = meta["nickname"] ?? session["nickname"] ?? existingConv?.customer_name ?? null;
          const email = meta["email"] ?? session["email"] ?? existingConv?.customer_email ?? null;
          const phone = meta["phone"] ?? session["phone"] ?? existingConv?.customer_phone ?? null;
          const avatar = meta["avatar"] ?? session["avatar"] ?? existingConv?.customer_avatar ?? null;

          const { data: conv, error: convErr } = await supabaseAdmin
            .from("crisp_conversations")
            .upsert(
              {
                crisp_website_id: websiteId,
                crisp_session_id: sessionId,
                customer_name: name,
                customer_email: email,
                customer_phone: phone,
                customer_avatar: avatar,
                status: (session["state"] as string) ?? "unresolved",
                updated_at: new Date().toISOString(),
              },
              { onConflict: "crisp_website_id,crisp_session_id" },
            )
            .select("id")
            .single();

          if (convErr || !conv) continue;
          wsConversations++;

          const msgsRes = await fetch(
            `https://api.crisp.chat/v1/website/${websiteId}/conversation/${sessionId}/messages`,
            { headers },
          );
          if (!msgsRes.ok) continue;

          const msgsData = (await msgsRes.json()) as { data?: Record<string, any>[] };
          for (const msg of msgsData.data ?? []) {
            const isOperator = String(msg["from"]).toLowerCase() === "operator";
            const crispMsgId = String(msg["fingerprint"] ?? `${sessionId}_${msg["timestamp"]}`);

            const { error: msgErr } = await supabaseAdmin.from("crisp_messages").insert({
              conversation_id: conv.id,
              crisp_website_id: websiteId,
              crisp_session_id: sessionId,
              crisp_message_id: crispMsgId,
              sender_type: isOperator ? "operator" : "customer",
              direction: isOperator ? "outgoing" : "incoming",
              content: messageText(msg["content"]) || "[Attachment/Content]",
              message_type: (msg["type"] as string) ?? "text",
              sent_at: msg["timestamp"]
                ? new Date(msg["timestamp"] as number).toISOString()
                : new Date().toISOString(),
              raw_payload: msg,
            });
            if (!msgErr) wsMessages++;
          }
        }
      }

      totalWorkspacesSynced = 1;
      totalSyncedConversations = wsConversations;
      totalSyncedMessages = wsMessages;
      workspaceResults.push({ website_id: websiteId, conversations: wsConversations, messages: wsMessages });
    }

    return {
      ok: true as const,
      workspaces_synced: totalWorkspacesSynced,
      synced_conversations: totalSyncedConversations,
      synced_messages: totalSyncedMessages,
      workspace_results: workspaceResults,
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

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // READ FROM DATABASE: crisp_website_id and crisp_session_id
    const { data: conv, error: fetchErr } = await supabaseAdmin
      .from("crisp_conversations")
      .select("id, crisp_website_id, crisp_session_id")
      .eq("id", data.conversationId)
      .single();

    if (fetchErr || !conv) {
      return { ok: false as const, error: "Conversation not found in database" };
    }

    const websiteId = conv.crisp_website_id;
    const sessionId = conv.crisp_session_id;

    const {
      getCrispPluginCredentials,
      getLegacyCrispWebsiteCredentials,
      crispPluginHeaders,
      crispWebsiteHeaders,
      crispApiError,
    } = await import("./crisp.server");

    const pluginCreds = getCrispPluginCredentials();
    const legacyCreds = getLegacyCrispWebsiteCredentials();

    let requestHeaders: Record<string, string>;
    let errorMode: "plugin" | "website" = "plugin";

    if (pluginCreds) {
      // Validate that website exists in crisp_workspaces AND enabled = true
      const { data: wsRecord } = await supabaseAdmin
        .from("crisp_workspaces")
        .select("id, enabled")
        .eq("crisp_website_id", websiteId)
        .maybeSingle();

      if (!wsRecord || !wsRecord.enabled) {
        return {
          ok: false as const,
          error: "Workspace is disabled or not registered as a Crisp Plugin.",
        };
      }

      requestHeaders = crispPluginHeaders(pluginCreds);
      errorMode = "plugin";
    } else if (legacyCreds && websiteId === legacyCreds.websiteId) {
      requestHeaders = crispWebsiteHeaders(legacyCreds);
      errorMode = "website";
    } else {
      return {
        ok: false as const,
        error: "Crisp integration is not configured for this workspace. Missing Plugin credentials.",
      };
    }

    const res = await fetch(
      `https://api.crisp.chat/v1/website/${websiteId}/conversation/${sessionId}/message`,
      {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({
          type: "text",
          from: "operator",
          origin: "chat",
          content: data.content,
        }),
      },
    );

    const payload = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) {
      console.error("[Crisp] Send message rejected", {
        status: res.status,
        reason: payload["reason"] ?? payload["message"] ?? "unknown",
      });
      return { ok: false as const, error: crispApiError(res.status, payload, errorMode) };
    }

    const msgData = (payload["data"] ?? payload) as Record<string, any>;
    const crispMsgId = String(msgData["fingerprint"] ?? Date.now());
    const sentAt = msgData["timestamp"]
      ? new Date(msgData["timestamp"] as number).toISOString()
      : new Date().toISOString();

    // Update conversation last message
    await supabaseAdmin
      .from("crisp_conversations")
      .update({
        last_message: data.content,
        last_message_at: sentAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", conv.id);

    // Insert outgoing message
    await supabaseAdmin.from("crisp_messages").insert({
      conversation_id: conv.id,
      crisp_website_id: websiteId,
      crisp_session_id: sessionId,
      crisp_message_id: crispMsgId,
      sender_type: "operator",
      direction: "outgoing",
      content: data.content,
      message_type: "text",
      sent_at: sentAt,
      raw_payload: payload,
    });

    return { ok: true as const, crisp_message_id: crispMsgId, sent_at: sentAt };
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
