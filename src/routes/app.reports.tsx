import { createFileRoute } from "@tanstack/react-router";
import { RouteSkeleton } from "@/components/route-skeleton";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ChevronDown, Download, Loader2, Search, User, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { downloadCsv } from "@/lib/crm-lite";
import { cn } from "@/lib/utils";

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

export const Route = createFileRoute("/app/reports")({ component: Page, pendingComponent: () => <RouteSkeleton />, pendingMs: 200 });

const RAW_STATUSES = ["new", "forwarded", "not_found", "wrong", "duplicate"] as const;
const CS_STATUSES = [
  "new",
  "undeliver",
  "wrong_number",
  "wrong_lead",
  "already_got_someone",
  "service_provider_himself",
  "small_service",
  "converted",
  "need_follow_up",
] as const;

const RAW_LABELS: Record<string, string> = {
  new: "New",
  forwarded: "Forwarded to CS",
  not_found: "Number not found",
  wrong: "Wrong posts",
  duplicate: "Duplicate",
};

const CS_LABELS: Record<string, string> = {
  new: "New to contact",
  undeliver: "Undeliver",
  wrong_number: "Wrong number",
  wrong_lead: "Wrong lead",
  already_got_someone: "Already got someone",
  service_provider_himself: "Service provider himself",
  small_service: "Small service",
  converted: "Processed",
  need_follow_up: "Need follow-up",
};

function Page() {
  const auth = useAuth();
  return (
    <div>
      <PageHeader title="Reports" description="Operational counts across the pipeline." />
      <PageBody>
        <RoleGate allow={["admin", "sub_admin"]} current={auth.primaryRole}>
          <Inner />
        </RoleGate>
      </PageBody>
    </div>
  );
}

