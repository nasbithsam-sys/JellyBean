import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { consumeLoginOtp } from "@/lib/login-otp.functions";

type LoginProfile = {
  is_active: boolean;
};

type LoginSettings = {
  admin_otp_required: boolean;
};

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const consumeOtp = useServerFn(consumeLoginOtp);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [otpRequired, setOtpRequired] = useState(false);
  const [code, setCode] = useState("");

  // Already signed in? If they still owe an OTP, ask; otherwise route to app.
  useEffect(() => {
    void (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) return;
      const access = await getLoginAccess(sess.session.user.id);
      if (!access.isActive) {
        await supabase.auth.signOut();
        toast.error("Your account is inactive. Please contact an administrator.");
        return;
      }
      if (access.needsOtp) setOtpRequired(true);
      else navigate({ to: "/app" });
    })();
  }, [navigate]);

  async function getLoginAccess(uid: string): Promise<{ isActive: boolean; needsOtp: boolean }> {
    const [{ data: profile }, { data: rolesData }, { data: settings }] = await Promise.all([
      supabase.from("profiles").select("is_active, otp_required").eq("user_id", uid).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", uid),
      supabase.from("app_settings").select("admin_otp_required").maybeSingle(),
    ]);
    const roles = (rolesData ?? []).map((r) => r.role as string);
    const isAdmin = roles.includes("admin");
    // Only CS still requires the one-time login code.
    // Scraping, processor and acc_handler sign in with just username + password.
    const roleNeedsOtp = roles.includes("cs");
    const adminNeedsOtp =
      isAdmin && Boolean((settings as LoginSettings | null)?.admin_otp_required);
    // If the user's profile explicitly opts out (otp_required = false), respect that
    // even for CS. Only force OTP when their profile flag is true OR they're admin
    // with admin_otp_required, OR they're CS without an explicit opt-out.
    const profileOtp = (profile as (LoginProfile & { otp_required?: boolean }) | null)?.otp_required;
    const needsOtp =
      profileOtp === true ||
      adminNeedsOtp ||
      (roleNeedsOtp && profileOtp !== false);
    return {
      isActive: (profile as LoginProfile | null)?.is_active ?? false,
      needsOtp,
    };
  }

  async function resolveEmail(id: string): Promise<string | null> {
    const trimmed = id.trim();
    if (trimmed.includes("@")) return trimmed;
    const { data, error } = await supabase.rpc("email_for_username", { _username: trimmed });
    if (error) return null;
    return (data as string | null) ?? null;
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const email = await resolveEmail(identifier);
      if (!email) {
        toast.error("No account found for that email or username");
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        toast.error(error.message);
        return;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const access = await getLoginAccess(user.id);
        if (!access.isActive) {
          await supabase.auth.signOut();
          toast.error("Your account is inactive. Please contact an administrator.");
          return;
        }
        if (access.needsOtp) {
          setOtpRequired(true);
          return;
        }
      }
      navigate({ to: "/app" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOtpVerify(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await consumeOtp({ data: { code: code.trim() } });
      navigate({ to: "/app" });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 relative overflow-hidden">
      <div className="w-full max-w-sm relative animate-fade-in-up">
        <div className="mb-6 flex flex-col items-start border-l-[3px] border-primary pl-3">
          <div className="h-10 w-10 rounded-sm border border-border bg-card grid place-items-center">
            <span className="text-[13px] font-mono font-semibold text-primary">LG</span>
          </div>
          <h1 className="text-[22px] font-semibold tracking-normal mt-4">Leadgrid access</h1>
          <p className="text-[12px] text-muted-foreground mt-1 font-mono uppercase tracking-wide">
            Field Ops Console
          </p>
        </div>
        {otpRequired ? (
          <form onSubmit={handleOtpVerify} className="glass-card p-6 space-y-4 ring-glow">
            <div>
              <Label
                htmlFor="otp"
                className="text-[12px] uppercase tracking-wide text-muted-foreground font-medium"
              >
                One-time login code
              </Label>
              <Input
                id="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123 456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={6}
                className="mt-2 tracking-[0.4em] text-center text-lg h-12 font-mono"
              />
              <p className="text-[11.5px] text-muted-foreground mt-2 text-center">
                Ask your admin for the current 6-digit code. It rotates after every use.
              </p>
            </div>
            <Button type="submit" className="w-full h-10" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Verify
            </Button>
          </form>
        ) : (
          <form onSubmit={handleSignIn} className="glass-card p-6 space-y-4 ring-glow">
            <div>
              <Label
                htmlFor="id"
                className="text-[12px] uppercase tracking-wide text-muted-foreground font-medium"
              >
                Email or username
              </Label>
              <Input
                id="id"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                className="mt-2 h-10"
              />
            </div>
            <div>
              <Label
                htmlFor="pw"
                className="text-[12px] uppercase tracking-wide text-muted-foreground font-medium"
              >
                Password
              </Label>
              <Input
                id="pw"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="mt-2 h-10"
              />
            </div>
            <Button
              type="submit"
              className="w-full h-10 shadow-md hover:shadow-lg"
              disabled={submitting}
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Sign in
            </Button>
            <p className="text-[11.5px] text-muted-foreground text-center pt-2">
              Accounts are provisioned by your administrator.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
