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
    // 1. Verify CRISP_WEBHOOK_SECRET environment secret (REQUIRED)
    const webhookSecret = Deno.env.get("CRISP_WEBHOOK_SECRET");

    if (!webhookSecret) {
      console.error("Missing CRISP_WEBHOOK_SECRET environment variable");
      return new Response(
        JSON.stringify({ error: "Server configuration missing: CRISP_WEBHOOK_SECRET is not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const url = new URL(req.url);
    const providedKey = url.searchParams.get("key");

    if (!providedKey || providedKey !== webhookSecret) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Invalid or missing webhook key parameter (?key=...)" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

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
    // { website_id: string, event: string, data: { session_id, fingerprint, from, type, content, timestamp, user, state ... } }
    const websiteId = body.website_id || body.data?.website_id || Deno.env.get("CRISP_WEBSITE_ID") || "default";
    const eventType = String(body.event || "unknown").toLowerCase();
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

    // 2. Check & log webhook event idempotently
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

    // 3. Fetch existing conversation to preserve customer details without overwriting with null
    const { data: existingConv } = await supabase
      .from("crisp_conversations")
      .select("id, customer_name, customer_email, customer_phone, customer_avatar, last_message, last_message_at, status")
      .eq("crisp_session_id", sessionId)
      .maybeSingle();

    // Extract customer details from event if available
    const customerUser = data.user || body.user || {};
    const incomingName = customerUser.nickname || customerUser.name || data.nickname || body.nickname || null;
    const incomingEmail = customerUser.email || data.email || body.email || null;
    const incomingPhone = customerUser.phone || data.phone || body.phone || null;
    const incomingAvatar = customerUser.avatar || data.avatar || body.avatar || null;
    const incomingState = data.state || body.state || null;

    // Do NOT overwrite existing details with null
    const finalName = incomingName || existingConv?.customer_name || null;
    const finalEmail = incomingEmail || existingConv?.customer_email || null;
    const finalPhone = incomingPhone || existingConv?.customer_phone || null;
    const finalAvatar = incomingAvatar || existingConv?.customer_avatar || null;
    const finalState = incomingState || existingConv?.status || "unresolved";

    // 4. Extract message text if present
    let messageContent = "";
    if (typeof data.content === "string") {
      messageContent = data.content;
    } else if (data.content && typeof data.content === "object" && typeof data.content.text === "string") {
      messageContent = data.content.text;
    }

    const isMessageEvent = eventType.startsWith("message:");
    const sentAt = data.timestamp ? new Date(data.timestamp).toISOString() : new Date().toISOString();

    const lastMessage = isMessageEvent && messageContent.trim() ? messageContent.trim() : (existingConv?.last_message || null);
    const lastMessageAt = isMessageEvent && messageContent.trim() ? sentAt : (existingConv?.last_message_at || sentAt);

    // 5. Upsert conversation record with preserved details
    const { data: convData, error: convErr } = await supabase
      .from("crisp_conversations")
      .upsert(
        {
          crisp_session_id: sessionId,
          crisp_website_id: websiteId,
          customer_name: finalName,
          customer_email: finalEmail,
          customer_phone: finalPhone,
          customer_avatar: finalAvatar,
          status: finalState,
          last_message: lastMessage,
          last_message_at: lastMessageAt,
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

    // 6. ONLY real message events create crisp_messages (Session metadata events must NOT create fake chat messages)
    if (isMessageEvent && messageContent.trim()) {
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
        content: messageContent.trim(),
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
