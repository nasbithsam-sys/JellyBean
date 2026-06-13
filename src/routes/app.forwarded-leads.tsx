import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, Search, Phone, MapPin } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { formatPhone } from "@/lib/crm-lite";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/forwarded-leads")({ component: Page });

type ForwardedStatus =
  | "new"
  | "undeliver"
  | "wrong_number"
  | "wrong_lead"
  | "already_got_someone"
  | "service_provider_himself"
  | "converted"
  | "need_follow_up";

type Row = {
  id: string;
  customer_name: string;
  customer_number: string;
  main_area: string | null;
  sub_area: string | null;
  cs_status: ForwardedStatus | string;
  assigned_at: string;
  updated_at: string;
  created_by: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  new: "Pending",
  undeliver: "Undeliver",
  wrong_number: "Wrong number",
  wrong_lead: "Wrong lead",
  already_got_someone: "Already got someone",
  service_provider_himself: "Service provider himself",
  converted: "Processed",
  need_follow_up: "Need follow-up",
};

const STATUS_TONE: Record<string, string> = {
  new: "bg-muted text-muted-foreground border-border",
  undeliver: "bg-destructive/15 text-destructive border-destructive/30",
  wrong_number: "bg-destructive/15 text-destructive border-destructive/30",
  wrong_lead: "bg-destructive/15 text-destructive border-destructive/30",
  already_got_someone: "bg-destructive/15 text-destructive border-destructive/30",
  service_provider_himself: "bg-destructive/15 text-destructive border-destructive/30",
  converted: "bg-success/15 text-success border-success/30",
  need_follow_up: "bg-warning/15 text-warning border-warning/30",
};

const OUTCOME_FILTERS = [
  "undeliver",
  "wrong_number",
  "wrong_lead",
  "already_got_someone",
  "service_provider_himself",
  "converted",
  "need_follow_up",
] as const;

function Page() {
  const auth = useAuth();
  return (
    <div>
      <PageHeader
        title="Forwarded Leads"
        description="Leads you forwarded to CS, and how CS resolved them."
      />
      <PageBody className="!pt-5">
        <RoleGate allow={["admin", "processor"]} current={auth.primaryRole}>
          <Inner />
        </RoleGate>
      </PageBody>
    </div>
  );
}

function Inner() {
  const auth = useAuth();
  const qc = useQueryClient();
  const isAdmin = auth.primaryRole === "admin";
  const [query, setQuery] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<"all" | "pending" | ForwardedStatus>("all");

  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);

  const sentToday = useQuery({
    queryKey: ["forwarded-sent-today", auth.user?.id],
    enabled: !!auth.user?.id,
    queryFn: async () => {
      let q = supabase
        .from("qualified_leads")
        .select("id", { count: "exact", head: true })
        .gte("assigned_at", todayStart);
      if (!isAdmin) q = q.eq("created_by", auth.user!.id);
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
  });

  const list = useQuery({
    queryKey: ["forwarded-leads", auth.user?.id, isAdmin],
    enabled: !!auth.user?.id,
    queryFn: async () => {
      // RLS already filters to created_by = auth.uid() for scraping/processor.
      // Admin sees every row; no extra filter needed.
      const { data, error } = await supabase
        .from("qualified_leads")
        .select(
          "id, customer_name, customer_number, main_area, sub_area, cs_status, assigned_at, updated_at, created_by",
        )
        .order("updated_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (list.data ?? []).filter((r) => {
      if (outcomeFilter === "pending" && r.cs_status !== "new") return false;
      if (outcomeFilter !== "all" && outcomeFilter !== "pending" && r.cs_status !== outcomeFilter)
        return false;
      if (
        q &&
        ![r.customer_name, r.customer_number, r.main_area, r.sub_area].some((f) =>
          f?.toLowerCase().includes(q),
        )
      )
        return false;
      return true;
    });
  }, [list.data, query, outcomeFilter]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="glass-card p-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-mono">
            Sent to CS today
          </div>
          <div className="text-2xl font-bold mt-1 tabular-nums">{sentToday.data ?? "—"}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {isAdmin ? "All processors" : "By you"}
          </div>
        </div>
        <div className="glass-card p-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-mono">
            Total forwarded
          </div>
          <div className="text-2xl font-bold mt-1 tabular-nums">{list.data?.length ?? "—"}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-mono">
            Pending outcome
          </div>
          <div className="text-2xl font-bold mt-1 tabular-nums">
            {(list.data ?? []).filter((r) => r.cs_status === "new").length}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search customer, area, phone…"
            className="w-full h-9 pl-9 pr-3 rounded-md bg-surface border border-border text-[13px] placeholder:text-muted-foreground/70 focus:outline-none"
          />
        </div>
        <Select
          value={outcomeFilter}
          onValueChange={(v) => setOutcomeFilter(v as typeof outcomeFilter)}
        >
          <SelectTrigger className="h-9 w-[180px] text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All outcomes</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            {OUTCOME_FILTERS.map((status) => (
              <SelectItem key={status} value={status}>
                {STATUS_LABEL[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          className="h-9 ml-auto"
          onClick={() => qc.invalidateQueries({ queryKey: ["forwarded-leads"] })}
          disabled={list.isFetching}
        >
          {list.isFetching ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          )}
          Refresh
        </Button>
      </div>

      {list.error && (
        <div className="text-[12.5px] text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
          {(list.error as Error).message}
        </div>
      )}

      {list.isLoading ? (
        <div className="glass-card p-16 text-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-10 text-center text-[12.5px] text-muted-foreground">
          No forwarded leads found.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-[12.5px]">
            <thead className="bg-surface text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Customer</th>
                <th className="text-left px-3 py-2 font-medium">Phone</th>
                <th className="text-left px-3 py-2 font-medium">Area</th>
                <th className="text-left px-3 py-2 font-medium">Outcome</th>
                <th className="text-left px-3 py-2 font-medium">Forwarded</th>
                <th className="text-left px-3 py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-surface/50">
                  <td className="px-3 py-2 font-medium">{r.customer_name}</td>
                  <td className="px-3 py-2">
                    <a
                      href={`tel:${r.customer_number}`}
                      className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary"
                    >
                      <Phone className="h-3 w-3" /> {formatPhone(r.customer_number)}
                    </a>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {(r.main_area || r.sub_area) && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {[r.main_area, r.sub_area].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.cs_status === "new" ? (
                      <span className="text-muted-foreground italic">Pending</span>
                    ) : (
                      <span
                        className={cn(
                          "text-[10.5px] px-2 py-0.5 rounded-full border font-medium",
                          STATUS_TONE[r.cs_status] ?? "bg-muted text-muted-foreground border-border",
                        )}
                      >
                        {STATUS_LABEL[r.cs_status] ?? r.cs_status.replace(/_/g, " ")}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground tabular-nums">
                    {formatDistanceToNow(new Date(r.assigned_at), { addSuffix: true })}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground tabular-nums">
                    {formatDistanceToNow(new Date(r.updated_at), { addSuffix: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
