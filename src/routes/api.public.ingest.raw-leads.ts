import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// ── CORS ──────────────────────────────────────────────────────────────────────
// Chrome extensions send requests with Origin: chrome-extension://<id>.
// Browsers reject the response unless we echo CORS headers, so allow all.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ── Row shape (mirrors the Google Sheet columns) ──────────────────────────────
type SheetRow = Record<string, string> & {
  "Account Name"?: string;
  "Sub Area / Neighborhood"?: string;
  "Posted Date & Time"?: string;
  "Post Text"?: string;
  Lead?: string;
  "Lead Link"?: string;
  "Captured Date (UTC)"?: string;
  "Captured Time (UTC)"?: string;
  "Account Area"?: string;
  "Incog Account"?: string;
};

function keyFor(r: SheetRow): string {
  return (
    r["Lead Link"] ||
    `${r["Account Name"] ?? ""}|${r["Posted Date & Time"] ?? ""}|${(r["Post Text"] ?? "").slice(0, 40)}`
  );
}

function leadValueFromRow(r: SheetRow): "yes" | "no" | null {
  const raw = (r.Lead ?? "").trim().toLowerCase();
  if (raw === "yes" || raw === "y" || raw === "true") return "yes";
  if (raw === "no" || raw === "n" || raw === "false") return "no";
  return null;
}

function capturedIsoFromRow(r: SheetRow): string | null {
  const d = r["Captured Date (UTC)"];
  if (!d) return null;
  const t = Date.parse(d);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function normalizeRows(payload: unknown): SheetRow[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload as SheetRow[];
  if (typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.rows)) return obj.rows as SheetRow[];
    if (obj.row && typeof obj.row === "object") return [obj.row as SheetRow];
    // bare single-row object
    if ("Account Name" in obj || "Post Text" in obj || "Lead Link" in obj) {
      return [obj as SheetRow];
    }
  }
  return [];
}

export const Route = createFileRoute("/api/public/ingest/raw-leads")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),

      POST: async ({ request }) => {
        // ── Auth: validate Supabase bearer token ────────────────────────────
        const auth = request.headers.get("authorization") || "";
        const token = auth.replace(/^Bearer\s+/i, "").trim();
        if (!token) return json({ error: "Missing Bearer token" }, 401);

        const SUPABASE_URL = process.env.SUPABASE_URL!;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
        const userClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const { data: userData, error: userErr } = await userClient.auth.getUser(token);
        if (userErr || !userData.user) return json({ error: "Invalid token" }, 401);
        const userId = userData.user.id;

        // ── Authorization: user must be admin or scraping ───────────────────
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: roles, error: rolesErr } = await supabaseAdmin
          .from("user_roles")
          .select("role")
          .eq("user_id", userId);
        if (rolesErr) return json({ error: rolesErr.message }, 500);
        const allowed = (roles ?? []).some(
          (r) => r.role === "admin" || r.role === "scraping",
        );
        if (!allowed) return json({ error: "Forbidden: requires admin or scraping role" }, 403);

        // ── Parse & validate payload ────────────────────────────────────────
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: "Invalid JSON body" }, 400);
        }
        const rows = normalizeRows(body);
        if (rows.length === 0) {
          return json({ error: "No rows provided" }, 400);
        }
        if (rows.length > 500) {
          return json({ error: "Too many rows in one request (max 500)" }, 400);
        }

        // ── Upsert in chunks (ignore duplicates so existing edits stay) ─────
        const payload = rows.map((r) => ({
          row_key: keyFor(r),
          data: r,
          lead: leadValueFromRow(r),
          captured_at: capturedIsoFromRow(r),
          lead_link: r["Lead Link"] || null,
          sheet_row: null,
        }));

        const CHUNK = 100;
        let inserted = 0;
        for (let i = 0; i < payload.length; i += CHUNK) {
          const slice = payload.slice(i, i + CHUNK);
          const { error, count } = await supabaseAdmin
            .from("raw_lead_cache")
            .upsert(slice, { onConflict: "row_key", ignoreDuplicates: true, count: "exact" });
          if (error) return json({ error: error.message }, 500);
          inserted += count ?? 0;
        }

        return json({ ok: true, received: rows.length, inserted });
      },
    },
  },
});
