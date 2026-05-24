import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody } from "@/components/page";

export const Route = createFileRoute("/_authenticated/")({
  component: DashboardHome,
});

function DashboardHome() {
  const auth = useAuth();
  const role = auth.primaryRole;

  return (
    <div>
      <PageHeader
        title={`Welcome${auth.profile?.full_name ? `, ${auth.profile.full_name}` : ""}`}
        description={
          role === "admin"
            ? "Full operational overview."
            : role === "marketing"
              ? "Review raw leads and qualify them for CS."
              : role === "cs"
                ? "Work your assigned leads."
                : ""
        }
      />
      <PageBody>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {role === "admin" && (
            <>
              <StatCard label="Raw leads (today)" hint="From Google Sheets" />
              <StatCard label="Sent to CS (today)" hint="Marketing qualified" />
              <StatCard label="Active accounts" hint="Opened today" />
              <StatCard label="Conversions" hint="Closed won" />
            </>
          )}
          {role === "marketing" && (
            <>
              <StatCard label="Pending review" />
              <StatCard label="Sent to CS today" />
              <StatCard label="Cancelled today" />
            </>
          )}
          {role === "cs" && (
            <>
              <StatCard label="New leads" />
              <StatCard label="Follow-ups" />
              <StatCard label="Converted today" />
            </>
          )}
        </div>
      </PageBody>
    </div>
  );
}

function StatCard({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="bg-card border rounded-lg p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-3xl font-semibold mt-1">—</div>
      {hint && <div className="text-xs text-muted-foreground mt-2">{hint}</div>}
    </div>
  );
}

