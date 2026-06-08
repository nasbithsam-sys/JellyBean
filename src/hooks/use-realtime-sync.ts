import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/hooks/use-auth";

// Map each replicated table to the React Query keys that should refresh
// when any user inserts/updates/deletes a row.
const TABLE_QUERY_KEYS: Record<string, string[][]> = {
  qualified_leads: [["cs_leads"], ["cs_sent_today"], ["cs_new_lead_ping"]],
  incogniton_profiles: [["incog_profiles"]],
  shared_state: [["raw-leads-shared-start-row"]],
};

const ROLE_TABLES: Record<AppRole, string[]> = {
  admin: ["qualified_leads", "incogniton_profiles", "shared_state"],
  scraping: ["qualified_leads", "incogniton_profiles", "shared_state"],
  processor: ["qualified_leads", "incogniton_profiles", "shared_state"],
  cs: ["qualified_leads"],
};

/**
 * Mount once at the app shell. Subscribes to Postgres changes on the core
 * CRM tables and invalidates the matching React Query caches so every
 * signed-in user sees changes in real time.
 */
export function useRealtimeSync(role: AppRole | null) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!role) return;
    const channel = supabase.channel("crm-realtime-sync");
    const tables = ROLE_TABLES[role];

    for (const table of tables) {
      (channel as unknown as { on: (...args: unknown[]) => typeof channel }).on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          for (const key of TABLE_QUERY_KEYS[table]) {
            qc.invalidateQueries({ queryKey: key });
          }
        },
      );
    }

    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [role, qc]);
}
