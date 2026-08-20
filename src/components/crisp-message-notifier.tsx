import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
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

type QueuedMessageAlert = {
  id: string;
  customerName: string;
  workspaceName: string;
  messageSnippet: string;
};

export function CrispMessageNotifier() {
  const { roles, primaryRole, user } = useAuth();
  const navigate = useNavigate();

  const isCsAdmin =
    primaryRole === "cs_admin" ||
    roles.includes("cs_admin") ||
    roles.includes("admin");

  const seenMsgIdsRef = useRef<Set<string>>(new Set());
  const pendingBackgroundQueueRef = useRef<QueuedMessageAlert[]>([]);

  const displayMessageToast = (item: QueuedMessageAlert) => {
    playCrispChime();
    toast(
      `New message from ${item.customerName} (${item.workspaceName}): "${item.messageSnippet}"`,
      {
        duration: 9000,
        icon: <MessageSquare className="w-4 h-4 text-primary shrink-0" />,
        action: {
          label: "View Chat",
          onClick: () => navigate({ to: "/app/crisp-chat" }),
        },
      }
    );
  };

  const flushBackgroundQueue = () => {
    const queue = pendingBackgroundQueueRef.current;
    if (queue.length === 0) return;

    if (queue.length === 1) {
      displayMessageToast(queue[0]);
    } else {
      playCrispChime();
      toast(
        `You received ${queue.length} new Crisp messages while away.`,
        {
          duration: 10000,
          icon: <MessageSquare className="w-4 h-4 text-primary shrink-0" />,
          action: {
            label: "Open Crisp Chat",
            onClick: () => navigate({ to: "/app/crisp-chat" }),
          },
        }
      );
    }
    pendingBackgroundQueueRef.current = [];
  };

  // 1. FLUSH PENDING NOTIFICATIONS WHEN USER SWITCHES BACK TO THE CRM TAB
  useEffect(() => {
    if (!isCsAdmin) return;

    const handleVisibilityOrFocus = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        flushBackgroundQueue();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityOrFocus);
    window.addEventListener("focus", handleVisibilityOrFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
      window.removeEventListener("focus", handleVisibilityOrFocus);
    };
  }, [isCsAdmin, navigate]);

  // 2. REALTIME INCOMING MESSAGE LISTENER
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

          // Prevent duplicate notification if already seen
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

          const messageSnippet =
            newMsg.content && newMsg.content.length > 80
              ? `${newMsg.content.slice(0, 80)}...`
              : newMsg.content || "Sent a message";

          const alertItem: QueuedMessageAlert = {
            id: newMsg.id,
            customerName,
            workspaceName,
            messageSnippet,
          };

          // If the CRM tab is currently open & visible, notify immediately.
          // If the CRM tab is minimized or user is on another Chrome tab, queue it to notify upon return.
          const isTabVisible =
            typeof document !== "undefined" && document.visibilityState === "visible";

          if (isTabVisible) {
            displayMessageToast(alertItem);
          } else {
            pendingBackgroundQueueRef.current.push(alertItem);
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isCsAdmin, user?.id, navigate]);

  return null;
}
