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

function DashboardHome() {
  const auth = useAuth();
  const navigate = useNavigate();
  const role = auth.primaryRole;

  // Role-based landing redirect
  useEffect(() => {
    if (auth.loading) return;
    if (role === "cs") navigate({ to: "/app/cs-leads", replace: true });
    else if (role === "scraping" || role === "maturing")
      navigate({ to: "/app/raw-leads", replace: true });
    else if (role === "acc_handler") navigate({ to: "/app/map", replace: true });
    else if (role === "facebook" || role === "seo")
      navigate({ to: "/app/submit-lead", replace: true });
  }, [auth.loading, role, navigate]);

  if (role !== "admin" && role !== "sub_admin") {
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
      const { data, error } = await supabase.rpc("get_admin_dashboard_stats", {
        _today: today,
      });
      if (error) throw error;

      // Cast the csCounts values from the database returned object
      const csCounts: Record<string, number> = {};
      CS_STATUSES.forEach((status) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        csCounts[status] = Number((data as any)?.csCounts?.[status] ?? 0);
      });

      return {
        rawCounts: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          new: Number((data as any)?.rawCounts?.new ?? 0),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          forwarded: Number((data as any)?.rawCounts?.forwarded ?? 0),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          notFound: Number((data as any)?.rawCounts?.notFound ?? 0),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          wrong: Number((data as any)?.rawCounts?.wrong ?? 0),
        },
        csCounts,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        todayRaw: Number((data as any)?.todayRaw ?? 0),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        todayForwarded: Number((data as any)?.todayForwarded ?? 0),
      };
    },
  });


  const tiles = [
    {
      label: "New raw leads",
      value: stats.data?.rawCounts.new ?? 0,
      icon: Inbox,
      tone: "primary",
    },
    {
      label: "Forwarded to CS",
      value: stats.data?.rawCounts.forwarded ?? 0,
      icon: Send,
      tone: "accent",
    },
    {
      label: "Number not found",
      value: stats.data?.rawCounts.notFound ?? 0,
      icon: AlertCircle,
      tone: "muted",
    },
    {
      label: "Wrong posts",
      value: stats.data?.rawCounts.wrong ?? 0,
      icon: AlertCircle,
      tone: "muted",
    },
    {
      label: "Processed",
      value: stats.data?.csCounts.converted ?? 0,
      icon: Trophy,
      tone: "success",
    },
    {
      label: "Follow-ups",
      value: stats.data?.csCounts.need_follow_up ?? 0,
      icon: Clock,
      tone: "warning",
    },
    {
      label: "New to contact",
      value: stats.data?.csCounts.new ?? 0,
      icon: CheckCircle2,
      tone: "primary",
    },
  ];

  return (
    <div>
      <PageHeader
        title={`${greeting}${firstName ? `, ${firstName}` : ""}`}
        description="Overview of lead operations across scraping, maturing, and CS."
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
              <div>{stats.data?.todayForwarded ?? 0} leads forwarded to CS</div>
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
                    <span>{CS_LABELS[k] ?? k.replace(/_/g, " ")}</span>
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
