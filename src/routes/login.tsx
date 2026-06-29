import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useClockSkew } from "@/hooks/use-clock-skew";

type LoginProfile = {
  is_active: boolean;
};

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const skewSeconds = useClockSkew();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [profilesExist, setProfilesExist] = useState(true);

  useEffect(() => {
    async function checkProfiles() {
      try {
        const { count } = await supabase
          .from("profiles")
          .select("id", { count: "exact", head: true });
        setProfilesExist((count ?? 0) > 0);
      } catch (err) {
        console.error(err);
      }
    }
    checkProfiles();

    void (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) return;
      const access = await getLoginAccess(sess.session.user.id);
      if (!access.isActive) {
        await supabase.auth.signOut();
        toast.error("Your account is inactive. Please contact an administrator.");
        return;
      }
      navigate({ to: "/app" });
    })();
  }, [navigate]);

  async function getLoginAccess(uid: string): Promise<{ isActive: boolean }> {
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_active")
      .eq("user_id", uid)
      .maybeSingle();
    return {
      isActive: (profile as LoginProfile | null)?.is_active ?? false,
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
        const msg = error.message;
        toast.error(msg && msg !== "{}" ? msg : "Invalid login credentials or server error");
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
      }
      navigate({ to: "/app" });
    } catch (err: any) {
      console.error(err);
      const msg = err?.message || String(err);
      toast.error(msg === "{}" ? "An unexpected error occurred" : msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(135deg,#f7fbff_0%,#eef5ff_48%,#ffffff_100%)] px-4 py-8 flex items-center justify-center">
      <div className="w-full max-w-5xl grid overflow-hidden rounded-[28px] border border-white/80 bg-white/82 shadow-[0_32px_90px_-50px_rgba(30,64,175,0.45)] backdrop-blur-xl md:grid-cols-[0.92fr_1fr] animate-fade-in-up">
        <section className="hidden md:flex flex-col justify-between bg-[linear-gradient(160deg,#2563eb_0%,#4f46e5_56%,#7c3aed_100%)] p-9 text-white">
          <div>
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-2xl bg-white/16 ring-1 ring-white/22 grid place-items-center">
                <span className="text-sm font-semibold">LG</span>
              </div>
              <div>
                <div className="text-lg font-semibold tracking-tight">Leadgrid</div>
                <div className="text-sm text-white/68">Lead operations CRM</div>
              </div>
            </div>
            <div className="mt-16 max-w-sm">
              <h1 className="text-[34px] leading-[1.05] font-semibold tracking-[-0.02em]">
                Manage every lead from one calm workspace.
              </h1>
              <p className="mt-4 text-sm leading-6 text-white/72">
                Review raw leads, forward qualified jobs, and keep CS follow-up moving without extra
                login codes.
              </p>
            </div>
          </div>
          <div className="grid gap-3 text-sm text-white/82">
            {["Password-only access", "Role-based CRM views", "Live Supabase lead data"].map(
              (item) => (
                <div key={item} className="flex items-center gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-white" />
                  <span>{item}</span>
                </div>
              ),
            )}
          </div>
        </section>

        <section className="p-7 sm:p-10 md:p-12">
          <div className="md:hidden mb-8 flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-primary text-primary-foreground grid place-items-center">
              <span className="text-sm font-semibold">LG</span>
            </div>
            <div>
              <div className="text-lg font-semibold tracking-tight">Leadgrid</div>
              <div className="text-sm text-muted-foreground">Lead operations CRM</div>
            </div>
          </div>

          <div className="max-w-md mx-auto">
            {skewSeconds !== null && (
              <div className="mb-6 p-4 rounded-2xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200 text-sm shadow-sm flex flex-col gap-2 animate-fade-in">
                <div className="flex items-center gap-2 font-semibold">
                  <span className="text-base">⚠️</span>
                  <span>System Clock Out of Sync</span>
                </div>
                <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                  Your computer's clock is out of sync with our servers by about{" "}
                  <strong>{Math.round(Math.abs(skewSeconds) / 60)} minutes</strong>.
                  This causes security validation checks to fail, leading to rapid logouts (HTTP 429 Too Many Requests).
                </p>
                <p className="text-xs font-medium mt-1">
                  <strong>To fix this:</strong> Open your device's <strong>Date & Time settings</strong> and turn on <strong>"Set time automatically"</strong>, then refresh this page.
                </p>
              </div>
            )}

            <div className="mb-8">
              <p className="text-sm font-medium text-primary">Welcome back</p>
              <h1 className="mt-2 text-[30px] leading-tight font-semibold tracking-[-0.02em]">
                Sign in to your workspace
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Use your assigned email or username and password.
              </p>
            </div>

            <form onSubmit={handleSignIn} className="space-y-5">
              <div>
                <Label htmlFor="id" className="text-[13px] font-medium text-foreground">
                  Email or username
                </Label>
                <Input
                  id="id"
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                  className="mt-2 h-12 rounded-xl bg-white"
                />
              </div>
              <div>
                <Label htmlFor="pw" className="text-[13px] font-medium text-foreground">
                  Password
                </Label>
                <Input
                  id="pw"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="mt-2 h-12 rounded-xl bg-white"
                />
              </div>
              <Button
                type="submit"
                className="w-full h-12 rounded-xl text-[15px] shadow-[0_12px_28px_-16px_rgba(37,99,235,0.8)]"
                disabled={submitting}
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Sign in
                {!submitting && <ArrowRight className="h-4 w-4" />}
              </Button>
              <p className="text-[12.5px] text-muted-foreground text-center pt-2">
                Accounts are provisioned by your administrator.
              </p>
              {!profilesExist && (
                <div className="text-center pt-4 border-t border-border mt-4">
                  <Link to="/setup" className="text-xs text-primary hover:underline font-medium">
                    First time? Set up your admin account
                  </Link>
                </div>
              )}
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