function Inner() {
  const auth = useAuth();
  const isAdmin = auth.primaryRole === "admin";
  const today = toIsoDay(new Date());
  const [preset, setPreset] = useState<DatePreset>("all");
  const [fromDate, setFromDate] = useState<string>(today);
  const [toDate, setToDate] = useState<string>(today);
  const range = useMemo(() => computeRange(preset, fromDate, toDate), [preset, fromDate, toDate]);

  const raw = useQuery({
    queryKey: ["report-raw", range.from, range.to],
    queryFn: async () => {
      const results = await Promise.all(
        RAW_STATUSES.map((status) => {
          let q = supabase.from("raw_lead_cache").select("id", { count: "exact", head: true });
          if (range.from) q = q.gte("captured_at", range.from);
          if (range.to) q = q.lt("captured_at", range.to);
          if (status === "new") q = q.is("category", null);
          else q = q.eq("category", status);
          return q;
        }),
      );
      const c: Record<string, number> = {};
      results.forEach((result, index) => {
        if (result.error) throw result.error;
        c[RAW_STATUSES[index]] = result.count ?? 0;
      });
      return c;
    },
  });
  const cs = useQuery({
    queryKey: ["report-cs", range.from, range.to],
    queryFn: async () => {
      const c: Record<string, number> = {};
      const results = await Promise.all(
        CS_STATUSES.map((status) => {
          let q = supabase
            .from("qualified_leads")
            .select("id", { count: "exact", head: true })
            .eq("cs_status", status);
          if (range.from) q = q.gte("assigned_at", range.from);
          if (range.to) q = q.lt("assigned_at", range.to);
          return q;
        }),
      );
      results.forEach((result, index) => {
        if (result.error) throw result.error;
        const count = result.count ?? 0;
        if (count > 0) c[CS_STATUSES[index]] = count;
      });
      return c;
    },
  });
  const byAccount = useQuery({
    queryKey: ["report-leads-by-account", range.from, range.to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("report_leads_by_account", {
        _from: range.from ?? undefined,
        _to: range.to ?? undefined,
      });
      if (error) throw error;
      return (data ?? []) as Array<{
        account: string;
        yes_count: number;
        no_count: number;
        pending_count: number;
        total_count: number;
      }>;
    },
  });

  const accountsCount = useQuery({
    queryKey: ["report-accounts"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("accounts")
        .select("id", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  const byMaturing = useQuery({
    queryKey: ["report-forwarded-by-maturing", range.from, range.to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("report_leads_forwarded_by_maturing", {
        _from: range.from ?? undefined,
        _to: range.to ?? undefined,
      });
      if (error) throw error;
      return (data ?? []) as Array<{
        maturing_id: string | null;
        maturing_name: string;
        maturing_email: string | null;
        forwarded_count: number;
      }>;
    },
  });

  const notFoundByUser = useQuery({
    queryKey: ["report-not-found-by-user", range.from, range.to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("report_not_found_by_user", {
        _from: range.from ?? undefined,
        _to: range.to ?? undefined,
      });
      if (error) throw error;
      return (data ?? []) as Array<{
        user_id: string | null;
        user_name: string;
        user_email: string | null;
        not_found_count: number;
      }>;
    },
  });

  function exportReport() {
    downloadCsv(
      "crm-report.csv",
      ["Section", "Metric", "Value"],
      [
        ...Object.entries(raw.data ?? {}).map(([label, value]) => [
          "Raw leads",
          RAW_LABELS[label] ?? label.replace(/_/g, " "),
          value,
        ]),
        ...Object.entries(cs.data ?? {}).map(([label, value]) => [
          "CS pipeline",
          CS_LABELS[label] ?? label.replace(/_/g, " "),
          value,
        ]),
        ["Sources", "Total accounts", accountsCount.data ?? 0],
      ],
    );
  }

  function exportByAccount() {
    downloadCsv(
      "leads-by-account.csv",
      ["Account", "Yes", "No", "Pending", "Total", "Yes %"],
      (byAccount.data ?? []).map((r) => [
        r.account,
        r.yes_count,
        r.no_count,
        r.pending_count,
        r.total_count,
        r.yes_count + r.no_count > 0
          ? ((r.yes_count / (r.yes_count + r.no_count)) * 100).toFixed(1) + "%"
          : "—",
      ]),
    );
  }

  const accountRows = byAccount.data ?? [];
  const totals = accountRows.reduce(
    (acc, r) => ({
      yes: acc.yes + r.yes_count,
      no: acc.no + r.no_count,
      pending: acc.pending + r.pending_count,
      total: acc.total + r.total_count,
    }),
    { yes: 0, no: 0, pending: 0, total: 0 },
  );

  return (
    <div className="space-y-8">
      <div className="crm-toolbar-panel">
        <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["all", "All time"],
            ["today", "Today"],
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
            className="h-8 px-2.5 text-xs"
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
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="h-8 w-[140px] text-xs"
            />
          </>
        )}
        {isAdmin && (
          <Button size="sm" variant="outline" className="h-8 ml-auto" onClick={exportReport}>
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Export counts
          </Button>
        )}
        </div>
      </div>
      <Section title="Raw leads by status">
        <Grid>
          {Object.entries(raw.data ?? {}).map(([k, v]) => (
            <Stat key={k} label={RAW_LABELS[k] ?? k.replace(/_/g, " ")} value={v} />
          ))}
        </Grid>
      </Section>
      <Section title="CS pipeline by status">
        <Grid>
          {Object.entries(cs.data ?? {}).map(([k, v]) => (
            <Stat key={k} label={CS_LABELS[k] ?? k.replace(/_/g, " ")} value={v} />
          ))}
        </Grid>
      </Section>
      <Section title="Sources">
        <Grid>
          <Stat label="Total accounts" value={accountsCount.data ?? 0} />
        </Grid>
      </Section>
      <Section title="Leads by account">
        <div className="crm-surface-card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b">
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  ["all", "All time"],
                  ["today", "Today"],
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
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setPreset(key)}
                >
                  {label}
                </Button>
              ))}
            </div>
            {preset === "custom" && (
              <div className="flex items-center gap-1.5">
                <Input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="h-7 w-[140px] text-xs"
                />
                <span className="text-xs text-muted-foreground">→</span>
                <Input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="h-7 w-[140px] text-xs"
                />
              </div>
            )}
            <div className="text-xs text-muted-foreground ml-auto flex items-center gap-3">
              <span>
                {accountRows.length} accounts · {totals.total} total ·{" "}
                <span className="text-emerald-600 font-medium">{totals.yes} yes</span> /{" "}
                <span className="text-red-600 font-medium">{totals.no} no</span> · {totals.pending}{" "}
                pending
              </span>
              {isAdmin && (
                <Button size="sm" variant="outline" onClick={exportByAccount}>
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  Export CSV
                </Button>
              )}
            </div>
          </div>

          <div className="max-h-[560px] overflow-auto">
            <table className="crm-data-table">
              <thead className="bg-muted/40 sticky top-0">
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Account</th>
                  <th className="px-4 py-2 font-medium text-right">Yes</th>
                  <th className="px-4 py-2 font-medium text-right">No</th>
                  <th className="px-4 py-2 font-medium text-right">Pending</th>
                  <th className="px-4 py-2 font-medium text-right">Total</th>
                  <th className="px-4 py-2 font-medium text-right">Yes %</th>
                </tr>
              </thead>
              <tbody>
                {byAccount.isLoading && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                )}
                {!byAccount.isLoading && accountRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      No data yet.
                    </td>
                  </tr>
                )}
                {accountRows.map((r) => {
                  const decided = r.yes_count + r.no_count;
                  const yesPct = decided > 0 ? (r.yes_count / decided) * 100 : null;
                  return (
                    <tr key={r.account} className="border-t hover:bg-muted/30">
                      <td className="px-4 py-2 font-medium">{r.account}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-emerald-600">
                        {r.yes_count}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-red-600">
                        {r.no_count}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                        {r.pending_count}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold">
                        {r.total_count}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {yesPct === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          `${yesPct.toFixed(1)}%`
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      <Section title="Leads forwarded per maturing">
        <div className="crm-surface-card overflow-hidden">
          <div className="px-4 py-3 border-b text-xs text-muted-foreground">
            Uses the same range controls above: Today, Yesterday, Weekly, Monthly, or Custom.
          </div>
          <table className="crm-data-table">
            <thead className="bg-muted/40">
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-medium">Maturing</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium text-right">Forwarded</th>
              </tr>
            </thead>
            <tbody>
              {byMaturing.isLoading && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {!byMaturing.isLoading && (byMaturing.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                    No leads forwarded in this range.
                  </td>
                </tr>
              )}
              {(byMaturing.data ?? []).map((r, i) => (
                <tr key={r.maturing_id ?? `unknown-${i}`} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-2 font-medium">{r.maturing_name}</td>
                  <td className="px-4 py-2 text-muted-foreground">{r.maturing_email ?? "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold">
                    {r.forwarded_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Number-not-found checks per user">
        <div className="crm-surface-card overflow-hidden">
          <div className="px-4 py-3 border-b text-xs text-muted-foreground">
            Counts raw leads marked as “Number not found”. Uses the same date range as above. Only
            marks made after this report was added are attributed to a user.
          </div>
          <table className="crm-data-table">
            <thead className="bg-muted/40">
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-medium">User</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium text-right">Marked not found</th>
              </tr>
            </thead>
            <tbody>
              {notFoundByUser.isLoading && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {!notFoundByUser.isLoading && (notFoundByUser.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                    No “Number not found” marks in this range.
                  </td>
                </tr>
              )}
              {(notFoundByUser.data ?? []).map((r, i) => (
                <tr key={r.user_id ?? `unknown-${i}`} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-2 font-medium">{r.user_name}</td>
                  <td className="px-4 py-2 text-muted-foreground">{r.user_email ?? "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold">
                    {r.not_found_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ─── Per-Person Leads by Service ─── */}
      <PersonServiceReport range={range} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="crm-section-panel">
      <h2 className="crm-section-title mb-3">{title}</h2>
      {children}
    </div>
  );
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">{children}</div>;
}
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="crm-surface-card p-4">
      <div className="crm-card-label capitalize">{label}</div>
      <div className="crm-card-value mt-1">{value}</div>
    </div>
  );
}

// ─── Per-Person Leads by Service Report ───────────────────────────────────────
type RangeResult = { from: string | null; to: string | null };

const DEPT_COLORS: Record<string, string> = {
  maturing:    "var(--color-chart-1)",
  sub_admin:   "var(--color-chart-2)",
  seo:         "var(--color-chart-3)",
  facebook:    "var(--color-chart-4)",
  scraping:    "var(--color-chart-5)",
  acc_handler: "var(--color-primary-glow)",
};

function PersonServiceReport({ range }: { range: RangeResult }) {
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Load all active profiles once
  const profiles = useQuery({
    queryKey: ["report-profiles-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as Array<{ user_id: string; full_name: string; email: string }>;
    },
    staleTime: 10 * 60_000,
  });

  const allProfiles = profiles.data ?? [];
  const filteredProfiles = useMemo(
    () =>
      allProfiles.filter(
        (p) =>
          p.full_name.toLowerCase().includes(search.toLowerCase()) ||
          p.email.toLowerCase().includes(search.toLowerCase()),
      ),
    [allProfiles, search],
  );

  const selectedProfile = allProfiles.find((p) => p.user_id === selectedUserId);

  // Query leads by service for the selected user + date range
  const leadsQuery = useQuery({
    queryKey: ["report-person-service", selectedUserId, range.from, range.to],
    enabled: !!selectedUserId,
    queryFn: async () => {
      let q = supabase
        .from("qualified_leads")
        .select("service, submitted_by_role")
        .eq("created_by", selectedUserId!);
      if (range.from) q = q.gte("created_at", range.from);
      if (range.to)   q = q.lt("created_at", range.to);
      const { data, error } = await q;
      if (error) throw error;

      // Count by service client-side
      const counts: Record<string, number> = {};
      let dept = "";
      for (const row of data ?? []) {
        const svc = (row.service ?? "").trim() || "(no service)";
        counts[svc] = (counts[svc] ?? 0) + 1;
        if (!dept && row.submitted_by_role) dept = row.submitted_by_role;
      }
      const rows = Object.entries(counts)
        .map(([service, count]) => ({ service, count }))
        .sort((a, b) => b.count - a.count);
      return { rows, dept, total: rows.reduce((s, r) => s + r.count, 0) };
    },
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });

  const result = leadsQuery.data;
  const rows = result?.rows ?? [];
  const maxCount = rows[0]?.count ?? 1;
  const barColor = result?.dept
    ? (DEPT_COLORS[result.dept] ?? "var(--color-primary)")
    : "var(--color-primary)";

  function exportPersonCsv() {
    if (!result || !selectedProfile) return;
    downloadCsv(
      `leads-by-service-${selectedProfile.full_name.replace(/\s+/g, "-")}.csv`,
      ["Rank", "Service", "Lead Count", "Share %"],
      rows.map((r, i) => [
        i + 1,
        r.service,
        r.count,
        result.total ? ((r.count / result.total) * 100).toFixed(1) + "%" : "—",
      ]),
    );
  }

  return (
    <Section title="Leads by Service — Per Person">
      <div className="crm-surface-card">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b">
          {/* Person picker dropdown with Radix Popover (portaled, solid background) */}
          <Popover open={dropdownOpen} onOpenChange={setDropdownOpen}>
            <PopoverTrigger asChild>
              <button
                id="person-service-picker"
                type="button"
                className={cn(
                  "flex items-center justify-between gap-2 h-9 px-3 rounded-md border text-sm transition-colors cursor-pointer",
                  "bg-background hover:bg-muted/50 border-border min-w-[240px] text-left",
                  dropdownOpen && "ring-2 ring-primary/40 border-primary",
                )}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate text-sm font-medium">
                    {selectedProfile ? selectedProfile.full_name : "Select a person…"}
                  </span>
                </div>
                <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-150", dropdownOpen && "rotate-180")} />
              </button>
            </PopoverTrigger>

            <PopoverContent
              align="start"
              sideOffset={6}
              className="w-80 p-0 rounded-xl border border-border shadow-2xl z-[9999] overflow-hidden"
              style={{ backgroundColor: "var(--color-card, #17171a)", opacity: 1 }}
            >
              <div className="p-2 border-b border-border" style={{ backgroundColor: "var(--color-card, #17171a)" }}>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    id="person-search-input"
                    autoFocus
                    placeholder="Search name or email…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-8 pr-7 py-1.5 text-sm bg-muted/60 text-foreground placeholder:text-muted-foreground rounded-md outline-none border border-border/50 focus:border-primary/60"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <ul className="max-h-64 overflow-y-auto py-1" style={{ backgroundColor: "var(--color-card, #17171a)" }}>
                {profiles.isLoading && (
                  <li className="px-3 py-3 text-xs text-muted-foreground flex items-center justify-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> Loading users…
                  </li>
                )}
                {!profiles.isLoading && filteredProfiles.length === 0 && (
                  <li className="px-3 py-3 text-xs text-muted-foreground text-center">No users found</li>
                )}
                {filteredProfiles.map((p) => (
                  <li
                    key={p.user_id}
                    onClick={() => {
                      setSelectedUserId(p.user_id);
                      setDropdownOpen(false);
                      setSearch("");
                    }}
                    className={cn(
                      "flex flex-col px-3 py-2 cursor-pointer transition-colors text-sm hover:bg-muted/80",
                      p.user_id === selectedUserId && "bg-primary/20 text-primary font-medium",
                    )}
                  >
                    <span className="font-medium text-foreground">{p.full_name}</span>
                    <span className="text-xs text-muted-foreground">{p.email}</span>
                  </li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>

          {/* Summary badge + export button */}
          {result && (
            <>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground tabular-nums">{result.total}</span>
                {" "}leads
                {result.dept && (
                  <>
                    {" "}·{" "}
                    <span
                      className="font-semibold capitalize px-1.5 py-0.5 rounded-md"
                      style={{ background: `${barColor}20`, color: barColor }}
                    >
                      {result.dept.replace(/_/g, " ")}
                    </span>
                  </>
                )}
                {" "}· {rows.length} service{rows.length !== 1 ? "s" : ""}
              </div>
              <Button size="sm" variant="outline" className="h-8 ml-auto" onClick={exportPersonCsv}>
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Export CSV
              </Button>
            </>
          )}
        </div>

        {/* Body */}
        {!selectedUserId ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            Select a person above to see their leads broken down by service.
            <br />
            <span className="text-xs opacity-60 mt-1 block">Uses the date range selected at the top of the page.</span>
          </div>
        ) : leadsQuery.isLoading ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground animate-pulse">
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No leads found for <strong>{selectedProfile?.full_name}</strong> in this date range.
          </div>
        ) : (
          <div className="overflow-auto max-h-[560px]">
            <table className="crm-data-table w-full">
              <thead className="bg-muted/40 sticky top-0">
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium w-8">#</th>
                  <th className="px-4 py-2.5 font-medium">Service</th>
                  <th className="px-4 py-2.5 font-medium">Volume</th>
                  <th className="px-4 py-2.5 font-medium text-right w-20">Leads</th>
                  <th className="px-4 py-2.5 font-medium text-right w-16">Share</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const pct = result ? (r.count / result.total) * 100 : 0;
                  const barW = (r.count / maxCount) * 100;
                  return (
                    <tr key={r.service} className="border-t hover:bg-muted/20">
                      <td className="px-4 py-2.5 text-xs text-muted-foreground tabular-nums">{i + 1}</td>
                      <td className="px-4 py-2.5 text-sm font-medium">
                        <span className="block max-w-[280px] truncate">{r.service}</span>
                      </td>
                      <td className="px-4 py-2.5 min-w-[160px]">
                        <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${barW}%`,
                              background: `linear-gradient(90deg, ${barColor}, var(--color-primary-glow))`,
                            }}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-sm">
                        {r.count.toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-xs text-muted-foreground">
                        {pct.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-muted/20 border-t-2 border-border">
                <tr>
                  <td colSpan={3} className="px-4 py-2.5 text-xs text-muted-foreground font-medium">
                    Total · {rows.length} service{rows.length !== 1 ? "s" : ""}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-bold">
                    {result?.total.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </Section>
  );
}

