import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizePhone } from "./crm-lite";
import type { RawLeadCursorDirection } from "./raw-leads-pagination";

const ALLOWED_RAW_LEAD_ROLES = [
  "admin",
  "sub_admin",
  "scraping",
  "maturing",
  "acc_handler",
] as const;

type RawLeadRole = (typeof ALLOWED_RAW_LEAD_ROLES)[number];

export type RawLeadCacheRow = {
  id?: string;
  row_key: string;
  data: Record<string, string>;
  lead: "yes" | "no" | "review" | null;
  phone: string | null;
  category: "forwarded" | "not_found" | "wrong" | "duplicate" | null;
  captured_at: string | null;
  lead_link: string | null;
  sheet_row: number | null;
  assigned_to: string | null;
  assigned_myself_at: string | null;
  duplicate_detected?: boolean | null;
  duplicate_reason?: string | null;
  duplicate_match_type?: string | null;
  duplicate_key?: string | null;
  duplicate_of_raw_lead_id?: string | null;
  duplicate_of_qualified_lead_id?: string | null;
  canonical_post_id?: string | null;
  canonical_lead_link?: string | null;
};

export type CacheEntry = RawLeadCacheRow;

function normalizeLead(value: string | null): "yes" | "no" | "review" | null {
  return value === "yes" || value === "no" || value === "review" ? value : null;
}

function normalizeCategory(value: string | null): RawLeadCacheRow["category"] {
  return value === "forwarded" ||
    value === "not_found" ||
    value === "wrong" ||
    value === "duplicate"
    ? value
    : null;
}

function normalizeData(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, entry == null ? "" : String(entry)]),
  );
}

const CATEGORY_FILTERS = [
  "all",
  "new",
  "review",
  "forwarded",
  "not_found",
  "wrong",
  "duplicate",
  "assigned_myself",
] as const;
const DUPLICATE_LOOKBACK_HOURS = 48;

const LEAD_FILTERS = ["all", "yes", "no", "review"] as const;

const DUPLICATE_FILTERS = ["all", "duplicates", "unique"] as const;

const cursorSchema = z
  .object({
    captured_at: z.string().nullable(),
    id: z.string().uuid(),
  })
  .nullable()
  .default(null);

// Alias for local readability — canonical implementation is in crm-lite.
const normalizePhoneDigits = normalizePhone;

export const fetchRawLeadCache = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        limit: z.number().int().min(1).max(500).default(500),
        direction: z.enum(["first", "next", "previous", "last"]).default("first"),
        cursor: cursorSchema,
        expectedLastPageSize: z.number().int().min(0).max(500).optional(),
        category: z.enum(CATEGORY_FILTERS).default("all"),
        query: z.string().max(120).default(""),
        leadFilter: z.enum(LEAD_FILTERS).default("all"),
        areaFilter: z.string().max(120).default("all"),
        duplicateFilter: z.enum(DUPLICATE_FILTERS).default("all"),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    
    const { data: rolesData, error: rolesError } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (rolesError) throw new Error(rolesError.message);

    const roles = (rolesData ?? []).map((row) => row.role as string);
    const hasAllowedRole = roles.some((role): role is RawLeadRole =>
      ALLOWED_RAW_LEAD_ROLES.includes(role as RawLeadRole),
    );
    if (!hasAllowedRole) throw new Error("Forbidden: raw leads access required");

    const pageSize =
      data.direction === "last" && typeof data.expectedLastPageSize === "number"
        ? data.expectedLastPageSize
        : data.limit;
    const { data: rows, error } = await context.supabase.rpc(
      "get_raw_leads_cursor_page" as never,
      {
        p_area: data.areaFilter,
        p_category: data.category,
        p_cursor_captured_at: data.cursor?.captured_at ?? null,
        p_cursor_id: data.cursor?.id ?? null,
        p_direction: data.direction as RawLeadCursorDirection,
        p_duplicate_filter: data.duplicateFilter,
        p_lead_filter: data.leadFilter,
        p_page_size: pageSize,
        p_search: data.query,
      } as never,
    );
    if (error) throw new Error(error.message);

    const entries: RawLeadCacheRow[] = ((rows ?? []) as Array<Record<string, unknown>>).map((entry) => ({
      row_key: entry.row_key,
      id: (entry as Record<string, unknown>).id as string,
      data: normalizeData(entry.data),
      lead: normalizeLead(entry.lead as string | null),
      phone: entry.phone as string | null,
      category: normalizeCategory(entry.category as string | null),
      captured_at: entry.captured_at as string | null,
      lead_link: entry.lead_link as string | null,
      sheet_row: entry.sheet_row as number | null,
      assigned_to: entry.assigned_to as string | null,
      assigned_myself_at: (entry as Record<string, unknown>).assigned_myself_at as string | null ?? null,
      duplicate_detected: ((entry as Record<string, unknown>).duplicate_detected as boolean | null) ?? null,
      duplicate_reason: ((entry as Record<string, unknown>).duplicate_reason as string | null) ?? null,
      duplicate_match_type: ((entry as Record<string, unknown>).duplicate_match_type as string | null) ?? null,
      duplicate_key: ((entry as Record<string, unknown>).duplicate_key as string | null) ?? null,
      duplicate_of_raw_lead_id: ((entry as Record<string, unknown>).duplicate_of_raw_lead_id as string | null) ?? null,
      duplicate_of_qualified_lead_id: ((entry as Record<string, unknown>).duplicate_of_qualified_lead_id as string | null) ?? null,
      canonical_post_id: ((entry as Record<string, unknown>).canonical_post_id as string | null) ?? null,
      canonical_lead_link: ((entry as Record<string, unknown>).canonical_lead_link as string | null) ?? null,
    }));

    return {
      entries,
      counts: {
        new: 0,
        forwarded: 0,
        not_found: 0,
        wrong: 0,
        duplicate: 0,
        assigned_myself: 0,
      },
      pageSize: data.limit,
      hasMore: entries.length === data.limit,
    };
  });

