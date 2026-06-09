const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

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
    "Account Name": row.accountName ?? "",
    "Sub Area / Neighborhood": row.subArea ?? "",
    "Posted Date & Time": row.postDateTime ?? "",
    "Post Text": row.postText ?? "",
    "Lead Link": row.finalLink || row.postLink || row.profileLink || "",
    "Captured Date (UTC)": row.capturedDate ?? "",
    "Captured Time (UTC)": row.capturedTime ?? "",
    "Account Area": row.accountArea ?? "",
    "Incog Account": row.incogAccount ?? "",
  };
}

function rowKey(row: ExtRow): string {
  if (row.postId) return row.postId;
  if (row.finalLink) return row.finalLink;
  if (row.postLink) return row.postLink;
  return `${row.accountName ?? ""}|${row.postDateTime ?? ""}|${(row.postText ?? "").slice(0, 40)}`;
}

function capturedIso(row: ExtRow): string | null {
  const source = row.captureDateTime || row.capturedDate;
  if (!source) return null;
  const time = Date.parse(source);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
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

export function handleNextdoorLeadsOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function handleNextdoorLeadsPost(request: Request) {
  try {
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
      const supabaseAdmin = await loadSupabaseAdmin();
      const { error } = await supabaseAdmin
        .from("raw_lead_cache")
        .select("row_key", { count: "exact", head: true });
      if (error) {
        return json({ schemaVersion: SCHEMA_VERSION, ok: false, reason: error.message }, 500);
      }
      return json({ schemaVersion: SCHEMA_VERSION, ok: true, status: "ok" });
    }

    if (action !== "append_rows") {
      return json({ ok: false, reason: "unknown_action" }, 400);
    }

    const rawRows = Array.isArray(body.rows) ? (body.rows as ExtRow[]) : [];
    if (rawRows.length === 0) return json({ ok: false, reason: "no_rows" }, 400);
    if (rawRows.length > 500) return json({ ok: false, reason: "too_many_rows" }, 400);

    const supabaseAdmin = await loadSupabaseAdmin();
    const { unique, duplicateKeys } = uniqueRows(rawRows);
    const payload = unique.map(({ key, row }) => ({
      row_key: key,
      data: toSheetRow(row),
      lead: null,
      captured_at: capturedIso(row),
      lead_link: row.finalLink || row.postLink || row.profileLink || null,
      sheet_row: null,
    }));

    const chunkSize = 100;
    const acceptedIds: string[] = [];
    const dbSkippedIds: string[] = [];

    for (let index = 0; index < payload.length; index += chunkSize) {
      const slice = payload.slice(index, index + chunkSize);
      const keys = unique.slice(index, index + chunkSize).map(({ key }) => key);
      const { error, count } = await supabaseAdmin
        .from("raw_lead_cache")
        .upsert(slice, { onConflict: "row_key", ignoreDuplicates: true, count: "exact" });

      if (error) {
        return json({ ok: false, reason: error.message }, 500);
      }

      const inserted = count ?? 0;
      for (let offset = 0; offset < keys.length; offset++) {
        if (offset < inserted) acceptedIds.push(keys[offset]);
        else dbSkippedIds.push(keys[offset]);
      }
    }

    const skippedIds = [...dbSkippedIds, ...duplicateKeys];

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
    return json({ schemaVersion: SCHEMA_VERSION, ok: false, reason: errorReason(error) }, 500);
  }
}
