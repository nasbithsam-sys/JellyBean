import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const syncCrispHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
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

    const { getCrispCredentials, crispHeaders, crispApiError, messageText } = await import("./crisp.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const creds = getCrispCredentials();
    const headers = crispHeaders(creds);

    let syncedConversations = 0;
    let syncedMessages = 0;

    for (let page = 1; page <= 5; page++) {
      const listRes = await fetch(
        `https://api.crisp.chat/v1/website/${creds.websiteId}/conversations/${page}`,
        { headers },
      );
      if (!listRes.ok) {
        if (page === 1) {
          const err = (await listRes.json().catch(() => ({}))) as Record<string, unknown>;
          console.error("[Crisp] History sync rejected", {
            status: listRes.status,
            reason: err["reason"] ?? err["message"] ?? "unknown",
          });
          return { ok: false as const, error: crispApiError(listRes.status, err) };
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

        const { data: conv, error: convErr } = await supabaseAdmin
          .from("crisp_conversations")
          .upsert(
            {
              crisp_session_id: sessionId,
              crisp_website_id: creds.websiteId,
              customer_name: meta["nickname"] ?? session["nickname"] ?? null,
              customer_email: meta["email"] ?? session["email"] ?? null,
              customer_phone: meta["phone"] ?? session["phone"] ?? null,
              customer_avatar: meta["avatar"] ?? session["avatar"] ?? null,
              status: (session["state"] as string) ?? "unresolved",
              updated_at: new Date().toISOString(),
            },
            { onConflict: "crisp_session_id" },
          )
          .select("id")
          .single();

        if (convErr || !conv) continue;
        syncedConversations++;

        const msgsRes = await fetch(
          `https://api.crisp.chat/v1/website/${creds.websiteId}/conversation/${sessionId}/messages`,
          { headers },
        );
        if (!msgsRes.ok) continue;

        const msgsData = (await msgsRes.json()) as { data?: Record<string, any>[] };
        for (const msg of msgsData.data ?? []) {
          const isOperator = String(msg["from"]).toLowerCase() === "operator";
          const { error: msgErr } = await supabaseAdmin.from("crisp_messages").insert({
            conversation_id: conv.id,
            crisp_session_id: sessionId,
            crisp_message_id: String(msg["fingerprint"] ?? `${sessionId}_${msg["timestamp"]}`),
            sender_type: isOperator ? "operator" : "customer",
            direction: isOperator ? "outgoing" : "incoming",
            content: messageText(msg["content"]) || "[Attachment/Content]",
            message_type: (msg["type"] as string) ?? "text",
            sent_at: msg["timestamp"]
              ? new Date(msg["timestamp"] as number).toISOString()
              : new Date().toISOString(),
            raw_payload: msg,
          });
          if (!msgErr) syncedMessages++;
        }
      }
    }

    return {
      ok: true as const,
      synced_conversations: syncedConversations,
      synced_messages: syncedMessages,
    };
  });

export const sendCrispMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { sessionId: string; content: string }) => {
    const sessionId = String(input?.sessionId ?? "").trim();
    const content = String(input?.content ?? "").trim();
    if (!sessionId || !content) throw new Error("sessionId and non-empty content are required");
    return { sessionId, content };
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

    const { getCrispCredentials, crispHeaders, crispApiError } = await import("./crisp.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const creds = getCrispCredentials();

    const res = await fetch(
      `https://api.crisp.chat/v1/website/${creds.websiteId}/conversation/${data.sessionId}/message`,
      {
        method: "POST",
        headers: crispHeaders(creds),
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
      return { ok: false as const, error: crispApiError(res.status, payload) };
    }

    const msgData = (payload["data"] ?? payload) as Record<string, any>;
    const crispMsgId = String(msgData["fingerprint"] ?? Date.now());
    const sentAt = msgData["timestamp"]
      ? new Date(msgData["timestamp"] as number).toISOString()
      : new Date().toISOString();

    const { data: conv } = await supabaseAdmin
      .from("crisp_conversations")
      .upsert(
        {
          crisp_session_id: data.sessionId,
          crisp_website_id: creds.websiteId,
          last_message: data.content,
          last_message_at: sentAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "crisp_session_id" },
      )
      .select("id")
      .single();

    if (conv) {
      await supabaseAdmin.from("crisp_messages").insert({
        conversation_id: conv.id,
        crisp_session_id: data.sessionId,
        crisp_message_id: crispMsgId,
        sender_type: "operator",
        direction: "outgoing",
        content: data.content,
        message_type: "text",
        sent_at: sentAt,
        raw_payload: payload,
      });
    }

    return { ok: true as const, crisp_message_id: crispMsgId, sent_at: sentAt };
  });
