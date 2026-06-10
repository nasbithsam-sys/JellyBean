import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { downloadCsv } from "@/lib/crm-lite";

export const Route = createFileRoute("/app/reports")({ component: Page });

const RAW_STATUSES = ["new", "qualified", "cancelled"] as const;
const CS_STATUSES = [
  "new",
  "called",
  "messaged",
  "follow_up",
  "interested",
  "converted",
  "closed_won",
  "closed_lost",
  "undeliver",
  "wrong_number",
  "already_got_someone",
  "service_provider_himself",
  "need_follow_up",
] as const;

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

function Inner() {
  const raw = useQuery({
    queryKey: ["report-raw"],
    queryFn: async () => {
      const results = await Promise.all(
        RAW_STATUSES.map((status) => {
          let q = supabase
            .from("raw_lead_cache")
            .select("id", { count: "exact", head: true });
          if (status === "qualified") q = q.eq("lead", "yes");
          else if (status === "cancelled") q = q.eq("lead", "no");
          else q = q.is("lead", null);
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

  function exportReport() {
    downloadCsv(
      "crm-report.csv",
      ["Section", "Metric", "Value"],
      [
        ...Object.entries(raw.data ?? {}).map(([label, value]) => ["Raw leads", label, value]),
        ...Object.entries(cs.data ?? {}).map(([label, value]) => [
          "CS pipeline",
          label.replace(/_/g, " "),
          value,
        ]),
        ["Sources", "Total accounts", accountsCount.data ?? 0],
      ],
    );
  }

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
            <Stat key={k} label={k} value={v} />
          ))}
        </Grid>
      </Section>
      <Section title="CS pipeline by status">
        <Grid>
          {Object.entries(cs.data ?? {}).map(([k, v]) => (
            <Stat key={k} label={k.replace(/_/g, " ")} value={v} />
          ))}
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
