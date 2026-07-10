const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Webhook-Secret",
  "Access-Control-Max-Age": "86400",
};

import {
  extractNextdoorPostId,
  canonicalizeLeadLink,
} from "./lead-link-canonicalizer";

const SCHEMA_VERSION = "2026-04-08.nd.v1";

interface ExtRow {
  accountName?: string;
  subArea?: string;
  postDateTime?: string;
  postText?: string;
  profileLink?: string;
  postLink?: string;
  finalLink?: string;
  capturedDate?: string;
  capturedTime?: string;
  captureDateTime?: string;
  accountArea?: string;
  incogAccount?: string;
  postId?: string;
  sourceMode?: string;
  linkStatus?: string;
  linkAttempts?: number;
  [key: string]: unknown;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function toSheetRow(row: ExtRow): Record<string, string> {
  return {
    "Account Name": row.accountName || (row["Account Name"] as string) || "",
    "Sub Area / Neighborhood": row.subArea || (row["Sub Area / Neighborhood"] as string) || "",
    "Posted Date & Time": row.postDateTime || (row["Posted Date & Time"] as string) || "",
    "Post Text": row.postText || (row["Post Text"] as string) || "",
    "Lead Link": row.finalLink || row.postLink || row.profileLink || (row["Lead Link"] as string) || "",
    "Captured Date (UTC)": row.capturedDate || (row["Captured Date (UTC)"] as string) || "",
    "Captured Time (UTC)": row.capturedTime || (row["Captured Time (UTC)"] as string) || "",
    "Account Area": row.accountArea || (row["Account Area"] as string) || "",
    "Incog Account": row.incogAccount || (row["Incog Account"] as string) || "",
  };
}

function rowKey(row: ExtRow): string {
  if (row.postId) return row.postId;
  if (row.finalLink) return row.finalLink;
  if (row.postLink) return row.postLink;
  const name = row.accountName || (row["Account Name"] as string) || "";
  const posted = row.postDateTime || (row["Posted Date & Time"] as string) || "";
  const text = row.postText || (row["Post Text"] as string) || "";
  return `${name}|${posted}|${text.slice(0, 40)}`;
}

function capturedIso(row: ExtRow): string | null {
  const source = row.captureDateTime || row.capturedDate || row["Captured Date (UTC)"] || row["Captured Date"];
  if (!source) return new Date().toISOString(); // Fallback to current time so it stays at the top
  const time = Date.parse(String(source));
  return Number.isNaN(time) ? new Date().toISOString() : new Date(time).toISOString();
}

function uniqueRows(rows: ExtRow[]) {
  const seen = new Set<string>();
  const unique: Array<{ key: string; row: ExtRow }> = [];
  const duplicateKeys: string[] = [];

  for (const row of rows) {
    const key = rowKey(row);
    if (seen.has(key)) {
      duplicateKeys.push(key);
      continue;
    }
    seen.add(key);
    unique.push({ key, row });
  }

  return { unique, duplicateKeys };
}

async function loadSupabaseAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function errorReason(error: unknown) {
  return error instanceof Error ? error.message : "server_error";
}

async function logWebhookActivity(action: string, metadata: Record<string, unknown>) {
  try {
    const supabaseAdmin = await loadSupabaseAdmin();
    await supabaseAdmin.from("activity_logs").insert({
      actor_id: null,
      actor_name: "Nextdoor Scraper Webhook",
      actor_role: "system",
      action,
      entity_type: "raw_lead_cache",
      metadata: metadata as never,
    });
  } catch (err) {
    console.error("[Nextdoor webhook] Failed to log activity:", err);
  }
}

export function handleNextdoorLeadsOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function handleNextdoorLeadsPost(request: Request) {
  try {
    // Fail-closed: require the secret env var to be present. Prefer
    // NEXTDOOR_WEBHOOK_SECRET; fall back to WEBHOOK_SECRET for legacy setups.
    const webhookSecret = process.env.NEXTDOOR_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET;
    // Accept the secret from any of the historical locations the extension
    // has used, so older builds keep working without a URL/config change:
    //   - X-Webhook-Secret header (current)
    //   - X-Webhook-Token / X-Api-Key headers (legacy)
    //   - Authorization: Bearer <secret> (legacy)
    //   - ?secret= / ?token= query params (legacy)
    const url = new URL(request.url);
    const authHeader = request.headers.get("Authorization") || request.headers.get("authorization") || "";
    const bearer = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";
    const requestSecret =
      request.headers.get("X-Webhook-Secret") ||
      request.headers.get("x-webhook-secret") ||
      request.headers.get("X-Webhook-Token") ||
      request.headers.get("x-webhook-token") ||
      request.headers.get("X-Api-Key") ||
      request.headers.get("x-api-key") ||
      bearer ||
      url.searchParams.get("secret") ||
      url.searchParams.get("token") ||
      "";

    if (!webhookSecret) {
      console.error("[Nextdoor webhook] NEXTDOOR_WEBHOOK_SECRET is not configured");
      await logWebhookActivity("webhook_misconfigured", { reason: "secret_env_missing" });
      return json({ ok: false, reason: "server_misconfigured" }, 500);
    }

    let secretsMatch = false;
    if (requestSecret) {
      const a = Buffer.from(requestSecret);
      const b = Buffer.from(webhookSecret);
      if (a.length === b.length) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { timingSafeEqual } = await import("crypto");
          secretsMatch = timingSafeEqual(a, b);
        } catch {
          secretsMatch = requestSecret === webhookSecret;
        }
      }
    }
    if (!secretsMatch) {
      await logWebhookActivity("webhook_auth_failed", {
        reason: "secret_mismatch",
        received_present: !!requestSecret,
      });
      return json({ ok: false, reason: "unauthorized" }, 401);
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      await logWebhookActivity("webhook_parse_failed", { reason: "invalid_json" });
      return json({ ok: false, reason: "invalid_json" }, 400);
    }

