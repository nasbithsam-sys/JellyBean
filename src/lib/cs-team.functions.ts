import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

function adminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing server Supabase credentials");
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type CsTeamMember = { user_id: string; full_name: string; email: string };

// Returns the list of active CS (and admin) users so the CS pipeline can show
// who a lead is assigned to and let admins reassign. Any authenticated CRM
// user can call this — it only exposes name + email of teammates.
export const listCsTeam = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const admin = adminClient();
    // Leads are only assignable to CS users (admins can assign but never receive).
    const { data: roleRows, error: rErr } = await admin
      .from("user_roles")
      .select("user_id, role")
      .eq("role", "cs");
    if (rErr) throw new Error(rErr.message);
    const ids = Array.from(new Set((roleRows ?? []).map((r) => r.user_id)));
    if (ids.length === 0) return [] as CsTeamMember[];
    const { data: profs, error: pErr } = await admin
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
