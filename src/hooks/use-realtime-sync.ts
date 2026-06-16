import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/hooks/use-auth";

// Map each replicated table to the React Query keys that should refresh
// when any user inserts/updates/deletes a row.
const TABLE_QUERY_KEYS: Record<string, string[][]> = {
  qualified_leads: [["cs_leads"], ["cs_sent_today"], ["forwarded-leads"]],
  incogniton_profiles: [["incog_profiles"]],
  shared_state: [["raw-leads-shared-start-row"], ["raw-leads-ai-lock"], ["lead-ai-prompt"]],
  // raw_lead_cache is intentionally NOT auto-synced — Raw Leads only
  // refreshes when the user clicks the Refresh button.
};

const ROLE_TABLES: Record<AppRole, string[]> = {
  admin: ["qualified_leads", "incogniton_profiles", "shared_state"],
  sub_admin: ["qualified_leads", "incogniton_profiles", "shared_state"],
  scraping: ["qualified_leads", "incogniton_profiles", "shared_state"],
  processor: ["qualified_leads", "incogniton_profiles", "shared_state"],
  // CS pipeline intentionally avoids background list invalidation. A separate
  // insert listener shows new-lead alerts, while manual refresh keeps active
  // compose work from jumping when other users forward or update leads.
  cs: [],
  acc_handler: ["incogniton_profiles", "shared_state"],
  facebook: ["qualified_leads"],
  seo: ["qualified_leads"],
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
