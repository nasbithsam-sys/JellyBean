import { useEffect, useRef } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

function isCrispMaskedMessage(content: string | null | undefined): boolean {
  if (!content) return false;
  const trimmed = content.trim();
  if (!trimmed) return false;
  const stripped = trimmed.replace(/[\s\p{P}\p{S}]/gu, "");
  return stripped.length >= 3 && /^x+$/i.test(stripped);
}

function playCrispChime() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const beep = (freq: number, start: number, dur: number, vol = 0.4) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + 0.02);
    };
    // Clean double-tone notification chime
    beep(587.33, 0.0, 0.14); // D5
    beep(880.0, 0.14, 0.22); // A5
    setTimeout(() => ctx.close(), 1500);
  } catch {
    // Ignore audio context errors if blocked by browser policy
  }
}

function showBrowserNotification(title: string, body: string, onClick?: () => void) {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    const n = new Notification(title, {
      body,
      icon: "/favicon.ico",
      tag: "crisp-incoming-message",
      requireInteraction: false,
    });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch {
    // Ignore notification errors
  }
}

export function CrispMessageNotifier() {
  const { roles, primaryRole, user } = useAuth();
  const navigate = useNavigate();
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  const isCsAdmin =
    primaryRole === "cs_admin" ||
    roles.includes("cs_admin") ||
    roles.includes("admin");

  const seenMsgIdsRef = useRef<Set<string>>(new Set());
  const hasCheckedOfflineRef = useRef(false);

  // 1. OFFLINE CATCH-UP / INITIAL LOAD CHECK
  // When CS Admin opens the CRM, check if there are unreplied conversations waiting
  useEffect(() => {
    if (!isCsAdmin || !user?.id || hasCheckedOfflineRef.current) return;
    hasCheckedOfflineRef.current = true;

    async function checkPendingUnread() {
      try {
        const { data, error } = await supabase.rpc("get_crisp_workspace_summaries");
        if (error || !data) return;

        const totalUnreplied = (data as any[]).reduce((sum, item) => {
          return sum + Number(item.unreplied_chat_count || 0);
        }, 0);

        if (totalUnreplied > 0 && currentPath !== "/app/crisp-chat") {
          const lastAlert = sessionStorage.getItem("crisp_offline_alert_shown");
          const now = Date.now();
          if (!lastAlert || now - Number(lastAlert) > 5 * 60 * 1000) {
            sessionStorage.setItem("crisp_offline_alert_shown", String(now));
            toast.info(
              `You have ${totalUnreplied} Crisp conversation${totalUnreplied > 1 ? "s" : ""} awaiting customer reply.`,
              {
                duration: 8000,
                action: {
                  label: "Open Crisp Chat",
                  onClick: () => navigate({ to: "/app/crisp-chat" }),
                },
              }
            );
          }
        }
      } catch (err) {
        console.error("Failed to check pending Crisp unread count:", err);
      }
    }

    void checkPendingUnread();
  }, [isCsAdmin, user?.id, currentPath, navigate]);

  // 2. ONLINE REALTIME NOTIFICATION
  // Listens for new incoming customer messages in real-time
  useEffect(() => {
    if (!isCsAdmin || !user?.id) return;

    const channel = supabase
      .channel(`crisp-incoming-notifier-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "crisp_messages" },
        async (payload) => {
          const newMsg = payload.new as any;
          if (!newMsg?.id) return;

          // Only notify on incoming customer messages
          const isCustomer =
            newMsg.direction === "incoming" ||
            newMsg.sender_type === "customer" ||
            newMsg.sender_type === "user";
          if (!isCustomer) return;

          // Ignore masked / redacted free-plan placeholder messages
          if (isCrispMaskedMessage(newMsg.content)) return;

          // Prevent duplicate toast if already seen
          if (seenMsgIdsRef.current.has(newMsg.id)) return;
          seenMsgIdsRef.current.add(newMsg.id);

          // Fetch conversation details (customer name & workspace name)
          let customerName = "Customer";
          let workspaceName = "Crisp";

          try {
            const { data: conv } = await supabase
              .from("crisp_conversations")
              .select("customer_name, crisp_website_id")
              .eq("id", newMsg.conversation_id)
              .maybeSingle();

            if (conv?.customer_name?.trim()) {
              customerName = conv.customer_name.trim();
            }

            if (conv?.crisp_website_id) {
              const { data: ws } = await supabase
                .from("crisp_workspaces")
                .select("workspace_name")
                .eq("crisp_website_id", conv.crisp_website_id)
                .maybeSingle();
              if (ws?.workspace_name?.trim()) {
                workspaceName = ws.workspace_name.trim();
              }
            }
          } catch {
            // Non-fatal if fetch fails
          }

          // Play audio notification chime
          playCrispChime();

          const messageSnippet =
            newMsg.content && newMsg.content.length > 80
              ? `${newMsg.content.slice(0, 80)}...`
              : newMsg.content || "Sent a message";

          // Browser Notification (for background tab)
          showBrowserNotification(
            `Crisp Message: ${customerName} (${workspaceName})`,
            messageSnippet,
            () => navigate({ to: "/app/crisp-chat" })
          );

          // In-App Toast
          toast(
            `New message from ${customerName} (${workspaceName}): "${messageSnippet}"`,
            {
              duration: 10000,
              icon: <MessageSquare className="w-4 h-4 text-primary shrink-0" />,
              action: {
                label: "View Chat",
                onClick: () => navigate({ to: "/app/crisp-chat" }),
              },
            }
          );
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isCsAdmin, user?.id, navigate]);

  return null;
}
