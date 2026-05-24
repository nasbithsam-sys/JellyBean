import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { supabase } from "@/integrations/supabase/client";
import { MapPin } from "lucide-react";

export const Route = createFileRoute("/app/map")({ component: Page });

function Page() {
  const auth = useAuth();
  return (
    <div>
      <PageHeader title="Map Coverage" description="Visual layout of monitored account locations." />
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
      const { data, error } = await supabase.from("accounts").select("id, name, area, latitude, longitude");
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
    const padLat = (bounds.maxLat - bounds.minLat) * 0.1 || 0.001;
    const padLng = (bounds.maxLng - bounds.minLng) * 0.1 || 0.001;
    const x = ((lng - (bounds.minLng - padLng)) / (bounds.maxLng - bounds.minLng + padLng * 2)) * 100;
    const y = 100 - ((lat - (bounds.minLat - padLat)) / (bounds.maxLat - bounds.minLat + padLat * 2)) * 100;
    return { x, y };
  }

  const byArea = useMemo(() => {
    const m = new Map<string, number>();
    (accounts.data ?? []).forEach((a) => m.set(a.area, (m.get(a.area) ?? 0) + 1));
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [accounts.data]);

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 bg-card border rounded-lg p-5">
        <h3 className="text-sm font-semibold mb-3">Account positions</h3>
        {accounts.isLoading ? (
          <div className="h-96 grid place-items-center text-muted-foreground">Loading…</div>
        ) : !accounts.data?.length ? (
          <div className="h-96 grid place-items-center text-muted-foreground text-sm">No accounts yet — add some on the Accounts page.</div>
        ) : (
          <div className="relative aspect-[4/3] w-full bg-[radial-gradient(circle_at_30%_30%,hsl(var(--primary)/0.08),transparent_60%),linear-gradient(to_bottom_right,hsl(var(--muted)),hsl(var(--background)))] border rounded-md overflow-hidden">
            <svg className="absolute inset-0 w-full h-full opacity-20" preserveAspectRatio="none" viewBox="0 0 100 100">
              {Array.from({ length: 11 }).map((_, i) => (
                <g key={i}>
                  <line x1={i * 10} y1="0" x2={i * 10} y2="100" stroke="currentColor" strokeWidth="0.1" />
                  <line x1="0" y1={i * 10} x2="100" y2={i * 10} stroke="currentColor" strokeWidth="0.1" />
                </g>
              ))}
            </svg>
            {accounts.data.map((a) => {
              const p = project(a.latitude, a.longitude);
              return (
                <div key={a.id} className="absolute -translate-x-1/2 -translate-y-full group" style={{ left: `${p.x}%`, top: `${p.y}%` }}>
                  <MapPin className="h-5 w-5 text-primary drop-shadow" fill="currentColor" />
                  <div className="absolute left-1/2 -translate-x-1/2 mt-1 px-2 py-1 rounded bg-popover border text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10">
                    <div className="font-medium">{a.name}</div>
                    <div className="text-muted-foreground">{a.area}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-card border rounded-lg p-5">
        <h3 className="text-sm font-semibold mb-3">Coverage by area</h3>
        <div className="space-y-2">
          {byArea.length === 0 && <div className="text-sm text-muted-foreground">—</div>}
          {byArea.map(([area, count]) => (
            <div key={area} className="flex items-center justify-between text-sm">
              <span>{area}</span>
              <span className="font-mono bg-muted px-2 py-0.5 rounded text-xs">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
