import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { startOfDay } from "date-fns";
import {
  ArrowUpRight,
  Inbox,
  CheckCircle2,
  Send,
  Trophy,
  Clock,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody } from "@/components/page";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/")({
  component: DashboardHome,
});

function DashboardHome() {
  const auth = useAuth();
  const navigate = useNavigate();
  const role = auth.primaryRole;

  // Role-based landing redirect
  useEffect(() => {
    if (auth.loading) return;
    if (role === "cs") navigate({ to: "/app/cs-leads", replace: true });
    else if (role === "scraping" || role === "processor")
      navigate({ to: "/app/raw-leads", replace: true });
  }, [auth.loading, role, navigate]);

  if (role !== "admin") {
    return (
      <div className="min-h-[60vh] grid place-items-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <AdminDashboard />;
}

function AdminDashboard() {
  const auth = useAuth();
  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  })();
  const firstName = auth.profile?.full_name?.split(" ")[0];

  const stats = useQuery({
    queryKey: ["admin-dashboard-stats"],
    queryFn: async () => {
      const today = startOfDay(new Date()).toISOString();
      const rawStatuses = ["new", "qualified", "cancelled"] as const;
      const csStatuses = [
        "new",
        "called",
        "messaged",
        "follow_up",
        "interested",
        "converted",
        "closed_won",
        "need_follow_up",
      ] as const;

      const [rawNew, rawSent, rawCancelled, todayRaw, todayQualified, ...csResults] =
        await Promise.all([
          ...rawStatuses.map((status) =>
            supabase
              .from("raw_leads")
              .select("id", { count: "exact", head: true })
              .eq("status", status),
          ),
          supabase
            .from("raw_leads")
            .select("id", { count: "exact", head: true })
            .gte("created_at", today),
          supabase
            .from("qualified_leads")
            .select("id", { count: "exact", head: true })
            .gte("created_at", today),
          ...csStatuses.map((status) =>
            supabase
              .from("qualified_leads")
              .select("id", { count: "exact", head: true })
              .eq("cs_status", status),
          ),
        ]);

      const csCounts: Record<string, number> = {};
      csStatuses.forEach((status, index) => {
        csCounts[status] = csResults[index]?.count ?? 0;
      });

      return {
        rawCounts: {
          new: rawNew.count ?? 0,
          sent: rawSent.count ?? 0,
          cancelled: rawCancelled.count ?? 0,
        },
        csCounts,
        todayRaw: todayRaw.count ?? 0,
        todayQualified: todayQualified.count ?? 0,
      };
    },
  });

  const tiles = [
    { label: "New raw leads", value: stats.data?.rawCounts.new ?? 0, icon: Inbox, tone: "primary" },
    { label: "Sent to CS", value: stats.data?.rawCounts.sent ?? 0, icon: Send, tone: "accent" },
    {
      label: "Cancelled",
      value: stats.data?.rawCounts.cancelled ?? 0,
      icon: AlertCircle,
      tone: "muted",
    },
    {
      label: "Converted",
      value: (stats.data?.csCounts.converted ?? 0) + (stats.data?.csCounts.closed_won ?? 0),
      icon: Trophy,
      tone: "success",
    },
    {
      label: "Follow-ups",
      value: stats.data?.csCounts.follow_up ?? 0,
      icon: Clock,
      tone: "warning",
    },
    {
      label: "In-progress",
      value:
        (stats.data?.csCounts.called ?? 0) +
        (stats.data?.csCounts.messaged ?? 0) +
        (stats.data?.csCounts.interested ?? 0),
      icon: CheckCircle2,
      tone: "primary",
    },
  ];

  return (
    <div>
      <PageHeader
        title={`${greeting}${firstName ? `, ${firstName}` : ""}`}
        description="Overview of lead operations across marketing and CS."
      />
      <PageBody className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {tiles.map((t) => (
            <div key={t.label} className="glass-card p-4">
              <div className="flex items-center justify-between">
                <t.icon
                  className={cn(
                    "h-4 w-4",
                    t.tone === "primary" && "text-primary",
                    t.tone === "success" && "text-success",
                    t.tone === "warning" && "text-warning",
                    t.tone === "accent" && "text-accent-foreground",
                    t.tone === "muted" && "text-muted-foreground",
                  )}
                />
                <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/60" />
              </div>
              <div className="mt-3 text-[22px] font-semibold tabular-nums">{t.value}</div>
              <div className="text-[11.5px] text-muted-foreground mt-0.5">{t.label}</div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="glass-card p-5">
            <h3 className="text-sm font-semibold mb-2">Today</h3>
            <div className="text-[13px] text-muted-foreground">
              <div>{stats.data?.todayRaw ?? 0} new raw leads captured</div>
              <div>{stats.data?.todayQualified ?? 0} qualified leads passed to CS</div>
            </div>
          </div>
          <div className="glass-card p-5">
            <h3 className="text-sm font-semibold mb-2">CS pipeline mix</h3>
            <div className="text-[13px] text-muted-foreground space-y-0.5">
              {Object.entries(stats.data?.csCounts ?? {})
                .sort((a, b) => b[1] - a[1])
                .slice(0, 6)
                .map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="capitalize">{k.replace(/_/g, " ")}</span>
                    <span className="tabular-nums">{v}</span>
                  </div>
                ))}
              {Object.keys(stats.data?.csCounts ?? {}).length === 0 && <div>No leads yet.</div>}
            </div>
          </div>
        </div>
      </PageBody>
    </div>
  );
}
