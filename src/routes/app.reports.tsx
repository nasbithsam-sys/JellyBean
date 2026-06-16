import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { downloadCsv } from "@/lib/crm-lite";

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


export const Route = createFileRoute("/app/reports")({ component: Page });

const RAW_STATUSES = ["new", "forwarded", "not_found", "wrong"] as const;
const CS_STATUSES = [
  "new",
  "undeliver",
  "wrong_number",
  "wrong_lead",
  "already_got_someone",
  "service_provider_himself",
  "converted",
  "need_follow_up",
] as const;

const RAW_LABELS: Record<string, string> = {
  new: "New",
  forwarded: "Forwarded to CS",
  not_found: "Number not found",
  wrong: "Wrong posts",
};

const CS_LABELS: Record<string, string> = {
  new: "New to contact",
  undeliver: "Undeliver",
  wrong_number: "Wrong number",
  wrong_lead: "Wrong lead",
  already_got_someone: "Already got someone",
  service_provider_himself: "Service provider himself",
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
  const raw = useQuery({
    queryKey: ["report-raw"],
    queryFn: async () => {
      const results = await Promise.all(
        RAW_STATUSES.map((status) => {
          let q = supabase
            .from("raw_lead_cache")
            .select("id", { count: "exact", head: true });
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
    queryKey: ["report-cs"],
    queryFn: async () => {
      const c: Record<string, number> = {};
      const results = await Promise.all(
        CS_STATUSES.map((status) =>
          supabase
            .from("qualified_leads")
            .select("id", { count: "exact", head: true })
            .eq("cs_status", status),
        ),
      );
      results.forEach((result, index) => {
        if (result.error) throw result.error;
        const count = result.count ?? 0;
        if (count > 0) c[CS_STATUSES[index]] = count;
      });
      return c;
    },
  });
  const today = toIsoDay(new Date());
  const [preset, setPreset] = useState<DatePreset>("all");
  const [fromDate, setFromDate] = useState<string>(today);
  const [toDate, setToDate] = useState<string>(today);
  const range = useMemo(() => computeRange(preset, fromDate, toDate), [preset, fromDate, toDate]);

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

  const byProcessor = useQuery({
    queryKey: ["report-forwarded-by-processor", range.from, range.to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("report_leads_forwarded_by_processor", {
        _from: range.from ?? undefined,
        _to: range.to ?? undefined,
      });
      if (error) throw error;
      return (data ?? []) as Array<{
        processor_id: string | null;
        processor_name: string;
        processor_email: string | null;
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
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={exportReport}>
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Export counts
        </Button>
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
        <div className="bg-card border rounded-lg overflow-hidden">
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
                <span className="text-red-600 font-medium">{totals.no} no</span> ·{" "}
                {totals.pending} pending
              </span>
              <Button size="sm" variant="outline" onClick={exportByAccount}>
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Export CSV
              </Button>
            </div>
          </div>

          <div className="max-h-[560px] overflow-auto">
            <table className="w-full text-sm">
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

      <Section title="Leads forwarded per processor">
        <div className="bg-card border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b text-xs text-muted-foreground">
            Uses the same range controls above: Today, Yesterday, Weekly, Monthly, or Custom.
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-medium">Processor</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium text-right">Forwarded</th>
              </tr>
            </thead>
            <tbody>
              {byProcessor.isLoading && (
                <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!byProcessor.isLoading && (byProcessor.data ?? []).length === 0 && (
                <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">No leads forwarded in this range.</td></tr>
              )}
              {(byProcessor.data ?? []).map((r, i) => (
                <tr key={r.processor_id ?? `unknown-${i}`} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-2 font-medium">{r.processor_name}</td>
                  <td className="px-4 py-2 text-muted-foreground">{r.processor_email ?? "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold">{r.forwarded_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Number-not-found checks per user">
        <div className="bg-card border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b text-xs text-muted-foreground">
            Counts raw leads marked as “Number not found”. Uses the same date range as above.
            Only marks made after this report was added are attributed to a user.
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-medium">User</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium text-right">Marked not found</th>
              </tr>
            </thead>
            <tbody>
              {notFoundByUser.isLoading && (
                <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!notFoundByUser.isLoading && (notFoundByUser.data ?? []).length === 0 && (
                <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">No “Number not found” marks in this range.</td></tr>
              )}
              {(notFoundByUser.data ?? []).map((r, i) => (
                <tr key={r.user_id ?? `unknown-${i}`} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-2 font-medium">{r.user_name}</td>
                  <td className="px-4 py-2 text-muted-foreground">{r.user_email ?? "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold">{r.not_found_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}


function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
        {title}
      </h2>
      {children}
    </div>
  );
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">{children}</div>;
}
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-card border rounded-lg p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground capitalize">
        {label}
      </div>
      <div className="text-3xl font-semibold mt-1">{value}</div>
    </div>
  );
}
