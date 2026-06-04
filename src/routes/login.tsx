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
      const needs = await userNeedsOtp(sess.session.user.id);
      if (needs) setOtpRequired(true);
      else navigate({ to: "/app" });
    })();
  }, [navigate]);

  async function userNeedsOtp(uid: string): Promise<boolean> {
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", uid);
    const roles = (data ?? []).map((r) => r.role as string);
    return roles.includes("marketing") || roles.includes("cs");
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
      const { data: { user } } = await supabase.auth.getUser();
      if (user && (await userNeedsOtp(user.id))) {
        setOtpRequired(true);
        return;
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
      {/* Decorative glow */}
      <div className="absolute -top-32 left-1/2 -translate-x-1/2 h-[460px] w-[820px] rounded-full bg-primary/20 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-0 h-[300px] w-[500px] rounded-full bg-primary-glow/10 blur-[120px] pointer-events-none" />

      <div className="w-full max-w-sm relative animate-fade-in-up">
        <div className="mb-8 flex flex-col items-center">
          <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-primary to-primary-glow grid place-items-center shadow-lg ring-1 ring-primary/40">
            <span className="text-[16px] font-semibold text-primary-foreground">L</span>
          </div>
          <h1 className="text-[22px] font-semibold tracking-tight mt-4">Welcome back</h1>
          <p className="text-[13px] text-muted-foreground mt-1">Sign in to Leadgrid</p>
        </div>
        {mfaRequired ? (
          <form onSubmit={handleMfaVerify} className="glass-card p-6 space-y-4 ring-glow">
            <div>
              <Label htmlFor="otp" className="text-[12px] uppercase tracking-wide text-muted-foreground font-medium">Authenticator code</Label>
              <Input
                id="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123 456"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                maxLength={6}
                className="mt-2 tracking-[0.4em] text-center text-lg h-12 font-mono"
              />
              <p className="text-[11.5px] text-muted-foreground mt-2 text-center">
                Open Google Authenticator and enter the 6-digit code.
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
              <Label htmlFor="id" className="text-[12px] uppercase tracking-wide text-muted-foreground font-medium">Email or username</Label>
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
              <Label htmlFor="pw" className="text-[12px] uppercase tracking-wide text-muted-foreground font-medium">Password</Label>
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
            <Button type="submit" className="w-full h-10 shadow-md hover:shadow-lg" disabled={submitting}>
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
