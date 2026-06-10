import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/app-shell";
import { requireOtpVerified } from "@/lib/login-otp.functions";

export const Route = createFileRoute("/app")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const auth = useAuth();
  const { loading, session, signOut } = auth;
  const navigate = useNavigate();
  const inactive = auth.profile?.is_active === false;
  const verifyOtp = useServerFn(requireOtpVerified);
  const [otpChecked, setOtpChecked] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!session) {
      navigate({ to: "/login" });
      return;
    }
    if (inactive) {
      void signOut();
      navigate({ to: "/login" });
      return;
    }
    // Server-side OTP enforcement: client-only check is bypassable.
    let cancelled = false;
    void (async () => {
      try {
        await verifyOtp({ data: undefined });
        if (!cancelled) setOtpChecked(true);
      } catch {
        if (cancelled) return;
        toast.error("Additional verification required. Please sign in again.");
        await signOut();
        navigate({ to: "/login" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, session, inactive, signOut, navigate, verifyOtp]);

  if (loading || !session || inactive || !otpChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!auth.primaryRole) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md text-center bg-card border rounded-lg p-6">
          <h1 className="text-lg font-semibold">No role assigned</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Your account exists but has no role yet. Please contact an administrator.
          </p>
          <button
            onClick={() => void auth.signOut()}
            className="mt-4 text-sm text-primary underline"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <AppShell auth={auth}>
      <Outlet />
    </AppShell>
  );
}
