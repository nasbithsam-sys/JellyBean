import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/app/logs")({ component: Page });

function Page() {
  const auth = useAuth();
  return (
    <div>
      <PageHeader title="Activity Logs" description="Audit trail of operations across the CRM." />
      <PageBody>
        <RoleGate allow={["admin"]} current={auth.primaryRole}>
          <Inner />
        </RoleGate>
      </PageBody>
    </div>
  );
}

function Inner() {
  const logs = useQuery({
    queryKey: ["activity_logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="bg-card border rounded-lg overflow-hidden">
      <table className="crm-table">
        <thead>
          <tr><th>When</th><th>Actor</th><th>Role</th><th>Action</th><th>Entity</th><th>Details</th></tr>
        </thead>
        <tbody>
          {logs.isLoading && <tr><td colSpan={6} className="text-center py-6 text-muted-foreground">Loading…</td></tr>}
          {logs.data?.length === 0 && <tr><td colSpan={6} className="text-center py-6 text-muted-foreground">No activity yet.</td></tr>}
          {logs.data?.map((l) => (
            <tr key={l.id}>
              <td className="text-xs text-muted-foreground whitespace-nowrap">{formatDistanceToNow(new Date(l.created_at), { addSuffix: true })}</td>
              <td className="font-medium">{l.actor_name ?? "—"}</td>
              <td className="capitalize text-sm">{l.actor_role ?? "—"}</td>
              <td className="font-mono text-xs">{l.action}</td>
              <td className="font-mono text-xs">{l.entity_type ?? "—"}</td>
              <td className="font-mono text-xs text-muted-foreground max-w-xs"><div className="truncate">{l.metadata ? JSON.stringify(l.metadata) : "—"}</div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
