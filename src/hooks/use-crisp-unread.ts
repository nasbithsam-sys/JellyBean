import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useCrispUnread() {
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const isMountedRef = useRef(true);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc("get_crisp_workspace_summaries");
      if (!error && data && isMountedRef.current) {
        let total = 0;
        (data as any[]).forEach((item) => {
          const unreplied = Number(item.unreplied_chat_count ?? item.total_chat_count ?? 0);
          total += unreplied;
        });
        setUnreadCount(total);
      }
    } catch {
      // Non-fatal if fetch fails
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    void fetchUnreadCount();

    const channel = supabase
      .channel("crisp-unread-nav-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "crisp_conversations" },
        () => {
          void fetchUnreadCount();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "crisp_workspaces" },
        () => {
          void fetchUnreadCount();
        }
      )
      .subscribe();

    return () => {
      isMountedRef.current = false;
      void supabase.removeChannel(channel);
    };
  }, [fetchUnreadCount]);

  return {
    unreadCount,
    hasUnread: unreadCount > 0,
  };
}
