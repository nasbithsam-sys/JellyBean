import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type StateAssignmentRow = {
  state_code: string;
  state_name: string;
  assigned_cs_user_id: string;
  cs_user_name: string | null;
  cs_user_email: string | null;
  total_leads: number;
  updated_at: string;
};

export type StateAnalyticsRow = {
  state_code: string;
  state_name: string;
  assigned_cs_user_id: string;
  cs_user_name: string | null;
  total_leads: number;
  by_status: Record<string, number>;
};

export type CsUserTotalsRow = {
  cs_user_id: string;
  cs_user_name: string | null;
  cs_user_email: string | null;
  assigned_states: string[];
  total_leads: number;
  processed_leads: number;
  pending_leads: number;
  by_state: Record<string, number>;
  by_status: Record<string, number>;
};

async function requireAdmin(supabase: NonNullable<Awaited<ReturnType<typeof requireSupabaseAuth.server>>>["context"]["supabase"], userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "cs_admin"] as never);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("Forbidden");
}

export const listStateAssignments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase.rpc("list_state_assignments" as never);
    if (error) throw new Error(error.message);
    return (data ?? []) as StateAssignmentRow[];
  });

export const upsertStateAssignments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { assignments: { state_code: string; state_name: string; cs_user_id: string }[] }) => input)
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase, context.userId);
    if (data.assignments.length === 0) return { ok: true };
    const rows = data.assignments.map((a) => ({
      state_code: a.state_code,
      state_name: a.state_name,
      assigned_cs_user_id: a.cs_user_id,
      assigned_by: context.userId,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await context.supabase
      .from("state_assignments")
      .upsert(rows as never, { onConflict: "state_code" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeStateAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { state_code: string }) => input)
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("state_assignments")
      .delete()
      .eq("state_code", data.state_code);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getStateAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { from?: string | null; to?: string | null }) => input)
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase, context.userId);
    const { data: rows, error } = await context.supabase.rpc("state_assignment_analytics" as never, {
      _from: data.from ?? null,
      _to: data.to ?? null,
    } as never);
    if (error) throw new Error(error.message);
    return (rows ?? []) as StateAnalyticsRow[];
  });

export const getCsUserTotals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { from?: string | null; to?: string | null }) => input)
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase, context.userId);
    const { data: rows, error } = await context.supabase.rpc("cs_user_assignment_totals" as never, {
      _from: data.from ?? null,
      _to: data.to ?? null,
    } as never);
    if (error) throw new Error(error.message);
    return (rows ?? []) as CsUserTotalsRow[];
  });
