import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-crisp-signature, x-crisp-request-timestamp",
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

// Official Crisp Plugin Hook HMAC-SHA256 signature verification: [timestamp;body_as_string]
async function verifyCrispPluginSignature(secret: string, timestamp: string, rawBody: string, signature: string): Promise<boolean> {
  try {
    const signedPayload = `[${timestamp};${rawBody}]`;
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(signedPayload));
    
    // Convert to hex string
    const hexDigest = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Convert to base64 string
    const base64Digest = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

    return timingSafeEqual(signature, hexDigest) || timingSafeEqual(signature, base64Digest);
  } catch {
    return false;
  }
}

// Helper to fetch Crisp website details (name, domain, logo) via Crisp API GET /v1/website/{website_id}
async function fetchCrispWebsiteDetails(websiteId: string, authString: string, crispTier: string): Promise<{ name?: string; domain?: string; logo?: string } | null> {
  try {
    const res = await fetch(`https://api.crisp.chat/v1/website/${websiteId}`, {
      headers: {
        "Authorization": `Basic ${authString}`,
        "X-Crisp-Tier": crispTier,
      },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const data = json?.data || {};
    return {
      name: data.name || undefined,
      domain: data.domain || undefined,
      logo: data.logo || undefined,
    };
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const pluginTokenId = Deno.env.get("CRISP_PLUGIN_TOKEN_ID");
    const pluginTokenKey = Deno.env.get("CRISP_PLUGIN_TOKEN_KEY");
    const pluginHookSecret = Deno.env.get("CRISP_PLUGIN_HOOK_SECRET");
    const legacyWebhookSecret = Deno.env.get("CRISP_WEBHOOK_SECRET");
    const legacyWebsiteIdConfig = Deno.env.get("CRISP_WEBSITE_ID");

    const rawBody = await req.text();
    const url = new URL(req.url);
    const providedKey = url.searchParams.get("key");

    const crispSignature = req.headers.get("x-crisp-signature") || req.headers.get("X-Crisp-Signature");
    const crispTimestamp = req.headers.get("x-crisp-request-timestamp") || req.headers.get("X-Crisp-Request-Timestamp");

    let authMode: "plugin" | "legacy_website" | null = null;

    // 1. DETERMINE AUTH MODE
    if (crispSignature) {
      if (!pluginHookSecret || !crispTimestamp) {
        return new Response(
          JSON.stringify({ error: "Unauthorized: Missing plugin hook secret or timestamp header." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const isValidPluginSig = await verifyCrispPluginSignature(pluginHookSecret, crispTimestamp, rawBody, crispSignature);
      if (!isValidPluginSig) {
        return new Response(
          JSON.stringify({ error: "Unauthorized: Invalid Crisp plugin hook signature." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      authMode = "plugin";
    } else if (legacyWebhookSecret && providedKey) {
      if (timingSafeEqual(providedKey, legacyWebhookSecret)) {
        authMode = "legacy_website";
      } else {
        return new Response(
          JSON.stringify({ error: "Unauthorized: Invalid legacy webhook secret key." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    if (!authMode) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Webhook authentication missing or failed." }),
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
    const payloadWebsiteId = body.website_id || data.website_id;

    let websiteId = "";

    if (authMode === "plugin") {
      if (!payloadWebsiteId) {
        return new Response(JSON.stringify({ message: "No website_id in plugin payload, event ignored" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      websiteId = payloadWebsiteId;
    } else {
      if (!legacyWebsiteIdConfig) {
        return new Response(JSON.stringify({ error: "CRISP_WEBSITE_ID is not configured for legacy mode" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (payloadWebsiteId && payloadWebsiteId !== legacyWebsiteIdConfig) {
        return new Response(
          JSON.stringify({ error: "Legacy webhook secret can only be used for the configured CRISP_WEBSITE_ID" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      websiteId = legacyWebsiteIdConfig;
    }

    // 2. WORKSPACE MANAGEMENT ACCORDING TO AUTH MODE
    if (authMode === "plugin") {
      if (eventType === "plugin:subscription:updated") {
        const isBound = data.bound === true;
        
        if (isBound) {
          // Resolve real workspace name if plugin credentials are present
          let wsDetails: { name?: string; domain?: string; logo?: string } | null = null;
          if (pluginTokenId && pluginTokenKey) {
            const pluginAuth = btoa(`${pluginTokenId}:${pluginTokenKey}`);
            wsDetails = await fetchCrispWebsiteDetails(websiteId, pluginAuth, "plugin");
          }

          const { data: existingWs } = await supabase
            .from("crisp_workspaces")
            .select("installed_at, workspace_name, metadata")
            .eq("crisp_website_id", websiteId)
            .maybeSingle();

          const installedAt = existingWs?.installed_at || new Date().toISOString();
          const resolvedName = wsDetails?.name || existingWs?.workspace_name || null;
          const existingMeta = (existingWs?.metadata as Record<string, any>) || {};
          const newMeta = {
            ...existingMeta,
            ...(wsDetails?.domain ? { domain: wsDetails.domain } : {}),
            ...(wsDetails?.logo ? { logo: wsDetails.logo } : {}),
          };

          await supabase
            .from("crisp_workspaces")
            .upsert(
              {
                crisp_website_id: websiteId,
                workspace_name: resolvedName,
                connection_mode: "plugin",
                enabled: true,
                installed_at: installedAt,
                last_seen_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                metadata: newMeta,
              },
              { onConflict: "crisp_website_id" }
            );
        } else {
          await supabase
            .from("crisp_workspaces")
            .update({
              enabled: false,
              last_seen_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("crisp_website_id", websiteId);
        }

        return new Response(JSON.stringify({ status: "success", event: eventType, bound: isBound }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // For ordinary verified Plugin Hook events:
      const { data: existingWorkspace } = await supabase
        .from("crisp_workspaces")
        .select("id, enabled, workspace_name")
        .eq("crisp_website_id", websiteId)
        .maybeSingle();

      if (!existingWorkspace) {
        let wsDetails: { name?: string; domain?: string; logo?: string } | null = null;
        if (pluginTokenId && pluginTokenKey) {
          const pluginAuth = btoa(`${pluginTokenId}:${pluginTokenKey}`);
          wsDetails = await fetchCrispWebsiteDetails(websiteId, pluginAuth, "plugin");
        }

        await supabase
          .from("crisp_workspaces")
          .insert({
            crisp_website_id: websiteId,
            workspace_name: wsDetails?.name || null,
            connection_mode: "plugin",
            enabled: true,
            installed_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
            metadata: wsDetails ? { domain: wsDetails.domain, logo: wsDetails.logo } : {},
          });
      } else {
        await supabase
          .from("crisp_workspaces")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("crisp_website_id", websiteId);
      }
    }

    const sessionId = data.session_id || body.session_id;

    if (!sessionId) {
      return new Response(JSON.stringify({ status: "success", message: "Event processed (no session_id)" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fingerprint = data.fingerprint || data.timestamp || Date.now();
    const eventFingerprint = `${websiteId}_${eventType}_${sessionId}_${fingerprint}`;

    // 3. Log webhook event idempotently with website identity
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

    // 4. Fetch existing conversation to preserve customer details without overwriting with null
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

    // 5. Upsert conversation
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

    // 6. Insert ONLY real message events into crisp_messages
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

    return new Response(JSON.stringify({ status: "success", session_id: sessionId, website_id: websiteId, auth_mode: authMode }), {
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
