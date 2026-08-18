import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_ROLES = ["admin", "cs_admin", "cs"];

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

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);

    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid session token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Role check (admin, cs_admin, cs only)
    const { data: userRoles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    const roles = (userRoles || []).map((r: { role: string }) => r.role);
    if (!roles.some((r) => ALLOWED_ROLES.includes(r))) {
      return new Response(
        JSON.stringify({ error: "Forbidden: Crisp Chat history sync is restricted to admin, cs_admin, and cs roles." }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const websiteId = Deno.env.get("CRISP_WEBSITE_ID");
    const tokenId = Deno.env.get("CRISP_TOKEN_ID");
    const tokenKey = Deno.env.get("CRISP_TOKEN_KEY");

    if (!websiteId || !tokenId || !tokenKey) {
      return new Response(
        JSON.stringify({ error: "Crisp integration is not configured yet. Missing credentials." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const authString = btoa(`${tokenId}:${tokenKey}`);
    const headers = {
      "Authorization": `Basic ${authString}`,
      "X-Crisp-Tier": "plugin",
    };

    let totalSyncedConversations = 0;
    let totalSyncedMessages = 0;

    // Paginate through Crisp conversations (up to page 5 to respect rate limits)
    for (let page = 1; page <= 5; page++) {
      const listUrl = `https://api.crisp.chat/v1/website/${websiteId}/conversations/${page}`;
      const listRes = await fetch(listUrl, { headers });

      if (!listRes.ok) {
        if (page === 1) {
          const errData = await listRes.json().catch(() => ({}));
          return new Response(
            JSON.stringify({ error: errData.reason || `Crisp API returned status ${listRes.status}` }),
            { status: listRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        break; // Stop pagination if no more pages or error
      }

      const listData = await listRes.json();
      const sessions = listData.data || [];
      if (!Array.isArray(sessions) || sessions.length === 0) break;

      for (const session of sessions) {
        const sessionId = session.session_id;
        if (!sessionId) continue;

        const customerMeta = session.meta || {};
        const customerName = customerMeta.nickname || session.nickname || null;
        const customerEmail = customerMeta.email || session.email || null;
        const customerPhone = customerMeta.phone || session.phone || null;
        const customerAvatar = customerMeta.avatar || session.avatar || null;
        const state = session.state || "unresolved";

        const { data: convRecord, error: convErr } = await supabase
          .from("crisp_conversations")
          .upsert(
            {
              crisp_session_id: sessionId,
              crisp_website_id: websiteId,
              customer_name: customerName,
              customer_email: customerEmail,
              customer_phone: customerPhone,
              customer_avatar: customerAvatar,
              status: state,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "crisp_session_id" }
          )
          .select("id")
          .single();

        if (convErr || !convRecord) continue;
        totalSyncedConversations++;

        // Fetch messages for this session
        const msgsUrl = `https://api.crisp.chat/v1/website/${websiteId}/conversation/${sessionId}/messages`;
        const msgsRes = await fetch(msgsUrl, { headers });

        if (msgsRes.ok) {
          const msgsData = await msgsRes.json();
          const messagesList = msgsData.data || [];

          for (const msg of messagesList) {
            const rawContent = msg.content;
            let textContent = "";
            if (typeof rawContent === "string") textContent = rawContent;
            else if (rawContent && typeof rawContent === "object") textContent = rawContent.text || JSON.stringify(rawContent);

            const crispMsgId = String(msg.fingerprint || `${sessionId}_${msg.timestamp}`);
            const isOperator = String(msg.from).toLowerCase() === "operator";
            const sentAt = msg.timestamp ? new Date(msg.timestamp).toISOString() : new Date().toISOString();

            const { error: msgErr } = await supabase.from("crisp_messages").insert({
              conversation_id: convRecord.id,
              crisp_session_id: sessionId,
              crisp_message_id: crispMsgId,
              sender_type: isOperator ? "operator" : "customer",
              direction: isOperator ? "outgoing" : "incoming",
              content: textContent || "[Attachment/Content]",
              message_type: msg.type || "text",
              sent_at: sentAt,
              raw_payload: msg,
            });

            if (!msgErr) totalSyncedMessages++;
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        status: "success",
        synced_conversations: totalSyncedConversations,
        synced_messages: totalSyncedMessages,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("Crisp history sync error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
