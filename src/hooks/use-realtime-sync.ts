import { useEffect, useState, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/hooks/use-auth";

// Map each replicated table to the React Query keys that should refresh
// when any user inserts/updates a row.
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
  maturing: ["qualified_leads", "incogniton_profiles", "shared_state"],
  // CS pipeline intentionally avoids background list invalidation.
  cs: [],
  cs_admin: [],
  acc_handler: ["incogniton_profiles", "shared_state"],
  facebook: ["qualified_leads"],
  seo: ["qualified_leads"],
};

/**
 * Coalesces bursts of realtime events into a single query invalidation per
 * key. With 15–50 concurrent users a single write can otherwise trigger N
 * refetches per subscriber; this keeps it to at most one per 400 ms window.
 */
function makeDebouncedInvalidator(qc: QueryClient, waitMs = 400) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  return (key: string[]) => {
    const id = key.join("/");
    const existing = timers.get(id);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      timers.delete(id);
      qc.invalidateQueries({ queryKey: key });
    }, waitMs);
    timers.set(id, t);
  };
}

/**
 * Mount once at the app shell. Subscribes to Postgres INSERT/UPDATE on the
 * core CRM tables and debounces query cache invalidations so bursts of
 * writes from many users don't flood the client with refetches.
 */
export function useRealtimeSync(role: AppRole | null) {
  const qc = useQueryClient();
  const invalidateRef = useRef<((key: string[]) => void) | null>(null);

  useEffect(() => {
    invalidateRef.current = makeDebouncedInvalidator(qc, 400);
  }, [qc]);

  useEffect(() => {
    if (!role) return;
    const tables = ROLE_TABLES[role];
    if (tables.length === 0) return;

    const channel = supabase.channel("crm-realtime-sync");

    for (const table of tables) {
      // INSERT + UPDATE only — DELETE is rare and doesn't need list refresh
      // urgency; UI already reflects it locally when the user triggers it.
      for (const event of ["INSERT", "UPDATE"] as const) {
        (channel as unknown as { on: (...args: unknown[]) => typeof channel }).on(
          "postgres_changes",
          { event, schema: "public", table },
          () => {
            const invalidate = invalidateRef.current;
            if (!invalidate) return;
            for (const key of TABLE_QUERY_KEYS[table] ?? []) invalidate(key);
          },
        );
      }
    }

    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [role, qc]);
}

/**
 * Listens for new qualified_leads inserts and keeps track of count.
 * Exposes a function to clear the count alert.
 */
export function useNewLeadAlert(role?: AppRole | null) {
  const [newLeadCount, setNewLeadCount] = useState(0);

  // Only CS-facing roles (cs, admin, sub_admin) should see the "new leads" banner
  // — other roles never open the CS pipeline, so we skip the subscription entirely.
  const enabled = role === undefined || role === null
    ? true
    : role === "cs" || role === "admin" || role === "sub_admin";

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase.channel("cs-new-leads-realtime");
    (channel as unknown as { on: (...args: unknown[]) => typeof channel }).on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "qualified_leads" },
      () => {
        setNewLeadCount((prev) => prev + 1);
      },
    );
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled]);

  const clearAlert = () => setNewLeadCount(0);

  return { newLeadCount, clearAlert };
}
