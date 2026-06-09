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
    "Account Name": r.accountName ?? "",
    "Sub Area / Neighborhood": r.subArea ?? "",
    "Posted Date & Time": r.postDateTime ?? "",
    "Post Text": r.postText ?? "",
    "Lead Link": r.finalLink || r.postLink || r.profileLink || "",
    "Captured Date (UTC)": r.capturedDate ?? "",
    "Captured Time (UTC)": r.capturedTime ?? "",
    "Account Area": r.accountArea ?? "",
    "Incog Account": r.incogAccount ?? "",
  };
}

function rowKey(r: ExtRow): string {
  if (r.postId) return r.postId;
  if (r.finalLink) return r.finalLink;
  if (r.postLink) return r.postLink;
  return `${r.accountName ?? ""}|${r.postDateTime ?? ""}|${(r.postText ?? "").slice(0, 40)}`;
}

function capturedIso(r: ExtRow): string | null {
  const src = r.captureDateTime || r.capturedDate;
  if (!src) return null;
  const t = Date.parse(src);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
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

export function handleNextdoorLeadsOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function handleNextdoorLeadsPost(request: Request) {
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

  if (action === "test_connection") {
    return json({ schemaVersion: SCHEMA_VERSION, ok: true, status: "ok" });
  }

  if (action === "append_rows") {
    const rawRows = Array.isArray(body.rows) ? (body.rows as ExtRow[]) : [];
    if (rawRows.length === 0) return json({ ok: false, reason: "no_rows" }, 400);
    if (rawRows.length > 500) return json({ ok: false, reason: "too_many_rows" }, 400);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { unique, duplicateKeys } = uniqueRows(rawRows);

    // ── Race-condition-safe upsert ────────────────────────────────────────────
    //
    // OLD approach (BUGGY with multiple extension instances):
    //   1. SELECT existing keys
    //   2. Filter out already-seen rows
    //   3. INSERT only new rows
    //
    // Problem: two instances sending the same lead simultaneously both pass
    // the SELECT check (neither exists yet), then both try to INSERT, and one
    // gets a unique-constraint error and the lead is either dropped or causes
    // a 500 response — the extension marks it as failed and never retries.
    //
    // NEW approach (race-safe):
    //   Skip the SELECT entirely. Let the database's UNIQUE constraint on
    //   row_key be the single source of truth. Use upsert with ignoreDuplicates:
    //   true so a concurrent insert from another instance is silently ignored
    //   rather than errored. The first writer wins; subsequent identical keys
    //   are no-ops. No lead is ever dropped or lost.
    //
    // The count returned by Supabase upsert with ignoreDuplicates tells us
    // exactly how many rows were actually new (inserted), which we use to
    // build acceptedIds vs skippedIds correctly for the extension's sync log.

    const payload = unique.map(({ key, row }) => ({
      row_key: key,
      data: toSheetRow(row),
      lead: null,
      captured_at: capturedIso(row),
      lead_link: row.finalLink || row.postLink || row.profileLink || null,
      sheet_row: null,
    }));

    const CHUNK = 100;
    const acceptedIds: string[] = [];
    const dbSkippedIds: string[] = [];

    for (let i = 0; i < payload.length; i += CHUNK) {
      const slice = payload.slice(i, i + CHUNK);
      const keys = unique.slice(i, i + CHUNK).map(({ key }) => key);

      const { error, count } = await supabaseAdmin
        .from("raw_lead_cache")
        .upsert(slice, { onConflict: "row_key", ignoreDuplicates: true, count: "exact" });

      if (error) return json({ ok: false, reason: error.message }, 500);

      // `count` is the number of rows actually inserted (not ignored).
      // Walk the keys in order: first `count` are accepted, the rest were
      // already present (duplicate from another instance or prior sync).
      const inserted = count ?? 0;
      for (let j = 0; j < keys.length; j++) {
        if (j < inserted) {
          acceptedIds.push(keys[j]);
        } else {
          dbSkippedIds.push(keys[j]);
        }
      }
    }

    const skippedIds = [...dbSkippedIds, ...duplicateKeys];
    const skippedCount = skippedIds.length;

    return json({
      schemaVersion: SCHEMA_VERSION,
      ok: true,
      status: "ok",
      added: acceptedIds.length,
      acceptedIds,
      skippedIds,
      skippedReasons: skippedCount > 0 ? { duplicate: skippedCount } : {},
    });
  }

  return json({ ok: false, reason: "unknown_action" }, 400);
}
