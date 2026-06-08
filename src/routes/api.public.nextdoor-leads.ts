import { createFileRoute } from "@tanstack/react-router";

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

function toSheetRow(r: ExtRow): Record<string, string> {
  return {
    "Account Name":            r.accountName  ?? "",
    "Sub Area / Neighborhood": r.subArea      ?? "",
    "Posted Date & Time":      r.postDateTime ?? "",
    "Post Text":               r.postText     ?? "",
    "Lead Link":               r.finalLink || r.postLink || r.profileLink || "",
    "Captured Date (UTC)":     r.capturedDate ?? "",
    "Captured Time (UTC)":     r.capturedTime ?? "",
    "Account Area":            r.accountArea  ?? "",
    "Incog Account":           r.incogAccount ?? "",
  };
}

function rowKey(r: ExtRow): string {
  if (r.postId)    return r.postId;
  if (r.finalLink) return r.finalLink;
  if (r.postLink)  return r.postLink;
  return `${r.accountName ?? ""}|${r.postDateTime ?? ""}|${(r.postText ?? "").slice(0, 40)}`;
}

function capturedIso(r: ExtRow): string | null {
  const src = r.captureDateTime || r.capturedDate;
  if (!src) return null;
  const t = Date.parse(src);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

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

        if (body.schemaVersion !== SCHEMA_VERSION) {
          return json({ ok: false, reason: "unsupported_schema_version" }, 400);
        }

        const action = String(body.action ?? "");

        // ── test_connection ────────────────────────────────────────────────
        if (action === "test_connection") {
          return json({ schemaVersion: SCHEMA_VERSION, ok: true, status: "ok" });
        }

        // ── append_rows ────────────────────────────────────────────────────
        if (action === "append_rows") {
          const rawRows = Array.isArray(body.rows) ? (body.rows as ExtRow[]) : [];
          if (rawRows.length === 0)  return json({ ok: false, reason: "no_rows" }, 400);
          if (rawRows.length > 500)  return json({ ok: false, reason: "too_many_rows" }, 400);

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const payload = rawRows.map((r) => ({
            row_key:     rowKey(r),
            data:        toSheetRow(r),
            lead:        null,
            captured_at: capturedIso(r),
            lead_link:   r.finalLink || r.postLink || r.profileLink || null,
            sheet_row:   null,
          }));

          const CHUNK = 100;
          let inserted = 0;

          for (let i = 0; i < payload.length; i += CHUNK) {
            const slice = payload.slice(i, i + CHUNK);
            const { error, count } = await supabaseAdmin
              .from("raw_lead_cache")
              .upsert(slice, { onConflict: "row_key", ignoreDuplicates: true, count: "exact" });
            if (error) return json({ ok: false, reason: error.message }, 500);
            inserted += count ?? 0;
          }

          const skippedCount = rawRows.length - inserted;
          const acceptedIds  = rawRows.slice(0, inserted).map((r) => rowKey(r));
          const skippedIds   = rawRows.slice(inserted).map((r) => rowKey(r));

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

        return json({ ok: false, reason: "unknown_action" }, 400);
      },
    },
  },
});
