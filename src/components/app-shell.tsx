import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Table2, Building2, Map, BarChart3, LineChart,
  ScrollText, Users, Settings, Headphones, LogOut,
} from "lucide-react";
import type { AppRole, AuthState } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

type Item = { to: string; label: string; icon: React.ComponentType<{ className?: string }> };

const ADMIN: Item[] = [
  { to: "/app", label: "Dashboard", icon: LayoutDashboard },
  { to: "/app/raw-leads", label: "Raw Leads", icon: Table2 },
  { to: "/app/accounts", label: "Accounts", icon: Building2 },
  { to: "/app/map", label: "Map Coverage", icon: Map },
  { to: "/app/reports", label: "Reports", icon: BarChart3 },
  { to: "/app/analytics", label: "Analytics", icon: LineChart },
  { to: "/app/logs", label: "Activity Logs", icon: ScrollText },
  { to: "/app/users", label: "Users", icon: Users },
  { to: "/app/settings", label: "Settings", icon: Settings },
];

const MARKETING: Item[] = [
  { to: "/app", label: "Dashboard", icon: LayoutDashboard },
  { to: "/app/raw-leads", label: "Raw Leads", icon: Table2 },
  { to: "/app/accounts", label: "Accounts", icon: Building2 },
];

const CS: Item[] = [
  { to: "/app", label: "Dashboard", icon: LayoutDashboard },
  { to: "/app/cs-leads", label: "CS Leads", icon: Headphones },
];

function itemsForRole(role: AppRole | null): Item[] {
  if (role === "admin") return ADMIN;
  if (role === "marketing") return MARKETING;
  if (role === "cs") return CS;
  return [];
}

export function AppShell({
  auth,
  children,
}: {
  auth: AuthState;
  children: React.ReactNode;
}) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const items = itemsForRole(auth.primaryRole);

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="w-60 shrink-0 bg-sidebar text-sidebar-foreground flex flex-col">
        <div className="px-5 py-5 border-b border-sidebar-border">
          <div className="text-sidebar-primary font-semibold tracking-tight text-lg">
            Leadgrid
          </div>
          <div className="text-xs text-sidebar-foreground/60 mt-0.5">
            Lead Operations
          </div>
        </div>
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {items.map((item) => {
            const Icon = item.icon;
            const active =
              item.to === "/app"
                ? path === "/app" || path === "/app/"
                : path.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <div className="px-2 pb-2">
            <div className="text-sm font-medium truncate">
              {auth.profile?.full_name || auth.user?.email}
            </div>
            <div className="text-xs text-sidebar-foreground/60 capitalize">
              {auth.primaryRole ?? "no role"}
            </div>
          </div>
          <button
            onClick={() => void auth.signOut()}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
