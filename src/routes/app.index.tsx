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
      cardClass: "crm-accent-indigo",
      iconClass: "bg-[#d8d2ef] text-[#50469B] border-[#bdb5de]",
    },
    {
      label: "Forwarded to CS",
      value: stats.data?.rawCounts.forwarded ?? 0,
      icon: Send,
      tone: "accent",
      cardClass: "crm-accent-sky",
      iconClass: "bg-[#d9eef1] text-[#2d5c67] border-[#b7dae0]",
    },
    {
      label: "Number not found",
      value: stats.data?.rawCounts.notFound ?? 0,
      icon: AlertCircle,
      tone: "muted",
      cardClass: "crm-accent-slate",
      iconClass: "bg-[#ecece8] text-[#74766B] border-[#d3d4cc]",
    },
    {
      label: "Wrong posts",
      value: stats.data?.rawCounts.wrong ?? 0,
      icon: AlertCircle,
      tone: "muted",
      cardClass: "crm-accent-rose",
      iconClass: "bg-[#f8e4e5] text-[#C1292E] border-[#e6b0b2]",
    },
    {
      label: "Processed",
      value: stats.data?.csCounts.converted ?? 0,
      icon: Trophy,
      tone: "success",
      cardClass: "crm-accent-mint",
      iconClass: "bg-[#def7e8] text-[#07B053] border-[#a9dfbf]",
    },
    {
      label: "Follow-ups",
      value: stats.data?.csCounts.need_follow_up ?? 0,
      icon: Clock,
      tone: "warning",
      cardClass: "crm-accent-amber",
      iconClass: "bg-[#fff3cd] text-[#8f6a00] border-[#f0d27b]",
    },
    {
      label: "New to contact",
      value: stats.data?.csCounts.new ?? 0,
      icon: CheckCircle2,
      tone: "primary",
      cardClass: "crm-accent-indigo",
      iconClass: "bg-[#d8d2ef] text-[#50469B] border-[#bdb5de]",
    },
  ];

  return (
    <div>
      <PageHeader
        title={`${greeting}${firstName ? `, ${firstName}` : ""}`}
        description="Overview of lead operations across scraping, maturing, and CS."
      />
      <PageBody className="space-y-6">
        <div className="crm-section-panel">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7 gap-4">
            {tiles.map((t) => (
              <div key={t.label} className={cn("crm-surface-card relative overflow-hidden p-5", t.cardClass)}>
                <div
                  className={cn(
                    "absolute inset-x-0 top-0 h-1.5",
                    t.tone === "primary" && "bg-linear-to-r from-[#50469B] via-[#5a50a8] to-[#6a61b4]",
                    t.tone === "success" && "bg-linear-to-r from-[#07B053] via-[#15bb60] to-[#31c878]",
                    t.tone === "warning" && "bg-linear-to-r from-[#d4ae48] via-[#FFD670] to-[#ffe39c]",
                    t.tone === "accent" && "bg-linear-to-r from-[#4c9fac] via-[#5EB1BF] to-[#86cbd6]",
                    t.tone === "muted" && "bg-linear-to-r from-[#74766B] via-[#8a8c82] to-[#b2b4ad]",
                  )}
                />
                <div className="flex items-start justify-between gap-3">
                  <div
                    className={cn(
                      "h-11 w-11 rounded-2xl grid place-items-center border shadow-sm",
                      t.iconClass,
                    )}
                  >
                    <t.icon
                      className={cn(
                        "h-4.5 w-4.5",
                        t.tone === "primary" && "text-[#50469B]",
                        t.tone === "success" && "text-[#07B053]",
                        t.tone === "warning" && "text-[#9b7718]",
                        t.tone === "accent" && "text-[#2d5c67]",
                        t.tone === "muted" && "text-[#74766B]",
                      )}
                    />
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground/55" />
                </div>
                <div className="crm-card-value mt-7 tabular-nums">
                  {t.value}
                </div>
                <div className="crm-card-label mt-2">{t.label}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="crm-section-panel">
            <div className="crm-surface-card crm-accent-sky p-6">
              <h3 className="crm-section-title mb-4">Today</h3>
              <div className="space-y-3 text-[13px] crm-muted-text">
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#b7dae0] bg-white/78 px-4 py-3 shadow-sm">
                  <span>New raw leads captured</span>
                  <span className="text-base font-semibold text-foreground tabular-nums">
                    {stats.data?.todayRaw ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#c8c1e6] bg-white/78 px-4 py-3 shadow-sm">
                  <span>Leads forwarded to CS</span>
                  <span className="text-base font-semibold text-foreground tabular-nums">
                    {stats.data?.todayForwarded ?? 0}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="crm-section-panel">
            <div className="crm-surface-card crm-accent-indigo p-6">
              <h3 className="crm-section-title mb-4">CS pipeline mix</h3>
              <div className="text-[13px] crm-muted-text space-y-2">
                {Object.entries(stats.data?.csCounts ?? {})
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 6)
                  .map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-3 rounded-2xl border border-[#c8c1e6] bg-white/80 px-4 py-3 shadow-sm">
                      <span>{CS_LABELS[k] ?? k.replace(/_/g, " ")}</span>
                      <span className="font-semibold text-foreground tabular-nums">{v}</span>
                    </div>
                  ))}
                {Object.keys(stats.data?.csCounts ?? {}).length === 0 && <div>No leads yet.</div>}
              </div>
            </div>
          </div>
        </div>
      </PageBody>
    </div>
  );
}
