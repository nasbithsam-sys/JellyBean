import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Download, Loader2, Search } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { downloadCsv } from "@/lib/crm-lite";

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
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [limit, setLimit] = useState(100);

  const logs = useQuery({
    queryKey: ["activity_logs", dateFrom, dateTo, limit],
    queryFn: async () => {
      let request = supabase
        .from("activity_logs")
        .select("id, created_at, actor_name, actor_role, action, entity_type, metadata")
        .order("created_at", { ascending: false });
      if (dateFrom) {
        request = request.gte("created_at", new Date(`${dateFrom}T00:00:00`).toISOString());
      }
      if (dateTo) {
        const end = new Date(`${dateTo}T00:00:00`);
        end.setDate(end.getDate() + 1);
        request = request.lt("created_at", end.toISOString());
      }
      const { data, error } = await request.limit(limit);
      if (error) throw error;
      return data ?? [];
    },
    placeholderData: keepPreviousData,
  });

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return logs.data ?? [];
    return (logs.data ?? []).filter((log) =>
      [
        log.actor_name,
        log.actor_role,
        log.action,
        log.entity_type,
        log.metadata ? JSON.stringify(log.metadata) : "",
      ].some((value) => (value ?? "").toLowerCase().includes(q)),
    );
  }, [logs.data, query]);

  function exportLogs() {
    downloadCsv(
      "activity-logs.csv",
      ["Created", "Actor", "Role", "Action", "Entity", "Details"],
      visible.map((log) => [
        log.created_at,
        log.actor_name ?? "",
        log.actor_role ?? "",
        log.action,
        log.entity_type ?? "",
        log.metadata ? JSON.stringify(log.metadata) : "",
      ]),
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search actor, action, entity..."
            className="h-9 pl-9"
          />
        </div>
        <Input
          type="date"
          value={dateFrom}
          onChange={(event) => setDateFrom(event.target.value)}
          className="h-9 w-[150px]"
        />
        <Input
          type="date"
          value={dateTo}
          onChange={(event) => setDateTo(event.target.value)}
          className="h-9 w-[150px]"
        />
        <Button size="sm" variant="outline" className="h-9" onClick={exportLogs}>
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Export
        </Button>
      </div>

      {logs.error && (
        <div className="text-[12.5px] text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
          {(logs.error as Error).message}
        </div>
      )}

      <div className="bg-card border rounded-lg overflow-hidden">
        <table className="crm-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Role</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {logs.isLoading && !logs.data && (
              <tr>
                <td colSpan={6} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                  Loading...
                </td>
              </tr>
            )}
            {!logs.isLoading && visible.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-8 text-muted-foreground">
                  <Search className="h-5 w-5 mx-auto mb-2 opacity-50" />
                  No activity logs found for the selected date range.
                </td>
              </tr>
            )}
            {visible.map((log) => (
              <tr key={log.id}>
                <td className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                </td>
                <td className="font-medium">{log.actor_name ?? "-"}</td>
                <td className="capitalize text-sm">{log.actor_role ?? "-"}</td>
                <td className="font-mono text-xs">{log.action}</td>
                <td className="font-mono text-xs">{log.entity_type ?? "-"}</td>
                <td className="font-mono text-xs text-muted-foreground max-w-xs">
                  <div className="truncate">
                    {log.metadata ? JSON.stringify(log.metadata) : "-"}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3 text-[11.5px] text-muted-foreground">
        <span>
          Showing {visible.length} of {logs.data?.length ?? 0} loaded logs
        </span>
        <Button variant="outline" size="sm" onClick={() => setLimit((n) => n + 100)}>
          Load older
        </Button>
      </div>
    </div>
  );
}
