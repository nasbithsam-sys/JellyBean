import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { format, subDays, startOfDay } from "date-fns";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar } from "recharts";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/app/analytics")({ component: Page });

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

  const raw = useQuery({
    queryKey: ["analytics-raw", since],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_leads")
        .select("captured_at, status")
        .gte("captured_at", since)
        .limit(5000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const qual = useQuery({
    queryKey: ["analytics-qual", since],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qualified_leads")
        .select("assigned_at, cs_status")
        .gte("assigned_at", since)
        .limit(5000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const series = useMemo(() => {
    const days = Array.from({ length: 30 }, (_, i) => {
      const d = startOfDay(subDays(new Date(), 29 - i));
      return { day: format(d, "MMM d"), key: format(d, "yyyy-MM-dd"), captured: 0, qualified: 0, cancelled: 0, sentToCS: 0 };
    });
    const idx = new Map(days.map((d, i) => [d.key, i] as const));
    (raw.data ?? []).forEach((r) => {
      const k = format(new Date(r.captured_at), "yyyy-MM-dd");
      const i = idx.get(k);
      if (i === undefined) return;
      days[i].captured += 1;
      if (r.status === "qualified") days[i].qualified += 1;
      if (r.status === "cancelled") days[i].cancelled += 1;
    });
    (qual.data ?? []).forEach((q) => {
      const k = format(new Date(q.assigned_at), "yyyy-MM-dd");
      const i = idx.get(k);
      if (i === undefined) return;
      days[i].sentToCS += 1;
    });
    return days;
  }, [raw.data, qual.data]);

  const csBuckets = useMemo(() => {
    const c: Record<string, number> = {};
    (qual.data ?? []).forEach((q) => { c[q.cs_status] = (c[q.cs_status] ?? 0) + 1; });
    return Object.entries(c).map(([status, count]) => ({ status: status.replace(/_/g, " "), count }));
  }, [qual.data]);

  const totals = useMemo(() => {
    const t = { captured: 0, qualified: 0, sentToCS: 0 };
    series.forEach((d) => { t.captured += d.captured; t.qualified += d.qualified; t.sentToCS += d.sentToCS; });
    return t;
  }, [series]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Metric label="Total captured" value={totals.captured} sub="last 30 days" />
        <Metric label="Qualified" value={totals.qualified} sub={`${totals.captured ? Math.round((totals.qualified / totals.captured) * 100) : 0}% conversion`} />
        <Metric label="Sent to CS" value={totals.sentToCS} sub="handoffs" />
      </div>

      <Card title="Lead flow" subtitle="Captured / qualified / cancelled by day">
        <div className="h-72">
          <ResponsiveContainer>
            <AreaChart data={series} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="gradCap" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradQual" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-success)" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="var(--color-success)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} interval={4} />
              <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} allowDecimals={false} />
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
              <Area type="monotone" dataKey="captured" stroke="var(--color-primary)" strokeWidth={2} fill="url(#gradCap)" />
              <Area type="monotone" dataKey="qualified" stroke="var(--color-success)" strokeWidth={2} fill="url(#gradQual)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="Sent to CS" subtitle="Per day">
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={series} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} interval={4} />
                <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="sentToCS" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="CS pipeline" subtitle="Distribution by status">
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={csBuckets} layout="vertical" margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis dataKey="status" type="category" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} width={110} />
                <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
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
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-medium">{label}</div>
      <div className="text-[34px] font-semibold tracking-tight mt-2 tabular-nums">{value}</div>
      {sub && <div className="text-[12px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
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
