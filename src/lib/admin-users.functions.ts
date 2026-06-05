import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

const roleSchema = z.enum(["admin", "marketing", "cs"]);

const createUserSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255),
  username: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-zA-Z0-9._-]+$/)
    .optional(),
  password: z.string().min(8).max(128),
  role: roleSchema,
  isActive: z.boolean().default(true),
});

function deriveUsername(email: string): string {
  const base =
    email
      .split("@")[0]
      .replace(/[^a-zA-Z0-9._-]/g, "")
      .slice(0, 50) || "user";
  return base;
}

function adminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing server Supabase credentials");
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function ensureRequesterIsAdmin(userId: string) {
  const admin = adminClient();
  const { data, error } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

// Bootstrap: allow creating the FIRST admin only when zero users exist.
export const bootstrapFirstAdmin = createServerFn({ method: "POST" })
  .inputValidator((input) => createUserSchema.parse(input))
  .handler(async ({ data }) => {
    const admin = adminClient();
    // Count existing profiles
    const { count, error: countErr } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true });
    if (countErr) throw new Error(countErr.message);
    if ((count ?? 0) > 0) throw new Error("Bootstrap is closed; users already exist.");

    // Force the bootstrap role to admin no matter what was passed
    return await createUserInternal({ ...data, role: "admin" });
  });

// Admin-only user creation
export const adminCreateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createUserSchema.parse(input))
  .handler(async ({ data, context }) => {
    await ensureRequesterIsAdmin(context.userId);
    return await createUserInternal(data);
  });

// Admin-only deactivate
export const adminSetActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ userId: z.string().uuid(), isActive: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await ensureRequesterIsAdmin(context.userId);
    const admin = adminClient();
    const { error } = await admin
      .from("profiles")
      .update({ is_active: data.isActive })
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    // Also ban/unban auth user
    await admin.auth.admin.updateUserById(data.userId, {
      ban_duration: data.isActive ? "none" : "876000h",
    });
    return { ok: true };
  });

// Admin-only password reset (sets a new password directly)
export const adminResetPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ userId: z.string().uuid(), newPassword: z.string().min(8).max(128) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await ensureRequesterIsAdmin(context.userId);
    const admin = adminClient();
    const { error } = await admin.auth.admin.updateUserById(data.userId, {
      password: data.newPassword,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

async function createUserInternal(data: z.infer<typeof createUserSchema>) {
  const admin = adminClient();

  // Auto-derive username from the email local-part if none was provided, and
  // ensure it's unique by suffixing a number if necessary.
  let username = (data.username ?? deriveUsername(data.email)).toLowerCase();
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = attempt === 0 ? username : `${username}${attempt}`;
    const { data: dupe } = await admin
      .from("profiles")
      .select("id")
      .eq("username", candidate)
      .maybeSingle();
    if (!dupe) {
      username = candidate;
      break;
    }
    if (attempt === 19) throw new Error("Could not generate a unique username from this email.");
  }

  // Create auth user (email auto-confirmed)
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: data.email,
    password: data.password,
    email_confirm: true,
    user_metadata: { full_name: data.fullName, username },
    ban_duration: data.isActive ? "none" : "876000h",
  });
  if (createErr || !created.user) throw new Error(createErr?.message ?? "Failed to create user");

  const userId = created.user.id;

  // Create profile
  const { error: profErr } = await admin.from("profiles").insert({
    user_id: userId,
    full_name: data.fullName,
    username,
    email: data.email,
    is_active: data.isActive,
  });
  if (profErr) {
    await admin.auth.admin.deleteUser(userId);
    throw new Error(profErr.message);
  }

  // Assign role
  const { error: roleErr } = await admin.from("user_roles").insert({
    user_id: userId,
    role: data.role,
  });
  if (roleErr) {
    await admin.auth.admin.deleteUser(userId);
    throw new Error(roleErr.message);
  }

  return { ok: true, userId };
}
