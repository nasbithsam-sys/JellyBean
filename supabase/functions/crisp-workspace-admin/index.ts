import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Generate 32-byte random hex string for webhook secret
function generateWebhookSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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

    // STRICT ROLE CHECK: admin ONLY
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
    if (!roles.includes("admin")) {
      return new Response(
        JSON.stringify({ error: "Forbidden: Workspace management is restricted to JellyBean admin users only." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const action = String(body.action || "").toLowerCase();

    // 1. ADD WORKSPACE
    if (action === "add_workspace") {
      const websiteId = String(body.website_id || body.websiteId || "").trim();
      const tokenId = String(body.token_id || body.tokenId || "").trim();
      const tokenKey = String(body.token_key || body.tokenKey || "").trim();

      if (!websiteId || !tokenId || !tokenKey) {
        return new Response(
          JSON.stringify({ error: "Website ID, Token Identifier, and Token Key are required." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // VALIDATE CREDENTIALS AGAINST CRISP API BEFORE SAVING
      const authString = btoa(`${tokenId}:${tokenKey}`);
      const crispTestRes = await fetch(`https://api.crisp.chat/v1/website/${websiteId}`, {
        headers: {
          "Authorization": `Basic ${authString}`,
          "X-Crisp-Tier": "website",
        },
      });

      if (!crispTestRes.ok) {
        const errJson = await crispTestRes.json().catch(() => ({}));
        console.error("[Crisp Admin] Credential validation failed:", crispTestRes.status, errJson);
        return new Response(
          JSON.stringify({ error: "Crisp rejected the Website Token for this workspace. Please check Website ID, Token Identifier, and Token Key." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const crispData = await crispTestRes.json();
      const wsInfo = crispData?.data || {};
      const workspaceName = wsInfo.name || null;
      const domain = wsInfo.domain || null;
      const logo = wsInfo.logo || null;

      const webhookSecret = generateWebhookSecret();

      // Store in Vault via SQL helper
      const { data: secretId, error: vaultErr } = await supabase.rpc("crisp_create_workspace_secret", {
        p_website_id: websiteId,
        p_token_id: tokenId,
        p_token_key: tokenKey,
        p_webhook_secret: webhookSecret,
      });

      if (vaultErr) {
        console.error("[Crisp Admin] Error creating vault secret:", vaultErr);
        return new Response(
          JSON.stringify({ error: `Failed to store workspace credentials in Vault: ${vaultErr.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Upsert crisp_workspaces record
      const { data: wsRecord, error: wsErr } = await supabase
        .from("crisp_workspaces")
        .upsert(
          {
            crisp_website_id: websiteId,
            workspace_name: workspaceName,
            enabled: true,
            credential_secret_id: secretId,
            installed_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            metadata: { domain, logo },
          },
          { onConflict: "crisp_website_id" }
        )
        .select()
        .single();

      if (wsErr) {
        console.error("[Crisp Admin] Error upserting workspace:", wsErr);
        return new Response(
          JSON.stringify({ error: `Failed to save workspace record: ${wsErr.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const projectRef = supabaseUrl.replace("https://", "").split(".")[0];
      const webhookUrl = `https://${projectRef}.supabase.co/functions/v1/crisp-webhook?key=${webhookSecret}`;

      return new Response(
        JSON.stringify({
          ok: true,
          workspace: wsRecord,
          workspace_name: workspaceName || `Workspace • ${websiteId.slice(0, 5)}`,
          webhook_url: webhookUrl,
          webhook_secret: webhookSecret,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. REGENERATE WEBHOOK SECRET
    if (action === "regenerate_webhook_secret") {
      const websiteId = String(body.website_id || body.websiteId || "").trim();
      if (!websiteId) {
        return new Response(JSON.stringify({ error: "website_id is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: wsRecord, error: fetchErr } = await supabase
        .from("crisp_workspaces")
        .select("credential_secret_id")
        .eq("crisp_website_id", websiteId)
        .single();

      if (fetchErr || !wsRecord || !wsRecord.credential_secret_id) {
        return new Response(JSON.stringify({ error: "Workspace credential record not found in Vault" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: secretData } = await supabase.rpc("crisp_get_workspace_secret", {
        p_secret_id: wsRecord.credential_secret_id,
      });

      const currentTokenId = secretData?.token_id || "";
      const currentTokenKey = secretData?.token_key || "";
      const newSecret = generateWebhookSecret();

      await supabase.rpc("crisp_update_workspace_secret", {
        p_secret_id: wsRecord.credential_secret_id,
        p_token_id: currentTokenId,
        p_token_key: currentTokenKey,
        p_webhook_secret: newSecret,
      });

      const projectRef = supabaseUrl.replace("https://", "").split(".")[0];
      const webhookUrl = `https://${projectRef}.supabase.co/functions/v1/crisp-webhook?key=${newSecret}`;

      return new Response(
        JSON.stringify({
          ok: true,
          webhook_url: webhookUrl,
          webhook_secret: newSecret,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. TOGGLE WORKSPACE ENABLED
    if (action === "toggle_workspace_enabled") {
      const websiteId = String(body.website_id || body.websiteId || "").trim();
      const enabled = Boolean(body.enabled);

      if (!websiteId) {
        return new Response(JSON.stringify({ error: "website_id is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error: updateErr } = await supabase
        .from("crisp_workspaces")
        .update({ enabled, updated_at: new Date().toISOString() })
        .eq("crisp_website_id", websiteId);

      if (updateErr) {
        return new Response(JSON.stringify({ error: updateErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ ok: true, enabled }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Crisp Workspace Admin Error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
