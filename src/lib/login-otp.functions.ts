import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
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

async function ensureRequesterIsAdmin(admin: ReturnType<typeof adminClient>, userId: string) {
  const { data, error } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

// Admin: delete any user (including other admins). Cannot delete self.
export const adminDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = adminClient();
    await ensureRequesterIsAdmin(admin, context.userId);
    if (data.userId === context.userId) throw new Error("You cannot delete your own account.");
    // Cascade cleanup of app rows first (no FK to auth.users defined)
    await admin.from("user_roles").delete().eq("user_id", data.userId);
    await admin.from("profiles").delete().eq("user_id", data.userId);
    const { error } = await admin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