    if (body.schemaVersion !== SCHEMA_VERSION) {
      await logWebhookActivity("webhook_schema_mismatch", {
        received: body.schemaVersion,
        expected: SCHEMA_VERSION,
      });
      return json({ ok: false, reason: "unsupported_schema_version" }, 400);
    }

    const action = String(body.action ?? "");

    if (action === "test_connection") {
      const supabaseAdmin = await loadSupabaseAdmin();
      const { error } = await supabaseAdmin
        .from("raw_lead_cache")
        .select("row_key", { count: "exact", head: true });
      if (error) {
        await logWebhookActivity("webhook_test_connection_failed", { error: error.message });
        return json({ schemaVersion: SCHEMA_VERSION, ok: false, reason: error.message }, 500);
      }
      await logWebhookActivity("webhook_test_connection_success", {});
      return json({ schemaVersion: SCHEMA_VERSION, ok: true, status: "ok" });
    }

    if (action !== "append_rows") {
      await logWebhookActivity("webhook_unknown_action", { action });
      return json({ ok: false, reason: "unknown_action" }, 400);
    }

    const rawRows = Array.isArray(body.rows) ? (body.rows as ExtRow[]) : [];
    if (rawRows.length === 0) {
      await logWebhookActivity("webhook_no_rows", {});
      return json({ ok: false, reason: "no_rows" }, 400);
    }
    if (rawRows.length > 500) {
      await logWebhookActivity("webhook_too_many_rows", { count: rawRows.length });
      return json({ ok: false, reason: "too_many_rows" }, 400);
    }

    const supabaseAdmin = await loadSupabaseAdmin();
    const { unique, duplicateKeys } = uniqueRows(rawRows);
    const payload = unique.map(({ key, row }) => {
      const rawLink = row.finalLink || row.postLink || row.profileLink || null;
      return {
        row_key: key,
        data: toSheetRow(row),
        lead: null,
        captured_at: capturedIso(row),
        lead_link: rawLink,
        sheet_row: null,
        canonical_post_id: extractNextdoorPostId(rawLink),
        canonical_lead_link: canonicalizeLeadLink(rawLink),
        duplicate_detected: false,
        duplicate_reason: null as string | null,
        duplicate_match_type: null as string | null,
        duplicate_key: null as string | null,
        duplicate_of_raw_lead_id: null as string | null,
        duplicate_of_qualified_lead_id: null as string | null,
      };
    });

    const chunkSize = 100;
    const acceptedIds: string[] = [];
    const dbSkippedIds: string[] = [];

