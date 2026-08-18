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

    // SPECIFIC WORKSPACE SYNC REQUEST
    if (data.websiteId) {
      const targetWebsiteId = data.websiteId;

      // Option A: Check if enabled in crisp_workspaces + pluginCreds exist
      let isPluginTarget = false;
      if (pluginCreds) {
        const { data: wsRecord } = await supabaseAdmin
          .from("crisp_workspaces")
          .select("crisp_website_id, enabled")
          .eq("crisp_website_id", targetWebsiteId)
          .eq("enabled", true)
          .maybeSingle();

        if (wsRecord) isPluginTarget = true;
      }

      if (isPluginTarget && pluginCreds) {
        // Sync target workspace via Plugin Token
        const headers = crispPluginHeaders(pluginCreds);
        let wsConversations = 0;
        let wsMessages = 0;

        for (let page = 1; page <= 5; page++) {
          const listRes = await fetch(
            `https://api.crisp.chat/v1/website/${targetWebsiteId}/conversations/${page}`,
            { headers },
          );
          if (!listRes.ok) {
            if (page === 1) {
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

            const { data: existingConv } = await supabaseAdmin
              .from("crisp_conversations")
              .select("customer_name, customer_email, customer_phone, customer_avatar")
              .eq("crisp_website_id", targetWebsiteId)
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
                  crisp_website_id: targetWebsiteId,
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
              `https://api.crisp.chat/v1/website/${targetWebsiteId}/conversation/${sessionId}/messages`,
              { headers },
            );
            if (!msgsRes.ok) continue;

            const msgsData = (await msgsRes.json()) as { data?: Record<string, any>[] };
            for (const msg of msgsData.data ?? []) {
              const isOperator = String(msg["from"]).toLowerCase() === "operator";
              const crispMsgId = String(msg["fingerprint"] ?? `${sessionId}_${msg["timestamp"]}`);

              const { error: msgErr } = await supabaseAdmin.from("crisp_messages").insert({
                conversation_id: conv.id,
                crisp_website_id: targetWebsiteId,
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
          .eq("crisp_website_id", targetWebsiteId);

        return {
          ok: true as const,
          workspaces_synced: 1,
          synced_conversations: wsConversations,
          synced_messages: wsMessages,
          workspace_results: [{ website_id: targetWebsiteId, conversations: wsConversations, messages: wsMessages }],
        };
      }

      // Option B: Check if target equals legacy CRISP_WEBSITE_ID + legacyCreds exist
      if (legacyCreds && targetWebsiteId === legacyCreds.websiteId) {
        const headers = crispWebsiteHeaders(legacyCreds);
        let wsConversations = 0;
        let wsMessages = 0;

        for (let page = 1; page <= 5; page++) {
          const listRes = await fetch(
            `https://api.crisp.chat/v1/website/${targetWebsiteId}/conversations/${page}`,
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

            const { data: existingConv } = await supabaseAdmin
              .from("crisp_conversations")
              .select("customer_name, customer_email, customer_phone, customer_avatar")
              .eq("crisp_website_id", targetWebsiteId)
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
                  crisp_website_id: targetWebsiteId,
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
              `https://api.crisp.chat/v1/website/${targetWebsiteId}/conversation/${sessionId}/messages`,
              { headers },
            );
            if (!msgsRes.ok) continue;

            const msgsData = (await msgsRes.json()) as { data?: Record<string, any>[] };
            for (const msg of msgsData.data ?? []) {
              const isOperator = String(msg["from"]).toLowerCase() === "operator";
              const crispMsgId = String(msg["fingerprint"] ?? `${sessionId}_${msg["timestamp"]}`);

              const { error: msgErr } = await supabaseAdmin.from("crisp_messages").insert({
                conversation_id: conv.id,
                crisp_website_id: targetWebsiteId,
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

        return {
          ok: true as const,
          workspaces_synced: 1,
          synced_conversations: wsConversations,
          synced_messages: wsMessages,
          workspace_results: [{ website_id: targetWebsiteId, conversations: wsConversations, messages: wsMessages }],
        };
      }

      // Option C: Workspace not configured
      return { ok: false as const, error: "Workspace is not registered, enabled, or configured." };
    }

    // ALL WORKSPACES SYNC REQUEST
    const syncedWebsiteIds = new Set<string>();

    // 1. Sync every enabled Plugin workspace using Plugin Token
    if (pluginCreds) {
      const { data: workspaces } = await supabaseAdmin
        .from("crisp_workspaces")
        .select("crisp_website_id, workspace_name")
        .eq("enabled", true);

      const targetWorkspaces = workspaces || [];
      const headers = crispPluginHeaders(pluginCreds);

      for (const ws of targetWorkspaces) {
        const websiteId = ws.crisp_website_id;
        syncedWebsiteIds.add(websiteId);
        let wsConversations = 0;
        let wsMessages = 0;

        for (let page = 1; page <= 5; page++) {
          const listRes = await fetch(
            `https://api.crisp.chat/v1/website/${websiteId}/conversations/${page}`,
            { headers },
          );
          if (!listRes.ok) break;

          const listData = (await listRes.json()) as { data?: Record<string, any>[] };
          const sessions = listData.data ?? [];
          if (sessions.length === 0) break;

          for (const session of sessions) {
            const sessionId = session["session_id"] as string | undefined;
            if (!sessionId) continue;
            const meta = (session["meta"] ?? {}) as Record<string, any>;

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
    }

    // 2. PLUS sync legacy CRISP_WEBSITE_ID using Website Token IF NOT ALREADY synced via Plugin mode
    if (legacyCreds && !syncedWebsiteIds.has(legacyCreds.websiteId)) {
      const websiteId = legacyCreds.websiteId;
      const headers = crispWebsiteHeaders(legacyCreds);
      let wsConversations = 0;
      let wsMessages = 0;

      for (let page = 1; page <= 5; page++) {
        const listRes = await fetch(
          `https://api.crisp.chat/v1/website/${websiteId}/conversations/${page}`,
          { headers },
        );
        if (!listRes.ok) break;

        const listData = (await listRes.json()) as { data?: Record<string, any>[] };
        const sessions = listData.data ?? [];
        if (sessions.length === 0) break;

        for (const session of sessions) {
          const sessionId = session["session_id"] as string | undefined;
          if (!sessionId) continue;
          const meta = (session["meta"] ?? {}) as Record<string, any>;

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

      totalWorkspacesSynced++;
      totalSyncedConversations += wsConversations;
      totalSyncedMessages += wsMessages;
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

    let requestHeaders: Record<string, string> | null = null;
    let errorMode: "plugin" | "website" = "plugin";

    // ROUTING ORDER:
    // A) If crisp_workspaces contains the conversation website and enabled=true, AND Plugin credentials exist -> use Plugin Token
    if (pluginCreds) {
      const { data: wsRecord } = await supabaseAdmin
        .from("crisp_workspaces")
        .select("id, enabled")
        .eq("crisp_website_id", websiteId)
        .eq("enabled", true)
        .maybeSingle();

      if (wsRecord) {
        requestHeaders = crispPluginHeaders(pluginCreds);
        errorMode = "plugin";
      }
    }

    // B) Otherwise, if conversation.crisp_website_id === CRISP_WEBSITE_ID AND legacy credentials exist -> use legacy Website Token
    if (!requestHeaders && legacyCreds && websiteId === legacyCreds.websiteId) {
      requestHeaders = crispWebsiteHeaders(legacyCreds);
      errorMode = "website";
    }

    // C) Otherwise, return clear error
    if (!requestHeaders) {
      return {
        ok: false as const,
        error: "Workspace is disabled, not registered as a Crisp Plugin, or not configured for legacy access.",
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
