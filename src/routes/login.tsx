import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mfaRequired, setMfaRequired] = useState<{ factorId: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");

  // Already signed in? Route based on MFA / role
  useEffect(() => {
    void (async () => {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) return;
      if (aal?.nextLevel === "aal2" && aal?.currentLevel !== "aal2") {
        // MFA exists, needs challenge
        const { data: factors } = await supabase.auth.mfa.listFactors();
        const verified = factors?.totp?.find((f) => f.status === "verified");
        if (verified) {
          setMfaRequired({ factorId: verified.id });
          return;
        }
      }
      navigate({ to: "/app" });
    })();
  }, [navigate]);

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
      // Check MFA requirement
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.nextLevel === "aal2" && aal?.currentLevel !== "aal2") {
        const { data: factors } = await supabase.auth.mfa.listFactors();
        const verified = factors?.totp?.find((f) => f.status === "verified");
        if (verified) {
          setMfaRequired({ factorId: verified.id });
          return;
        }
      }

      // Enforce OTP for marketing/cs even if not enrolled yet
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: rolesData } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
        const roles = (rolesData ?? []).map((r) => r.role as string);
        const mustOtp = roles.includes("marketing") || roles.includes("cs");
        if (mustOtp) {
          const { data: factors } = await supabase.auth.mfa.listFactors();
          if (!factors?.totp?.some((f) => f.status === "verified")) {
            navigate({ to: "/mfa-setup" });
            return;
          }
        }
      }
      navigate({ to: "/app" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMfaVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaRequired) return;
    setSubmitting(true);
    try {
      const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: mfaRequired.factorId });
      if (chErr || !ch) {
        toast.error(chErr?.message ?? "Could not start MFA challenge");
        return;
      }
      const { error } = await supabase.auth.mfa.verify({
        factorId: mfaRequired.factorId,
        challengeId: ch.id,
        code: mfaCode.trim(),
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      navigate({ to: "/app" });
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
        <BootstrapPanel />
      </div>
    </div>
  );
}

function BootstrapPanel() {
  const [needs, setNeeds] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ fullName: "", email: "", username: "", password: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const { count } = await supabase.from("profiles").select("id", { count: "exact", head: true });
      setNeeds((count ?? 0) === 0);
    })();
  }, []);

  if (!needs) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { bootstrapFirstAdmin } = await import("@/lib/admin-users.functions");
      await bootstrapFirstAdmin({ data: { ...form, role: "admin", isActive: true } });
      toast.success("Admin created. You can now sign in.");
      setOpen(false);
      setNeeds(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 bg-card border border-dashed rounded-lg p-4">
      <div className="text-xs text-muted-foreground">
        No users exist yet. Create the first admin to get started.
      </div>
      {!open ? (
        <Button variant="outline" className="w-full mt-3" onClick={() => setOpen(true)}>
          Create first admin
        </Button>
      ) : (
        <form onSubmit={submit} className="mt-3 space-y-2">
          <Input placeholder="Full name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required />
          <Input placeholder="Username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
          <Input type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <Input type="password" placeholder="Password (8+ chars)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} />
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Create admin
          </Button>
        </form>
      )}
    </div>
  );
}
