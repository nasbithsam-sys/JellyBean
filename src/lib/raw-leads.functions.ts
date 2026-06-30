import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ALLOWED_RAW_LEAD_ROLES = ["admin", "sub_admin", "maturing", "acc_handler"] as const;

type RawLeadRole = (typeof ALLOWED_RAW_LEAD_ROLES)[number];

type RawLeadCacheRow = {
  row_key: string;
  data: Record<string, string>;
  lead: "yes" | "no" | null;
  phone: string | null;
  category: "forwarded" | "not_found" | "wrong" | "duplicate" | null;
  captured_at: string | null;
  lead_link: string | null;
  sheet_row: number | null;
  assigned_to: string | null;
  assigned_myself_at: string | null;
};

function normalizeLead(value: string | null): "yes" | "no" | null {
  return value === "yes" || value === "no" ? value : null;
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

const CATEGORY_FILTERS = ["all", "new", "forwarded", "not_found", "wrong", "duplicate", "assigned_myself"] as const;
type CategoryFilter = (typeof CATEGORY_FILTERS)[number];
const DUPLICATE_LOOKBACK_HOURS = 72;

function normalizePhoneDigits(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

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
      "row_key, data, lead, phone, category, captured_at, lead_link, sheet_row, assigned_to, assigned_myself_at";

    const applyCategory = <T extends {
      is: (...a: never[]) => T;
      eq: (...a: never[]) => T;
      not: (...a: never[]) => T;
    }>(
      query: T,
      category: CategoryFilter,
    ): T => {
      if (category === "new") {
        // Exclude categorised rows AND self-assigned rows (they belong in Assigned Myself).
        return query
          .is("category" as never, null as never)
          .is("assigned_myself_at" as never, null as never);
      }
      if (
        category === "forwarded" ||
        category === "not_found" ||
        category === "wrong" ||
        category === "duplicate"
      )
        return query.eq("category" as never, category as never);
      return query;
    };

    const applyAssignment = <T extends { or: (...a: never[]) => T; eq: (...a: never[]) => T }>(
      query: T,
      category: CategoryFilter,
    ): T => {
      // "Assigned Myself" tab: show only leads assigned to the current user.
      if (category === "assigned_myself")
        return query.eq("assigned_to" as never, context.userId as never);
      if (isAdmin) return query;
      // For other tabs, non-admins see unassigned + their own leads.
      return query.or(`assigned_to.is.null,assigned_to.eq.${context.userId}` as never);
    };

    // Paged data
    let dataQuery = supabaseAdmin
      .from("raw_lead_cache")
      .select(columns)
      .order("captured_at", { ascending: false, nullsFirst: false })
      .range(data.offset, data.offset + data.limit - 1);
    // For assigned_myself tab: show leads self-assigned by the user that are
    // still active (category IS NULL = not yet forwarded/wrong/etc.).
    if (data.category === "assigned_myself") {
      dataQuery = dataQuery
        .eq("assigned_to" as never, context.userId as never)
        .not("assigned_myself_at" as never, "is" as never, null as never)
        .is("category" as never, null as never) as typeof dataQuery;
    } else {
      dataQuery = applyCategory(dataQuery as never, data.category) as typeof dataQuery;
      dataQuery = applyAssignment(dataQuery as never, data.category) as typeof dataQuery;
    }
    const { data: rows, error } = await dataQuery;
    if (error) throw new Error(error.message);

    const { data: countRows, error: countError } = await supabaseAdmin.rpc(
      "raw_lead_cache_category_counts" as never,
      { _user_id: context.userId, _is_admin: isAdmin } as never,
    );
    if (countError) throw new Error(countError.message);
    const counts = (
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
    const totalNew = counts.new ?? 0;
    const totalForwarded = counts.forwarded ?? 0;
    const totalNotFound = counts.not_found ?? 0;
    const totalWrong = counts.wrong ?? 0;
    const totalDuplicate = counts.duplicate ?? 0;

    // Count self-assigned leads that are still active (not yet categorized).
    // Only count rows where assigned_myself_at IS NOT NULL so old pre-feature
    // assignments are excluded.
    const { count: assignedMyselfCount, error: assignedCountError } = await supabaseAdmin
      .from("raw_lead_cache")
      .select("row_key", { count: "exact", head: true })
      .eq("assigned_to", context.userId)
      .not("assigned_myself_at", "is", null)
      .is("category", null);
    if (assignedCountError) throw new Error(assignedCountError.message);
    const totalAssignedMyself = assignedMyselfCount ?? 0;

    const totalForCategory =
      data.category === "new"
        ? totalNew
        : data.category === "forwarded"
          ? totalForwarded
          : data.category === "not_found"
            ? totalNotFound
            : data.category === "wrong"
              ? totalWrong
              : data.category === "duplicate"
                ? totalDuplicate
                : data.category === "assigned_myself"
                  ? totalAssignedMyself
                  : totalNew + totalForwarded + totalNotFound + totalWrong + totalDuplicate;

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
      assigned_myself_at: (entry as Record<string, unknown>).assigned_myself_at as string | null ?? null,
    }));

    return {
      entries,
      totalCount: totalForCategory,
      counts: {
        new: totalNew,
        forwarded: totalForwarded,
        not_found: totalNotFound,
        wrong: totalWrong,
        duplicate: totalDuplicate,
        assigned_myself: totalAssignedMyself,
      },
      pageSize: data.limit,
      offset: data.offset,
      hasMore: data.offset + entries.length < totalForCategory,
      nextOffset: data.offset + entries.length < totalForCategory ? data.offset + data.limit : null,
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
    ).map((row) => ({
      id: row.id,
      customer_name: row.customer_name,
      customer_number: row.customer_number,
      customer_number_2: row.customer_number_2,
      assigned_at: row.assigned_at,
    }));

    return { duplicate: matches.length > 0, matches };
  });
