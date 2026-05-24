import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { format, subDays, startOfDay } from "date-fns";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, Legend } from "recharts";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/app/analytics")({ component: Page });

function Page() {
  const auth = useAuth();
  return (
    <div>
      <PageHeader title="Analytics" description="Last 30 days of lead activity." />
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

  return (
    <div className="space-y-6">
      <Card title="Raw leads captured / qualified / cancelled (per day)">
        <div className="h-72">
          <ResponsiveContainer>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="captured" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="qualified" stroke="hsl(var(--success, 142 71% 45%))" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="cancelled" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title="Leads sent to CS (per day)">
        <div className="h-64">
          <ResponsiveContainer>
            <BarChart data={series}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="sentToCS" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title="CS pipeline distribution">
        <div className="h-64">
          <ResponsiveContainer>
            <BarChart data={csBuckets} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis dataKey="status" type="category" tick={{ fontSize: 11 }} width={110} />
              <Tooltip />
              <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border rounded-lg p-5">
      <h3 className="text-sm font-semibold mb-4">{title}</h3>
      {children}
    </div>
  );
}
