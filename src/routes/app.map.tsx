import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/app/map")({ component: Page });

function Page() {
  const auth = useAuth();
  return (
    <div>
      <PageHeader title="Map" description="Geographic spread of monitored lead-source accounts across the USA." />
      <PageBody>
        <RoleGate allow={["admin"]} current={auth.primaryRole}>
          <Inner />
        </RoleGate>
      </PageBody>
    </div>
  );
}

type Account = {
  id: string; name: string; area: string | null;
  latitude: number | null; longitude: number | null;
  last_opened_at: string | null;
};

// Continental USA bounding box (approx)
const USA = { minLat: 24, maxLat: 50, minLng: -125, maxLng: -66 };

function Inner() {
  const [visuals, setVisuals] = useState(false);
  useEffect(() => {
    const v = localStorage.getItem("map.visuals");
    if (v === "1") setVisuals(true);
  }, []);
  const toggle = (next: boolean) => {
    setVisuals(next);
    localStorage.setItem("map.visuals", next ? "1" : "0");
  };

  const accounts = useQuery({
    queryKey: ["accounts-map"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("id, name, area, latitude, longitude, last_opened_at");
      if (error) throw error;
      return (data ?? []) as Account[];
    },
  });

  const placed = useMemo(
    () => (accounts.data ?? []).filter(
      (a): a is Account & { latitude: number; longitude: number } =>
        a.latitude !== null && a.longitude !== null,
    ),
    [accounts.data],
  );

  function project(lat: number, lng: number) {
    const x = ((lng - USA.minLng) / (USA.maxLng - USA.minLng)) * 100;
    const y = 100 - ((lat - USA.minLat) / (USA.maxLat - USA.minLat)) * 100;
    return { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
  }

  const byArea = useMemo(() => {
    const m = new Map<string, number>();
    (accounts.data ?? []).forEach((a) => {
      const key = a.area?.trim() || "Unassigned";
      m.set(key, (m.get(key) ?? 0) + 1);
    });
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [accounts.data]);

  const isActive = (a: { last_opened_at: string | null }) => {
    if (!a.last_opened_at) return false;
    return (Date.now() - new Date(a.last_opened_at).getTime()) < 1000 * 60 * 60 * 24 * 14;
  };

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 glass-card p-5">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <h3 className="text-sm font-semibold tracking-tight">USA · Account positions</h3>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-success" />Active</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-muted-foreground/60" />Idle</span>
            </div>
            <div className="flex items-center gap-2 pl-3 border-l border-border">
              <Label htmlFor="visuals" className="text-[12px] text-muted-foreground cursor-pointer">Map visuals</Label>
              <Switch id="visuals" checked={visuals} onCheckedChange={toggle} />
            </div>
          </div>
        </div>

        {accounts.isLoading ? (
          <div className="h-[480px] grid place-items-center text-muted-foreground">Loading…</div>
        ) : (
          <div
            className="relative aspect-[16/10] w-full rounded-lg overflow-hidden border border-border bg-surface"
            style={
              visuals
                ? {
                    backgroundImage:
                      "radial-gradient(800px 400px at 70% 20%, color-mix(in oklab, var(--primary) 14%, transparent), transparent 60%)," +
                      "radial-gradient(600px 400px at 20% 80%, color-mix(in oklab, var(--primary-glow) 10%, transparent), transparent 60%)," +
                      "linear-gradient(180deg, oklch(0.18 0.014 260), oklch(0.13 0.012 260))",
                  }
                : undefined
            }
          >
            {/* USA outline (simplified) */}
            <svg viewBox="0 0 100 62" preserveAspectRatio="none" className="absolute inset-0 w-full h-full text-foreground/30">
              <path
                d="M3 18 L8 14 L14 12 L20 10 L28 8 L38 6 L48 5 L58 6 L68 7 L76 9 L84 12 L90 16 L94 22 L96 28 L96 36 L94 42 L90 46 L84 48 L78 49 L70 50 L62 51 L54 52 L46 52 L38 51 L30 50 L22 48 L16 45 L11 41 L7 36 L4 30 L2 24 Z"
                fill="currentColor"
                fillOpacity={visuals ? 0.08 : 0.06}
                stroke="currentColor"
                strokeOpacity={0.5}
                strokeWidth={0.25}
              />
              {/* state-ish internal hint lines */}
              {visuals &&
                Array.from({ length: 11 }).map((_, i) => (
                  <line key={i} x1={10 + i * 7} y1="10" x2={10 + i * 7} y2="50" stroke="currentColor" strokeOpacity={0.08} strokeWidth={0.15} />
                ))}
            </svg>

            {visuals && (
              <svg className="absolute inset-0 w-full h-full text-foreground/8" preserveAspectRatio="none" viewBox="0 0 100 100">
                {Array.from({ length: 21 }).map((_, i) => (
                  <g key={i}>
                    <line x1={i * 5} y1="0" x2={i * 5} y2="100" stroke="currentColor" strokeWidth="0.08" />
                    <line x1="0" y1={i * 5} x2="100" y2={i * 5} stroke="currentColor" strokeWidth="0.08" />
                  </g>
                ))}
              </svg>
            )}

            {placed.map((a) => {
              const p = project(a.latitude, a.longitude);
              const active = isActive(a);
              return (
                <div key={a.id} className="absolute group" style={{ left: `${p.x}%`, top: `${p.y}%`, transform: "translate(-50%, -50%)" }}>
                  {visuals && (
                    <>
                      <div
                        className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${active ? "bg-success/15" : "bg-muted-foreground/10"} blur-xl`}
                        style={{ width: active ? 90 : 50, height: active ? 90 : 50 }}
                      />
                      <div
                        className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border ${active ? "border-success/40" : "border-muted-foreground/25"}`}
                        style={{ width: active ? 56 : 32, height: active ? 56 : 32 }}
                      />
                    </>
                  )}
                  <div
                    className={`relative h-2.5 w-2.5 rounded-full ${active ? "bg-success" : "bg-muted-foreground/70"} ${visuals && active ? "animate-pulse-glow" : ""} ring-2 ring-background`}
                  />
                  <div className="absolute left-1/2 -translate-x-1/2 top-4 px-2 py-1 rounded-md bg-popover border border-border text-[11px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10 shadow-md">
                    <div className="font-medium text-foreground">{a.name}</div>
                    <div className="text-muted-foreground">{a.area ?? "—"}</div>
                  </div>
                </div>
              );
            })}

            {!visuals && (
              <div className="absolute bottom-3 right-3 text-[10.5px] uppercase tracking-wider text-muted-foreground/70">
                Visuals off · {placed.length} pinned
              </div>
            )}
          </div>
        )}
        {!visuals && (
          <p className="text-[11.5px] text-muted-foreground mt-3">
            Map visuals are off to keep the dashboard light. Toggle on to see coverage glow, grid, and hover detail.
          </p>
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
