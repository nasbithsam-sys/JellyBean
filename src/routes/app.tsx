import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/app")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const auth = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (auth.loading) return;
    if (!auth.session) {
      navigate({ to: "/login" });
    }
  }, [auth.loading, auth.session, navigate]);

  if (auth.loading || !auth.session) {
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
