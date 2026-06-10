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
  Command,
  Globe,
  Sun,
  Moon,
  ShieldCheck,
} from "lucide-react";
import { useTheme } from "@/hooks/use-theme";
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

const SCRAPING_PROCESSOR: Item[] = [
  { to: "/app/raw-leads", label: "Raw Leads", icon: Table2 },
  { to: "/app/forwarded-leads", label: "Forwarded Leads", icon: Headphones },
  { to: "/app/browser-profiles", label: "Browser Profiles", icon: Globe },
];

const CS: Item[] = [{ to: "/app/cs-leads", label: "Dashboard", icon: LayoutDashboard }];
const ACC_HANDLER: Item[] = [
  { to: "/app/map", label: "Map", icon: Map, shortcut: "M" },
  { to: "/app/browser-profiles", label: "Browser Profiles", icon: Globe, shortcut: "B" },
];

const ADMIN_FULL: Item[] = [
  ...ADMIN.slice(0, 3),
  { to: "/app/forwarded-leads", label: "Forwarded Leads", icon: Headphones },
  ...ADMIN.slice(3),
];

function itemsForRole(role: AppRole | null): Item[] {
  if (role === "admin") return ADMIN_FULL;
  if (role === "scraping" || role === "processor") return SCRAPING_PROCESSOR;
  if (role === "cs") return CS;
  if (role === "acc_handler") return ACC_HANDLER;
  return [];
}

function initials(name?: string | null, email?: string | null) {
  const src = name?.trim() || email?.trim() || "?";
  const parts = src.split(/[\s.@]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || src[0]!.toUpperCase();
}

export function AppShell({ auth, children }: { auth: AuthState; children: React.ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const items = itemsForRole(auth.primaryRole);
  const displayName = auth.profile?.full_name || auth.user?.email || "-";
  const { theme, toggle: toggleTheme } = useTheme();
  useRealtimeSync(auth.primaryRole);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="w-[248px] shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col sticky top-0 h-screen">
        <div className="px-4 pt-5 pb-4 border-b border-sidebar-border">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-sm border border-sidebar-border bg-sidebar-accent grid place-items-center">
              <span className="text-[12px] font-mono font-semibold text-primary">LG</span>
            </div>
            <div className="leading-tight">
              <div className="text-[13px] font-semibold tracking-normal text-foreground">
                Leadgrid
              </div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-sidebar-foreground/55 font-mono">
                Field Ops
              </div>
            </div>
          </div>
        </div>

        <div className="px-3 py-3">
          <div className="flex items-center gap-2 px-2.5 h-8 rounded-sm bg-sidebar-accent/70 border border-sidebar-border text-[11.5px] text-sidebar-foreground/70 cursor-default select-none">
            <Command className="h-3.5 w-3.5" />
            <span className="font-mono uppercase tracking-wide">Console</span>
            <span className="ml-auto inline-flex items-center gap-0.5">
              <kbd className="px-1.5 py-0.5 rounded-sm bg-background/40 border border-sidebar-border text-[10px]">
                Ctrl
              </kbd>
              <kbd className="px-1.5 py-0.5 rounded-sm bg-background/40 border border-sidebar-border text-[10px]">
                K
              </kbd>
            </span>
          </div>
        </div>

        <nav className="flex-1 px-2 py-2 space-y-1 overflow-y-auto">
          <div className="px-2 pb-1 text-[10px] uppercase tracking-[0.14em] text-sidebar-foreground/45 font-medium">
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
                  "group relative flex items-center gap-2.5 px-2.5 py-2 rounded-sm text-[13px] font-medium transition-all border border-transparent",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground border-sidebar-border"
                    : "text-sidebar-foreground/75 hover:bg-sidebar-accent/55 hover:text-sidebar-accent-foreground hover:border-sidebar-border",
                )}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] bg-primary" />
                )}
                <Icon
                  className={cn(
                    "h-[15px] w-[15px] transition-colors",
                    active
                      ? "text-primary"
                      : "text-sidebar-foreground/55 group-hover:text-sidebar-foreground",
                  )}
                />
                <span className="flex-1 truncate">{item.label}</span>
                {item.shortcut && (
                  <kbd className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] px-1.5 py-0.5 rounded-sm bg-sidebar-border/70 text-sidebar-foreground/60">
                    {item.shortcut}
                  </kbd>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-sm bg-sidebar-accent/35 hover:bg-sidebar-accent/55 transition-colors border border-sidebar-border/60">
            <div className="h-8 w-8 rounded-sm bg-secondary grid place-items-center text-[12px] font-semibold ring-1 ring-sidebar-border">
              {initials(auth.profile?.full_name, auth.user?.email)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium truncate">{displayName}</div>
              <div className="text-[10.5px] text-sidebar-foreground/55 capitalize flex items-center gap-1">
                <span className="h-1.5 w-1.5 bg-success animate-pulse-glow" />
                {auth.primaryRole ?? "no role"}
              </div>
            </div>
            <button
              onClick={toggleTheme}
              title={theme === "dark" ? "Switch to light" : "Switch to dark"}
              className="h-7 w-7 grid place-items-center rounded-sm text-sidebar-foreground/60 hover:text-foreground hover:bg-sidebar-accent transition-colors"
            >
              {theme === "dark" ? (
                <Sun className="h-3.5 w-3.5" />
              ) : (
                <Moon className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              onClick={() => void auth.signOut()}
              title="Sign out"
              className="h-7 w-7 grid place-items-center rounded-sm text-sidebar-foreground/60 hover:text-foreground hover:bg-sidebar-accent transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </aside>
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
