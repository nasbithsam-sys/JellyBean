import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Globe,
  Key,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Trash2,
  User,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  addCrispConversationNote,
  addCrispWorkspace,
  deleteCrispConversationNote,
  regenerateCrispWebhookSecret,
  sendCrispMessage,
  syncCrispHistory,
  toggleCrispWorkspace,
} from "@/lib/crisp.functions";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { PageBody, PageHeader, RoleGate } from "@/components/page";

export const Route = createFileRoute("/app/crisp-chat")({
  component: CrispChatPage,
});

type ConversationRecord = {
  id: string;
  crisp_session_id: string;
  crisp_website_id: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_avatar: string | null;
  status: string | null;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number | null;
  metadata: any;
  created_at: string | null;
  updated_at: string | null;
};

type MessageRecord = {
  id: string;
  conversation_id: string;
  crisp_session_id: string;
  crisp_website_id: string | null;
  crisp_message_id: string | null;
  sender_type: "user" | "customer" | "operator";
  direction: "incoming" | "outgoing";
  content: string;
  message_type: string | null;
  sent_at: string;
  raw_payload: any;
};

type WorkspaceRecord = {
  id: string;
  crisp_website_id: string;
  workspace_name: string | null;
  enabled: boolean;
  credential_secret_id: string | null;
  installed_at: string | null;
  last_seen_at: string | null;
  last_synced_at: string | null;
};

type NoteRecord = {
  id: string;
  conversation_id: string;
  created_by: string;
  note: string;
  is_edited: boolean;
  created_at: string;
  author_name?: string;
};

function getWorkspaceDisplayName(websiteId: string, workspacesMap: Map<string, string>): string {
  if (workspacesMap.has(websiteId) && workspacesMap.get(websiteId)?.trim()) {
    return workspacesMap.get(websiteId)!;
  }
  const suffix = websiteId.length > 6 ? websiteId.slice(-5) : websiteId;
  return `Workspace • ${suffix}`;
}

function CrispChatPage() {
  const auth = useAuth();
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-background text-foreground overflow-hidden">
      <PageHeader
        title="Crisp Chat Inbox"
        description="Unified multi-workspace customer support portal."
      />
      <PageBody className="flex-1 p-0 overflow-hidden">
        <RoleGate
          allow={["admin", "cs_admin", "cs"]}
          current={auth.primaryRole}
        >
          <CrispInboxInner />
        </RoleGate>
      </PageBody>
    </div>
  );
}

