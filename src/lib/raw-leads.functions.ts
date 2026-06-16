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

const CATEGORY_FILTERS = ["all", "new", "forwarded", "not_found", "wrong"] as const;
type CategoryFilter = (typeof CATEGORY_FILTERS)[number];

export const fetchRawLeadCache = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        limit: z.number().int().min(1).max(500).default(100),
        offset: z.number().int().min(0).default(0),
        category: z.enum(CATEGORY_FILTERS).default("all"),
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
    const columns =
      "row_key, data, lead, phone, category, captured_at, lead_link, sheet_row, assigned_to";

    const applyCategory = <T extends { is: (...a: never[]) => T; eq: (...a: never[]) => T }>(
      query: T,
      category: CategoryFilter,
    ): T => {
      if (category === "new") return query.is("category" as never, null as never);
      if (category === "forwarded" || category === "not_found" || category === "wrong")
        return query.eq("category" as never, category as never);
      return query;
    };

    const applyAssignment = <T extends { or: (...a: never[]) => T }>(query: T): T => {
      if (isAdmin) return query;
      return query.or(`assigned_to.is.null,assigned_to.eq.${context.userId}` as never);
    };

    // Paged data
    let dataQuery = supabaseAdmin
      .from("raw_lead_cache")
      .select(columns)
      .order("captured_at", { ascending: false, nullsFirst: false })
      .range(data.offset, data.offset + data.limit - 1);
    dataQuery = applyCategory(dataQuery as never, data.category) as typeof dataQuery;
    dataQuery = applyAssignment(dataQuery as never) as typeof dataQuery;
    const { data: rows, error } = await dataQuery;
    if (error) throw new Error(error.message);

    // Counts per category (so the UI can paginate and show tab badges).
    const countFor = async (category: CategoryFilter) => {
      let q = supabaseAdmin
        .from("raw_lead_cache")
        .select("row_key", { count: "exact", head: true });
      q = applyCategory(q as never, category) as typeof q;
      q = applyAssignment(q as never) as typeof q;
      const { count, error: countError } = await q;
      if (countError) throw new Error(countError.message);
      return count ?? 0;
    };

    const [totalNew, totalForwarded, totalNotFound, totalWrong] = await Promise.all([
      countFor("new"),
      countFor("forwarded"),
      countFor("not_found"),
      countFor("wrong"),
    ]);

    const totalForCategory =
      data.category === "new"
        ? totalNew
        : data.category === "forwarded"
          ? totalForwarded
          : data.category === "not_found"
            ? totalNotFound
            : data.category === "wrong"
              ? totalWrong
              : totalNew + totalForwarded + totalNotFound + totalWrong;

    const entries: RawLeadCacheRow[] = (rows ?? []).map((entry) => ({
      row_key: entry.row_key,
      data: normalizeData(entry.data),
      lead: normalizeLead(entry.lead),
      phone: entry.phone,
      category: normalizeCategory(entry.category),
      captured_at: entry.captured_at,
      lead_link: entry.lead_link,
      sheet_row: entry.sheet_row,
      assigned_to: entry.assigned_to,
    }));

    return {
      entries,
      totalCount: totalForCategory,
      counts: {
        new: totalNew,
        forwarded: totalForwarded,
        not_found: totalNotFound,
        wrong: totalWrong,
      },
      pageSize: data.limit,
      offset: data.offset,
      hasMore: data.offset + entries.length < totalForCategory,
      nextOffset:
        data.offset + entries.length < totalForCategory ? data.offset + data.limit : null,
    };
  });
