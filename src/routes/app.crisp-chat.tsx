import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow, format } from "date-fns";
import {
  MessageSquare,
  Send,
  RefreshCw,
  Search,
  User,
  Mail,
  Phone,
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { RouteSkeleton } from "@/components/route-skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { syncCrispHistory, sendCrispMessage } from "@/lib/crisp.functions";
import type { Database } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/crisp-chat")({
  component: CrispChatPage,
  pendingComponent: () => <RouteSkeleton />,
  pendingMs: 200,
});

type CrispConversation = Database["public"]["Tables"]["crisp_conversations"]["Row"];
type CrispMessage = Database["public"]["Tables"]["crisp_messages"]["Row"];

function CrispChatPage() {
  const auth = useAuth();

  return (
    <div className="flex flex-col h-full min-h-screen">
      <PageHeader
        title="Crisp Chat"
        description="Manage live customer support conversations from your Crisp workspace."
      />
      <PageBody className="flex-1 flex flex-col min-h-0">
        <RoleGate allow={["admin", "cs_admin", "cs"]} current={auth.primaryRole}>
          <CrispChatInbox />
        </RoleGate>
      </PageBody>
    </div>
  );
}

function CrispChatInbox() {
  const queryClient = useQueryClient();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [messageInput, setMessageInput] = useState("");
  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const syncHistoryFn = useServerFn(syncCrispHistory);
  const sendMessageFn = useServerFn(sendCrispMessage);

  // 1. Fetch Crisp Conversations
  const conversationsQuery = useQuery({
    queryKey: ["crisp-conversations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crisp_conversations")
        .select("*")
        .order("last_message_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as CrispConversation[];
    },
    refetchInterval: 10000,
  });

  const conversations = conversationsQuery.data ?? [];

  // Automatically select first conversation if none selected
  useEffect(() => {
    if (!selectedSessionId && conversations.length > 0) {
      setSelectedSessionId(conversations[0].crisp_session_id);
    }
  }, [conversations, selectedSessionId]);

  // 2. Fetch Messages for selected conversation
  const messagesQuery = useQuery({
    queryKey: ["crisp-messages", selectedSessionId],
    queryFn: async () => {
      if (!selectedSessionId) return [];
      const { data, error } = await supabase
        .from("crisp_messages")
        .select("*")
        .eq("crisp_session_id", selectedSessionId)
        .order("sent_at", { ascending: true });

      if (error) throw error;
      return (data ?? []) as CrispMessage[];
    },
    enabled: !!selectedSessionId,
    refetchInterval: 5000,
  });

  const messages = messagesQuery.data ?? [];
  const selectedConversation = useMemo(
    () => conversations.find((c) => c.crisp_session_id === selectedSessionId),
    [conversations, selectedSessionId]
  );

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // 3. Supabase Realtime Subscription for instant live messages
  useEffect(() => {
    const channel = supabase
      .channel("crisp-realtime-channel")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "crisp_messages" },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["crisp-messages"] });
          void queryClient.invalidateQueries({ queryKey: ["crisp-conversations"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "crisp_conversations" },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["crisp-conversations"] });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  // Filter conversations based on search query and status filter
  const filteredConversations = useMemo(() => {
    return conversations.filter((conv) => {
      const matchesStatus =
        statusFilter === "all" || (conv.status || "unresolved").toLowerCase() === statusFilter;

      const q = searchQuery.toLowerCase().trim();
      if (!q) return matchesStatus;

      const nameMatch = conv.customer_name?.toLowerCase().includes(q) ?? false;
      const emailMatch = conv.customer_email?.toLowerCase().includes(q) ?? false;
      const phoneMatch = conv.customer_phone?.toLowerCase().includes(q) ?? false;
      const lastMsgMatch = conv.last_message?.toLowerCase().includes(q) ?? false;
      const sessionMatch = conv.crisp_session_id.toLowerCase().includes(q);

      return matchesStatus && (nameMatch || emailMatch || phoneMatch || lastMsgMatch || sessionMatch);
    });
  }, [conversations, searchQuery, statusFilter]);

  // Send message via server function
  const handleSendMessage = async () => {
    if (!selectedSessionId || !messageInput.trim() || sending) return;

    setSending(true);
    setConfigError(null);

    try {
      await sendMessageFn({
        data: { sessionId: selectedSessionId, content: messageInput.trim() },
      });
      setMessageInput("");
      void queryClient.invalidateQueries({ queryKey: ["crisp-messages", selectedSessionId] });
      void queryClient.invalidateQueries({ queryKey: ["crisp-conversations"] });
    } catch (err: any) {
      console.error("Failed to send message:", err);
      const errMsg = err?.message || "Failed to send message via Crisp";
      if (errMsg.includes("not configured") || errMsg.includes("Missing CRISP")) {
        setConfigError(
          "Crisp integration is not configured yet. Please configure CRISP_WEBSITE_ID, CRISP_TOKEN_ID, and CRISP_TOKEN_KEY in Supabase environment secrets.",
        );
      } else {
        alert(errMsg);
      }
    } finally {
      setSending(false);
    }
  };

  // Sync Crisp history via server function
  const handleSyncHistory = async () => {
    setSyncing(true);
    setConfigError(null);

    try {
      const result = await syncHistoryFn({});
      alert(
        `Crisp history sync completed! Synced ${result?.synced_conversations ?? 0} conversations.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["crisp-conversations"] });
    } catch (err: any) {
      console.error("Sync history failed:", err);
      const errMsg = err?.message || "Crisp history sync failed";
      if (errMsg.includes("not configured") || errMsg.includes("Missing CRISP")) {
        setConfigError(
          "Crisp integration is not configured yet. Please configure CRISP_WEBSITE_ID, CRISP_TOKEN_ID, and CRISP_TOKEN_KEY in Supabase environment secrets.",
        );
      } else {
        alert(errMsg);
      }
    } finally {
      setSyncing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  return (
    <div className="flex flex-col gap-3 h-[calc(100vh-140px)]">
      {/* Crisp Not Configured Banner */}
      {configError && (
        <div className="bg-amber-500/15 border border-amber-500/30 text-amber-200 px-4 py-3 rounded-2xl flex items-center justify-between text-xs sm:text-sm">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
            <span>{configError}</span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="text-xs h-7 text-amber-200 hover:text-white"
            onClick={() => setConfigError(null)}
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Main CRM Inbox Layout */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-0 bg-card border border-border rounded-[28px] overflow-hidden shadow-sm">
        {/* Left Side: Conversation List (4 cols) */}
        <div className="lg:col-span-4 flex flex-col border-r border-border min-h-0 bg-background/40">
          {/* List Header & Search */}
          <div className="p-3.5 border-b border-border space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-sm tracking-tight text-foreground">
                <MessageSquare className="h-4 w-4 text-primary" />
                <span>Conversations</span>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0.2 rounded-full">
                  {filteredConversations.length}
                </Badge>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5 rounded-xl"
                onClick={() => void handleSyncHistory()}
                disabled={syncing}
                title="Sync Crisp History"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
                <span>Sync</span>
              </Button>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search name, email, message..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 text-xs h-8 rounded-xl bg-background/60"
              />
            </div>

            {/* Status Filter Tabs */}
            <div className="flex items-center gap-1 text-[11px] overflow-x-auto pb-0.5">
              {["all", "unresolved", "pending", "resolved"].map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={cn(
                    "px-2.5 py-1 rounded-lg capitalize transition-colors font-medium shrink-0",
                    statusFilter === st
                      ? "bg-primary text-primary-foreground font-semibold"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  )}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          {/* Conversation List Items */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {conversationsQuery.isLoading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="text-center py-12 px-4 text-xs text-muted-foreground">
                {searchQuery || statusFilter !== "all"
                  ? "No conversations match your search filter."
                  : "No Crisp conversations yet."}
              </div>
            ) : (
              filteredConversations.map((conv) => {
                const isSelected = conv.crisp_session_id === selectedSessionId;
                const displayName =
                  conv.customer_name || conv.customer_email || `Visitor ${conv.crisp_session_id.slice(-6)}`;
                const relativeTime = conv.last_message_at
                  ? formatDistanceToNow(new Date(conv.last_message_at), { addSuffix: true })
                  : "";

                return (
                  <button
                    key={conv.id}
                    onClick={() => setSelectedSessionId(conv.crisp_session_id)}
                    className={cn(
                      "w-full text-left p-3 rounded-2xl transition-all duration-150 flex items-start gap-3 border",
                      isSelected
                        ? "bg-primary/10 border-primary/30 shadow-sm"
                        : "border-transparent hover:bg-muted/40 hover:border-border/50"
                    )}
                  >
                    {/* Avatar */}
                    <div className="h-9 w-9 rounded-full bg-primary/20 grid place-items-center shrink-0 font-bold text-xs text-primary uppercase">
                      {displayName.substring(0, 2)}
                    </div>

                    {/* Meta info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <span className="text-xs font-semibold text-foreground truncate">
                          {displayName}
                        </span>
                        <span className="text-[10px] text-muted-foreground shrink-0">{relativeTime}</span>
                      </div>

                      <p className="text-[11.5px] text-muted-foreground truncate leading-relaxed">
                        {conv.last_message || "No messages yet"}
                      </p>

                      <div className="flex items-center gap-1.5 mt-1.5">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[9.5px] px-1.5 py-0 rounded-md font-medium uppercase tracking-wider",
                            conv.status === "resolved" && "border-emerald-500/40 text-emerald-400 bg-emerald-500/10",
                            conv.status === "pending" && "border-amber-500/40 text-amber-400 bg-amber-500/10",
                            (!conv.status || conv.status === "unresolved") && "border-blue-500/40 text-blue-400 bg-blue-500/10"
                          )}
                        >
                          {conv.status || "unresolved"}
                        </Badge>
                        {conv.customer_email && (
                          <span className="text-[10px] text-muted-foreground/80 truncate">
                            {conv.customer_email}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Side: Selected Conversation Chat Panel (8 cols) */}
        <div className="lg:col-span-8 flex flex-col min-h-0 bg-background/20">
          {selectedConversation ? (
            <>
              {/* Customer Detail Header */}
              <div className="p-3.5 border-b border-border flex items-center justify-between gap-3 bg-card/60">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-full bg-primary/20 grid place-items-center shrink-0 font-bold text-sm text-primary uppercase">
                    {(selectedConversation.customer_name || selectedConversation.customer_email || "V").substring(0, 2)}
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm font-bold text-foreground truncate">
                      {selectedConversation.customer_name || "Crisp Visitor"}
                    </h2>
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                      {selectedConversation.customer_email && (
                        <span className="flex items-center gap-1 truncate">
                          <Mail className="h-3 w-3 shrink-0" />
                          {selectedConversation.customer_email}
                        </span>
                      )}
                      {selectedConversation.customer_phone && (
                        <span className="flex items-center gap-1 truncate">
                          <Phone className="h-3 w-3 shrink-0" />
                          {selectedConversation.customer_phone}
                        </span>
                      )}
                      <span className="text-[10px] font-mono text-muted-foreground/70 truncate">
                        ID: {selectedConversation.crisp_session_id}
                      </span>
                    </div>
                  </div>
                </div>

                <Badge
                  variant="outline"
                  className={cn(
                    "text-xs px-2.5 py-0.5 rounded-full capitalize font-semibold shrink-0",
                    selectedConversation.status === "resolved" && "border-emerald-500/40 text-emerald-400 bg-emerald-500/10",
                    selectedConversation.status === "pending" && "border-amber-500/40 text-amber-400 bg-amber-500/10",
                    (!selectedConversation.status || selectedConversation.status === "unresolved") && "border-blue-500/40 text-blue-400 bg-blue-500/10"
                  )}
                >
                  {selectedConversation.status || "unresolved"}
                </Badge>
              </div>

              {/* Chat Messages Thread */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
                {messagesQuery.isLoading ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground gap-2">
                    <MessageSquare className="h-8 w-8 opacity-40" />
                    <p className="text-xs">No message history available for this session.</p>
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isOperator = msg.sender_type === "operator" || msg.direction === "outgoing";
                    const formattedTime = msg.sent_at
                      ? format(new Date(msg.sent_at), "MMM d, h:mm a")
                      : "";

                    return (
                      <div
                        key={msg.id}
                        className={cn("flex flex-col max-w-[80%]", isOperator ? "ml-auto items-end" : "mr-auto items-start")}
                      >
                        <div className="flex items-center gap-1.5 mb-1 text-[10.5px] text-muted-foreground font-medium">
                          <span>{isOperator ? "Staff / Operator" : (selectedConversation.customer_name || "Customer")}</span>
                          <span>·</span>
                          <span>{formattedTime}</span>
                        </div>

                        <div
                          className={cn(
                            "px-4 py-2.5 rounded-2xl text-xs sm:text-[13px] leading-relaxed shadow-sm break-words whitespace-pre-wrap",
                            isOperator
                              ? "bg-primary text-primary-foreground rounded-tr-xs font-normal"
                              : "bg-muted/70 text-foreground border border-border/60 rounded-tl-xs"
                          )}
                        >
                          {msg.content}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Message Composer Area */}
              <div className="p-3.5 border-t border-border bg-card/60">
                <div className="flex flex-col gap-2">
                  <Textarea
                    placeholder="Type your response to the customer... (Enter to send)"
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="min-h-[70px] max-h-[140px] text-xs sm:text-sm resize-none rounded-2xl bg-background/80"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">
                      Sent directly to customer via Crisp
                    </span>
                    <Button
                      size="sm"
                      onClick={() => void handleSendMessage()}
                      disabled={sending || !messageInput.trim()}
                      className="rounded-xl px-4 text-xs gap-1.5 h-8 font-semibold shadow-sm"
                    >
                      {sending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="h-3.5 w-3.5" />
                      )}
                      <span>{sending ? "Sending..." : "Send Message"}</span>
                    </Button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
              <MessageSquare className="h-10 w-10 opacity-30" />
              <p className="text-sm font-medium">Select a conversation to view chat history</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
