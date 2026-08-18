import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable");
      return new Response(JSON.stringify({ error: "Server configuration missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const bodyText = await req.text();
    let body: any;

    try {
      body = JSON.parse(bodyText);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Crisp Webhook Payload Structure
    // { website_id: string, event: string, data: { session_id, fingerprint, from, type, content, timestamp, user, ... } }
    const websiteId = body.website_id || body.data?.website_id || Deno.env.get("CRISP_WEBSITE_ID") || "default";
    const eventType = body.event || "unknown";
    const data = body.data || body;
    const sessionId = data.session_id || body.session_id;

    if (!sessionId) {
      return new Response(JSON.stringify({ message: "No session_id in payload, event ignored" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fingerprint = data.fingerprint || data.timestamp || Date.now();
    const eventFingerprint = `${eventType}_${sessionId}_${fingerprint}`;

    // 1. Check & insert webhook log idempotently
    const { error: webhookLogErr } = await supabase
      .from("crisp_webhook_events")
      .insert({
        event_fingerprint: eventFingerprint,
        event_type: eventType,
        payload: body,
        processed: true,
      });

    if (webhookLogErr && webhookLogErr.code === "23505") {
      // Unique constraint violation -> Already processed duplicate event
      return new Response(JSON.stringify({ status: "ignored", message: "Duplicate webhook event" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Extract customer details if available
    const customerUser = data.user || body.user || {};
    const customerName = customerUser.nickname || customerUser.name || null;
    const customerEmail = customerUser.email || null;
    const customerPhone = customerUser.phone || null;
    const customerAvatar = customerUser.avatar || null;

    // 3. Determine last message text & timestamp
    let contentText = "";
    if (typeof data.content === "string") {
      contentText = data.content;
    } else if (data.content && typeof data.content === "object") {
      contentText = data.content.text || JSON.stringify(data.content);
    } else if (eventType.includes("session")) {
      contentText = `[Event: ${eventType}]`;
    }

    const sentAt = data.timestamp ? new Date(data.timestamp).toISOString() : new Date().toISOString();

    // 4. Upsert conversation
    const { data: convData, error: convErr } = await supabase
      .from("crisp_conversations")
      .upsert(
        {
          crisp_session_id: sessionId,
          crisp_website_id: websiteId,
          customer_name: customerName,
          customer_email: customerEmail,
          customer_phone: customerPhone,
          customer_avatar: customerAvatar,
          last_message: contentText || null,
          last_message_at: sentAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "crisp_session_id" }
      )
      .select("id")
      .single();

    if (convErr) {
      console.error("Error upserting crisp_conversations:", convErr);
      return new Response(JSON.stringify({ error: convErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const conversationId = convData.id;

    // 5. If it's a message event, insert message idempotently
    if (eventType.startsWith("message:") || contentText) {
      const crispMsgId = String(data.fingerprint || `${sessionId}_${sentAt}`);
      const rawFrom = String(data.from || "user").toLowerCase();
      const isOperator = rawFrom === "operator";
      const senderType = isOperator ? "operator" : "customer";
      const direction = isOperator ? "outgoing" : "incoming";

      const { error: msgErr } = await supabase.from("crisp_messages").insert({
        conversation_id: conversationId,
        crisp_session_id: sessionId,
        crisp_message_id: crispMsgId,
        sender_type: senderType,
        direction: direction,
        content: contentText || "[Empty Message]",
        message_type: data.type || "text",
        sent_at: sentAt,
        raw_payload: data,
      });

      if (msgErr && msgErr.code !== "23505") {
        console.error("Error inserting crisp_messages:", msgErr);
      }
    }

    return new Response(JSON.stringify({ status: "success", session_id: sessionId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Crisp webhook error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
