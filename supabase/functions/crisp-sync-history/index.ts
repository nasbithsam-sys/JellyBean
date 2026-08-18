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

    // Role check
    const { data: userRoles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    const roles = (userRoles || []).map((r: { role: string }) => r.role);
    if (!roles.some((r) => ALLOWED_ROLES.includes(r))) {
      return new Response(
        JSON.stringify({ error: "Forbidden: Crisp Chat history sync is restricted to admin, cs_admin, and cs roles." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const targetWebsiteId = body.website_id || body.websiteId;

    const pluginTokenId = Deno.env.get("CRISP_PLUGIN_TOKEN_ID");
    const pluginTokenKey = Deno.env.get("CRISP_PLUGIN_TOKEN_KEY");

    const legacyWebsiteId = Deno.env.get("CRISP_WEBSITE_ID");
    const legacyTokenId = Deno.env.get("CRISP_TOKEN_ID");
    const legacyTokenKey = Deno.env.get("CRISP_TOKEN_KEY");

    let totalSyncedConversations = 0;
    let totalSyncedMessages = 0;
    const syncedWebsiteIds = new Set<string>();

    // SPECIFIC WORKSPACE REQUEST
    if (targetWebsiteId) {
      let isPluginTarget = false;

      if (pluginTokenId && pluginTokenKey) {
        const { data: wsRecord } = await supabase
          .from("crisp_workspaces")
          .select("crisp_website_id, enabled")
          .eq("crisp_website_id", targetWebsiteId)
          .eq("enabled", true)
          .maybeSingle();

        if (wsRecord) isPluginTarget = true;
      }

      if (isPluginTarget && pluginTokenId && pluginTokenKey) {
        // Sync via Plugin Token
        const headers = {
          "Authorization": `Basic ${btoa(`${pluginTokenId}:${pluginTokenKey}`)}`,
          "X-Crisp-Tier": "plugin",
        };

        const websiteId = targetWebsiteId;

        for (let page = 1; page <= 5; page++) {
          const listUrl = `https://api.crisp.chat/v1/website/${websiteId}/conversations/${page}`;
          const listRes = await fetch(listUrl, { headers });
          if (!listRes.ok) break;

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

            const { data: existingConv } = await supabase
              .from("crisp_conversations")
              .select("customer_name, customer_email, customer_phone, customer_avatar")
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
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "crisp_website_id,crisp_session_id" }
              )
              .select("id")
              .single();

            if (convErr || !convRecord) continue;
            totalSyncedConversations++;

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
                  crisp_website_id: websiteId,
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

        await supabase
          .from("crisp_workspaces")
          .update({ last_synced_at: new Date().toISOString() })
          .eq("crisp_website_id", websiteId);

        return new Response(
          JSON.stringify({
            status: "success",
            synced_conversations: totalSyncedConversations,
            synced_messages: totalSyncedMessages,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check legacy mode for specific target
      if (legacyTokenId && legacyTokenKey && legacyWebsiteId === targetWebsiteId) {
        const headers = {
          "Authorization": `Basic ${btoa(`${legacyTokenId}:${legacyTokenKey}`)}`,
          "X-Crisp-Tier": "website",
        };

        const websiteId = targetWebsiteId;

        for (let page = 1; page <= 5; page++) {
          const listUrl = `https://api.crisp.chat/v1/website/${websiteId}/conversations/${page}`;
          const listRes = await fetch(listUrl, { headers });
          if (!listRes.ok) break;

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

            const { data: existingConv } = await supabase
              .from("crisp_conversations")
              .select("customer_name, customer_email, customer_phone, customer_avatar")
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
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "crisp_website_id,crisp_session_id" }
              )
              .select("id")
              .single();

            if (convErr || !convRecord) continue;
            totalSyncedConversations++;

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
                  crisp_website_id: websiteId,
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
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ error: "Workspace is not registered, enabled, or configured." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ALL WORKSPACES REQUEST
    // 1. Sync all enabled Plugin workspaces using Plugin Token
    if (pluginTokenId && pluginTokenKey) {
      const { data: workspaces } = await supabase
        .from("crisp_workspaces")
        .select("crisp_website_id, workspace_name")
        .eq("enabled", true);

      const targetWorkspaces = workspaces || [];
      const headers = {
        "Authorization": `Basic ${btoa(`${pluginTokenId}:${pluginTokenKey}`)}`,
        "X-Crisp-Tier": "plugin",
      };

      for (const ws of targetWorkspaces) {
        const websiteId = ws.crisp_website_id;
        syncedWebsiteIds.add(websiteId);

        for (let page = 1; page <= 5; page++) {
          const listUrl = `https://api.crisp.chat/v1/website/${websiteId}/conversations/${page}`;
          const listRes = await fetch(listUrl, { headers });

          if (!listRes.ok) break;

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

            const { data: existingConv } = await supabase
              .from("crisp_conversations")
              .select("customer_name, customer_email, customer_phone, customer_avatar")
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
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "crisp_website_id,crisp_session_id" }
              )
              .select("id")
              .single();

            if (convErr || !convRecord) continue;
            totalSyncedConversations++;

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
                  crisp_website_id: websiteId,
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

        await supabase
          .from("crisp_workspaces")
          .update({ last_synced_at: new Date().toISOString() })
          .eq("crisp_website_id", websiteId);
      }
    }

    // 2. PLUS sync legacy CRISP_WEBSITE_ID using Website Token IF NOT ALREADY SYNCED via Plugin mode
    if (legacyTokenId && legacyTokenKey && legacyWebsiteId && !syncedWebsiteIds.has(legacyWebsiteId)) {
      const websiteId = legacyWebsiteId;
      const headers = {
        "Authorization": `Basic ${btoa(`${legacyTokenId}:${legacyTokenKey}`)}`,
        "X-Crisp-Tier": "website",
      };

      for (let page = 1; page <= 5; page++) {
        const listUrl = `https://api.crisp.chat/v1/website/${websiteId}/conversations/${page}`;
        const listRes = await fetch(listUrl, { headers });
        if (!listRes.ok) break;

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

          const { data: existingConv } = await supabase
            .from("crisp_conversations")
            .select("customer_name, customer_email, customer_phone, customer_avatar")
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
                updated_at: new Date().toISOString(),
              },
              { onConflict: "crisp_website_id,crisp_session_id" }
            )
            .select("id")
            .single();

          if (convErr || !convRecord) continue;
          totalSyncedConversations++;

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
                crisp_website_id: websiteId,
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
    }

    return new Response(
      JSON.stringify({
        status: "success",
        synced_conversations: totalSyncedConversations,
        synced_messages: totalSyncedMessages,
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
