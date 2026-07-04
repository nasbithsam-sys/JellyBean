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
    <div className="crm-app-shell flex h-screen overflow-hidden bg-background text-foreground p-3 md:p-4">
      <aside className="crm-sidebar-shell w-[272px] shrink-0 text-sidebar-foreground flex flex-col h-full rounded-[28px]">
        <div className="px-6 pt-6 pb-5">
          <div className="relative flex items-center gap-3 overflow-hidden rounded-[20px] border border-[#c8c1e6] bg-linear-to-br from-white via-[#ece9f8] to-[#f3effb] px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_20px_36px_-22px_rgba(80,70,155,0.42)] backdrop-blur-sm">
            <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-[#b8b0de] to-transparent" />
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-linear-to-br from-[#50469B] via-[#5b52a7] to-[#6b61b6] text-white shadow-[0_18px_30px_-18px_rgba(80,70,155,0.78)] ring-1 ring-white/80">
              <span className="text-[13px] font-bold tracking-[0.01em]">LG</span>
            </div>
            <div className="leading-tight">
              <div className="text-[15px] font-extrabold tracking-[-0.02em] text-slate-900">
                Leadgrid
              </div>
              <div className="text-[12px] font-medium tracking-[-0.01em] text-slate-600">CRM workspace</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 min-h-0 px-4 py-2 space-y-1 overflow-y-auto">
          <div className="px-3 pb-2 text-[11px] uppercase tracking-[0.12em] text-slate-600 font-bold">
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
                  "group crm-motion relative flex items-center gap-3 px-3.5 py-3 rounded-2xl text-[14px] tracking-[-0.01em]",
                  active
                    ? "crm-sidebar-active text-slate-950 font-semibold shadow-md"
                    : "text-slate-700 font-medium hover:bg-white/92 hover:text-slate-950 hover:shadow-sm",
                )}
              >
                <Icon
                  className={cn(
                    "h-[17px] w-[17px] crm-motion",
                    active
                      ? "text-[#50469B]"
                      : "text-slate-600 group-hover:text-[#50469B]",
                  )}
                />
                <span className="flex-1 truncate">{item.label}</span>
                {item.shortcut && (
                  <kbd
                    className={cn(
                      "crm-motion opacity-0 group-hover:opacity-100 text-[10px] px-1.5 py-0.5 rounded-md",
                      active
                        ? "bg-[#d8d2ef] text-[#3d357a]"
                        : "bg-slate-200/80 text-slate-600",
                    )}
                  >
                    {item.shortcut}
                  </kbd>
                )}
                {active && (
                  <span className="absolute left-1.5 top-1/2 h-8 w-1 -translate-y-1/2 rounded-full bg-linear-to-b from-[#50469B] to-[#6b61b6]" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-sidebar-border/80 p-4">
          <div className="relative flex items-center gap-3 overflow-hidden rounded-[22px] border border-[#bdb4e0] bg-linear-to-br from-white via-[#ece7f8] to-[#f2edf9] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_22px_34px_-22px_rgba(80,70,155,0.42)]">
            <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-[#b8b0de] to-transparent" />
            <div className="h-10 w-10 rounded-full bg-linear-to-br from-[#50469B] via-[#5b52a7] to-[#6b61b6] grid place-items-center text-[12px] font-bold text-white ring-1 ring-white/90 shadow-[0_14px_24px_-14px_rgba(80,70,155,0.7)]">
              {initials(auth.profile?.full_name, auth.user?.email)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-bold tracking-[-0.015em] truncate text-slate-900">{displayName}</div>
              <div className="text-[11.5px] font-medium tracking-[-0.01em] text-slate-600 capitalize flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#5EB1BF]" />
                {roleLabel(auth.primaryRole)}
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  title="Account options"
                  className="crm-motion h-8 w-8 grid place-items-center rounded-xl border border-[#cdc5e8] bg-white/88 text-[#50469B] shadow-sm hover:bg-white hover:text-[#3d357a] hover:shadow-md"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-52 rounded-2xl border-[#cfc8e7] bg-linear-to-br from-white via-[#f8f7fc] to-[#f1eef9] p-2 shadow-[0_22px_46px_-28px_rgba(80,70,155,0.42)]"
              >
                <DropdownMenuItem
                  onSelect={() => setPasswordDialogOpen(true)}
                  className="crm-motion rounded-xl px-3 py-2 text-[13px] font-medium text-slate-700 focus:bg-[#ebe8f8] focus:text-[#50469B]"
                >
                  <KeyRound className="h-4 w-4 text-[#50469B]" />
                  Change Password
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              onClick={() => void auth.signOut()}
              title="Sign out"
              className="crm-motion h-8 w-8 grid place-items-center rounded-xl border border-[#cdc5e8] bg-white/88 text-[#50469B] shadow-sm hover:bg-white hover:text-[#3d357a] hover:shadow-md"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
      <main className="flex-1 min-w-0 h-full overflow-y-auto overflow-x-hidden bg-transparent pl-3 md:pl-4">
        {skewSeconds !== null && (
          <div className="m-4 p-4 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200 text-sm shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 animate-fade-in">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 font-semibold">
                <span className="text-base">⚠️</span>
                <span>System Clock Out of Sync</span>
              </div>
              <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                Your computer's clock is out of sync with our servers by about{" "}
                <strong>{Math.round(Math.abs(skewSeconds) / 60)} minutes</strong>.
                This causes security checks to fail and will trigger automatic logout (HTTP 429 Too Many Requests).
              </p>
            </div>
            <div className="shrink-0 text-xs font-semibold bg-amber-100 dark:bg-amber-900/40 px-3 py-1.5 rounded-lg text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-800">
              Turn on "Set time automatically" in Date & Time Settings
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
