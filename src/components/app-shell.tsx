import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Table2,
  Map,
  BarChart3,
  LineChart,
  ScrollText,
  Settings,
  Headphones,
  LogOut,
  Globe,
  ShieldCheck,
  Send,
} from "lucide-react";
import { useRealtimeSync } from "@/hooks/use-realtime-sync";
import type { AppRole, AuthState } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

type Item = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: string;
};

const ADMIN: Item[] = [
  { to: "/app", label: "Dashboard", icon: LayoutDashboard, shortcut: "D" },
  { to: "/app/raw-leads", label: "Raw Leads", icon: Table2, shortcut: "L" },
  { to: "/app/cs-leads", label: "CS Pipeline", icon: Headphones, shortcut: "P" },
  { to: "/app/browser-profiles", label: "Browser Profiles", icon: Globe, shortcut: "B" },
  { to: "/app/map", label: "Map", icon: Map, shortcut: "M" },
  { to: "/app/analytics", label: "Analytics", icon: LineChart, shortcut: "N" },
  { to: "/app/reports", label: "Reports", icon: BarChart3, shortcut: "R" },
  { to: "/app/logs", label: "Activity", icon: ScrollText, shortcut: "G" },
  { to: "/app/health", label: "Health", icon: ShieldCheck, shortcut: "H" },
  { to: "/app/settings", label: "Settings", icon: Settings, shortcut: "S" },
];

const SCRAPING: Item[] = [{ to: "/app/browser-profiles", label: "Browser Profiles", icon: Globe }];

const MATURING: Item[] = [
  { to: "/app/raw-leads", label: "Raw Leads", icon: Table2 },
  { to: "/app/forwarded-leads", label: "Forwarded Leads", icon: Headphones },
  { to: "/app/submit-lead", label: "Manual Lead", icon: Send },
];

const CS: Item[] = [{ to: "/app/cs-leads", label: "Dashboard", icon: LayoutDashboard }];
const ACC_HANDLER: Item[] = [
  { to: "/app/map", label: "Map", icon: Map, shortcut: "M" },
  { to: "/app/browser-profiles", label: "Browser Profiles", icon: Globe, shortcut: "B" },
  { to: "/app/raw-leads", label: "Raw Leads", icon: Table2, shortcut: "L" },
  { to: "/app/forwarded-leads", label: "Forwarded Leads", icon: Headphones },
  { to: "/app/submit-lead", label: "Manual Lead", icon: Send },
];

const SUBMITTER: Item[] = [
  { to: "/app/submit-lead", label: "Submit Lead", icon: Send },
  { to: "/app/forwarded-leads", label: "Forwarded Leads", icon: Headphones },
];

const ADMIN_FULL: Item[] = [
  ...ADMIN.slice(0, 3),
  { to: "/app/forwarded-leads", label: "Forwarded Leads", icon: Headphones },
  { to: "/app/submit-lead", label: "Manual Lead", icon: Send },
  ...ADMIN.slice(3),
];

const SUB_ADMIN: Item[] = ADMIN_FULL.filter(
  (item) => item.to !== "/app/cs-leads" && item.to !== "/app/logs" && item.to !== "/app/settings",
);

function itemsForRole(role: AppRole | null): Item[] {
  if (role === "admin") return ADMIN_FULL;
  if (role === "sub_admin") return SUB_ADMIN;
  if (role === "scraping") return SCRAPING;
  if (role === "maturing") return MATURING;
  if (role === "cs") return CS;
  if (role === "acc_handler") return ACC_HANDLER;
  if (role === "facebook" || role === "seo") return SUBMITTER;
  return [];
}

function initials(name?: string | null, email?: string | null) {
  const src = name?.trim() || email?.trim() || "?";
  const parts = src.split(/[\s.@]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || src[0]!.toUpperCase();
}

function roleLabel(role: AppRole | null) {
  if (role === "sub_admin") return "Sub-admin";
  return role?.replace(/_/g, " ") ?? "no role";
}

export function AppShell({ auth, children }: { auth: AuthState; children: React.ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const items = itemsForRole(auth.primaryRole);
  const displayName = auth.profile?.full_name || auth.user?.email || "-";
  useRealtimeSync(auth.primaryRole);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <aside className="w-[264px] shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col h-screen">
        <div className="px-5 pt-5 pb-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary text-primary-foreground shadow-sm grid place-items-center">
              <span className="text-[13px] font-semibold">LG</span>
            </div>
            <div className="leading-tight">
              <div className="text-[15px] font-semibold tracking-tight text-foreground">
                Leadgrid
              </div>
              <div className="text-[12px] text-muted-foreground">CRM workspace</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 min-h-0 px-3 py-2 space-y-1 overflow-y-auto">
          <div className="px-3 pb-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-medium">
            Workspace
          </div>
          {items.map((item) => {
            const Icon = item.icon;
            const active =
              item.to === "/app" ? path === "/app" || path === "/app/" : path.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-medium transition-all",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                )}
              >
                <Icon
                  className={cn(
                    "h-[17px] w-[17px] transition-colors",
                    active
                      ? "text-primary-foreground"
                      : "text-muted-foreground group-hover:text-foreground",
                  )}
                />
                <span className="flex-1 truncate">{item.label}</span>
                {item.shortcut && (
                  <kbd
                    className={cn(
                      "opacity-0 group-hover:opacity-100 transition-opacity text-[10px] px-1.5 py-0.5 rounded-md",
                      active
                        ? "bg-white/18 text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {item.shortcut}
                  </kbd>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-4">
          <div className="flex items-center gap-3 rounded-xl bg-white/8 border border-white/10 p-3 shadow-sm">
            <div className="h-9 w-9 rounded-full bg-secondary grid place-items-center text-[12px] font-semibold text-secondary-foreground">
              {initials(auth.profile?.full_name, auth.user?.email)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold truncate text-white">{displayName}</div>
              <div className="text-[11px] text-slate-300 capitalize flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                {roleLabel(auth.primaryRole)}
              </div>
            </div>
            <button
              onClick={() => void auth.signOut()}
              title="Sign out"
              className="h-8 w-8 grid place-items-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
      <main className="flex-1 min-w-0 h-screen overflow-y-auto overflow-x-hidden bg-background">
        {children}
      </main>
    </div>
  );
}
