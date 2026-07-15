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
  Megaphone,
} from "lucide-react";

import { CrmUpdatesNotifier } from "@/components/crm-updates-notifier";
import { LeadReminderNotifier } from "@/components/lead-reminder-notifier";

import { useRealtimeSync } from "@/hooks/use-realtime-sync";
import type { AppRole, AuthState } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { useClockSkew } from "@/hooks/use-clock-skew";
import jellybeanLogo from "@/assets/jellybean-logo.png";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChangePasswordDialog } from "@/components/auth/change-password-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
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
  { to: "/app/lead-assignment", label: "Lead Assignment", icon: PieChart },
  { to: "/app/logs", label: "Activity", icon: ScrollText, shortcut: "G" },
  { to: "/app/health", label: "Health", icon: ShieldCheck, shortcut: "H" },
  { to: "/app/crm-updates", label: "CRM Updates", icon: Megaphone },
  { to: "/app/settings", label: "Settings", icon: Settings, shortcut: "S" },
];

const SCRAPING: Item[] = [
  { to: "/app/raw-leads", label: "Raw Leads", icon: Table2 },
  { to: "/app/browser-profiles", label: "Browser Profiles", icon: Globe },
];

const MATURING: Item[] = [
  { to: "/app/raw-leads", label: "Raw Leads", icon: Table2 },
  { to: "/app/forwarded-leads", label: "Forwarded Leads", icon: Headphones },
  { to: "/app/submit-lead", label: "Manual Lead", icon: Send },
];

const CS: Item[] = [{ to: "/app/cs-leads", label: "Dashboard", icon: LayoutDashboard }];
const CS_ADMIN_ITEMS: Item[] = [
  { to: "/app/cs-leads", label: "CS Pipeline", icon: Headphones },
  { to: "/app/lead-assignment", label: "Lead Assignment", icon: PieChart },
];
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
  (item) =>
    item.to !== "/app/cs-leads" &&
    item.to !== "/app/logs" &&
    item.to !== "/app/settings" &&
    item.to !== "/app/crm-updates",
);

function itemsForRole(role: AppRole | null): Item[] {
  if (role === "admin") return ADMIN_FULL;
  if (role === "sub_admin") return SUB_ADMIN;
  if (role === "scraping") return SCRAPING;
  if (role === "maturing") return MATURING;
  if (role === "cs") return CS;
  if (role === "cs_admin") return CS_ADMIN_ITEMS;
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
      <aside className="crm-sidebar-shell w-[76px] lg:w-[236px] shrink-0 text-sidebar-foreground flex flex-col h-full">
        <div className="px-3 lg:px-5 pt-5 pb-4">
          <div className="flex items-center justify-center lg:justify-start gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-sidebar-primary/90 ring-1 ring-white/30 shadow-[0_14px_30px_-16px_color-mix(in_srgb,var(--sidebar-primary)_80%,transparent)] overflow-hidden">
              <img
                src={jellybeanLogo}
                alt="JellyBean logo"
                width={44}
                height={44}
                className="h-8 w-8 object-contain"
              />
            </div>
            <div className="hidden lg:block leading-tight">
              <div className="text-[14px] font-bold tracking-[-0.015em] text-white">
                JellyBean
              </div>
              <div className="text-[11px] font-medium tracking-[0.02em] uppercase text-white/50">
                CRM
              </div>
            </div>
          </div>
        </div>

        <nav className="flex-1 min-h-0 px-2.5 lg:px-3 py-3 space-y-1 overflow-y-auto">
          <div className="hidden lg:block px-3 pb-2 pt-1 text-[10px] uppercase tracking-[0.14em] text-white/40 font-bold">
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
                title={item.label}
                className={cn(
                  "group crm-motion relative flex h-11 items-center justify-center lg:justify-start gap-3 px-0 lg:px-3 rounded-2xl text-[13px] tracking-[-0.005em]",
                  active
                    ? "crm-sidebar-active text-white font-semibold"
                    : "text-sidebar-foreground/72 font-medium hover:bg-white/[0.10] hover:text-white",
                )}
              >
                <Icon
                  className={cn(
                    "h-[16px] w-[16px] crm-motion",
                    active ? "text-white" : "text-white/60 group-hover:text-white",
                  )}
                />
                <span className="hidden lg:block flex-1 truncate">{item.label}</span>
                {item.shortcut && (
                  <kbd
                    className={cn(
                      "hidden lg:inline-flex crm-motion opacity-0 group-hover:opacity-100 text-[10px] px-1.5 py-0.5 rounded font-mono",
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

        <div className="px-2.5 lg:px-3 pb-3 flex flex-col gap-1.5">
          <ThemeToggle className="group crm-motion relative flex h-11 w-full items-center justify-center lg:justify-start gap-3 px-0 lg:px-3 rounded-2xl text-[13px] tracking-[-0.005em] text-sidebar-foreground/72 font-medium hover:bg-white/[0.10] hover:text-white focus:ring-0 focus:ring-offset-0 [&>span]:hidden lg:[&>span]:inline" />
        </div>
        <div className="mt-auto p-2.5 lg:p-3">
          <div className="flex items-center justify-center lg:justify-start gap-2.5 rounded-[22px] bg-sidebar-accent/72 border border-white/[0.10] shadow-sm p-2 lg:p-2.5 overflow-hidden">
            <div className="h-9 w-9 shrink-0 rounded-full bg-primary grid place-items-center text-[12px] font-bold text-white shadow-sm">
              {initials(auth.profile?.full_name, auth.user?.email)}
            </div>
            <div className="hidden lg:flex min-w-0 flex-1 flex-col justify-center">
              <div className="text-[13px] font-bold tracking-tight truncate text-white leading-none mb-1.5">
                {displayName}
              </div>
              <div className="text-[11px] font-medium uppercase text-white/52 capitalize flex items-center gap-1.5 leading-none">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                <span className="truncate">{roleLabel(auth.primaryRole)}</span>
              </div>
            </div>
            <div className="hidden lg:flex items-center gap-0.5 shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    title="Account options"
                    aria-label="Account options"
                    className="crm-motion h-8 w-8 grid place-items-center rounded-xl text-white/55 hover:bg-white/10 hover:text-white transition-colors"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52 p-1">
                  <DropdownMenuItem
                    onSelect={() => setPasswordDialogOpen(true)}
                    className="crm-motion rounded-sm px-2.5 py-2 text-[13px] font-medium cursor-pointer flex items-center gap-2"
                  >
                    <KeyRound className="h-4 w-4" />
                    Change Password
                  </DropdownMenuItem>

                </DropdownMenuContent>
              </DropdownMenu>
              <button
                onClick={() => void auth.signOut()}
                title="Sign out"
                aria-label="Sign out"
                className="crm-motion h-8 w-8 grid place-items-center rounded-xl text-white/55 hover:bg-destructive/15 hover:text-white transition-colors"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
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
        {children}
      </main>
      <ChangePasswordDialog
        open={passwordDialogOpen}
        onOpenChange={setPasswordDialogOpen}
        userEmail={auth.user?.email ?? auth.profile?.email ?? null}
      />
      <CrmUpdatesNotifier />
      <LeadReminderNotifier />
    </div>
  );
}
