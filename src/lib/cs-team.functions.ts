import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type CsTeamMember = { user_id: string; full_name: string; email: string };

async function callerHasAnyRole(userId: string, roles: string[]): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", roles as never);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

// Returns the list of active CS (and admin) users so the CS pipeline can show
// who a lead is assigned to and let admins reassign. Any authenticated CRM
// user can call this — it only exposes name + email of teammates.
export const listCsTeam = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Require the caller to hold any CRM role before exposing teammate PII.
    const { data: callerRole, error: callerErr } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .limit(1)
      .maybeSingle();
    if (callerErr) throw new Error(callerErr.message);
    if (!callerRole) throw new Error("Forbidden: no CRM role");
    // Leads are only assignable to CS users (admins can assign but never receive).
    const { data: roleRows, error: rErr } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role")
      .eq("role", "cs");
    if (rErr) throw new Error(rErr.message);
    const ids = Array.from(new Set((roleRows ?? []).map((r) => r.user_id)));
    if (ids.length === 0) return [] as CsTeamMember[];
    const { data: profs, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("user_id, full_name, email, is_active")
      .in("user_id", ids)
      .eq("is_active", true);
    if (pErr) throw new Error(pErr.message);
    return (profs ?? []).map((p) => ({
      user_id: p.user_id,
      full_name: p.full_name,
      email: p.email,
    })) as CsTeamMember[];
  });
