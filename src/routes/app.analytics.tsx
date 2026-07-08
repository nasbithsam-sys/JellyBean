import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { addDays, differenceInCalendarDays, format, subDays, startOfDay } from "date-fns";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
  ComposedChart,
  Line,
} from "recharts";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/analytics")({ component: Page });

type CsStatus = Database["public"]["Enums"]["cs_status"];

const CS_STATUSES = [
  "new",
  "undeliver",
  "wrong_number",
  "wrong_lead",
  "already_got_someone",
  "service_provider_himself",
  "converted",
  "need_follow_up",
] as const satisfies readonly CsStatus[];

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

const PIE_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-primary-glow)",
  "var(--color-success)",
  "var(--color-warning)",
];

function Page() {
  const auth = useAuth();
  return (
    <div>
      <PageHeader title="Analytics" description="Pipeline health, throughput, and top performers." />
      <PageBody>
        <RoleGate allow={["admin", "sub_admin"]} current={auth.primaryRole}>
          <Inner isAdmin={auth.primaryRole === "admin" || auth.primaryRole === "sub_admin"} />
        </RoleGate>
      </PageBody>
    </div>
  );
}

type DailyRow = {
  day: string;
  key: string;
  start: string;
  end: string;
  captured: number;
  forwarded: number;
  wrong: number;
  sentToCS: number;
};

async function fetchDailySeries(fromISO: string, toISO: string, startDate: Date, endDate: Date) {
  const daysCount = Math.max(
    1,
    Math.min(180, Math.ceil((endDate.getTime() - startDate.getTime()) / 86_400_000)),
  );
  const days: DailyRow[] = Array.from({ length: daysCount }, (_, i) => {
    const d = addDays(startDate, i);
    return {
      day: format(d, "MMM d"),
      key: format(d, "yyyy-MM-dd"),
      start: d.toISOString(),
      end: addDays(d, 1).toISOString(),
      captured: 0,
      forwarded: 0,
      wrong: 0,
      sentToCS: 0,
    };
  });
  const { data, error } = await supabase.rpc("get_analytics_daily_stats", {
    _start_date: fromISO,
    _end_date: toISO,
  });
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const statsMap = new Map((data ?? []).map((row: any) => [row.day_key, row]));
  days.forEach((day) => {
    const dbRow = statsMap.get(day.key);
    if (dbRow) {
      day.captured = Number(dbRow.total_captured);
      day.forwarded = Number(dbRow.forwarded_count);
      day.wrong = Number(dbRow.wrong_count);
      day.sentToCS = Number(dbRow.sent_to_cs_count);
    }
  });
  return days;
}

