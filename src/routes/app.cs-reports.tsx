import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Download, Loader2, Users, ClipboardList, PhoneOff, UserCheck } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { downloadCsv } from "@/lib/crm-lite";
import { cn } from "@/lib/utils";
import { listCsTeam } from "@/lib/cs-team.functions";

type DatePreset = "all" | "today" | "yesterday" | "7d" | "30d" | "custom";

function toIsoDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10);
}

function computeRange(preset: DatePreset, from: string, to: string) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  switch (preset) {
    case "today":
      return { from: startOfToday.toISOString(), to: startOfTomorrow.toISOString() };
    case "yesterday": {
      const y = new Date(startOfToday);
      y.setDate(y.getDate() - 1);
      return { from: y.toISOString(), to: startOfToday.toISOString() };
    }
    case "7d": {
      const s = new Date(startOfToday);
      s.setDate(s.getDate() - 6);
      return { from: s.toISOString(), to: startOfTomorrow.toISOString() };
    }
    case "30d": {
      const s = new Date(startOfToday);
      s.setDate(s.getDate() - 29);
      return { from: s.toISOString(), to: startOfTomorrow.toISOString() };
    }
    case "custom": {
      const f = from ? new Date(from + "T00:00:00").toISOString() : null;
      const t = to
        ? (() => {
            const d = new Date(to + "T00:00:00");
            d.setDate(d.getDate() + 1);
            return d.toISOString();
          })()
        : null;
      return { from: f, to: t };
    }
    default:
      return { from: null, to: null };
  }
}

export const Route = createFileRoute("/app/cs-reports")({ component: Page });

// "New" = not yet contacted at all
const NEEDS_CONTACT_STATUS = "new";
// "Need follow-up" also means still needs contact action
const NEEDS_FOLLOWUP_STATUS = "need_follow_up";

type CsStats = {
  user_id: string;
  name: string;
  email: string;
  total: number;
  still_new: number;     // cs_status === "new" — never contacted at all
  need_contact: number;  // cs_status === "need_follow_up" — needs a callback
};

function Page() {
  const auth = useAuth();
  return (
    <div>
      <PageHeader
        title="CS Reports"
        description="Lead assignment and contact status per CS agent."
      />
      <PageBody className="!pt-5">
        <RoleGate allow={["admin"]} current={auth.primaryRole}>
          <Inner />
        </RoleGate>
      </PageBody>
    </div>
  );
}

