import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Database, Loader2, Users } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/health")({ component: Page });

type Check = {
  label: string;
  value: string;
  status: "ok" | "warn" | "error";
};

function Page() {
  const auth = useAuth();
  return (
    <div>
      <PageHeader title="Health" description="Lightweight admin checks for the CRM setup." />
      <PageBody>
        <RoleGate allow={["admin"]} current={auth.primaryRole}>
          <Inner />
        </RoleGate>
      </PageBody>
    </div>
  );
}

function Inner() {
  const health = useQuery({
    queryKey: ["crm-health"],
    queryFn: async () => {
      const [cursor, profiles, rawCache, qualified, browserProfiles, activityLogs] =
        await Promise.all([
          supabase
            .from("shared_state")
            .select("value, updated_at")
            .eq("key", "raw_leads.start_row")
            .maybeSingle(),
          supabase.from("profiles").select("id", { count: "exact", head: true }),
          supabase.from("raw_lead_cache").select("row_key", { count: "exact", head: true }),
          supabase.from("qualified_leads").select("id", { count: "exact", head: true }),
          supabase.from("incogniton_profiles").select("id", { count: "exact", head: true }),
          supabase.from("activity_logs").select("id", { count: "exact", head: true }),
        ]);

      const checks: Check[] = [
        resultCheck(
          "Raw lead cursor",
          cursor.error,
          cursor.data ? "Shared cursor found" : "Not set yet",
        ),
        resultCheck("Profiles", profiles.error, `${profiles.count ?? 0} visible users`),
        resultCheck("Raw cache", rawCache.error, `${rawCache.count ?? 0} cached raw leads`),
        resultCheck("CS leads", qualified.error, `${qualified.count ?? 0} qualified leads`),
        resultCheck(
          "Browser profiles",
          browserProfiles.error,
          `${browserProfiles.count ?? 0} profiles`,
        ),
        resultCheck("Activity logs", activityLogs.error, `${activityLogs.count ?? 0} logs`),
        {
          label: "Service role key",
          value: "Must be configured only on the server/deployment environment",
          status: "warn",
        },
        {
          label: "Free-plan posture",
          value:
            "Pages use count-only checks, capped rows, local filtering, and no file storage exports",
          status: "ok",
        },
      ];

      return {
        cursorValue:
          cursor.data?.value &&
          typeof cursor.data.value === "object" &&
          !Array.isArray(cursor.data.value)
            ? (cursor.data.value as { row?: number }).row
            : undefined,
        cursorUpdatedAt: cursor.data?.updated_at,
        checks,
      };
    },
  });

  if (health.isLoading) {
    return (
      <div className="glass-card p-12 text-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin inline mr-2" />
        Running checks...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {health.error && (
        <div className="text-[12.5px] text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
          {(health.error as Error).message}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <SummaryCard
          icon={Database}
          label="Raw cursor"
          value={health.data?.cursorValue ? `Row ${health.data.cursorValue}` : "Not set"}
        />
        <SummaryCard icon={Users} label="Access" value="Password only" />
        <SummaryCard icon={CheckCircle2} label="Exports" value="Browser CSV only" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {health.data?.checks.map((check) => (
          <div key={check.label} className="bg-card border rounded-lg p-4 flex items-start gap-3">
            <StatusIcon status={check.status} />
            <div className="min-w-0">
              <div className="font-medium text-[13px]">{check.label}</div>
              <div className="text-[12px] text-muted-foreground mt-1">{check.value}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function resultCheck(label: string, error: Error | null, okValue: string): Check {
  return {
    label,
    value: error ? error.message : okValue,
    status: error ? "error" : "ok",
  };
}

function StatusIcon({ status }: { status: Check["status"] }) {
  if (status === "ok") return <CheckCircle2 className="h-4 w-4 mt-0.5 text-success" />;
  return (
    <AlertTriangle
      className={cn("h-4 w-4 mt-0.5", status === "warn" ? "text-warning" : "text-destructive")}
    />
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-card border rounded-lg p-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="text-xl font-semibold mt-2">{value}</div>
    </div>
  );
}
