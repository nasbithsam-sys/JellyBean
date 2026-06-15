import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ALLOWED_RAW_LEAD_ROLES = ["admin", "sub_admin", "processor", "acc_handler"] as const;

type RawLeadRole = (typeof ALLOWED_RAW_LEAD_ROLES)[number];

type RawLeadCacheRow = {
  row_key: string;
  data: Record<string, string>;
  lead: "yes" | "no" | null;
  phone: string | null;
  category: "forwarded" | "not_found" | "wrong" | null;
  captured_at: string | null;
  lead_link: string | null;
  sheet_row: number | null;
  assigned_to: string | null;
};

function normalizeLead(value: string | null): "yes" | "no" | null {
  return value === "yes" || value === "no" ? value : null;
}

function normalizeCategory(value: string | null): RawLeadCacheRow["category"] {
  return value === "forwarded" || value === "not_found" || value === "wrong" ? value : null;
}

function normalizeData(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, entry == null ? "" : String(entry)]),
  );
}

export const fetchRawLeadCache = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        limit: z.number().int().min(1).max(500).default(200),
        offset: z.number().int().min(0).default(0),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rolesData, error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (rolesError) throw new Error(rolesError.message);

    const roles = (rolesData ?? []).map((row) => row.role as string);
    const hasAllowedRole = roles.some((role): role is RawLeadRole =>
      ALLOWED_RAW_LEAD_ROLES.includes(role as RawLeadRole),
    );
    if (!hasAllowedRole) throw new Error("Forbidden: raw leads access required");

    const isAdmin = roles.includes("admin") || roles.includes("sub_admin");
    const columns = "row_key, data, lead, phone, category, captured_at, lead_link, sheet_row, assigned_to";

    const buildQuery = () => {
      let query = supabaseAdmin
        .from("raw_lead_cache")
        .select(columns)
        .order("captured_at", { ascending: false, nullsFirst: false })
        .range(data.offset, data.offset + data.limit);
      if (!isAdmin) query = query.or(`assigned_to.is.null,assigned_to.eq.${context.userId}`);
      return query;
    };

    const { data: latest, error } = await buildQuery();
    if (error) throw new Error(error.message);

    const merged = new Map<string, RawLeadCacheRow>();
    for (const entry of latest ?? []) {
      merged.set(entry.row_key, {
        row_key: entry.row_key,
        data: normalizeData(entry.data),
        lead: normalizeLead(entry.lead),
        phone: entry.phone,
        category: normalizeCategory(entry.category),
        captured_at: entry.captured_at,
        lead_link: entry.lead_link,
        sheet_row: entry.sheet_row,
        assigned_to: entry.assigned_to,
      });
    }

    const rows = Array.from(merged.values()).sort(
      (a, b) => new Date(b.captured_at ?? 0).getTime() - new Date(a.captured_at ?? 0).getTime(),
    );
    const entries = rows.slice(0, data.limit);
    return {
      entries,
      nextOffset: rows.length > data.limit ? data.offset + data.limit : null,
      hasMore: rows.length > data.limit,
    };
  });
