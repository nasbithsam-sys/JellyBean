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
  PieChart,
  MoreHorizontal,
  KeyRound,
} from "lucide-react";
import { useRealtimeSync } from "@/hooks/use-realtime-sync";
import type { AppRole, AuthState } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { useClockSkew } from "@/hooks/use-clock-skew";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChangePasswordDialog } from "@/components/auth/change-password-dialog";
import { useState } from "react";

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
  { to: "/app/cs-reports", label: "CS Reports", icon: PieChart },
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
  const skewSeconds = useClockSkew();
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  useRealtimeSync(auth.primaryRole);

  return (
    <div className="crm-app-shell flex h-screen overflow-hidden bg-background text-foreground">
      <aside className="crm-sidebar-shell w-[248px] shrink-0 text-sidebar-foreground flex flex-col h-full">
        <div className="px-5 pt-5 pb-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-md bg-primary-glow text-white ring-1 ring-white/10">
              <span className="text-[12px] font-bold tracking-[0.02em]">LG</span>
            </div>
            <div className="leading-tight">
              <div className="text-[14px] font-bold tracking-[-0.015em] text-white">
                Leadgrid
              </div>
              <div className="text-[11px] font-medium tracking-[0.02em] uppercase text-white/50">
                CRM
              </div>
            </div>
          </div>
        </div>

        <nav className="flex-1 min-h-0 px-3 py-3 space-y-0.5 overflow-y-auto">
          <div className="px-3 pb-2 pt-1 text-[10px] uppercase tracking-[0.14em] text-white/40 font-bold">
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
                  "group crm-motion relative flex items-center gap-3 px-3 py-2 rounded-md text-[13px] tracking-[-0.005em]",
                  active
                    ? "crm-sidebar-active text-white font-semibold"
                    : "text-white/70 font-medium hover:bg-white/[0.06] hover:text-white",
                )}
              >
                <Icon
                  className={cn(
                    "h-[16px] w-[16px] crm-motion",
                    active ? "text-white" : "text-white/60 group-hover:text-white",
                  )}
                />
                <span className="flex-1 truncate">{item.label}</span>
                {item.shortcut && (
                  <kbd
                    className={cn(
                      "crm-motion opacity-0 group-hover:opacity-100 text-[10px] px-1.5 py-0.5 rounded font-mono",
                      active ? "bg-white/15 text-white" : "bg-white/10 text-white/60",
                    )}
                  >
                    {item.shortcut}
                  </kbd>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-white/[0.06] p-3">
          <div className="flex items-center gap-2.5 rounded-md bg-white/[0.04] border border-white/[0.06] p-2.5">
            <div className="h-8 w-8 rounded-md bg-primary-glow grid place-items-center text-[11px] font-bold text-white">
              {initials(auth.profile?.full_name, auth.user?.email)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-semibold tracking-[-0.005em] truncate text-white">
                {displayName}
              </div>
              <div className="text-[10.5px] font-medium tracking-[0.03em] uppercase text-white/50 capitalize flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {roleLabel(auth.primaryRole)}
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  title="Account options"
                  className="crm-motion h-7 w-7 grid place-items-center rounded-md text-white/60 hover:bg-white/10 hover:text-white"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52 p-1">
                <DropdownMenuItem
                  onSelect={() => setPasswordDialogOpen(true)}
                  className="crm-motion rounded-sm px-2.5 py-2 text-[13px] font-medium"
                >
                  <KeyRound className="h-4 w-4" />
                  Change Password
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              onClick={() => void auth.signOut()}
              title="Sign out"
              className="crm-motion h-7 w-7 grid place-items-center rounded-md text-white/60 hover:bg-white/10 hover:text-white"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
      <main className="flex-1 min-w-0 h-full overflow-y-auto overflow-x-hidden bg-background">
        {skewSeconds !== null && (
          <div className="m-4 p-3 rounded-md border border-warning/40 bg-warning/10 text-warning-foreground text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 animate-fade-in">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 font-semibold text-[13px]">
                <span>System Clock Out of Sync</span>
              </div>
              <p className="text-xs leading-relaxed opacity-90">
                Your computer's clock is out of sync with our servers by about{" "}
                <strong>{Math.round(Math.abs(skewSeconds) / 60)} minutes</strong>. This
                causes security checks to fail and will trigger automatic logout.
              </p>
            </div>
            <div className="shrink-0 text-xs font-semibold bg-warning/20 px-3 py-1.5 rounded border border-warning/40">
              Enable "Set time automatically" in Date & Time Settings
            </div>
          </div>
        )}
        <div key={path} className="crm-route-enter">
          {children}
        </div>
      </main>
      <ChangePasswordDialog
        open={passwordDialogOpen}
        onOpenChange={setPasswordDialogOpen}
        userEmail={auth.user?.email ?? auth.profile?.email ?? null}
      />
    </div>
  );
}
