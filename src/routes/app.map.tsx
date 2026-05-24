import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/app/map")({ component: Page });

function Page() {
  const auth = useAuth();
  return (
    <div>
      <PageHeader title="Map" description="Geographic spread of monitored lead-source accounts." />
      <PageBody>
        <RoleGate allow={["admin", "marketing"]} current={auth.primaryRole}>
          <Inner />
        </RoleGate>
      </PageBody>
    </div>
  );
}

function Inner() {
  const accounts = useQuery({
    queryKey: ["accounts-map"],
    queryFn: async () => {
      const { data, error } = await supabase.from("accounts").select("id, name, area, latitude, longitude, last_opened_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const bounds = useMemo(() => {
    const list = accounts.data ?? [];
    if (list.length === 0) return null;
    const lats = list.map((a) => a.latitude);
    const lngs = list.map((a) => a.longitude);
    return {
      minLat: Math.min(...lats), maxLat: Math.max(...lats),
      minLng: Math.min(...lngs), maxLng: Math.max(...lngs),
    };
  }, [accounts.data]);

  function project(lat: number, lng: number) {
    if (!bounds) return { x: 50, y: 50 };
    const padLat = (bounds.maxLat - bounds.minLat) * 0.12 || 0.001;
    const padLng = (bounds.maxLng - bounds.minLng) * 0.12 || 0.001;
    const x = ((lng - (bounds.minLng - padLng)) / (bounds.maxLng - bounds.minLng + padLng * 2)) * 100;
    const y = 100 - ((lat - (bounds.minLat - padLat)) / (bounds.maxLat - bounds.minLat + padLat * 2)) * 100;
    return { x, y };
  }

  const byArea = useMemo(() => {
    const m = new Map<string, number>();
    (accounts.data ?? []).forEach((a) => m.set(a.area, (m.get(a.area) ?? 0) + 1));
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [accounts.data]);

  const isActive = (a: { last_opened_at: string | null }) => {
    if (!a.last_opened_at) return false;
    return (Date.now() - new Date(a.last_opened_at).getTime()) < 1000 * 60 * 60 * 24 * 14;
  };

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold tracking-tight">Account positions</h3>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-success shadow-[0_0_8px_var(--success)]" />Active</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-muted-foreground/60" />Idle</span>
          </div>
        </div>
        {accounts.isLoading ? (
          <div className="h-[480px] grid place-items-center text-muted-foreground">Loading…</div>
        ) : !accounts.data?.length ? (
          <div className="h-[480px] grid place-items-center text-muted-foreground text-sm">No accounts yet — add some on the Accounts page.</div>
        ) : (
          <div
            className="relative aspect-[4/3] w-full rounded-lg overflow-hidden border border-border"
            style={{
              backgroundImage:
                "radial-gradient(800px 400px at 70% 20%, color-mix(in oklab, var(--primary) 18%, transparent), transparent 60%)," +
                "radial-gradient(600px 400px at 20% 80%, color-mix(in oklab, var(--primary-glow) 12%, transparent), transparent 60%)," +
                "linear-gradient(180deg, oklch(0.18 0.014 260), oklch(0.13 0.012 260))",
            }}
          >
            {/* Grid */}
            <svg className="absolute inset-0 w-full h-full text-foreground/8" preserveAspectRatio="none" viewBox="0 0 100 100">
              {Array.from({ length: 21 }).map((_, i) => (
                <g key={i}>
                  <line x1={i * 5} y1="0" x2={i * 5} y2="100" stroke="currentColor" strokeWidth="0.08" />
                  <line x1="0" y1={i * 5} x2="100" y2={i * 5} stroke="currentColor" strokeWidth="0.08" />
                </g>
              ))}
            </svg>

            {/* Coverage circles + pins */}
            {accounts.data.map((a) => {
              const p = project(a.latitude, a.longitude);
              const active = isActive(a);
              return (
                <div key={a.id} className="absolute group" style={{ left: `${p.x}%`, top: `${p.y}%`, transform: "translate(-50%, -50%)" }}>
                  {/* coverage glow */}
                  <div
                    className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${active ? "bg-success/15" : "bg-muted-foreground/10"} blur-xl`}
                    style={{ width: active ? 90 : 50, height: active ? 90 : 50 }}
                  />
                  <div
                    className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border ${active ? "border-success/40" : "border-muted-foreground/25"}`}
                    style={{ width: active ? 56 : 32, height: active ? 56 : 32 }}
                  />
                  {/* pin */}
                  <div
                    className={`relative h-3 w-3 rounded-full ${active ? "bg-success animate-pulse-glow" : "bg-muted-foreground/70"} ring-2 ring-background`}
                  />
                  <div className="absolute left-1/2 -translate-x-1/2 top-5 px-2.5 py-1.5 rounded-md bg-popover border border-border text-[11.5px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10 shadow-md">
                    <div className="font-medium text-foreground">{a.name}</div>
                    <div className="text-muted-foreground">{a.area}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold tracking-tight mb-4">Coverage by area</h3>
        <div className="space-y-2">
          {byArea.length === 0 && <div className="text-sm text-muted-foreground">—</div>}
          {byArea.map(([area, count]) => {
            const max = Math.max(...byArea.map(([, c]) => c));
            const pct = (count / max) * 100;
            return (
              <div key={area} className="group">
                <div className="flex items-center justify-between text-[12.5px] mb-1">
                  <span className="truncate">{area}</span>
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{count}</span>
                </div>
                <div className="h-1.5 rounded-full bg-surface overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-primary to-primary-glow transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
