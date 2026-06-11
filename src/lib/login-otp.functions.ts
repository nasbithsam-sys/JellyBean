import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { randomInt } from "crypto";
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

function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

const OTP_MAX_AGE_MS = 72 * 60 * 60 * 1000; // 72 hours

// Admin: generate (or rotate) the one-time login code for a user
export const adminRotateLoginOtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = adminClient();
    await ensureRequesterIsAdmin(admin, context.userId);
    const code = newCode();
    const { error } = await admin
      .from("profiles")
      .update({ login_otp: code, login_otp_updated_at: new Date().toISOString() })
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    return { code };
  });

// Called by the user during login (after password) to consume their one-time code.
// On success the code is rotated to a fresh value that only admin can see.
export const consumeLoginOtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ code: z.string().trim().min(4).max(12) }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = adminClient();
    const { data: prof, error } = await admin
      .from("profiles")
      .select("login_otp, login_otp_updated_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!prof?.login_otp) throw new Error("No login code issued. Ask an admin.");
    const issuedAt = prof.login_otp_updated_at ? new Date(prof.login_otp_updated_at) : null;
    if (!issuedAt || Date.now() - issuedAt.getTime() > OTP_MAX_AGE_MS) {
      throw new Error("Login code has expired. Ask an admin to generate a new one.");
    }
    if (prof.login_otp !== data.code.trim()) throw new Error("Invalid code");
    // Rotate to a new one-time code so it can't be reused, and record server-side verification
    const next = newCode();
    const nowIso = new Date().toISOString();
    const { error: uErr } = await admin
      .from("profiles")
      .update({
        login_otp: next,
        login_otp_updated_at: nowIso,
        otp_verified_at: nowIso,
      })
      .eq("user_id", context.userId);
    if (uErr) throw new Error(uErr.message);
    return { ok: true };
  });

// Admin: read a user's current code (so admin can hand it to them)
export const adminGetLoginOtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = adminClient();
    await ensureRequesterIsAdmin(admin, context.userId);
    const { data: prof, error } = await admin
      .from("profiles")
      .select("login_otp, login_otp_updated_at")
      .eq("user_id", data.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { code: prof?.login_otp ?? null, updatedAt: prof?.login_otp_updated_at ?? null };
  });

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

// Server-side check that the current session has completed OTP (when required).
// Compares otp_verified_at against the JWT iat so each fresh sign-in must re-verify.
export const requireOtpVerified = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = adminClient();
    const { data: prof, error } = await admin
      .from("profiles")
      .select("otp_required, otp_verified_at, is_active")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!prof) throw new Error("Profile not found");
    if (!prof.is_active) throw new Error("Account inactive");

    const { data: roles, error: rErr } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (rErr) throw new Error(rErr.message);
    const roleList = (roles ?? []).map((r) => r.role as string);
    const { data: settings } = await admin
      .from("app_settings")
      .select("admin_otp_required")
      .maybeSingle();
    const isAdmin = roleList.includes("admin");
    // Only CS still requires the one-time login code on every sign-in.
    // Scraping, processor and acc_handler sign in with just username + password.
    const roleNeedsOtp = roleList.includes("cs");
    const adminNeedsOtp = isAdmin && Boolean(settings?.admin_otp_required);
    // Respect explicit profile opt-out (otp_required = false) even for CS,
    // matching the client-side login gate.
    const needsOtp =
      prof.otp_required === true ||
      adminNeedsOtp ||
      (roleNeedsOtp && prof.otp_required !== false);
    if (!needsOtp) return { ok: true as const };

    const iatSec = Number((context.claims as { iat?: number } | null)?.iat ?? 0);
    const verifiedMs = prof.otp_verified_at ? Date.parse(prof.otp_verified_at) : 0;
    if (!verifiedMs || verifiedMs < iatSec * 1000) {
      throw new Error("OTP verification required");
    }
    return { ok: true as const };
  });