function Inner() {
  const today = toIsoDay(new Date());
  const [preset, setPreset] = useState<DatePreset>("today");
  const [fromDate, setFromDate] = useState<string>(today);
  const [toDate, setToDate] = useState<string>(today);
  const [userFilter, setUserFilter] = useState<string>("all");

  const range = useMemo(
    () => computeRange(preset, fromDate, toDate),
    [preset, fromDate, toDate],
  );

  const listTeam = useServerFn(listCsTeam);

  // Fetch all CS users via server function (uses supabaseAdmin, bypasses RLS)
  const csUsers = useQuery({
    queryKey: ["cs_team"],
    queryFn: () => listTeam(),
  });

  // Fetch leads for the range, assigned_to is not null
  const leadsQuery = useQuery({
    queryKey: ["cs-report-leads", range.from, range.to],
    queryFn: async () => {
      let q = supabase
        .from("qualified_leads")
        .select("id, assigned_to, cs_status");

      if (range.from) q = q.gte("assigned_at", range.from);
      if (range.to) q = q.lt("assigned_at", range.to);

      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const stats = useMemo((): CsStats[] => {
    const users = csUsers.data ?? [];
    const leads = leadsQuery.data ?? [];

    const targetUsers =
      userFilter === "all" ? users : users.filter((u) => u.user_id === userFilter);

    return targetUsers.map((u) => {
      const userLeads = leads.filter((l) => l.assigned_to === u.user_id);
      const stillNew = userLeads.filter((l) => l.cs_status === NEEDS_CONTACT_STATUS).length;
      const needContact = userLeads.filter(
        (l) => l.cs_status === NEEDS_FOLLOWUP_STATUS,
      ).length;

      return {
        user_id: u.user_id,
        name: u.full_name ?? u.email,
        email: u.email,
        total: userLeads.length,
        still_new: stillNew,
        need_contact: needContact,
      };
    });
  }, [csUsers.data, leadsQuery.data, userFilter]);

  // Aggregate totals
  const totals = useMemo(
    () =>
      stats.reduce(
        (acc, s) => ({
          total: acc.total + s.total,
          still_new: acc.still_new + s.still_new,
          need_contact: acc.need_contact + s.need_contact,
        }),
        { total: 0, still_new: 0, need_contact: 0 },
      ),
    [stats],
  );

  const isLoading = csUsers.isLoading || leadsQuery.isLoading;

  function exportCsv() {
    downloadCsv(
      "cs-reports.csv",
      ["CS Agent", "Email", "Total Assigned", "New To Contact (never contacted)", "Need Follow-Up"],
      stats.map((s) => [s.name, s.email, s.total, s.still_new, s.need_contact]),
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Filters ── */}
      <div className="crm-toolbar-panel">
        <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["all", "All time"],
            ["today", "Same day"],
            ["yesterday", "Yesterday"],
            ["7d", "Weekly"],
            ["30d", "Monthly"],
            ["custom", "Custom"],
          ] as Array<[DatePreset, string]>
        ).map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            variant={preset === key ? "default" : "outline"}
            className="h-8 px-3 text-xs"
            onClick={() => setPreset(key)}
          >
            {label}
          </Button>
        ))}

        {preset === "custom" && (
          <>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-8 w-[140px] text-xs"
            />
            <span className="text-xs text-muted-foreground">→</span>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="h-8 w-[140px] text-xs"
            />
          </>
        )}

        {/* CS User filter */}
        <Select value={userFilter} onValueChange={setUserFilter}>
          <SelectTrigger className="h-8 w-[200px] text-xs">
            <SelectValue placeholder="All CS users" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All CS users</SelectItem>
            {(csUsers.data ?? []).map((u) => (
              <SelectItem key={u.user_id} value={u.user_id}>
                {u.full_name ?? u.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          size="sm"
          variant="outline"
          className="h-8 ml-auto"
          onClick={exportCsv}
          disabled={stats.length === 0}
        >
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Export CSV
        </Button>
        </div>
      </div>

      {/* ── Summary stat cards ── */}
      <div className="crm-section-panel">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <SummaryCard
          icon={<Users className="h-4 w-4" />}
          label="CS agents"
          value={stats.length}
          color="text-primary"
        />
        <SummaryCard
          icon={<ClipboardList className="h-4 w-4" />}
          label="Total assigned"
          value={totals.total}
          color="text-sky-500"
        />
        <SummaryCard
          icon={<PhoneOff className="h-4 w-4" />}
          label="New To Contact"
          value={totals.still_new}
          color="text-amber-500"
          tooltip="Leads still at 'New' status — CS has never contacted these customers yet."
        />
        <SummaryCard
          icon={<UserCheck className="h-4 w-4" />}
          label="Need Follow-Up"
          value={totals.need_contact}
          color="text-orange-500"
          tooltip="Leads marked 'Need Follow-Up' — CS contacted them but needs to call back."
        />
        </div>
      </div>

      {/* ── Per-user table ── */}
      <div className="crm-section-panel">
        <div className="crm-surface-card overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <span className="crm-section-title">Per CS agent breakdown</span>
            {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          <div className="overflow-x-auto">
          <table className="crm-data-table">
            <thead className="bg-muted/40 sticky top-0">
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">CS Agent</th>
                <th className="px-4 py-2.5 font-medium text-right">Total Assigned</th>
                <th className="px-4 py-2.5 font-medium text-right">
                  <span title="Leads still at 'New' status — never been contacted at all">Still New ⓘ</span>
                </th>
                <th className="px-4 py-2.5 font-medium text-right">
                  <span title="Leads marked 'Need Follow-Up' — already contacted but need a callback">Need Follow-Up ⓘ</span>
                </th>
                <th className="px-4 py-2.5 font-medium text-right">Contacted %</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin inline mr-2" />
                    Loading…
                  </td>
                </tr>
              )}
              {!isLoading && stats.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                    No data found for this range.
                  </td>
                </tr>
              )}
              {stats.map((s) => {
                const contactedPct =
                  s.total > 0 ? (((s.total - s.need_contact) / s.total) * 100).toFixed(1) : null;
                return (
                  <tr key={s.user_id} className="border-t hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-foreground">{s.name}</div>
                      <div className="text-[12px] crm-muted-text">{s.email}</div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">
                      {s.total}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 text-right tabular-nums font-semibold",
                        s.still_new > 0 ? "text-amber-500" : "text-muted-foreground",
                      )}
                    >
                      {s.still_new}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 text-right tabular-nums font-semibold",
                        s.need_contact > 0 ? "text-orange-500" : "text-muted-foreground",
                      )}
                    >
                      {s.need_contact}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {contactedPct === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span
                          className={cn(
                            "font-medium",
                            Number(contactedPct) >= 80
                              ? "text-emerald-600"
                              : Number(contactedPct) >= 50
                                ? "text-amber-500"
                                : "text-red-500",
                          )}
                        >
                          {contactedPct}%
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}

              {/* Totals row */}
              {stats.length > 1 && (
                <tr className="border-t bg-muted/20 font-semibold">
                  <td className="px-4 py-3">
                    <span className="crm-kicker">
                      Total
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{totals.total}</td>
                  <td
                    className={cn(
                      "px-4 py-3 text-right tabular-nums",
                      totals.still_new > 0 ? "text-amber-500" : "",
                    )}
                  >
                    {totals.still_new}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-3 text-right tabular-nums",
                      totals.need_contact > 0 ? "text-orange-500" : "",
                    )}
                  >
                    {totals.need_contact}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {totals.total > 0
                      ? `${(((totals.total - totals.need_contact) / totals.total) * 100).toFixed(1)}%`
                      : "—"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  color,
  tooltip,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
  tooltip?: string;
}) {
  return (
    <div className="crm-surface-card p-4 flex flex-col gap-2" title={tooltip}>
      <div className={cn("flex items-center gap-2 crm-kicker")}>
        <span className={color}>{icon}</span>
        {label}
        {tooltip && <span className="ml-auto text-[11px] normal-case font-normal text-muted-foreground/60 cursor-help">ⓘ</span>}
      </div>
      <div className="crm-card-value tabular-nums">{value}</div>
    </div>
  );
}
