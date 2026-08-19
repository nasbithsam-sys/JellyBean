import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Timing-safe string comparison
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
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

    const rawBody = await req.text();
    const url = new URL(req.url);
    const providedKey = url.searchParams.get("key");

    if (!providedKey) {
      return new Response(JSON.stringify({ error: "Unauthorized: Missing webhook secret key (?key=)" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    let body: any;

    try {
      body = JSON.parse(rawBody);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const eventType = String(body.event || "unknown").toLowerCase();
    const data = body.data || body;
    const websiteId = body.website_id || data.website_id;

    if (!websiteId) {
      return new Response(JSON.stringify({ message: "No website_id in payload, event ignored" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. LOOKUP WORKSPACE IN DATABASE (Must be active and enabled)
    const { data: wsRecord, error: wsErr } = await supabase
      .from("crisp_workspaces")
      .select("id, enabled, credential_secret_id")
      .eq("crisp_website_id", websiteId)
      .maybeSingle();

    if (wsErr || !wsRecord?.enabled || !wsRecord.credential_secret_id) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: workspace is missing, disabled, or not configured." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: secretData, error: secretErr } = await supabase.rpc("crisp_get_workspace_secret", {
      p_secret_id: wsRecord.credential_secret_id,
    });

    const storedWebhookSecret = secretData?.webhook_secret || secretData?.webhookSecret;

    if (secretErr || !storedWebhookSecret || !timingSafeEqual(providedKey, storedWebhookSecret)) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: webhook key mismatch." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await supabase
      .from("crisp_workspaces")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", wsRecord.id);

    const sessionId = data.session_id || body.session_id;

    if (!sessionId) {
      return new Response(JSON.stringify({ status: "success", message: "Event processed (no session_id)" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fingerprint = data.fingerprint || data.timestamp || Date.now();
    const eventFingerprint = `${websiteId}_${eventType}_${sessionId}_${fingerprint}`;

    // 2. Log webhook event with processed: false initially
    const { data: eventRow, error: webhookLogErr } = await supabase
      .from("crisp_webhook_events")
      .insert({
        crisp_website_id: websiteId,
        event_fingerprint: eventFingerprint,
        event_type: eventType,
        payload: body,
        processed: false,
      })
      .select("id, processed")
      .maybeSingle();

    if (webhookLogErr && webhookLogErr.code === "23505") {
      // Check existing event record: if already processed = true, ignore. If processed = false, allow retry!
      const { data: existingEvt } = await supabase
        .from("crisp_webhook_events")
        .select("id, processed")
        .eq("event_fingerprint", eventFingerprint)
        .maybeSingle();

      if (existingEvt?.processed === true) {
        return new Response(JSON.stringify({ status: "ignored", message: "Duplicate webhook event already processed" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const webhookEventId = eventRow?.id;

    try {
      // 3. Fetch existing conversation to preserve customer details and calculate unread count
      const { data: existingConv } = await supabase
        .from("crisp_conversations")
        .select("id, customer_name, customer_email, customer_phone, customer_avatar, last_message, last_message_at, last_customer_unread_at, status, unread_count")
        .eq("crisp_website_id", websiteId)
        .eq("crisp_session_id", sessionId)
        .maybeSingle();

      const customerUser = data.user || body.user || {};
      const incomingName = customerUser.nickname || customerUser.name || data.nickname || body.nickname || null;
      const incomingEmail = customerUser.email || data.email || body.email || null;
      const incomingPhone = customerUser.phone || data.phone || body.phone || null;
      const incomingAvatar = customerUser.avatar || data.avatar || body.avatar || null;
      const incomingState = data.state || body.state || null;

      const finalName = incomingName || existingConv?.customer_name || null;
      const finalEmail = incomingEmail || existingConv?.customer_email || null;
      const finalPhone = incomingPhone || existingConv?.customer_phone || null;
      const finalAvatar = incomingAvatar || existingConv?.customer_avatar || null;
      const finalState = incomingState || existingConv?.status || "unresolved";

      // Handle both text and non-text customer message events
      let messageContent = "";
      if (typeof data.content === "string" && data.content.trim()) {
        messageContent = data.content.trim();
      } else if (data.content && typeof data.content === "object" && typeof data.content.text === "string" && data.content.text.trim()) {
        messageContent = data.content.text.trim();
      } else if (data.type === "file" || data.type === "attachment") {
        messageContent = "[File]";
      } else if (data.type === "animation" || data.type === "picker" || data.type === "image" || data.type === "media") {
        messageContent = "[Image]";
      } else if (data.type === "audio") {
        messageContent = "[Audio]";
      } else if (eventType.startsWith("message:")) {
        messageContent = "[Attachment]";
      }

      const isMessageEvent = eventType.startsWith("message:");
      const rawFrom = String(data.from || "user").toLowerCase();
      const isOperator = rawFrom === "operator";
      const isCustomerMessage = isMessageEvent && !isOperator;

      const currentUnread = Number(existingConv?.unread_count || 0);
      const updatedUnread = isCustomerMessage ? currentUnread + 1 : currentUnread;

      const sentAt = data.timestamp ? new Date(data.timestamp).toISOString() : new Date().toISOString();
      const lastMessage = isMessageEvent && messageContent ? messageContent : (existingConv?.last_message || null);
      const lastMessageAt = isMessageEvent && messageContent ? sentAt : (existingConv?.last_message_at || sentAt);

      // Set last_customer_unread_at ONLY on genuine incoming customer messages
      const lastCustomerUnreadAt = isCustomerMessage
        ? sentAt
        : (updatedUnread > 0 ? (existingConv?.last_customer_unread_at || sentAt) : null);

      // 4. Upsert conversation
      const { data: convData, error: convErr } = await supabase
        .from("crisp_conversations")
        .upsert(
          {
            crisp_website_id: websiteId,
            crisp_session_id: sessionId,
            customer_name: finalName,
            customer_email: finalEmail,
            customer_phone: finalPhone,
            customer_avatar: finalAvatar,
            status: finalState,
            last_message: lastMessage,
            last_message_at: lastMessageAt,
            last_customer_unread_at: lastCustomerUnreadAt,
            unread_count: updatedUnread,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "crisp_website_id,crisp_session_id" }
        )
        .select("id")
        .single();

      if (convErr) {
        throw new Error(`Error upserting crisp_conversations: ${convErr.message}`);
      }

      const conversationId = convData.id;

      // 5. Insert message into crisp_messages
      if (isMessageEvent && messageContent) {
        const crispMsgId = String(data.fingerprint || `${sessionId}_${sentAt}`);
        const senderType = isOperator ? "operator" : "customer";
        const direction = isOperator ? "outgoing" : "incoming";

        const { error: msgErr } = await supabase.from("crisp_messages").insert({
          conversation_id: conversationId,
          crisp_website_id: websiteId,
          crisp_session_id: sessionId,
          crisp_message_id: crispMsgId,
          sender_type: senderType,
          direction: direction,
          content: messageContent,
          message_type: data.type || "text",
          sent_at: sentAt,
          raw_payload: data,
        });

        if (msgErr && msgErr.code !== "23505") {
          console.error("Error inserting crisp_messages:", msgErr);
        }
      }

      // 6. Mark webhook event as processed: true
      if (webhookEventId) {
        await supabase
          .from("crisp_webhook_events")
          .update({ processed: true, error_log: null })
          .eq("id", webhookEventId);
      }

      return new Response(JSON.stringify({ status: "success", session_id: sessionId, website_id: websiteId }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (processErr: any) {
      console.error("Webhook processing error:", processErr);

      // Leave processed: false and record error_log
      if (webhookEventId) {
        await supabase
          .from("crisp_webhook_events")
          .update({ processed: false, error_log: processErr.message })
          .eq("id", webhookEventId);
      }

      return new Response(JSON.stringify({ error: processErr.message || "Webhook processing failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (err: any) {
    console.error("Crisp webhook error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
