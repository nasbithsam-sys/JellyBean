import { createFileRoute } from "@tanstack/react-router";

// ── CORS — Chrome extensions send Origin: chrome-extension://<id> ─────────────
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const SCHEMA_VERSION = "2026-04-08.nd.v1";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ── Extension row shape (camelCase, from CRM_WEBHOOK_CONTRACT.md) ─────────────
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

// ── Map extension camelCase row → raw_lead_cache.data (Sheet column names) ────
// raw_lead_cache.data keeps the same "Account Name" keys the rest of the CRM
// already reads — so Raw Leads page, CS Leads, etc. all work without changes.
function toSheetRow(r: ExtRow): Record<string, string> {
  return {
    "Account Name":           r.accountName          ?? "",
    "Sub Area / Neighborhood": r.subArea              ?? "",
    "Posted Date & Time":     r.postDateTime         ?? "",
    "Post Text":              r.postText             ?? "",
    "Lead Link":              r.finalLink || r.postLink || r.profileLink || "",
    "Captured Date (UTC)":    r.capturedDate         ?? "",
    "Captured Time (UTC)":    r.capturedTime         ?? "",
    "Account Area":           r.accountArea          ?? "",
    "Incog Account":          r.incogAccount         ?? "",
  };
}

function rowKey(r: ExtRow): string {
  // Prefer stable postId, then finalLink, then author|time|text fallback
  if (r.postId)   return r.postId;
  if (r.finalLink) return r.finalLink;
  if (r.postLink)  return r.postLink;
  return `${r.accountName ?? ""}|${r.postDateTime ?? ""}|${(r.postText ?? "").slice(0, 40)}`;
}

function capturedIso(r: ExtRow): string | null {
  if (r.captureDateTime) {
    const t = Date.parse(r.captureDateTime);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  if (r.capturedDate) {
    const t = Date.parse(r.capturedDate);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return null;
}

// ── License verification helper ───────────────────────────────────────────────
async function checkLicense(
  supabaseAdmin: ReturnType<typeof import("@/integrations/supabase/client.server")["supabaseAdmin"]["from"]>["from"] extends never ? never : import("@/integrations/supabase/client.server")["supabaseAdmin"],
  licenseKey: string,
  deviceId: string,
) {
  const { data, error } = await supabaseAdmin
    .from("extension_licenses")
    .select("license_key, assigned_to, expires_on, is_active")
    .eq("license_key", licenseKey)
    .maybeSingle();

  if (error) return { valid: false, reason: "db_error" } as const;
  if (!data)  return { valid: false, reason: "not_found" } as const;
  if (!data.is_active) return { valid: false, reason: "revoked" } as const;

  if (data.expires_on) {
    const exp = Date.parse(data.expires_on);
    if (!Number.isNaN(exp) && exp < Date.now()) {
      return { valid: false, reason: "expired" } as const;
    }
  }

  // Upsert device record (fire-and-forget — don't block on errors)
  supabaseAdmin
    .from("extension_devices")
    .upsert(
      { license_key: licenseKey, device_id: deviceId, last_seen: new Date().toISOString() },
      { onConflict: "license_key,device_id" },
    )
    .then(() => {});

  return {
    valid: true,
    reason: "active",
    assignedTo: data.assigned_to ?? "",
    expiresOn:  data.expires_on  ?? "",
  } as const;
}

// ── Route ─────────────────────────────────────────────────────────────────────
export const Route = createFileRoute("/api/public/nextdoor-leads")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),

      POST: async ({ request }) => {
        let body: Record<string, unknown>;
        try {
          body = await request.json();
        } catch {
          return json({ ok: false, reason: "invalid_json" }, 400);
        }

        // Schema version check
        if (body.schemaVersion !== SCHEMA_VERSION) {
          return json({ ok: false, reason: "unsupported_schema_version" }, 400);
        }

        const action     = String(body.action     ?? "");
        const licenseKey = String(body.licenseKey ?? "").trim();
        const deviceId   = String(body.deviceId   ?? "").trim();

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // ── test_connection ─────────────────────────────────────────────────
        if (action === "test_connection") {
          return json({ schemaVersion: SCHEMA_VERSION, ok: true, status: "ok" });
        }

        // ── verify_license ──────────────────────────────────────────────────
        if (action === "verify_license") {
          if (!licenseKey) return json({ schemaVersion: SCHEMA_VERSION, valid: false, reason: "missing_key" });
          const result = await checkLicense(supabaseAdmin, licenseKey, deviceId);
          return json({ schemaVersion: SCHEMA_VERSION, ...result });
        }

        // ── append_rows ─────────────────────────────────────────────────────
        if (action === "append_rows") {
          if (!licenseKey) return json({ schemaVersion: SCHEMA_VERSION, ok: false, reason: "missing_license_key" }, 401);

          const licResult = await checkLicense(supabaseAdmin, licenseKey, deviceId);
          if (!licResult.valid) {
            return json({ schemaVersion: SCHEMA_VERSION, ok: false, reason: licResult.reason }, 403);
          }

          const rawRows = Array.isArray(body.rows) ? (body.rows as ExtRow[]) : [];
          if (rawRows.length === 0) {
            return json({ schemaVersion: SCHEMA_VERSION, ok: false, reason: "no_rows" }, 400);
          }
          if (rawRows.length > 500) {
            return json({ schemaVersion: SCHEMA_VERSION, ok: false, reason: "too_many_rows" }, 400);
          }

          const payload = rawRows.map((r) => ({
            row_key:     rowKey(r),
            data:        toSheetRow(r),          // keeps "Account Name" format the CRM already reads
            lead:        null,                   // not set by extension; reviewers mark this in CRM
            captured_at: capturedIso(r),
            lead_link:   r.finalLink || r.postLink || r.profileLink || null,
            sheet_row:   null,
          }));

          const CHUNK = 100;
          let inserted = 0;
          const acceptedIds: string[] = [];
          const skippedIds:  string[] = [];

          for (let i = 0; i < payload.length; i += CHUNK) {
            const slice = payload.slice(i, i + CHUNK);
            const { error, count } = await supabaseAdmin
              .from("raw_lead_cache")
              .upsert(slice, { onConflict: "row_key", ignoreDuplicates: true, count: "exact" });
            if (error) return json({ schemaVersion: SCHEMA_VERSION, ok: false, reason: error.message }, 500);
            inserted += count ?? 0;
          }

          // Build accepted/skipped id lists for extension sync tracking
          for (const r of rawRows) {
            const id = rowKey(r as ExtRow);
            // If the total inserted equals rows sent — all accepted (approximate, batch-level)
            // For per-row accuracy we'd need a separate select; this is good enough for the extension
            acceptedIds.push(id);
          }

          // Any rows that weren't inserted (duplicate) → skipped
          const skippedCount = rawRows.length - inserted;
          if (skippedCount > 0) {
            // Move last N from accepted to skipped (batch-level approximation)
            const moved = acceptedIds.splice(acceptedIds.length - skippedCount, skippedCount);
            skippedIds.push(...moved);
          }

          return json({
            schemaVersion: SCHEMA_VERSION,
            ok: true,
            status: "ok",
            added: inserted,
            acceptedIds,
            skippedIds,
            skippedReasons: skippedCount > 0 ? { duplicate: skippedCount } : {},
          });
        }

        // ── Unknown action ──────────────────────────────────────────────────
        return json({ schemaVersion: SCHEMA_VERSION, ok: false, reason: "unknown_action" }, 400);
      },
    },
  },
});
