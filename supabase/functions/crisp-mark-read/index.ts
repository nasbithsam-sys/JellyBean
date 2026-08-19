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
      return new Response(JSON.stringify({ error: "Server configuration missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const conversationId = String(body.conversationId || "").trim();

    if (!conversationId) {
      return new Response(JSON.stringify({ error: "conversationId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Fetch conversation details
    const { data: conv, error: convErr } = await supabase
      .from("crisp_conversations")
      .select("id, crisp_website_id, crisp_session_id")
      .eq("id", conversationId)
      .maybeSingle();

    if (convErr || !conv) {
      return new Response(JSON.stringify({ error: "Conversation not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const websiteId = conv.crisp_website_id;
    const sessionId = conv.crisp_session_id;

    // 2. Fetch workspace secret reference from Vault
    const { data: ws, error: wsErr } = await supabase
      .from("crisp_workspaces")
      .select("credential_secret_id")
      .eq("crisp_website_id", websiteId)
      .maybeSingle();

    if (wsErr || !ws?.credential_secret_id) {
      return new Response(JSON.stringify({ error: "Workspace secret reference missing" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: secretData, error: secretErr } = await supabase.rpc("crisp_get_workspace_secret", {
      p_secret_id: ws.credential_secret_id,
    });

    const tokenId = (secretData as any)?.token_id || (secretData as any)?.tokenId;
    const tokenKey = (secretData as any)?.token_key || (secretData as any)?.tokenKey;

    if (secretErr || !tokenId || !tokenKey) {
      return new Response(JSON.stringify({ error: "Vault credentials missing or invalid" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Call Crisp REST API to mark conversation as read for operator
    const auth = btoa(`${tokenId}:${tokenKey}`);
    const crispRes = await fetch(`https://api.crisp.chat/v1/website/${websiteId}/conversation/${sessionId}/read`, {
      method: "PATCH",
      headers: {
        Authorization: `Basic ${auth}`,
        "X-Crisp-Tier": "website",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ read: { operator: true } }),
    });

    if (!crispRes.ok) {
      const errJson = await crispRes.json().catch(() => ({}));
      const reason = errJson?.reason || errJson?.data?.message || `HTTP ${crispRes.status}`;
      console.error(`Crisp mark-read API failed for session ${sessionId}:`, reason);
      return new Response(JSON.stringify({ error: `Crisp API error: ${reason}` }), {
        status: crispRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Update Supabase crisp_conversations: unread_count = 0, last_customer_unread_at = null
    const { error: updErr } = await supabase
      .from("crisp_conversations")
      .update({
        unread_count: 0,
        last_customer_unread_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId);

    if (updErr) {
      return new Response(JSON.stringify({ error: `Database update failed: ${updErr.message}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ status: "success", session_id: sessionId, website_id: websiteId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Crisp mark-read error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
