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
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Leadgrid</h1>
          <p className="text-sm text-muted-foreground mt-1">Sign in to continue</p>
        </div>
        {mfaRequired ? (
          <form onSubmit={handleMfaVerify} className="bg-card border rounded-lg p-6 space-y-4">
            <div>
              <Label htmlFor="otp">Authenticator code</Label>
              <Input
                id="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                maxLength={6}
                className="mt-1.5 tracking-widest text-center text-lg"
              />
              <p className="text-xs text-muted-foreground mt-2">
                Open Google Authenticator and enter the 6-digit code.
              </p>
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Verify
            </Button>
          </form>
        ) : (
          <form onSubmit={handleSignIn} className="bg-card border rounded-lg p-6 space-y-4">
            <div>
              <Label htmlFor="id">Email or username</Label>
              <Input
                id="id"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="pw">Password</Label>
              <Input
                id="pw"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="mt-1.5"
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Sign in
            </Button>
            <p className="text-xs text-muted-foreground text-center pt-2">
              Accounts are created by your administrator.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