function Inner({ isAdmin }: { isAdmin: boolean }) {
  const today = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);
  const defaultFrom = useMemo(() => format(startOfDay(subDays(new Date(), 29)), "yyyy-MM-dd"), []);
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(today);
  const range = useMemo(() => {
    const start = startOfDay(new Date(`${fromDate}T00:00:00`));
    const end = addDays(startOfDay(new Date(`${toDate || fromDate}T00:00:00`)), 1);
    const days = Math.max(1, differenceInCalendarDays(end, start));
    const prevStart = subDays(start, days);
    return {
      start,
      end,
      days,
      since: start.toISOString(),
      until: end.toISOString(),
      prevStart,
      prevSince: prevStart.toISOString(),
      prevUntil: start.toISOString(),
    };
  }, [fromDate, toDate]);

  const analytics = useQuery({
    queryKey: ["analytics-v2", range.since, range.until],
    queryFn: async () => {
      const [series, prevSeries, csResults, accountsRes, forwardersRes, notFoundRes] =
        await Promise.all([
          fetchDailySeries(range.since, range.until, range.start, range.end),
          fetchDailySeries(range.prevSince, range.prevUntil, range.prevStart, range.start),
          Promise.all(
            CS_STATUSES.map((status) =>
              supabase
                .from("qualified_leads")
                .select("id", { count: "exact", head: true })
                .eq("cs_status", status)
                .gte("assigned_at", range.since)
                .lt("assigned_at", range.until),
            ),
          ),
          supabase.rpc("report_leads_by_account", { _from: range.since, _to: range.until }),
          isAdmin
            ? supabase.rpc("report_leads_forwarded_by_maturing", {
                _from: range.since,
                _to: range.until,
              })
            : Promise.resolve({ data: [], error: null }),
          isAdmin
            ? supabase.rpc("report_not_found_by_user", {
                _from: range.since,
                _to: range.until,
              })
            : Promise.resolve({ data: [], error: null }),
        ]);

      const csBuckets = csResults
        .map((result, index) => {
          if (result.error) throw result.error;
          return {
            key: CS_STATUSES[index],
            status: CS_LABELS[CS_STATUSES[index]] ?? CS_STATUSES[index].replace(/_/g, " "),
            count: result.count ?? 0,
          };
        })
        .filter((b) => b.count > 0)
        .sort((a, b) => b.count - a.count);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const accounts = (accountsRes.data ?? []) as any[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const forwarders = (forwardersRes.data ?? []) as any[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const notFound = (notFoundRes.data ?? []) as any[];

      return { series, prevSeries, csBuckets, accounts, forwarders, notFound };
    },
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });

  const series = analytics.data?.series ?? [];
  const prevSeries = analytics.data?.prevSeries ?? [];
  const csBuckets = analytics.data?.csBuckets ?? [];
  const accounts = analytics.data?.accounts ?? [];
  const forwarders = analytics.data?.forwarders ?? [];
  const notFound = analytics.data?.notFound ?? [];

  const totals = useMemo(() => {
    const t = { captured: 0, forwarded: 0, sentToCS: 0, wrong: 0 };
    series.forEach((d) => {
      t.captured += d.captured;
      t.forwarded += d.forwarded;
      t.sentToCS += d.sentToCS;
      t.wrong += d.wrong;
    });
    return t;
  }, [series]);

  const prevTotals = useMemo(() => {
    const t = { captured: 0, forwarded: 0, sentToCS: 0, wrong: 0 };
    prevSeries.forEach((d) => {
      t.captured += d.captured;
      t.forwarded += d.forwarded;
      t.sentToCS += d.sentToCS;
      t.wrong += d.wrong;
    });
    return t;
  }, [prevSeries]);

  const converted = useMemo(
    () => csBuckets.find((b) => b.key === "converted")?.count ?? 0,
    [csBuckets],
  );
  const csTotal = useMemo(() => csBuckets.reduce((s, b) => s + b.count, 0), [csBuckets]);
  const conversionRate = totals.forwarded ? (converted / totals.forwarded) * 100 : 0;

  const bestDay = useMemo(() => {
    if (!series.length) return null;
    return [...series].sort((a, b) => b.captured - a.captured)[0];
  }, [series]);

  const cumulativeSeries = useMemo(() => {
    let cCap = 0;
    let cFwd = 0;
    return series.map((d) => {
      cCap += d.captured;
      cFwd += d.forwarded;
      return { ...d, cumulativeCaptured: cCap, cumulativeForwarded: cFwd };
    });
  }, [series]);

  const funnel = useMemo(() => {
    const captured = totals.captured;
    const forwarded = totals.forwarded;
    const sentToCS = totals.sentToCS;
    const conv = converted;
    return [
      { stage: "Captured", value: captured, pct: 100 },
      {
        stage: "Forwarded",
        value: forwarded,
        pct: captured ? (forwarded / captured) * 100 : 0,
      },
      {
        stage: "Sent to CS",
        value: sentToCS,
        pct: captured ? (sentToCS / captured) * 100 : 0,
      },
      {
        stage: "Converted",
        value: conv,
        pct: captured ? (conv / captured) * 100 : 0,
      },
    ];
  }, [totals, converted]);

  return (
    <div className="space-y-5">
      <div className="crm-toolbar-panel">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value || defaultFrom)}
            className="h-9 w-[150px]"
          />
          <Input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value || today)}
            className="h-9 w-[150px]"
          />
          <Button size="sm" variant="outline" className="h-9" onClick={() => { setFromDate(today); setToDate(today); }}>Today</Button>
          <Button size="sm" variant="outline" className="h-9" onClick={() => { setFromDate(format(subDays(new Date(), 6), "yyyy-MM-dd")); setToDate(today); }}>7d</Button>
          <Button size="sm" variant="outline" className="h-9" onClick={() => { setFromDate(defaultFrom); setToDate(today); }}>30d</Button>
          <Button size="sm" variant="outline" className="h-9" onClick={() => { setFromDate(format(subDays(new Date(), 89), "yyyy-MM-dd")); setToDate(today); }}>90d</Button>
          <div className="ml-auto text-[11px] text-muted-foreground">
            vs previous {range.days}d
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard label="Captured" value={totals.captured} prev={prevTotals.captured} />
        <KpiCard label="Forwarded" value={totals.forwarded} prev={prevTotals.forwarded} sub={`${totals.captured ? Math.round((totals.forwarded / totals.captured) * 100) : 0}% of captured`} />
        <KpiCard label="Sent to CS" value={totals.sentToCS} prev={prevTotals.sentToCS} />
        <KpiCard label="Converted" value={converted} sub={`${conversionRate.toFixed(1)}% of forwarded`} accent="success" />
        <KpiCard label="Wrong posts" value={totals.wrong} prev={prevTotals.wrong} accent="destructive" invertDelta />
        <KpiCard
          label="Avg / day"
          value={Math.round(totals.captured / Math.max(1, range.days))}
          sub={bestDay ? `Peak ${bestDay.day} · ${bestDay.captured}` : undefined}
        />
      </div>

      {/* Main flow */}
      <Card title="Lead flow" subtitle="Daily captured, forwarded, sent to CS + cumulative capture">
        <div className="h-80">
          <ResponsiveContainer>
            <ComposedChart data={cumulativeSeries} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="gradCap" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.42} />
                  <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradFwd" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-success)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="var(--color-success)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} interval={Math.max(0, Math.floor(cumulativeSeries.length / 10))} />
              <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} allowDecimals={false} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "var(--color-muted-foreground)" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area yAxisId="left" type="monotone" name="Captured" dataKey="captured" stroke="var(--color-primary)" strokeWidth={2} fill="url(#gradCap)" />
              <Area yAxisId="left" type="monotone" name="Forwarded" dataKey="forwarded" stroke="var(--color-success)" strokeWidth={2} fill="url(#gradFwd)" />
              <Bar yAxisId="left" name="Sent to CS" dataKey="sentToCS" fill="var(--color-chart-3)" radius={[3, 3, 0, 0]} barSize={10} />
              <Line yAxisId="right" type="monotone" name="Cumulative captured" dataKey="cumulativeCaptured" stroke="var(--color-primary-glow)" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Funnel + CS donut */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card title="Conversion funnel" subtitle="Drop-off from capture to converted" className="lg:col-span-2">
          <div className="space-y-3 py-2">
            {funnel.map((f, i) => (
              <div key={f.stage} className="space-y-1">
                <div className="flex items-baseline justify-between text-[12px]">
                  <span className="font-semibold tracking-tight">{f.stage}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {f.value.toLocaleString()} <span className="opacity-60">· {f.pct.toFixed(1)}%</span>
                  </span>
                </div>
                <div className="h-3 rounded-full bg-muted/40 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.max(0.5, f.pct)}%`,
                      background: `linear-gradient(90deg, var(--color-chart-${(i % 5) + 1}), var(--color-primary-glow))`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="CS pipeline" subtitle={`${csTotal} in queue`}>
          <div className="h-[220px]">
            <ResponsiveContainer>
              <PieChart>
                <Tooltip contentStyle={tooltipStyle} />
                <Pie
                  data={csBuckets}
                  dataKey="count"
                  nameKey="status"
                  innerRadius={52}
                  outerRadius={82}
                  paddingAngle={2}
                  stroke="var(--color-card)"
                  strokeWidth={2}
                >
                  {csBuckets.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-2 space-y-1 text-[11.5px]">
            {csBuckets.slice(0, 6).map((b, i) => (
              <li key={b.key} className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                <span className="flex-1 truncate">{b.status}</span>
                <span className="tabular-nums text-muted-foreground">{b.count}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Top accounts + Sent to CS by day */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="Top accounts" subtitle="By total leads in range">
          {accounts.length === 0 ? (
            <EmptyState label="No account data in this range" />
          ) : (
            <ul className="space-y-2">
              {accounts.slice(0, 8).map((a) => {
                const total = Number(a.total_count);
                const yes = Number(a.yes_count);
                const pct = total ? (yes / total) * 100 : 0;
                const max = Number(accounts[0].total_count) || 1;
                return (
                  <li key={a.account} className="space-y-1">
                    <div className="flex items-baseline justify-between text-[12px]">
                      <span className="font-medium tracking-tight truncate max-w-[60%]">{a.account}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {total} <span className="opacity-60">· {pct.toFixed(0)}% yes</span>
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted/40 overflow-hidden flex">
                      <div className="h-full bg-success/80" style={{ width: `${(yes / max) * 100}%` }} />
                      <div className="h-full bg-primary/50" style={{ width: `${((total - yes) / max) * 100}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Sent to CS" subtitle="Handoffs per day">
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={series} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} interval={Math.max(0, Math.floor(series.length / 8))} />
                <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="sentToCS" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Team leaderboards (admin) */}
      {isAdmin && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Card title="Top forwarders" subtitle="Qualified leads assigned">
            {forwarders.length === 0 ? (
              <EmptyState label="No forwarding activity in this range" />
            ) : (
              <Leaderboard
                rows={forwarders.map((r) => ({
                  label: r.maturing_name ?? "(unknown)",
                  sub: r.maturing_email,
                  value: Number(r.forwarded_count),
                }))}
                accent="var(--color-primary)"
              />
            )}
          </Card>
          <Card title="Not-found by user" subtitle="Marked as not_found in range">
            {notFound.length === 0 ? (
              <EmptyState label="No not-found activity in this range" />
            ) : (
              <Leaderboard
                rows={notFound.map((r) => ({
                  label: r.user_name ?? "(unknown)",
                  sub: r.user_email,
                  value: Number(r.not_found_count),
                }))}
                accent="var(--color-warning)"
              />
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

const tooltipStyle: React.CSSProperties = {
  background: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  fontSize: 12,
  boxShadow: "var(--shadow-md)",
  backdropFilter: "blur(14px)",
};

function KpiCard({
  label,
  value,
  prev,
  sub,
  accent,
  invertDelta,
}: {
  label: string;
  value: number;
  prev?: number;
  sub?: string;
  accent?: "success" | "destructive";
  invertDelta?: boolean;
}) {
  const delta = prev !== undefined ? value - prev : undefined;
  const pct = prev !== undefined && prev > 0 ? ((value - prev) / prev) * 100 : undefined;
  const isUp = delta !== undefined && delta > 0;
  const isDown = delta !== undefined && delta < 0;
  const good = invertDelta ? isDown : isUp;
  const bad = invertDelta ? isUp : isDown;
  return (
    <div className="crm-surface-card p-4">
      <div className="flex items-center justify-between">
        <div className="crm-kicker">{label}</div>
        {delta !== undefined && delta !== 0 && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md tabular-nums",
              good && "bg-success/15 text-success",
              bad && "bg-destructive/15 text-destructive",
            )}
          >
            {isUp ? <ArrowUpRight className="h-3 w-3" /> : isDown ? <ArrowDownRight className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
            {pct !== undefined ? `${Math.abs(pct).toFixed(0)}%` : Math.abs(delta)}
          </span>
        )}
      </div>
      <div
        className={cn(
          "crm-card-value mt-2 tabular-nums",
          accent === "success" && "text-success",
          accent === "destructive" && "text-destructive",
        )}
      >
        {value.toLocaleString()}
      </div>
      {sub && <div className="crm-card-label mt-1">{sub}</div>}
    </div>
  );
}

function Leaderboard({
  rows,
  accent,
}: {
  rows: { label: string; sub?: string | null; value: number }[];
  accent: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ol className="space-y-2">
      {rows.slice(0, 8).map((r, i) => (
        <li key={`${r.label}-${i}`} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2 text-[12px]">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="w-4 text-muted-foreground tabular-nums text-[11px]">{i + 1}</span>
              <span className="font-medium tracking-tight truncate">{r.label}</span>
              {r.sub && <span className="text-[10.5px] text-muted-foreground truncate">{r.sub}</span>}
            </div>
            <span className="tabular-nums font-semibold">{r.value}</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: accent }} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="text-[12px] text-muted-foreground py-6 text-center">{label}</div>;
}

function Card({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("crm-surface-card p-5", className)}>
      <div className="mb-4">
        <h3 className="crm-section-title">{title}</h3>
        {subtitle && <p className="crm-card-label mt-1">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
