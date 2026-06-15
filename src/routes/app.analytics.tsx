import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { addDays, format, subDays, startOfDay } from "date-fns";
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
} from "recharts";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

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

function Page() {
  const auth = useAuth();
  return (
    <div>
      <PageHeader title="Analytics" description="The last 30 days at a glance." />
      <PageBody>
        <RoleGate allow={["admin"]} current={auth.primaryRole}>
          <Inner />
        </RoleGate>
      </PageBody>
    </div>
  );
}

function Inner() {
  const since = useMemo(() => startOfDay(subDays(new Date(), 29)).toISOString(), []);

  const analytics = useQuery({
    queryKey: ["analytics-counts", since],
    queryFn: async () => {
      const days = Array.from({ length: 30 }, (_, i) => {
        const d = startOfDay(subDays(new Date(), 29 - i));
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

      const countRaw = (start: string, end: string, category?: "forwarded" | "wrong") => {
        let q = supabase
          .from("raw_lead_cache")
          .select("id", { count: "exact", head: true })
          .gte("captured_at", start)
          .lt("captured_at", end);
        if (category) q = q.eq("category", category);
        return q;
      };
      const countQualified = (start: string, end: string) =>
        supabase
          .from("qualified_leads")
          .select("id", { count: "exact", head: true })
          .gte("assigned_at", start)
          .lt("assigned_at", end);

      const results = await Promise.all(
        days.flatMap((d) => [
          countRaw(d.start, d.end),
          countRaw(d.start, d.end, "forwarded"),
          countRaw(d.start, d.end, "wrong"),
          countQualified(d.start, d.end),
        ]),
      );

      results.forEach((result, index) => {
        if (result.error) throw result.error;
        const day = days[Math.floor(index / 4)];
        const metric = index % 4;
        if (metric === 0) day.captured = result.count ?? 0;
        if (metric === 1) day.forwarded = result.count ?? 0;
        if (metric === 2) day.wrong = result.count ?? 0;
        if (metric === 3) day.sentToCS = result.count ?? 0;
      });

      const csResults = await Promise.all(
        CS_STATUSES.map((status) =>
          supabase
            .from("qualified_leads")
            .select("id", { count: "exact", head: true })
            .eq("cs_status", status)
            .gte("assigned_at", since),
        ),
      );
      const csBuckets = csResults
        .map((result, index) => {
          if (result.error) throw result.error;
          return {
            status: CS_LABELS[CS_STATUSES[index]] ?? CS_STATUSES[index].replace(/_/g, " "),
            count: result.count ?? 0,
          };
        })
        .filter((bucket) => bucket.count > 0);

      return { series: days, csBuckets };
    },
    staleTime: 5 * 60_000,
  });

  const series = useMemo(() => analytics.data?.series ?? [], [analytics.data?.series]);
  const csBuckets = useMemo(() => analytics.data?.csBuckets ?? [], [analytics.data?.csBuckets]);

  const totals = useMemo(() => {
    const t = { captured: 0, forwarded: 0, sentToCS: 0 };
    series.forEach((d) => {
      t.captured += d.captured;
      t.forwarded += d.forwarded;
      t.sentToCS += d.sentToCS;
    });
    return t;
  }, [series]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Metric label="Total captured" value={totals.captured} sub="last 30 days" />
        <Metric
          label="Forwarded"
          value={totals.forwarded}
          sub={`${totals.captured ? Math.round((totals.forwarded / totals.captured) * 100) : 0}% of captured`}
        />
        <Metric label="Sent to CS" value={totals.sentToCS} sub="handoffs" />
      </div>

      <Card title="Lead flow" subtitle="Captured / forwarded / wrong posts by day">
        <div className="h-72">
          <ResponsiveContainer>
            <AreaChart data={series} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="gradCap" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradForwarded" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-success)" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="var(--color-success)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                interval={4}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--color-popover)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  fontSize: 12,
                  boxShadow: "var(--shadow-md)",
                }}
                labelStyle={{ color: "var(--color-muted-foreground)" }}
              />
              <Area
                type="monotone"
                dataKey="captured"
                stroke="var(--color-primary)"
                strokeWidth={2}
                fill="url(#gradCap)"
              />
              <Area
                type="monotone"
                dataKey="forwarded"
                stroke="var(--color-success)"
                strokeWidth={2}
                fill="url(#gradForwarded)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="Sent to CS" subtitle="Per day">
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={series} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid
                  stroke="var(--color-border)"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  interval={4}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="sentToCS" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="CS pipeline" subtitle="Distribution by status">
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart
                data={csBuckets}
                layout="vertical"
                margin={{ top: 10, right: 10, left: 10, bottom: 0 }}
              >
                <CartesianGrid
                  stroke="var(--color-border)"
                  strokeDasharray="3 3"
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  dataKey="status"
                  type="category"
                  tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  width={110}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="count" fill="var(--color-primary-glow)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="glass-card p-5">
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-medium">
        {label}
      </div>
      <div className="text-[34px] font-semibold tracking-tight mt-2 tabular-nums">{value}</div>
      {sub && <div className="text-[12px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="glass-card p-5">
      <div className="mb-4">
        <h3 className="text-[13px] font-semibold tracking-tight">{title}</h3>
        {subtitle && <p className="text-[11.5px] text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
