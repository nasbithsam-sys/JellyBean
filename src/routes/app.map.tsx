import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { PlacedAccount } from "@/components/leaflet-map";

export const Route = createFileRoute("/app/map")({ component: Page });

type LaunchHistoryEntry = { at: string; by?: string | null };

type BrowserProfile = {
  id: string;
  profile_name: string;
  account_area: string | null;
  latitude: number | null;
  longitude: number | null;
  last_launched_at: string | null;
  launch_history: Json;
};

type LeafletMapComp = ComponentType<{
  placed: PlacedAccount[];
  visuals: boolean;
  radiusMode: MapRadiusMode;
  tempPin?: { lat: number; lng: number } | null;
  onMapClick?: (lat: number, lng: number) => void;
}>;

type MapRadiusMode = "daily" | "all";

function Page() {
  const auth = useAuth();
  return (
    <div>
      <PageHeader
        title="Map"
        description="Daily 50-mile launch coverage from browser profile coordinates."
      />
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
  const [radiusMode, setRadiusMode] = useState<MapRadiusMode>("daily");
  const [LeafletMap, setLeafletMap] = useState<LeafletMapComp | null>(null);
  const [tempPin, setTempPin] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    const visualsValue = localStorage.getItem("map.visuals");
    const modeValue = localStorage.getItem("map.radiusMode");
    if (visualsValue === "1") setVisuals(true);
    if (modeValue === "all" || modeValue === "daily") setRadiusMode(modeValue);
    import("@/components/leaflet-map").then((module) => setLeafletMap(() => module.default));
  }, []);

  const toggle = (next: boolean) => {
    setVisuals(next);
    localStorage.setItem("map.visuals", next ? "1" : "0");
  };

  const changeRadiusMode = (next: string) => {
    const mode = next === "all" ? "all" : "daily";
    setRadiusMode(mode);
    localStorage.setItem("map.radiusMode", mode);
  };

  const profiles = useQuery({
    queryKey: ["incog-profiles-map"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("incogniton_profiles")
        .select(
          "id, profile_name, account_area, latitude, longitude, last_launched_at, launch_history",
        )
        .order("last_launched_at", { ascending: false, nullsFirst: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as BrowserProfile[];
    },
  });

  const todayKey = useMemo(() => dayKey(new Date()), []);

  const placed = useMemo<PlacedAccount[]>(() => {
    return (profiles.data ?? [])
      .filter(
        (profile): profile is BrowserProfile & { latitude: number; longitude: number } =>
          profile.latitude !== null && profile.longitude !== null,
      )
      .map((profile) => {
        const history = parseHistory(profile.launch_history);
        const todayLaunchCount = countLaunchesOnDay(history, todayKey, profile.last_launched_at);
        return {
          id: profile.id,
          name: profile.profile_name,
          area: profile.account_area,
          latitude: profile.latitude,
          longitude: profile.longitude,
          last_launched_at: profile.last_launched_at,
          launched_today: todayLaunchCount > 0,
          today_launch_count: todayLaunchCount,
        };
      });
  }, [profiles.data, todayKey]);

  const coverage = useMemo(() => {
    const byArea = new Map<string, { total: number; covered: number; launches: number }>();
    for (const profile of placed) {
      const key = profile.area?.trim() || "Unassigned";
      const current = byArea.get(key) ?? { total: 0, covered: 0, launches: 0 };
      current.total += 1;
      current.launches += profile.today_launch_count;
      if (profile.launched_today) current.covered += 1;
      byArea.set(key, current);
    }
    return Array.from(byArea.entries()).sort(
      (a, b) => b[1].covered - a[1].covered || b[1].total - a[1].total,
    );
  }, [placed]);

  const coveredToday = placed.filter((profile) => profile.launched_today).length;
  const missingToday = placed.length - coveredToday;
  const fullRadiusCount = radiusMode === "all" ? placed.length : coveredToday;

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 glass-card p-5">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold tracking-tight">
              {radiusMode === "all" ? "Added account radius" : "Daily profile coverage"}
            </h3>
            <div className="text-[11.5px] text-muted-foreground mt-0.5">
              {radiusMode === "all"
                ? "Every added browser profile with coordinates shows a 50-mile radius."
                : "50-mile radius appears only for profiles launched today."}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Tabs value={radiusMode} onValueChange={changeRadiusMode}>
              <TabsList className="h-9">
                <TabsTrigger value="daily" className="h-7 text-[11.5px]">
                  Daily launches
                </TabsTrigger>
                <TabsTrigger value="all" className="h-7 text-[11.5px]">
                  All added accounts
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-primary" />
                Covered today
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-muted-foreground/60" />
                Missing today
              </span>
            </div>
            <div className="flex items-center gap-2 pl-3 border-l border-border">
              <Label htmlFor="visuals" className="text-[12px] text-muted-foreground cursor-pointer">
                Map visuals
              </Label>
              <Switch id="visuals" checked={visuals} onCheckedChange={toggle} />
            </div>
          </div>
        </div>

        {!visuals ? (
          <div className="aspect-[16/10] w-full rounded-lg border border-dashed border-border bg-surface/40 grid place-items-center text-center px-6">
            <div>
              <div className="text-sm font-medium">Map visuals are off</div>
              <div className="text-[12px] text-muted-foreground mt-1">
                Toggle "Map visuals" on to load map tiles and coverage circles.
              </div>
            </div>
          </div>
        ) : profiles.isLoading || !LeafletMap ? (
          <div className="h-[480px] grid place-items-center text-muted-foreground">Loading...</div>
        ) : (
          <div className="aspect-[16/10] w-full rounded-lg overflow-hidden border border-border bg-surface">
            <LeafletMap
              placed={placed}
              visuals={visuals}
              radiusMode={radiusMode}
              tempPin={tempPin}
              onMapClick={(lat, lng) => setTempPin({ lat, lng })}
            />
          </div>
        )}
        <p className="text-[11.5px] text-muted-foreground mt-3">
          {visuals
            ? "Click anywhere on the map to drop a temporary 50-mile red radius. It clears when you leave this page."
            : "Map visuals stay off by default so tile egress only happens when you need the map."}
          {tempPin && (
            <>
              {" · "}
              <button
                type="button"
                onClick={() => setTempPin(null)}
                className="underline text-destructive hover:text-destructive/80"
              >
                Clear temporary radius
              </button>
            </>
          )}
          {" · "}
          {fullRadiusCount} full 50-mile radii · {coveredToday} covered today · {missingToday}{" "}
          missing · {placed.length} pinned profiles
        </p>
      </div>

      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold tracking-tight mb-4">Coverage by area</h3>
        <div className="grid grid-cols-2 gap-2 mb-4">
          <Stat label="Covered" value={coveredToday} />
          <Stat label="Missing" value={missingToday} />
        </div>
        <div className="space-y-2">
          {coverage.length === 0 && (
            <div className="text-sm text-muted-foreground">No pinned profiles.</div>
          )}
          {coverage.map(([area, counts]) => {
            const pct = counts.total ? (counts.covered / counts.total) * 100 : 0;
            return (
              <div key={area} className="group">
                <div className="flex items-center justify-between text-[12.5px] mb-1 gap-2">
                  <span className="truncate">{area}</span>
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {counts.covered}/{counts.total} · {counts.launches} launches
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-surface overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-500"
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

function parseHistory(value: Json): LaunchHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is LaunchHistoryEntry => {
    return (
      !!entry && typeof entry === "object" && !Array.isArray(entry) && typeof entry.at === "string"
    );
  });
}

function dayKey(date: Date) {
  return [date.getFullYear(), date.getMonth(), date.getDate()].join("-");
}

function countLaunchesOnDay(
  history: LaunchHistoryEntry[],
  targetDay: string,
  lastLaunchedAt: string | null,
) {
  const historyCount = history.filter((entry) => dayKey(new Date(entry.at)) === targetDay).length;
  if (historyCount > 0) return historyCount;
  if (!lastLaunchedAt) return 0;
  return dayKey(new Date(lastLaunchedAt)) === targetDay ? 1 : 0;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-surface/60 p-3">
      <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-1">{value}</div>
    </div>
  );
}
