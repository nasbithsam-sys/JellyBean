import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Map each replicated table to the React Query keys that should refresh
// when any user inserts/updates/deletes a row.
const TABLE_QUERY_KEYS: Record<string, string[][]> = {
  raw_leads: [["raw-leads-api"], ["raw_leads"]],
  raw_lead_cache: [["raw-lead-cache"]],
  qualified_leads: [["cs_leads"], ["cs_sent_today"], ["cs_new_lead_ping"]],
  incogniton_profiles: [["incog_profiles"]],
  shared_state: [["raw-leads-shared-start-row"]],
  accounts: [["accounts"]],
  activity_logs: [["activity_logs"], ["logs"]],
  profiles: [["profiles"], ["admin_users"]],
  app_settings: [["app_settings"]],
};

/**
 * Mount once at the app shell. Subscribes to Postgres changes on the core
 * CRM tables and invalidates the matching React Query caches so every
 * signed-in user sees changes in real time.
 */
export function useRealtimeSync(enabled: boolean) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase.channel("crm-realtime-sync");

    for (const table of Object.keys(TABLE_QUERY_KEYS)) {
      channel.on(
        // @ts-expect-error - supabase-js types for postgres_changes payload
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
  }, [enabled, qc]);
}