    for (let index = 0; index < payload.length; index += chunkSize) {
      const slice = payload.slice(index, index + chunkSize);
      const keys = unique.slice(index, index + chunkSize).map(({ key }) => key);

      // --- DUPLICATE DETECTION START ---
      const postIds = Array.from(new Set(slice.map((r) => r.canonical_post_id).filter(Boolean))) as string[];
      const leadLinks = Array.from(new Set(slice.map((r) => r.canonical_lead_link).filter(Boolean))) as string[];

      let existingRawPostIdRows: any[] = [];
      let existingRawLinkRows: any[] = [];
      let existingQualPostIdRows: any[] = [];
      let existingQualLinkRows: any[] = [];

      // Bulk queries against raw_lead_cache
      if (postIds.length > 0) {
        const { data } = await supabaseAdmin
          .from("raw_lead_cache")
          .select("id, canonical_post_id, row_key")
          .in("canonical_post_id", postIds);
        if (data) existingRawPostIdRows = data;
      }
      if (leadLinks.length > 0) {
        const { data } = await supabaseAdmin
          .from("raw_lead_cache")
          .select("id, canonical_lead_link, row_key")
          .in("canonical_lead_link", leadLinks);
        if (data) existingRawLinkRows = data;
      }

      // Bulk queries against qualified_leads
      if (postIds.length > 0) {
        const { data } = await supabaseAdmin
          .from("qualified_leads")
          .select("id, canonical_post_id")
          .in("canonical_post_id", postIds);
        if (data) existingQualPostIdRows = data;
      }
      if (leadLinks.length > 0) {
        const { data } = await supabaseAdmin
          .from("qualified_leads")
          .select("id, canonical_lead_link")
          .in("canonical_lead_link", leadLinks);
        if (data) existingQualLinkRows = data;
      }

      for (const row of slice) {
        let isDup = false;

        // Priority 1: Canonical Post ID Match
        if (!isDup && row.canonical_post_id) {
          // Check qualified first (stronger historical match)
          const qMatch = existingQualPostIdRows.find((q) => q.canonical_post_id === row.canonical_post_id);
          if (qMatch) {
            isDup = true;
            row.duplicate_detected = true;
            row.duplicate_reason = "Same Nextdoor post ID (already forwarded)";
            row.duplicate_match_type = "post_id";
            row.duplicate_key = row.canonical_post_id;
            row.duplicate_of_qualified_lead_id = qMatch.id;
          } else {
            // Check raw lead cache (skip itself)
            const rMatch = existingRawPostIdRows.find(
              (r) => r.canonical_post_id === row.canonical_post_id && r.row_key !== row.row_key
            );
            if (rMatch) {
              isDup = true;
              row.duplicate_detected = true;
              row.duplicate_reason = "Same Nextdoor post ID";
              row.duplicate_match_type = "post_id";
              row.duplicate_key = row.canonical_post_id;
              row.duplicate_of_raw_lead_id = rMatch.id;
            }
          }
        }

        // Priority 2: Canonical Lead Link Match
        if (!isDup && row.canonical_lead_link) {
          const qMatch = existingQualLinkRows.find((q) => q.canonical_lead_link === row.canonical_lead_link);
          if (qMatch) {
            isDup = true;
            row.duplicate_detected = true;
            row.duplicate_reason = "Same canonical post link (already forwarded)";
            row.duplicate_match_type = "canonical_link";
            row.duplicate_key = row.canonical_lead_link;
            row.duplicate_of_qualified_lead_id = qMatch.id;
          } else {
            const rMatch = existingRawLinkRows.find(
              (r) => r.canonical_lead_link === row.canonical_lead_link && r.row_key !== row.row_key
            );
            if (rMatch) {
              isDup = true;
              row.duplicate_detected = true;
              row.duplicate_reason = "Same canonical post link";
              row.duplicate_match_type = "canonical_link";
              row.duplicate_key = row.canonical_lead_link;
              row.duplicate_of_raw_lead_id = rMatch.id;
            }
          }
        }

        // Priority 3 & 4 (Exact/90% Details Match) are bypassed for ingestion to save compute
        // and keep webhook fast as requested by user. We can safely rely on IDs/links for Nextdoor.
      }
      // --- DUPLICATE DETECTION END ---

      const { error } = await supabaseAdmin
        .from("raw_lead_cache")
        .upsert(slice, { onConflict: "row_key", ignoreDuplicates: true });

      if (error) {
        await logWebhookActivity("webhook_upsert_failed", { error: error.message });
        return json({ ok: false, reason: error.message }, 500);
      }

      // Determine which keys were actually inserted by checking which already existed
      const { data: existing } = await supabaseAdmin
        .from("raw_lead_cache")
        .select("row_key")
        .in("row_key", keys)
        .lt("created_at", new Date(Date.now() - 2000).toISOString());

      const existingSet = new Set((existing ?? []).map((r) => r.row_key));
      for (const key of keys) {
        if (existingSet.has(key)) dbSkippedIds.push(key);
        else acceptedIds.push(key);
      }
    }

    const skippedIds = [...dbSkippedIds, ...duplicateKeys];

    await logWebhookActivity("webhook_success", {
      added: acceptedIds.length,
      skipped: skippedIds.length,
      duplicate_keys: duplicateKeys.length,
      db_skipped_keys: dbSkippedIds.length,
    });

    return json({
      schemaVersion: SCHEMA_VERSION,
      ok: true,
      status: "ok",
      added: acceptedIds.length,
      acceptedIds,
      skippedIds,
      skippedReasons: skippedIds.length > 0 ? { duplicate: skippedIds.length } : {},
    });
  } catch (error) {
    console.error("[Nextdoor webhook]", error);
    await logWebhookActivity("webhook_fatal_error", {
      message: error instanceof Error ? error.message : String(error),
    });
    return json({ schemaVersion: SCHEMA_VERSION, ok: false, reason: errorReason(error) }, 500);
  }
}
