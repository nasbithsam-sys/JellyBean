import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { startOfDay } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody } from "@/components/page";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/app/")({
  component: DashboardHome,
});

function DashboardHome() {
  const auth = useAuth();
  const role = auth.primaryRole;

  return (
    <div>
      <PageHeader
        title={`Welcome${auth.profile?.full_name ? `, ${auth.profile.full_name}` : ""}`}
        description={
          role === "admin"
            ? "Full operational overview."
            : role === "marketing"
              ? "Review raw leads and qualify them for CS."
              : role === "cs"
                ? "Work your assigned leads."
                : ""
        }
      />
      <PageBody>
        {role === "admin" && <AdminCards />}
        {role === "marketing" && <MarketingCards />}
        {role === "cs" && <CSCards />}
      </PageBody>
    </div>
  );
}

function useToday(table: "raw_leads" | "qualified_leads", field: "captured_at" | "assigned_at", extra?: { col: string; val: string }) {
  return useQuery({
    queryKey: ["dash-today", table, field, extra?.col, extra?.val],
    queryFn: async () => {
      const since = startOfDay(new Date()).toISOString();
      let q = supabase.from(table).select("id", { count: "exact", head: true }).gte(field, since);
      if (extra) q = q.eq(extra.col, extra.val as never);
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
  });
}

function AdminCards() {
  const captured = useToday("raw_leads", "captured_at");
  const qualified = useToday("raw_leads", "captured_at", { col: "status", val: "qualified" });
  const sentToCS = useToday("qualified_leads", "assigned_at");
  const converted = useToday("qualified_leads", "assigned_at", { col: "cs_status", val: "converted" });
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard label="Raw leads (today)" value={captured.data} hint="From sources" />
      <StatCard label="Qualified (today)" value={qualified.data} hint="Marketing approved" />
      <StatCard label="Sent to CS (today)" value={sentToCS.data} hint="In customer service" />
      <StatCard label="Converted (today)" value={converted.data} hint="Successfully closed" />
    </div>
  );
}

function MarketingCards() {
  const pending = useQuery({
    queryKey: ["dash-pending"],
    queryFn: async () => {
      const { count, error } = await supabase.from("raw_leads").select("id", { count: "exact", head: true }).eq("status", "new");
      if (error) throw error;
      return count ?? 0;
    },
  });
  const sent = useToday("qualified_leads", "assigned_at");
  const cancelled = useToday("raw_leads", "captured_at", { col: "status", val: "cancelled" });
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <StatCard label="Pending review" value={pending.data} />
      <StatCard label="Sent to CS today" value={sent.data} />
      <StatCard label="Cancelled today" value={cancelled.data} />
    </div>
  );
}

function CSCards() {
  const newCount = useQuery({
    queryKey: ["dash-cs-new"],
    queryFn: async () => {
      const { count, error } = await supabase.from("qualified_leads").select("id", { count: "exact", head: true }).eq("cs_status", "new");
      if (error) throw error;
      return count ?? 0;
    },
  });
  const followups = useQuery({
    queryKey: ["dash-cs-followups"],
    queryFn: async () => {
      const { count, error } = await supabase.from("qualified_leads").select("id", { count: "exact", head: true }).eq("cs_status", "follow_up");
      if (error) throw error;
      return count ?? 0;
    },
  });
  const converted = useToday("qualified_leads", "assigned_at", { col: "cs_status", val: "converted" });
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <StatCard label="New leads" value={newCount.data} />
      <StatCard label="Follow-ups" value={followups.data} />
      <StatCard label="Converted today" value={converted.data} />
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: number | undefined; hint?: string }) {
  return (
    <div className="bg-card border rounded-lg p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-3xl font-semibold mt-1">{value ?? "—"}</div>
      {hint && <div className="text-xs text-muted-foreground mt-2">{hint}</div>}
    </div>
  );
}
