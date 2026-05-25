import { Fragment } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapContainer, TileLayer, Marker, Popup, Circle } from "react-leaflet";
import L from "leaflet";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/app/map")({ component: Page });

// Fix default marker icon paths (leaflet's default uses build-time URLs)
const DefaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

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
          <div className="aspect-[16/10] w-full rounded-lg overflow-hidden border border-border bg-surface">
            <MapContainer
              center={[39.5, -98.35]}
              zoom={4}
              minZoom={3}
              scrollWheelZoom
              style={{ height: "100%", width: "100%" }}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {placed.map((a) => {
                const active = isActive(a);
                return (
                  <div key={a.id}>
                    {visuals && (
                      <Circle
                        center={[a.latitude, a.longitude]}
                        radius={active ? 60000 : 30000}
                        pathOptions={{
                          color: active ? "#22c55e" : "#94a3b8",
                          fillOpacity: 0.15,
                          weight: 1,
                        }}
                      />
                    )}
                    <Marker position={[a.latitude, a.longitude]}>
                      <Popup>
                        <div className="text-[12.5px]">
                          <div className="font-semibold">{a.name}</div>
                          <div className="text-muted-foreground">{a.area ?? "—"}</div>
                          <div className="mt-1 text-[11px]">
                            {active ? "Active" : "Idle"}
                          </div>
                        </div>
                      </Popup>
                    </Marker>
                  </div>
                );
              })}
            </MapContainer>
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
