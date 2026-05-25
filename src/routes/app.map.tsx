import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import type { PlacedAccount } from "@/components/leaflet-map";

export const Route = createFileRoute("/app/map")({ component: Page });

type Account = {
  id: string; name: string; area: string | null;
  latitude: number | null; longitude: number | null;
  last_opened_at: string | null;
};

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

type LeafletMapComp = ComponentType<{ placed: PlacedAccount[]; visuals: boolean }>;

function Inner() {
  const [visuals, setVisuals] = useState(false);
  const [LeafletMap, setLeafletMap] = useState<LeafletMapComp | null>(null);

  useEffect(() => {
    const v = localStorage.getItem("map.visuals");
    if (v === "1") setVisuals(true);
    import("@/components/leaflet-map").then((m) => setLeafletMap(() => m.default));
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

  const placed = useMemo<PlacedAccount[]>(
    () =>
      (accounts.data ?? []).filter(
        (a): a is Account & { latitude: number; longitude: number } =>
          a.latitude !== null && a.longitude !== null,
      ),
    [accounts.data],
  );

  const byArea = useMemo(() => {
    const m = new Map<string, number>();
    (accounts.data ?? []).forEach((a) => {
      const key = a.area?.trim() || "Unassigned";
      m.set(key, (m.get(key) ?? 0) + 1);
    });
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [accounts.data]);

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

        {accounts.isLoading || !LeafletMap ? (
          <div className="h-[480px] grid place-items-center text-muted-foreground">Loading…</div>
        ) : (
          <div className="aspect-[16/10] w-full rounded-lg overflow-hidden border border-border bg-surface">
            <LeafletMap placed={placed} visuals={visuals} />
          </div>
        )}
        <p className="text-[11.5px] text-muted-foreground mt-3">
          {visuals
            ? "Visuals on — coverage circles rendered for each pinned account."
            : "Map visuals are off to keep things light. Toggle on to see coverage circles."}
          {" · "}
          {placed.length} pinned
        </p>
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
