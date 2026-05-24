import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { startOfDay } from "date-fns";
import { ArrowUpRight, Inbox, CheckCircle2, Send, Trophy, Clock, AlertCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody } from "@/components/page";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/")({
  component: DashboardHome,
});

function DashboardHome() {
  const auth = useAuth();
  const role = auth.primaryRole;
  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  })();
  const firstName = auth.profile?.full_name?.split(" ")[0];

  return (
    <div>
      <PageHeader
        title={`${greeting}${firstName ? `, ${firstName}` : ""}`}
        description={
          role === "admin"
            ? "Here's what's happening across your lead operations today."
            : role === "marketing"
              ? "Review captured leads and qualify the ones worth pursuing."
              : role === "cs"
                ? "Stay on top of your assigned customer leads."
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
      <StatCard label="Raw leads" value={captured.data} hint="Captured today" icon={Inbox} tone="primary" />
      <StatCard label="Qualified" value={qualified.data} hint="Marketing approved" icon={CheckCircle2} tone="success" />
      <StatCard label="Sent to CS" value={sentToCS.data} hint="Handed off today" icon={Send} tone="primary" />
      <StatCard label="Converted" value={converted.data} hint="Closed today" icon={Trophy} tone="warning" />
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
      <StatCard label="Pending review" value={pending.data} icon={Clock} tone="primary" hint="Awaiting your call" />
      <StatCard label="Sent to CS" value={sent.data} icon={Send} tone="success" hint="Today" />
      <StatCard label="Cancelled" value={cancelled.data} icon={AlertCircle} tone="destructive" hint="Today" />
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
      <StatCard label="New leads" value={newCount.data} icon={Inbox} tone="primary" />
      <StatCard label="Follow-ups" value={followups.data} icon={Clock} tone="warning" />
      <StatCard label="Converted today" value={converted.data} icon={Trophy} tone="success" />
    </div>
  );
}

type Tone = "primary" | "success" | "warning" | "destructive";
const TONE: Record<Tone, { ring: string; icon: string; chip: string }> = {
  primary: { ring: "from-primary/15 to-primary/0", icon: "text-primary", chip: "bg-primary/10 text-primary" },
  success: { ring: "from-success/15 to-success/0", icon: "text-success", chip: "bg-success/10 text-success" },
  warning: { ring: "from-warning/20 to-warning/0", icon: "text-warning", chip: "bg-warning/10 text-warning" },
  destructive: { ring: "from-destructive/15 to-destructive/0", icon: "text-destructive", chip: "bg-destructive/10 text-destructive" },
};

function StatCard({
  label, value, hint, icon: Icon, tone = "primary",
}: { label: string; value: number | undefined; hint?: string; icon: React.ComponentType<{ className?: string }>; tone?: Tone }) {
  const t = TONE[tone];
  return (
    <div className="glass-card relative overflow-hidden p-5 group hover:border-border-strong transition-all">
      <div className={cn("absolute -top-12 -right-12 h-32 w-32 rounded-full bg-gradient-to-br opacity-70 blur-2xl pointer-events-none", t.ring)} />
      <div className="flex items-center justify-between relative">
        <div className={cn("h-8 w-8 grid place-items-center rounded-md", t.chip)}>
          <Icon className="h-4 w-4" />
        </div>
        <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mt-4 font-medium">{label}</div>
      <div className="text-[34px] leading-none font-semibold mt-2 tracking-tight tabular-nums">
        {value ?? <span className="text-muted-foreground/50">—</span>}
      </div>
      {hint && <div className="text-[12px] text-muted-foreground mt-2">{hint}</div>}
    </div>
  );
}