export const fetchRawLeadTotal = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        category: z.enum(CATEGORY_FILTERS).default("all"),
        query: z.string().max(120).default(""),
        leadFilter: z.enum(LEAD_FILTERS).default("all"),
        areaFilter: z.string().max(120).default("all"),
        duplicateFilter: z.enum(DUPLICATE_FILTERS).default("all"),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { data: rolesData, error: rolesError } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (rolesError) throw new Error(rolesError.message);

    const roles = (rolesData ?? []).map((row) => row.role as string);
    const hasAllowedRole = roles.some((role): role is RawLeadRole =>
      ALLOWED_RAW_LEAD_ROLES.includes(role as RawLeadRole),
    );
    if (!hasAllowedRole) throw new Error("Forbidden: raw leads access required");

    const { data: rows, error } = await context.supabase.rpc(
      "count_raw_leads_filtered" as never,
      {
        p_category: data.category,
        p_area: data.areaFilter,
        p_lead_filter: data.leadFilter,
        p_duplicate_filter: data.duplicateFilter,
        p_search: data.query,
      } as never,
    );
    if (error) throw new Error(error.message);
    return { totalCount: Number(rows ?? 0) };
  });

export const fetchRawLeadCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({}).parse(input ?? {}))
  .handler(async ({ context }) => {
    
    const { data: rolesData, error: rolesError } = await context.supabase
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

    const { data: countRows, error: countError } = await context.supabase.rpc(
      "raw_lead_cache_category_counts" as never,
      { _user_id: context.userId, _is_admin: isAdmin } as never,
    );
    if (countError) throw new Error(countError.message);

    const baseCounts = (
      countRows as unknown as Array<{
        new: number | null;
        forwarded: number | null;
        not_found: number | null;
        wrong: number | null;
        duplicate: number | null;
      }> | null
    )?.[0] ?? {
      new: 0,
      forwarded: 0,
      not_found: 0,
      wrong: 0,
      duplicate: 0,
    };

    // Count matches the list query: every uncategorized lead is "New",
    // regardless of who has self-assigned it. Keeps the tab badge in sync
    // with what the user actually sees in the list.
    const newAdjustedQuery = context.supabase
      .from("raw_lead_cache")
      .select("row_key", { count: "exact", head: true })
      .is("category", null)
      .is("assigned_myself_at", null);
    // Draft raw leads (parked by the current user) are hidden from the
    // Assigned Myself tab, so the badge must exclude them too.
    const { data: draftRowsForCounts } = await context.supabase
      .from("lead_drafts" as never)
      .select("source_lead_id")
      .eq("created_by" as never, context.userId as never)
      .eq("source_type" as never, "raw_lead" as never)
      .not("source_lead_id" as never, "is" as never, null as never);
    const draftedIdsForCounts = ((draftRowsForCounts ?? []) as Array<{ source_lead_id: string | null }>)
      .map((r) => r.source_lead_id)
      .filter((v): v is string => !!v);
    let assignedMyselfQuery = context.supabase
      .from("raw_lead_cache")
      .select("row_key", { count: "exact", head: true })
      .eq("assigned_to", context.userId)
      .not("assigned_myself_at", "is", null)
      .is("category", null);
    if (draftedIdsForCounts.length) {
      assignedMyselfQuery = assignedMyselfQuery.not(
        "id" as never,
        "in" as never,
        `(${draftedIdsForCounts.join(",")})` as never,
      ) as typeof assignedMyselfQuery;
    }
    const [
      { count: adjustedNewCount, error: adjustedNewCountError },
      { count: assignedMyselfCount, error: assignedMyselfCountError },
    ] = await Promise.all([newAdjustedQuery, assignedMyselfQuery]);

    if (adjustedNewCountError) throw new Error(adjustedNewCountError.message);
    if (assignedMyselfCountError) throw new Error(assignedMyselfCountError.message);

    return {
      new: adjustedNewCount ?? 0,
      review: 0,
      forwarded: baseCounts.forwarded ?? 0,
      not_found: baseCounts.not_found ?? 0,
      wrong: baseCounts.wrong ?? 0,
      duplicate: baseCounts.duplicate ?? 0,
      assigned_myself: assignedMyselfCount ?? 0,
    };
  });