function CrispInboxInner() {
  const auth = useAuth();
  const isAdmin = auth.primaryRole === "admin";

  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [selectedWebsiteId, setSelectedWebsiteId] = useState<string>("all");
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [notes, setNotes] = useState<NoteRecord[]>([]);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusTab, setStatusTab] = useState<"all" | "unresolved" | "resolved">("all");
  const [messageInput, setMessageInput] = useState("");
  const [noteInput, setNoteInput] = useState("");

  const [isSending, setIsSending] = useState(false);
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Admin Add Workspace State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addWebsiteId, setAddWebsiteId] = useState("");
  const [addTokenId, setAddTokenId] = useState("");
  const [addTokenKey, setAddTokenKey] = useState("");
  const [isAddingWorkspace, setIsAddingWorkspace] = useState(false);
  const [addSuccessResult, setAddSuccessResult] = useState<{ workspaceName: string; webhookUrl: string } | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch workspaces
  const loadWorkspaces = async () => {
    const { data } = await supabase
      .from("crisp_workspaces")
      .select("*")
      .order("created_at", { ascending: true });
    if (data) setWorkspaces(data as any);
  };

  // Fetch conversations
  const loadConversations = async () => {
    let query = supabase
      .from("crisp_conversations")
      .select("*")
      .order("last_message_at", { ascending: false });

    if (selectedWebsiteId !== "all") {
      query = query.eq("crisp_website_id", selectedWebsiteId);
    }

    const { data } = await query;
    if (data) setConversations(data as any);
  };

  // Fetch messages for active conversation
  const loadMessages = async (convId: string) => {
    const { data } = await supabase
      .from("crisp_messages")
      .select("*")
      .eq("conversation_id", convId)
      .order("sent_at", { ascending: true });

    if (data) setMessages(data as any);
  };

  // Fetch internal notes for active conversation
  const loadNotes = async (convId: string) => {
    const { data } = await supabase
      .from("crisp_conversation_notes")
      .select("*")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });

    if (data) {
      const userIds = Array.from(new Set(data.map((n) => n.created_by)));
      let namesMap: Record<string, string> = {};

      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", userIds);

        if (profiles) {
          profiles.forEach((p) => {
            namesMap[p.id] = p.full_name || p.email?.split("@")[0] || "Team Member";
          });
        }
      }

      setNotes(
        data.map((n) => ({
          ...n,
          author_name: namesMap[n.created_by] || "Team Member",
        }))
      );
    }
  };

  // Initial load
  useEffect(() => {
    loadWorkspaces();
    loadConversations();
  }, []);

  // Reload conversations on workspace filter change
  useEffect(() => {
    loadConversations();
  }, [selectedWebsiteId]);

  // Load messages & notes when conversation selection changes
  useEffect(() => {
    if (selectedConversationId) {
      loadMessages(selectedConversationId);
      loadNotes(selectedConversationId);
    } else {
      setMessages([]);
      setNotes([]);
    }
  }, [selectedConversationId]);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Realtime Subscriptions
  useEffect(() => {
    const channel = supabase
      .channel("crisp_inbox_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "crisp_conversations" },
        () => {
          loadConversations();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "crisp_messages" },
        (payload) => {
          loadConversations();
          if (
            selectedConversationId &&
            payload.new &&
            (payload.new as any).conversation_id === selectedConversationId
          ) {
            loadMessages(selectedConversationId);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "crisp_conversation_notes" },
        (payload) => {
          if (
            selectedConversationId &&
            payload.new &&
            (payload.new as any).conversation_id === selectedConversationId
          ) {
            loadNotes(selectedConversationId);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "crisp_workspaces" },
        () => {
          loadWorkspaces();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedConversationId]);

  // Map of workspace website_id -> workspace_name
  const workspacesMap = useMemo(() => {
    const map = new Map<string, string>();
    workspaces.forEach((w) => {
      if (w.workspace_name) {
        map.set(w.crisp_website_id, w.workspace_name);
      }
    });
    return map;
  }, [workspaces]);

  // Workspace counts
  const workspaceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    conversations.forEach((c) => {
      const current = counts.get(c.crisp_website_id) || 0;
      counts.set(c.crisp_website_id, current + 1);
    });
    return counts;
  }, [conversations]);

  // Filtered conversations
  const filteredConversations = useMemo(() => {
    return conversations.filter((c) => {
      if (statusTab === "unresolved" && c.status === "resolved") return false;
      if (statusTab === "resolved" && c.status !== "resolved") return false;

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const nameMatch = c.customer_name?.toLowerCase().includes(query);
        const emailMatch = c.customer_email?.toLowerCase().includes(query);
        const lastMsgMatch = c.last_message?.toLowerCase().includes(query);
        const sessionMatch = c.crisp_session_id.toLowerCase().includes(query);
        return nameMatch || emailMatch || lastMsgMatch || sessionMatch;
      }

      return true;
    });
  }, [conversations, statusTab, searchQuery]);

  const activeConversation = useMemo(() => {
    return conversations.find((c) => c.id === selectedConversationId) || null;
  }, [conversations, selectedConversationId]);

  // Handle Send Message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConversationId || !messageInput.trim() || isSending) return;

    setIsSending(true);
    const content = messageInput.trim();
    setMessageInput("");

    try {
      const res = await sendCrispMessage({ data: { conversationId: selectedConversationId, content } });
      if (!res.ok) {
        toast.error(res.error || "Could not send message");
        setMessageInput(content);
      } else {
        loadMessages(selectedConversationId);
      }
    } catch (err: any) {
      toast.error(err.message || "An unexpected error occurred");
      setMessageInput(content);
    } finally {
      setIsSending(false);
    }
  };

  // Handle Add Note
  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConversationId || !noteInput.trim() || isAddingNote) return;

    setIsAddingNote(true);
    const noteText = noteInput.trim();
    setNoteInput("");

    try {
      const res = await addCrispConversationNote({ data: { conversationId: selectedConversationId, note: noteText } });
      if (!res.ok) {
        toast.error(res.error || "Could not save internal note");
        setNoteInput(noteText);
      } else {
        loadNotes(selectedConversationId);
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsAddingNote(false);
    }
  };

  // Handle Delete Note
  const handleDeleteNote = async (noteId: string) => {
    try {
      const res = await deleteCrispConversationNote({ data: { noteId } });
      if (res.ok && selectedConversationId) {
        loadNotes(selectedConversationId);
      }
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // Handle History Sync
  const handleSyncHistory = async () => {
    if (isSyncing) return;
    setIsSyncing(true);

    try {
      const websiteIdParam = selectedWebsiteId !== "all" ? selectedWebsiteId : undefined;
      const res = await syncCrispHistory({ data: { websiteId: websiteIdParam } });

      if (!res.ok) {
        toast.error(res.error || "Failed to sync history");
      } else {
        toast.success(`Synced ${res.synced_conversations} conversations & ${res.synced_messages} messages.`);
        loadWorkspaces();
        loadConversations();
        if (selectedConversationId) loadMessages(selectedConversationId);
      }
    } catch (err: any) {
      toast.error(err.message || "History sync failed");
    } finally {
      setIsSyncing(false);
    }
  };

  // Handle Admin Add Workspace Submit
  const handleAddWorkspaceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addWebsiteId.trim() || !addTokenId.trim() || !addTokenKey.trim() || isAddingWorkspace) return;

    setIsAddingWorkspace(true);
    try {
      const res = await addCrispWorkspace({
        data: {
          websiteId: addWebsiteId.trim(),
          tokenId: addTokenId.trim(),
          tokenKey: addTokenKey.trim(),
        },
      });

      if (!res.ok) {
        toast.error(res.error || "Could not add workspace");
      } else {
        setAddSuccessResult({
          workspaceName: res.workspace_name || `Workspace • ${addWebsiteId.slice(0, 5)}`,
          webhookUrl: res.webhook_url || "",
        });
        setAddWebsiteId("");
        setAddTokenId("");
        setAddTokenKey("");
        loadWorkspaces();
        toast.success("Crisp Workspace connected successfully!");
      }
    } catch (err: any) {
      toast.error(err.message || "An unexpected error occurred");
    } finally {
      setIsAddingWorkspace(false);
    }
  };

  const handleCopyWebhookUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(true);
    toast.success("Webhook URL copied to clipboard!");
    setTimeout(() => setCopiedUrl(false), 2500);
  };

  // Extract unique workspaces from conversations if crisp_workspaces is empty
  const availableWorkspacesList = useMemo(() => {
    const knownSet = new Set(workspaces.map((w) => w.crisp_website_id));
    const list = [...workspaces];

    conversations.forEach((c) => {
      if (!knownSet.has(c.crisp_website_id)) {
        knownSet.add(c.crisp_website_id);
        list.push({
          id: c.crisp_website_id,
          crisp_website_id: c.crisp_website_id,
          workspace_name: null,
          enabled: true,
          credential_secret_id: null,
          installed_at: null,
          last_seen_at: null,
          last_synced_at: null,
        });
      }
    });

    return list;
  }, [workspaces, conversations]);

  return (
    <div className="flex h-full w-full overflow-hidden border-t border-border/40">
      {/* ========================================================================= */}
      {/* COLUMN 1: CRISP WORKSPACES (~200px) */}
      {/* ========================================================================= */}
      <div className="w-52 shrink-0 border-r border-border/40 bg-card/40 flex flex-col">
        <div className="p-3 border-b border-border/40 flex items-center justify-between font-medium text-xs text-muted-foreground uppercase tracking-wider">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-primary" />
            <span>Workspaces</span>
          </div>
          {isAdmin && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 rounded-md hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                setAddSuccessResult(null);
                setIsAddModalOpen(true);
              }}
              title="Add Crisp Workspace"
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>

        <ScrollArea className="flex-1 p-2">
          <div className="space-y-1">
            {/* All Workspaces */}
            <button
              onClick={() => setSelectedWebsiteId("all")}
              className={cn(
                "w-full flex items-center justify-between px-3 py-2 rounded-md text-sm font-medium transition-colors text-left",
                selectedWebsiteId === "all"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "hover:bg-accent hover:text-accent-foreground text-foreground"
              )}
            >
              <div className="flex items-center gap-2 truncate">
                <Globe className="w-4 h-4 shrink-0" />
                <span className="truncate">All Workspaces</span>
              </div>
              <Badge variant="secondary" className="ml-1 shrink-0 text-xs px-1.5 py-0">
                {conversations.length}
              </Badge>
            </button>

            <div className="my-2 border-t border-border/40" />

            {/* Individual Workspaces */}
            {availableWorkspacesList.map((ws) => {
              const count = workspaceCounts.get(ws.crisp_website_id) || 0;
              const displayName = getWorkspaceDisplayName(ws.crisp_website_id, workspacesMap);
              const isSelected = selectedWebsiteId === ws.crisp_website_id;

              return (
                <button
                  key={ws.crisp_website_id}
                  onClick={() => setSelectedWebsiteId(ws.crisp_website_id)}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors text-left group",
                    isSelected
                      ? "bg-primary text-primary-foreground font-medium shadow-sm"
                      : "hover:bg-accent hover:text-accent-foreground text-muted-foreground"
                  )}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className={cn("w-2 h-2 rounded-full shrink-0", ws.enabled ? "bg-emerald-500" : "bg-muted")} />
                    <span className="truncate">{displayName}</span>
                  </div>
                  <Badge variant="outline" className="ml-1 shrink-0 text-xs px-1.5 py-0 border-border/60">
                    {count}
                  </Badge>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* ========================================================================= */}
      {/* COLUMN 2: CONVERSATIONS LIST (~300px) */}
      {/* ========================================================================= */}
      <div className="w-80 shrink-0 border-r border-border/40 bg-card/20 flex flex-col">
        {/* Search & Sync Header */}
        <div className="p-3 border-b border-border/40 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input
                placeholder="Search chats..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-9 text-xs"
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={handleSyncHistory}
              disabled={isSyncing}
              title="Sync Crisp History"
              className="h-9 w-9 shrink-0"
            >
              <RefreshCw className={cn("w-4 h-4", isSyncing && "animate-spin")} />
            </Button>
          </div>

          <Tabs value={statusTab} onValueChange={(v: any) => setStatusTab(v)} className="w-full">
            <TabsList className="w-full grid grid-cols-3 h-8 text-xs">
              <TabsTrigger value="all" className="text-xs py-1">All</TabsTrigger>
              <TabsTrigger value="unresolved" className="text-xs py-1">Unresolved</TabsTrigger>
              <TabsTrigger value="resolved" className="text-xs py-1">Resolved</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Conversations List */}
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {filteredConversations.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-xs">
                No conversations found.
              </div>
            ) : (
              filteredConversations.map((conv) => {
                const isSelected = selectedConversationId === conv.id;
                const wsLabel = getWorkspaceDisplayName(conv.crisp_website_id, workspacesMap);

                return (
                  <button
                    key={conv.id}
                    onClick={() => setSelectedConversationId(conv.id)}
                    className={cn(
                      "w-full text-left p-3 rounded-lg border transition-all space-y-1.5",
                      isSelected
                        ? "bg-accent/80 border-primary/50 shadow-sm"
                        : "border-transparent hover:bg-accent/40"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm truncate text-foreground">
                        {conv.customer_name || "Visitor"}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {conv.last_message_at
                          ? new Date(conv.last_message_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                          : ""}
                      </span>
                    </div>

                    <p className="text-xs text-muted-foreground line-clamp-2 break-words">
                      {conv.last_message || "No messages yet"}
                    </p>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 truncate border-border/60">
                        {wsLabel}
                      </Badge>
                      <span
                        className={cn(
                          "text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded",
                          conv.status === "resolved"
                            ? "bg-emerald-500/10 text-emerald-500"
                            : "bg-amber-500/10 text-amber-500"
                        )}
                      >
                        {conv.status || "unresolved"}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>

      {/* ========================================================================= */}
      {/* COLUMN 3: ACTIVE CHAT THREAD (~flex-1) */}
      {/* ========================================================================= */}
      <div className="flex-1 flex flex-col bg-background min-w-0">
        {activeConversation ? (
          <>
            {/* Header */}
            <div className="p-3 border-b border-border/40 flex items-center justify-between bg-card/20">
              <div className="flex items-center gap-3 truncate">
                <Avatar className="w-8 h-8">
                  <AvatarImage src={activeConversation.customer_avatar || undefined} />
                  <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                    {(activeConversation.customer_name || "V")[0].toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="truncate">
                  <h3 className="font-semibold text-sm truncate">
                    {activeConversation.customer_name || "Visitor"}
                  </h3>
                  <p className="text-xs text-muted-foreground truncate">
                    {activeConversation.customer_email || activeConversation.crisp_session_id}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="secondary" className="text-xs">
                  {getWorkspaceDisplayName(activeConversation.crisp_website_id, workspacesMap)}
                </Badge>
              </div>
            </div>

            {/* Messages Scroll Area */}
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-3 max-w-3xl mx-auto">
                {messages.map((msg) => {
                  const isOperator = msg.sender_type === "operator" || msg.direction === "outgoing";

                  return (
                    <div
                      key={msg.id}
                      className={cn(
                        "flex flex-col max-w-[75%]",
                        isOperator ? "ml-auto items-end" : "mr-auto items-start"
                      )}
                    >
                      <div
                        className={cn(
                          "px-3.5 py-2.5 rounded-2xl text-xs break-words shadow-sm space-y-1",
                          isOperator
                            ? "bg-primary text-primary-foreground rounded-br-xs"
                            : "bg-muted text-foreground rounded-bl-xs"
                        )}
                      >
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      </div>
                      <span className="text-[10px] text-muted-foreground px-1 mt-0.5">
                        {new Date(msg.sent_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Message Composer */}
            <form onSubmit={handleSendMessage} className="p-3 border-t border-border/40 flex items-center gap-2 bg-card/20">
              <Textarea
                placeholder="Type a message to send to Crisp visitor..."
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage(e);
                  }
                }}
                className="min-h-[44px] max-h-32 text-xs resize-none flex-1 py-2.5"
              />
              <Button
                type="submit"
                disabled={isSending || !messageInput.trim()}
                className="self-end h-11 px-4 gap-1.5"
              >
                {isSending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <span>Send</span>
                    <Send className="w-3.5 h-3.5" />
                  </>
                )}
              </Button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-muted-foreground text-center">
            <MessageSquare className="w-10 h-10 mb-2 stroke-1 opacity-50" />
            <p className="text-sm font-medium">No conversation selected</p>
            <p className="text-xs text-muted-foreground">Select a chat from Column 2 to inspect and reply.</p>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* COLUMN 4: CHAT DETAILS & INTERNAL NOTES (~280px) */}
      {/* ========================================================================= */}
      <div className="w-72 shrink-0 border-l border-border/40 bg-card/30 flex flex-col">
        {activeConversation ? (
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-6">
              {/* Customer & Chat Details */}
              <div className="space-y-3">
                <div className="flex items-center gap-3 pb-3 border-b border-border/40">
                  <Avatar className="w-10 h-10">
                    <AvatarImage src={activeConversation.customer_avatar || undefined} />
                    <AvatarFallback className="bg-primary/20 text-primary font-semibold">
                      {(activeConversation.customer_name || "V")[0].toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="truncate">
                    <h4 className="font-semibold text-sm truncate">
                      {activeConversation.customer_name || "Visitor"}
                    </h4>
                    <p className="text-xs text-muted-foreground capitalize">
                      {activeConversation.status || "unresolved"}
                    </p>
                  </div>
                </div>

                <div className="space-y-2 text-xs">
                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase font-semibold">Workspace</span>
                    <span className="font-medium text-foreground">
                      {getWorkspaceDisplayName(activeConversation.crisp_website_id, workspacesMap)}
                    </span>
                  </div>

                  {activeConversation.customer_email && (
                    <div>
                      <span className="text-muted-foreground block text-[10px] uppercase font-semibold">Email</span>
                      <span className="font-medium text-foreground break-all">{activeConversation.customer_email}</span>
                    </div>
                  )}

                  {activeConversation.customer_phone && (
                    <div>
                      <span className="text-muted-foreground block text-[10px] uppercase font-semibold">Phone</span>
                      <span className="font-medium text-foreground">{activeConversation.customer_phone}</span>
                    </div>
                  )}

                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase font-semibold">Crisp Session ID</span>
                    <span className="font-mono text-[11px] text-muted-foreground break-all">{activeConversation.crisp_session_id}</span>
                  </div>

                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase font-semibold">Crisp Website ID</span>
                    <span className="font-mono text-[11px] text-muted-foreground break-all">{activeConversation.crisp_website_id}</span>
                  </div>
                </div>
              </div>

              {/* Internal Notes Section */}
              <div className="border-t border-border/40 pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">Internal Notes</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/40 text-amber-400">
                    JellyBean Only
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Internal team notes. Never visible to customers or sent to Crisp.
                </p>

                {/* Add Note Input */}
                <form onSubmit={handleAddNote} className="space-y-2">
                  <Textarea
                    placeholder="Add an internal note..."
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    className="min-h-[60px] text-xs resize-none bg-background/60"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={isAddingNote || !noteInput.trim()}
                    className="w-full h-8 text-xs gap-1"
                  >
                    {isAddingNote ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    <span>Add Note</span>
                  </Button>
                </form>

                {/* Notes List */}
                <div className="space-y-2 pt-2">
                  {notes.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic text-center py-2">
                      No internal notes added yet.
                    </p>
                  ) : (
                    notes.map((note) => (
                      <div key={note.id} className="p-2.5 rounded bg-muted/40 border border-border/40 space-y-1 relative group">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[11px] text-primary">
                            {note.author_name || "Team Member"}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(note.created_at).toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        <p className="text-xs whitespace-pre-wrap break-words">{note.note}</p>
                        <button
                          onClick={() => handleDeleteNote(note.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity absolute top-2 right-2 text-muted-foreground hover:text-destructive"
                          title="Delete note"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </ScrollArea>
        ) : (
          <div className="p-8 text-center text-muted-foreground text-xs">
            Select a conversation to view customer details & internal notes.
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* ADMIN ADD WORKSPACE MODAL */}
      {/* ========================================================================= */}
      {isAdmin && (
        <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base font-semibold">
                <Building2 className="w-5 h-5 text-primary" />
                <span>Connect Crisp Workspace</span>
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Generate a Website Token in Crisp under <strong>Settings → Workspace Settings → Advanced configuration → REST API / API Token</strong>.
              </DialogDescription>
            </DialogHeader>

            {!addSuccessResult ? (
              <form onSubmit={handleAddWorkspaceSubmit} className="space-y-4 pt-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ws-website-id" className="text-xs font-semibold">
                    Crisp Website ID
                  </Label>
                  <Input
                    id="ws-website-id"
                    placeholder="e.g. 57a2f8b1-39c4-4d8e-90ab-1234567890ab"
                    value={addWebsiteId}
                    onChange={(e) => setAddWebsiteId(e.target.value)}
                    className="text-xs font-mono"
                    required
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Found in Crisp under Website Settings → Setup instructions.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="ws-token-id" className="text-xs font-semibold">
                    Website Token Identifier (API Identifier)
                  </Label>
                  <Input
                    id="ws-token-id"
                    placeholder="e.g. 59881881-80a1-4328-86d1-..."
                    value={addTokenId}
                    onChange={(e) => setAddTokenId(e.target.value)}
                    className="text-xs font-mono"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="ws-token-key" className="text-xs font-semibold">
                    Website Token Key (API Key)
                  </Label>
                  <Input
                    id="ws-token-key"
                    type="text"
                    autoComplete="off"
                    placeholder="e.g. 81a9f012b..."
                    value={addTokenKey}
                    onChange={(e) => setAddTokenKey(e.target.value)}
                    className="text-xs font-mono"
                    required
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Credentials are validated with Crisp API and stored encrypted in Supabase Vault.
                  </p>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsAddModalOpen(false)}
                    disabled={isAddingWorkspace}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={isAddingWorkspace}>
                    {isAddingWorkspace ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                        <span>Validating...</span>
                      </>
                    ) : (
                      <span>Connect Workspace</span>
                    )}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="space-y-4 pt-2">
                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 space-y-1">
                  <div className="flex items-center gap-2 text-emerald-500 font-semibold text-xs">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Workspace Connected: {addSuccessResult.workspaceName}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Website Token verified successfully and encrypted in Vault.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Website Hook Setup URL</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      value={addSuccessResult.webhookUrl}
                      className="text-xs font-mono bg-muted/50 select-all"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="shrink-0 h-9 w-9"
                      onClick={() => handleCopyWebhookUrl(addSuccessResult.webhookUrl)}
                    >
                      {copiedUrl ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Add this URL as a Website Hook in this Crisp workspace under <strong>Settings → Advanced configuration → Webhooks</strong>.
                  </p>
                </div>

                <div className="flex justify-end pt-2 border-t border-border/40">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      setIsAddModalOpen(false);
                      setAddSuccessResult(null);
                    }}
                  >
                    Done
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
