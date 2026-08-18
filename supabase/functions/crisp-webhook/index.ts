import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-crisp-signature, x-crisp-request-timestamp",
};

// HMAC-SHA256 signature verification for Crisp Plugin Hooks
async function verifyCrispSignature(secret: string, timestamp: string, rawBody: string, signature: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    // Crisp signature is computed on concatenated string: timestamp + rawBody or rawBody
    // Crisp calculates HMAC-SHA256 over rawBody (or timestamp + rawBody)
    const signedData = encoder.encode(rawBody);
    const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, signedData);
    
    // Convert buffer to hex string
    const hexDigest = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Convert buffer to base64 string
    const base64Digest = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

    return signature === hexDigest || signature === base64Digest;
  } catch {
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const pluginHookSecret = Deno.env.get("CRISP_PLUGIN_HOOK_SECRET");
    const legacyWebhookSecret = Deno.env.get("CRISP_WEBHOOK_SECRET");

    const rawBody = await req.text();
    const url = new URL(req.url);
    const providedKey = url.searchParams.get("key");

    const crispSignature = req.headers.get("x-crisp-signature") || req.headers.get("X-Crisp-Signature");
    const crispTimestamp = req.headers.get("x-crisp-request-timestamp") || req.headers.get("X-Crisp-Request-Timestamp");

    let isAuthorized = false;

    // A) Verify Crisp Plugin Hook Signature if secret & headers exist
    if (pluginHookSecret && crispSignature) {
      if (crispTimestamp) {
        isAuthorized = await verifyCrispSignature(pluginHookSecret, crispTimestamp, rawBody, crispSignature);
      }
    }

    // B) Temporary Legacy Website Hook ?key= fallback if signature validation didn't pass
    if (!isAuthorized && legacyWebhookSecret) {
      if (providedKey && providedKey === legacyWebhookSecret) {
        isAuthorized = true;
      }
    }

    // C) If neither plugin secret nor legacy secret is configured, require one
    if (!pluginHookSecret && !legacyWebhookSecret) {
      console.error("Neither CRISP_PLUGIN_HOOK_SECRET nor CRISP_WEBHOOK_SECRET is configured.");
      return new Response(
        JSON.stringify({ error: "Server configuration missing: Crisp webhook secret is not configured." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!isAuthorized) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Invalid Crisp webhook signature or key parameter." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(JSON.stringify({ error: "Server configuration missing" }), {
        status: 500,
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
    const websiteId = body.website_id || data.website_id || Deno.env.get("CRISP_WEBSITE_ID");

    if (!websiteId) {
      return new Response(JSON.stringify({ message: "No website_id in payload, event ignored" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Auto-register or update crisp_workspaces
    if (eventType === "plugin:subscription:updated") {
      const isBound = data.bound === true;
      await supabase
        .from("crisp_workspaces")
        .upsert(
          {
            crisp_website_id: websiteId,
            enabled: isBound,
            last_seen_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "crisp_website_id" }
        );
      return new Response(JSON.stringify({ status: "success", event: eventType, bound: isBound }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ensure workspace record exists & update last_seen_at
    await supabase
      .from("crisp_workspaces")
      .upsert(
        {
          crisp_website_id: websiteId,
          enabled: true,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "crisp_website_id" }
      );

    const sessionId = data.session_id || body.session_id;

    if (!sessionId) {
      return new Response(JSON.stringify({ status: "success", message: "Workspace registered/updated" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fingerprint = data.fingerprint || data.timestamp || Date.now();
    const eventFingerprint = `${websiteId}_${eventType}_${sessionId}_${fingerprint}`;

    // 2. Log webhook event idempotently
    const { error: webhookLogErr } = await supabase
      .from("crisp_webhook_events")
      .insert({
        crisp_website_id: websiteId,
        event_fingerprint: eventFingerprint,
        event_type: eventType,
        payload: body,
        processed: true,
      });

    if (webhookLogErr && webhookLogErr.code === "23505") {
      return new Response(JSON.stringify({ status: "ignored", message: "Duplicate webhook event" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Fetch existing conversation to preserve customer details without overwriting with null
    const { data: existingConv } = await supabase
      .from("crisp_conversations")
      .select("id, customer_name, customer_email, customer_phone, customer_avatar, last_message, last_message_at, status")
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
          updated_at: new Date().toISOString(),
        },
        { onConflict: "crisp_website_id,crisp_session_id" }
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

    // 5. Insert ONLY real message events into crisp_messages
    if (isMessageEvent && messageContent.trim()) {
      const crispMsgId = String(data.fingerprint || `${sessionId}_${sentAt}`);
      const rawFrom = String(data.from || "user").toLowerCase();
      const isOperator = rawFrom === "operator";
      const senderType = isOperator ? "operator" : "customer";
      const direction = isOperator ? "outgoing" : "incoming";

      const { error: msgErr } = await supabase.from("crisp_messages").insert({
        conversation_id: conversationId,
        crisp_website_id: websiteId,
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

    return new Response(JSON.stringify({ status: "success", session_id: sessionId, website_id: websiteId }), {
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
