import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function resolveWorkspaceName(websiteId: string, authString: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.crisp.chat/v1/website/${websiteId}`, {
      method: "GET",
      headers: {
        Authorization: `Basic ${authString}`,
        "X-Crisp-Tier": "website",
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) return null;
    const json = await res.json();
    return json?.data?.name || null;
  } catch {
    return null;
  }
}

/** Parse raw message content for any message type. */
function parseMessageContent(msg: any): string {
  const rawContent = msg.content;
  if (typeof rawContent === "string" && rawContent.trim()) return rawContent.trim();
  if (rawContent && typeof rawContent === "object" && typeof rawContent.text === "string" && rawContent.text.trim()) {
    return rawContent.text.trim();
  }
  if (msg.type === "file" || msg.type === "attachment") return "[File]";
  if (msg.type === "animation" || msg.type === "picker" || msg.type === "image" || msg.type === "media") return "[Image]";
  if (msg.type === "audio") return "[Audio]";
  return "[Attachment]";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(JSON.stringify({ error: "Server configuration missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const targetWebsiteId = body.websiteId ? String(body.websiteId).trim() : null;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch registered and enabled workspaces only
    let wsQuery = supabase
      .from("crisp_workspaces")
      .select("id, crisp_website_id, workspace_name, credential_secret_id")
      .eq("enabled", true);

    if (targetWebsiteId) {
      wsQuery = wsQuery.eq("crisp_website_id", targetWebsiteId);
    }

    const { data: workspaces, error: wsErr } = await wsQuery;

    if (wsErr || !workspaces || workspaces.length === 0) {
      return new Response(JSON.stringify({ error: "No enabled Crisp workspaces found to sync" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let totalConversations = 0;
    let totalMessages = 0;

    for (const ws of workspaces) {
      const websiteId = ws.crisp_website_id;
      const secretId = ws.credential_secret_id;
      if (!secretId) continue;

      const { data: secretData, error: secretErr } = await supabase.rpc("crisp_get_workspace_secret", {
        p_secret_id: secretId,
      });

      const tokenId = (secretData as any)?.token_id || (secretData as any)?.tokenId;
      const tokenKey = (secretData as any)?.token_key || (secretData as any)?.tokenKey;

      if (secretErr || !tokenId || !tokenKey) {
        console.error(`Missing Vault credentials for workspace ${websiteId}`);
        continue;
      }

      const authString = btoa(`${tokenId}:${tokenKey}`);
      const headers = {
        Authorization: `Basic ${authString}`,
        "X-Crisp-Tier": "website",
        "Content-Type": "application/json",
      };

      // Resolve workspace name if missing
      if (!ws.workspace_name) {
        const wsName = await resolveWorkspaceName(websiteId, authString);
        if (wsName) {
          await supabase.from("crisp_workspaces").update({ workspace_name: wsName }).eq("id", ws.id);
        }
      }

      let wsConversations = 0;
      let wsMessages = 0;

      // Paginate Crisp history (safety cap: 50 pages)
      for (let page = 1; page <= 50; page++) {
        const listUrl = `https://api.crisp.chat/v1/website/${websiteId}/conversations/${page}`;
        const listRes = await fetch(listUrl, { headers });
        if (!listRes.ok) {
          const errJson = await listRes.json().catch(() => ({}));
          const reason = (errJson as any)?.reason || (errJson as any)?.data?.message || `HTTP ${listRes.status}`;
          throw new Error(`Crisp history sync failed for ${websiteId}: ${reason}`);
        }

        const listData = await listRes.json();
        const sessions = listData.data || [];
        if (!Array.isArray(sessions) || sessions.length === 0) break;

        for (const session of sessions) {
          const sessionId = session.session_id;
          if (!sessionId) continue;

          const customerMeta = session.meta || {};
          const incomingName = customerMeta.nickname || session.nickname || null;
          const incomingEmail = customerMeta.email || session.email || null;
          const incomingPhone = customerMeta.phone || session.phone || null;
          const incomingAvatar = customerMeta.avatar || session.avatar || null;
          const state = session.state || "unresolved";

          // Import Crisp native operator unread count (session.unread.operator)
          const unreadObj = session.unread || {};
          const operatorUnread = typeof unreadObj.operator === "number"
            ? unreadObj.operator
            : typeof session.unread_count === "number"
            ? session.unread_count
            : 0;

          const unreadCount = Math.max(0, operatorUnread);

          const { data: existingConv } = await supabase
            .from("crisp_conversations")
            .select("customer_name, customer_email, customer_phone, customer_avatar, last_message, last_message_at, last_customer_unread_at")
            .eq("crisp_website_id", websiteId)
            .eq("crisp_session_id", sessionId)
            .maybeSingle();

          const finalName = incomingName || existingConv?.customer_name || null;
          const finalEmail = incomingEmail || existingConv?.customer_email || null;
          const finalPhone = incomingPhone || existingConv?.customer_phone || null;
          const finalAvatar = incomingAvatar || existingConv?.customer_avatar || null;

          const { data: convRecord, error: convErr } = await supabase
            .from("crisp_conversations")
            .upsert(
              {
                crisp_website_id: websiteId,
                crisp_session_id: sessionId,
                customer_name: finalName,
                customer_email: finalEmail,
                customer_phone: finalPhone,
                customer_avatar: finalAvatar,
                status: state,
                unread_count: unreadCount,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "crisp_website_id,crisp_session_id" }
            )
            .select("id")
            .single();

          if (convErr || !convRecord) continue;
          wsConversations++;

          // Sync messages for this conversation
          const msgsUrl = `https://api.crisp.chat/v1/website/${websiteId}/conversation/${sessionId}/messages`;
          const msgsRes = await fetch(msgsUrl, { headers });

          if (msgsRes.ok) {
            const msgsData = await msgsRes.json();
            const messagesList: any[] = msgsData.data || [];

            if (messagesList.length > 0) {
              // Sort messages chronologically ascending for correct ordering
              messagesList.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

              // ── LAST CUSTOMER MESSAGE TIMESTAMP ─────────────────────────────
              // Identify the newest actual CUSTOMER (incoming) message.
              // Operator replies must NEVER become last_customer_unread_at.
              let lastCustomerMsgTime: string | null = null;
              for (let i = messagesList.length - 1; i >= 0; i--) {
                const m = messagesList[i];
                const fromStr = String(m.from || "user").toLowerCase();
                if (fromStr !== "operator") {
                  lastCustomerMsgTime = m.timestamp ? new Date(m.timestamp).toISOString() : null;
                  break;
                }
              }

              // Only set last_customer_unread_at if there ARE unread messages AND
              // there's a traceable customer message timestamp
              const lastCustUnreadAt = unreadCount > 0 ? lastCustomerMsgTime : null;

              // Track newest overall message for last_message + last_message_at
              const newestMsg = messagesList[messagesList.length - 1];
              const newestText = parseMessageContent(newestMsg);
              const newestTime = newestMsg.timestamp
                ? new Date(newestMsg.timestamp).toISOString()
                : new Date().toISOString();

              // Upsert all messages (ignore duplicates via 23505)
              for (const msg of messagesList) {
                const textContent = parseMessageContent(msg);
                const crispMsgId = String(msg.fingerprint || `${sessionId}_${msg.timestamp}`);
                const isOperator = String(msg.from).toLowerCase() === "operator";
                const sentAt = msg.timestamp ? new Date(msg.timestamp).toISOString() : new Date().toISOString();

                const { error: msgErr } = await supabase.from("crisp_messages").insert({
                  conversation_id: convRecord.id,
                  crisp_website_id: websiteId,
                  crisp_session_id: sessionId,
                  crisp_message_id: crispMsgId,
                  sender_type: isOperator ? "operator" : "customer",
                  direction: isOperator ? "outgoing" : "incoming",
                  content: textContent,
                  message_type: msg.type || "text",
                  sent_at: sentAt,
                  raw_payload: msg,
                });

                // 23505 = unique_violation (already imported) — safe to ignore
                if (!msgErr) wsMessages++;
              }

              // Update conversation with last message details and correct unread AT
              const { error: updateErr } = await supabase
                .from("crisp_conversations")
                .update({
                  last_message: newestText,
                  last_message_at: newestTime,
                  last_customer_unread_at: lastCustUnreadAt,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", convRecord.id);

              if (updateErr) {
                console.error(`Failed to update conversation ${sessionId}:`, updateErr.message);
              }
            } else {
              // No messages fetched — still clear last_customer_unread_at if read
              if (unreadCount === 0) {
                await supabase
                  .from("crisp_conversations")
                  .update({ last_customer_unread_at: null, updated_at: new Date().toISOString() })
                  .eq("id", convRecord.id);
              }
            }
          }
        }
      }

      const { error: wsUpdateErr } = await supabase
        .from("crisp_workspaces")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", ws.id);

      if (wsUpdateErr) {
        console.error(`Failed to update last_synced_at for workspace ${websiteId}:`, wsUpdateErr.message);
      }

      totalConversations += wsConversations;
      totalMessages += wsMessages;
    }

    return new Response(
      JSON.stringify({
        status: "success",
        synced_conversations: totalConversations,
        synced_messages: totalMessages,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Crisp history sync error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
