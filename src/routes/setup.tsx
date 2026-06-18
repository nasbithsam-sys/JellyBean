import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useServerFn } from "@tanstack/react-start";
import { bootstrapFirstAdmin } from "@/lib/admin-users.functions";
import { friendlyError } from "@/lib/error-messages";

export const Route = createFileRoute("/setup")({
  component: SetupPage,
});

function SetupPage() {
  const bootstrap = useServerFn(bootstrapFirstAdmin);
  const [checking, setChecking] = useState(true);
  const [profilesExist, setProfilesExist] = useState(false);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  useEffect(() => {
    async function checkProfiles() {
      try {
        const { count, error } = await supabase
          .from("profiles")
          .select("id", { count: "exact", head: true });
        if (error) throw error;
        setProfilesExist((count ?? 0) > 0);
      } catch (err) {
        toast.error("Failed to verify system status.");
      } finally {
        setChecking(false);
      }
    }
    checkProfiles();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.password.length < 8) {
      toast.error("Password must be at least 8 characters long.");
      return;
    }
    if (form.password !== form.confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      await bootstrap({
        data: {
          fullName: form.fullName,
          email: form.email,
          password: form.password,
          role: "admin",
          isActive: true,
        },
      });
      setSuccess(true);
      toast.success("Admin account created successfully!");
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-[linear-gradient(135deg,#f7fbff_0%,#eef5ff_48%,#ffffff_100%)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Checking system status...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(135deg,#f7fbff_0%,#eef5ff_48%,#ffffff_100%)] px-4 py-8 flex items-center justify-center">
      <div className="w-full max-w-5xl grid overflow-hidden rounded-[28px] border border-white/80 bg-white/82 shadow-[0_32px_90px_-50px_rgba(30,64,175,0.45)] backdrop-blur-xl md:grid-cols-[0.92fr_1fr] animate-fade-in-up">
        {/* Left Side Branding */}
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
                Set up your first admin account.
              </h1>
              <p className="mt-4 text-sm leading-6 text-white/72">
                Create the primary administrator credentials to configure the application, add
                users, and manage leads.
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

        {/* Right Side Form */}
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
            {profilesExist ? (
              <div className="text-center py-8">
                <h2 className="text-2xl font-bold tracking-tight">Setup Complete</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Setup is already complete. Please sign in to access your account.
                </p>
                <Button asChild className="mt-6 w-full h-12 rounded-xl">
                  <Link to="/login">
                    Sign In <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            ) : success ? (
              <div className="text-center py-8">
                <div className="h-12 w-12 rounded-full bg-success/20 text-success grid place-items-center mx-auto mb-4">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <h2 className="text-2xl font-bold tracking-tight">Account Created</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Admin account created. You can now sign in to your workspace.
                </p>
                <Button asChild className="mt-6 w-full h-12 rounded-xl">
                  <Link to="/login">
                    Go to Sign In <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            ) : (
              <div>
                <div className="mb-8">
                  <p className="text-sm font-medium text-primary">Initial Configuration</p>
                  <h1 className="mt-2 text-[30px] leading-tight font-semibold tracking-[-0.02em]">
                    Create Admin Account
                  </h1>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Create the first account. This account will automatically have administrative
                    privileges.
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <Label htmlFor="fullName" className="text-[13px] font-medium text-foreground">
                      Full Name
                    </Label>
                    <Input
                      id="fullName"
                      value={form.fullName}
                      onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                      required
                      className="mt-2 h-12 rounded-xl bg-white"
                      placeholder="e.g. John Doe"
                    />
                  </div>

                  <div>
                    <Label htmlFor="email" className="text-[13px] font-medium text-foreground">
                      Email Address
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      required
                      className="mt-2 h-12 rounded-xl bg-white"
                      placeholder="e.g. admin@leadgrid.com"
                    />
                  </div>

                  <div>
                    <Label htmlFor="pw" className="text-[13px] font-medium text-foreground">
                      Password
                    </Label>
                    <Input
                      id="pw"
                      type="password"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      required
                      className="mt-2 h-12 rounded-xl bg-white"
                      placeholder="At least 8 characters"
                    />
                  </div>

                  <div>
                    <Label htmlFor="confirmPw" className="text-[13px] font-medium text-foreground">
                      Confirm Password
                    </Label>
                    <Input
                      id="confirmPw"
                      type="password"
                      value={form.confirmPassword}
                      onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                      required
                      className="mt-2 h-12 rounded-xl bg-white"
                      placeholder="Repeat your password"
                    />
                  </div>

                  <Button
                    type="submit"
                    className="w-full h-12 rounded-xl text-[15px] shadow-[0_12px_28px_-16px_rgba(37,99,235,0.8)] mt-2"
                    disabled={submitting}
                  >
                    {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                    Complete Setup
                    {!submitting && <ArrowRight className="h-4 w-4 ml-2" />}
                  </Button>
                </form>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