export const checkDuplicatePhone = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        phone: z.string().default(""),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const target = normalizePhoneDigits(data.phone);
    if (target.length < 7) return { duplicate: false, matches: [] };

    // The RPC is SECURITY DEFINER and already enforces that the caller has a
    // role row. Call it with the authenticated user's client so any signed-in
    // user (submitter, facebook, seo, maturing, acc_handler, admin) can run
    // the duplicate check from the lead form.
    void context.userId;
    const duplicateSince = new Date(
      Date.now() - DUPLICATE_LOOKBACK_HOURS * 60 * 60 * 1000,
    ).toISOString();
    const { data: rows, error } = await context.supabase.rpc(
      "check_qualified_lead_phone_duplicates" as never,
      { _phone_digits: target, _since: duplicateSince } as never,
    );
    if (error) throw new Error(error.message);

    const matches = (
      (rows as unknown as Array<{
        id: string;
        customer_name: string;
        customer_number: string;
        customer_number_2: string | null;
        assigned_at: string;
      }> | null) ?? []
    )
      .slice(0, 10)
      .map((row) => ({
        id: row.id,
        customer_name: row.customer_name,
        customer_number: row.customer_number,
        customer_number_2: row.customer_number_2,
        assigned_at: row.assigned_at,
      }));

    const ids = matches.map((row) => row.id);
    const { data: details, error: detailsError } =
      ids.length === 0
        ? { data: [], error: null }
        : await context.supabase
            .from("qualified_leads")
            .select("id, service, context, main_area, sub_area, original_lead_link")
            .in("id", ids);
    if (detailsError) throw new Error(detailsError.message);

    const detailsById = new Map(
      ((details as Array<{
        id: string;
        service: string | null;
        context: string | null;
        main_area: string | null;
        sub_area: string | null;
        original_lead_link: string | null;
      }> | null) ?? []
      ).map((detail) => [detail.id, detail]),
    );

    return {
      duplicate: matches.length > 0,
      matches: matches.map((match) => {
        const detail = detailsById.get(match.id);
        return {
          ...match,
          service: detail?.service ?? null,
          context: detail?.context ?? null,
          main_area: detail?.main_area ?? null,
          sub_area: detail?.sub_area ?? null,
          original_lead_link: detail?.original_lead_link ?? null,
        };
      }),
    };
  });
