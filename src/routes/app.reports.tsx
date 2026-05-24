import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/app/reports")({ component: Page });

function Page() {
  const auth = useAuth();
  return (
    <div>
      <PageHeader title="Reports" description="Operational counts across the pipeline." />
      <PageBody>
        <RoleGate allow={["admin"]} current={auth.primaryRole}>
          <Inner />
        </RoleGate>
      </PageBody>
    </div>
  );
}

function useCount(table: "raw_leads" | "qualified_leads" | "accounts", filter?: (q: ReturnType<typeof supabase.from>) => unknown, key?: string) {
  return useQuery({
    queryKey: ["count", table, key],
    queryFn: async () => {
      let q = supabase.from(table).select("id", { count: "exact", head: true });
      if (filter) q = filter(q as never) as never;
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
  });
}

function Page2() { return null; }

function Inner() {
  const raw = useQuery({
    queryKey: ["report-raw"],
    queryFn: async () => {
      const { data, error } = await supabase.from("raw_leads").select("status");
      if (error) throw error;
      const c: Record<string, number> = { new: 0, qualified: 0, cancelled: 0 };
      (data ?? []).forEach((r) => { c[r.status] = (c[r.status] ?? 0) + 1; });
      return c;
    },
  });
  const cs = useQuery({
    queryKey: ["report-cs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("qualified_leads").select("cs_status");
      if (error) throw error;
      const c: Record<string, number> = {};
      (data ?? []).forEach((r) => { c[r.cs_status] = (c[r.cs_status] ?? 0) + 1; });
      return c;
    },
  });
  const accountsCount = useCount("accounts");

  return (
    <div className="space-y-8">
      <Section title="Raw leads by status">
        <Grid>
          {Object.entries(raw.data ?? {}).map(([k, v]) => <Stat key={k} label={k} value={v} />)}
        </Grid>
      </Section>
      <Section title="CS pipeline by status">
        <Grid>
          {Object.entries(cs.data ?? {}).map(([k, v]) => <Stat key={k} label={k.replace(/_/g, " ")} value={v} />)}
        </Grid>
      </Section>
      <Section title="Sources">
        <Grid>
          <Stat label="Total accounts" value={accountsCount.data ?? 0} />
        </Grid>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">{title}</h2>
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
      <div className="text-xs uppercase tracking-wide text-muted-foreground capitalize">{label}</div>
      <div className="text-3xl font-semibold mt-1">{value}</div>
    </div>
  );
}
