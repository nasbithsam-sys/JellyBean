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

    // Strictly check user roles (admin, cs_admin, cs only)
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
    const isAuthorized = roles.some((r) => ALLOWED_ROLES.includes(r));

    if (!isAuthorized) {
      return new Response(
        JSON.stringify({ error: "Forbidden: Crisp Chat is strictly restricted to admin, cs_admin, and cs roles." }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Parse payload
    const { session_id, content } = await req.json();

    if (!session_id || !content || typeof content !== "string" || !content.trim()) {
      return new Response(JSON.stringify({ error: "session_id and non-empty content are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const websiteId = Deno.env.get("CRISP_WEBSITE_ID");
    const tokenId = Deno.env.get("CRISP_TOKEN_ID");
    const tokenKey = Deno.env.get("CRISP_TOKEN_KEY");

    if (!websiteId || !tokenId || !tokenKey) {
      return new Response(
        JSON.stringify({ error: "Crisp integration is not configured yet. Missing Crisp credentials." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Call Crisp REST API
    const authString = btoa(`${tokenId}:${tokenKey}`);
    const crispUrl = `https://api.crisp.chat/v1/website/${websiteId}/conversation/${session_id}/message`;

    const crispResponse = await fetch(crispUrl, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${authString}`,
        "X-Crisp-Tier": "website",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "text",
        from: "operator",
        origin: "chat",
        content: content.trim(),
      }),
    });

    const responseData = await crispResponse.json();

    if (!crispResponse.ok) {
      console.error("Crisp API Error:", crispResponse.status, responseData);
      return new Response(
        JSON.stringify({
          error: responseData.reason || responseData.message || `Crisp API returned status ${crispResponse.status}`,
        }),
        {
          status: crispResponse.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Crisp response data contains created message details
    const crispMsgData = responseData.data || responseData;
    const crispMsgId = String(crispMsgData.fingerprint || Date.now());
    const sentAt = crispMsgData.timestamp
      ? new Date(crispMsgData.timestamp).toISOString()
      : new Date().toISOString();

    // Get conversation record
    const { data: convData } = await supabase
      .from("crisp_conversations")
      .select("id")
      .eq("crisp_session_id", session_id)
      .maybeSingle();

    let conversationId = convData?.id;

    if (!conversationId) {
      // Upsert conversation if record does not exist locally
      const { data: newConv } = await supabase
        .from("crisp_conversations")
        .upsert(
          {
            crisp_session_id: session_id,
            crisp_website_id: websiteId,
            last_message: content.trim(),
            last_message_at: sentAt,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "crisp_session_id" }
        )
        .select("id")
        .single();

      conversationId = newConv?.id;
    } else {
      // Update last message preview
      await supabase
        .from("crisp_conversations")
        .update({
          last_message: content.trim(),
          last_message_at: sentAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversationId);
    }

    // Insert outgoing operator message idempotently
    if (conversationId) {
      const { error: msgErr } = await supabase.from("crisp_messages").insert({
        conversation_id: conversationId,
        crisp_session_id: session_id,
        crisp_message_id: crispMsgId,
        sender_type: "operator",
        direction: "outgoing",
        content: content.trim(),
        message_type: "text",
        sent_at: sentAt,
        raw_payload: responseData,
      });

      if (msgErr && msgErr.code !== "23505") {
        console.error("Error inserting outgoing message into DB:", msgErr);
      }
    }

    return new Response(
      JSON.stringify({
        status: "success",
        crisp_message_id: crispMsgId,
        sent_at: sentAt,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("Crisp send message error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
