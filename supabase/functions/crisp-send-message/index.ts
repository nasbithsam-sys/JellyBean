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
      return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Role check
    const { data: userRoles, error: roleErr } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    if (roleErr) {
      return new Response(JSON.stringify({ error: "Could not verify user roles" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const roles = (userRoles || []).map((r: { role: string }) => r.role);
    if (!roles.some((r) => ALLOWED_ROLES.includes(r))) {
      return new Response(
        JSON.stringify({ error: "Forbidden: Crisp Chat is restricted to admin, cs_admin, and cs roles." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const conversationId = body.conversation_id || body.conversationId;
    const content = String(body.content || "").trim();

    if (!conversationId || !content) {
      return new Response(JSON.stringify({ error: "conversation_id and non-empty content are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // FETCH FROM DATABASE: crisp_website_id and crisp_session_id
    const { data: conv, error: convErr } = await supabase
      .from("crisp_conversations")
      .select("id, crisp_website_id, crisp_session_id")
      .eq("id", conversationId)
      .single();

    if (convErr || !conv) {
      return new Response(JSON.stringify({ error: "Conversation not found in database" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const websiteId = conv.crisp_website_id;
    const sessionId = conv.crisp_session_id;

    // Credentials lookup
    const pluginTokenId = Deno.env.get("CRISP_PLUGIN_TOKEN_ID");
    const pluginTokenKey = Deno.env.get("CRISP_PLUGIN_TOKEN_KEY");

    const legacyWebsiteId = Deno.env.get("CRISP_WEBSITE_ID");
    const legacyTokenId = Deno.env.get("CRISP_TOKEN_ID");
    const legacyTokenKey = Deno.env.get("CRISP_TOKEN_KEY");

    const { data: wsRecord } = await supabase
      .from("crisp_workspaces")
      .select("id, enabled, connection_mode")
      .eq("crisp_website_id", websiteId)
      .maybeSingle();

    let authString = "";
    let crispTier = "plugin";
    let isMatched = false;

    // A) Plugin Token: enabled=true AND connection_mode='plugin' AND Plugin credentials exist
    if (pluginTokenId && pluginTokenKey && wsRecord && wsRecord.enabled && wsRecord.connection_mode === "plugin") {
      authString = btoa(`${pluginTokenId}:${pluginTokenKey}`);
      crispTier = "plugin";
      isMatched = true;
    }

    // B) Legacy Website Token: conversation.crisp_website_id === CRISP_WEBSITE_ID AND legacy credentials exist AND (no wsRecord OR connection_mode='legacy')
    if (!isMatched && legacyTokenId && legacyTokenKey && legacyWebsiteId === websiteId && (!wsRecord || wsRecord.connection_mode === "legacy")) {
      authString = btoa(`${legacyTokenId}:${legacyTokenKey}`);
      crispTier = "website";
      isMatched = true;
    }

    // C) Otherwise, return clear error
    if (!isMatched) {
      return new Response(
        JSON.stringify({ error: "Workspace is disabled, not registered as a Crisp Plugin, or not configured for legacy access." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const crispUrl = `https://api.crisp.chat/v1/website/${websiteId}/conversation/${sessionId}/message`;
    const crispResponse = await fetch(crispUrl, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${authString}`,
        "X-Crisp-Tier": crispTier,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "text",
        from: "operator",
        origin: "chat",
        content: content,
      }),
    });

    const responseData = await crispResponse.json();

    if (!crispResponse.ok) {
      console.error("Crisp API Error:", crispResponse.status, responseData);
      return new Response(
        JSON.stringify({ error: responseData.reason || responseData.message || `Crisp API status ${crispResponse.status}` }),
        { status: crispResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const crispMsgData = responseData.data || responseData;
    const crispMsgId = String(crispMsgData.fingerprint || Date.now());
    const sentAt = crispMsgData.timestamp ? new Date(crispMsgData.timestamp).toISOString() : new Date().toISOString();

    // Update conversation
    await supabase
      .from("crisp_conversations")
      .update({
        last_message: content,
        last_message_at: sentAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", conv.id);

    // Insert outgoing message
    await supabase.from("crisp_messages").insert({
      conversation_id: conv.id,
      crisp_website_id: websiteId,
      crisp_session_id: sessionId,
      crisp_message_id: crispMsgId,
      sender_type: "operator",
      direction: "outgoing",
      content: content,
      message_type: "text",
      sent_at: sentAt,
      raw_payload: responseData,
    });

    return new Response(
      JSON.stringify({ status: "success", crisp_message_id: crispMsgId, sent_at: sentAt }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Crisp send message error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
