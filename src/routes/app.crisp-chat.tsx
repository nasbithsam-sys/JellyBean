import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Building2,
  Check,
  CheckCircle2,
  Copy,
  Globe,
  Loader2,
  MessageSquare,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Trash2,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  addCrispConversationNote,
  addCrispWorkspace,
  deleteCrispConversationNote,
  deleteCrispWorkspace,
  getCrispWorkspaceWebhookUrl,
  regenerateCrispWebhookSecret,
  sendCrispMessage,
  syncCrispHistory,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { PageHeader, RoleGate } from "@/components/page";

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
    <div className="h-full w-full min-h-0 flex flex-col overflow-hidden bg-background text-foreground">
      <PageHeader
        title="Crisp Chat Inbox"
        description="Unified multi-workspace customer support portal."
        className="shrink-0 my-2 py-3 px-4 md:px-5"
      />
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col px-3 md:px-5 pb-3">
        <RoleGate
          allow={["admin", "cs_admin", "cs"]}
          current={auth.primaryRole}
        >
          <CrispInboxInner />
        </RoleGate>
      </div>
    </div>
  );
}

function CrispInboxInner() {
  const auth = useAuth();
  const isAdmin = auth.primaryRole === "admin";

  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [workspaceTotalChatsMap, setWorkspaceTotalChatsMap] = useState<Map<string, number>>(new Map());
  const [workspaceHasUnreadMap, setWorkspaceHasUnreadMap] = useState<Map<string, boolean>>(new Map());
  const [workspaceLatestUnreadAtMap, setWorkspaceLatestUnreadAtMap] = useState<Map<string, string>>(new Map());
  const [totalChatsCount, setTotalChatsCount] = useState<number>(0);
  const [hasAnyUnread, setHasAnyUnread] = useState<boolean>(false);

  const [selectedWebsiteId, setSelectedWebsiteId] = useState<string>("all");
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [notes, setNotes] = useState<NoteRecord[]>([]);

  const [searchQuery, setSearchQuery] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [noteInput, setNoteInput] = useState("");

  const [isSending, setIsSending] = useState(false);
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showRightPanel, setShowRightPanel] = useState(true);

  // Admin Workspace Management Modals State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addWebsiteId, setAddWebsiteId] = useState("");
  const [addTokenId, setAddTokenId] = useState("");
  const [addTokenKey, setAddTokenKey] = useState("");
  const [isAddingWorkspace, setIsAddingWorkspace] = useState(false);
  const [addSuccessResult, setAddSuccessResult] = useState<{ workspaceName: string; webhookUrl: string } | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // View Webhook Modal
  const [viewWebhookWs, setViewWebhookWs] = useState<WorkspaceRecord | null>(null);
  const [viewWebhookUrl, setViewWebhookUrl] = useState<string | null>(null);
  const [isFetchingWebhook, setIsFetchingWebhook] = useState(false);

  // Regenerate Webhook Dialog
  const [regenWebhookWs, setRegenWebhookWs] = useState<WorkspaceRecord | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenResultUrl, setRegenResultUrl] = useState<string | null>(null);

  // Delete Workspace Dialog
  const [deleteWs, setDeleteWs] = useState<WorkspaceRecord | null>(null);
  const [isDeletingWs, setIsDeletingWs] = useState(false);

  // Refs for message container and stable realtime access
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const selectedConversationIdRef = useRef(selectedConversationId);
  const selectedWebsiteIdRef = useRef(selectedWebsiteId);

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  useEffect(() => {
    selectedWebsiteIdRef.current = selectedWebsiteId;
  }, [selectedWebsiteId]);

  // Load registered workspaces
  const loadWorkspaces = async () => {
    const { data } = await supabase
      .from("crisp_workspaces")
      .select("*")
      .order("created_at", { ascending: true });
    if (data) setWorkspaces(data as any);
  };

  // Load aggregate workspace stats: TOTAL chats count per workspace & UNREAD state
  const loadWorkspaceCounts = async () => {
    const { data } = await supabase
      .from("crisp_conversations")
      .select("crisp_website_id, unread_count, last_message_at");

    if (data) {
      const totalMap = new Map<string, number>();
      const hasUnreadMap = new Map<string, boolean>();
      const latestUnreadMap = new Map<string, string>();
      let anyUnread = false;

      data.forEach((item) => {
        const wsId = item.crisp_website_id;
        totalMap.set(wsId, (totalMap.get(wsId) || 0) + 1);

        const isUnread = (item.unread_count || 0) > 0;
        if (isUnread) {
          hasUnreadMap.set(wsId, true);
          anyUnread = true;

          const currentLatest = latestUnreadMap.get(wsId) || "";
          const msgTime = item.last_message_at || "";
          if (msgTime.localeCompare(currentLatest) > 0) {
            latestUnreadMap.set(wsId, msgTime);
          }
        }
      });

      setWorkspaceTotalChatsMap(totalMap);
      setWorkspaceHasUnreadMap(hasUnreadMap);
      setWorkspaceLatestUnreadAtMap(latestUnreadMap);
      setTotalChatsCount(data.length);
      setHasAnyUnread(anyUnread);
    }
  };

  // Fetch conversations filtered by workspace
  const loadConversations = async (targetWebsiteId?: string) => {
    const wsId = targetWebsiteId !== undefined ? targetWebsiteId : selectedWebsiteIdRef.current;
    let query = supabase
      .from("crisp_conversations")
      .select("*")
      .order("last_message_at", { ascending: false });

    if (wsId !== "all") {
      query = query.eq("crisp_website_id", wsId);
    }

    const { data } = await query;
    if (data) setConversations(data as any);
  };

  // Fetch messages for active conversation
  const loadMessages = async (convId: string, shouldScrollBottom = false) => {
    const { data } = await supabase
      .from("crisp_messages")
      .select("*")
      .eq("conversation_id", convId)
      .order("sent_at", { ascending: true });

    if (data) {
      setMessages(data as any);
      if (shouldScrollBottom) {
        setTimeout(() => scrollToBottom("auto"), 50);
      }
    }
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

  // Scroll message thread container to bottom without moving outer page
  const scrollToBottom = (behavior: ScrollBehavior = "auto") => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior,
      });
    }
  };

  // Check if message viewport is near bottom
  const isNearBottom = () => {
    const container = messagesContainerRef.current;
    if (!container) return true;
    const threshold = 120;
    return container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
  };

  // Initial load
  useEffect(() => {
    loadWorkspaces();
    loadWorkspaceCounts();
    loadConversations();
  }, []);

  // Reload conversations when selected workspace filter changes
  useEffect(() => {
    loadConversations(selectedWebsiteId);

    // Clear active conversation if it does not belong to newly selected workspace
    if (selectedWebsiteId !== "all" && selectedConversationId) {
      const activeConv = conversations.find((c) => c.id === selectedConversationId);
      if (activeConv && activeConv.crisp_website_id !== selectedWebsiteId) {
        setSelectedConversationId(null);
        setMessages([]);
        setNotes([]);
      }
    }
  }, [selectedWebsiteId]);

  // Load messages & notes when active conversation selection changes
  useEffect(() => {
    if (selectedConversationId) {
      loadMessages(selectedConversationId, true);
      loadNotes(selectedConversationId);
    } else {
      setMessages([]);
      setNotes([]);
    }
  }, [selectedConversationId]);

  // Handle selecting a conversation (Marks unread conversation as READ)
  const handleSelectConversation = (convId: string) => {
    setSelectedConversationId(convId);

    const targetConv = conversations.find((c) => c.id === convId);
    if (targetConv && targetConv.unread_count && targetConv.unread_count > 0) {
      // 1. Immediately update local conversations state so unread dot disappears
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, unread_count: 0 } : c))
      );

      // 2. Persist unread_count = 0 to Supabase DB asynchronously
      supabase
        .from("crisp_conversations")
        .update({ unread_count: 0, updated_at: new Date().toISOString() })
        .eq("id", convId)
        .then(({ error }) => {
          if (!error) {
            loadWorkspaceCounts();
          }
        });
    }
  };

  // Stable Realtime Subscriptions (Channel created ONCE on mount)
  useEffect(() => {
    const channel = supabase
      .channel("crisp_inbox_realtime_stable")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "crisp_conversations" },
        () => {
          loadConversations();
          loadWorkspaceCounts();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "crisp_messages" },
        (payload) => {
          loadConversations();
          loadWorkspaceCounts();
          const activeId = selectedConversationIdRef.current;
          if (
            activeId &&
            payload.new &&
            (payload.new as any).conversation_id === activeId
          ) {
            const nearBottom = isNearBottom();
            loadMessages(activeId).then(() => {
              if (nearBottom) scrollToBottom("smooth");
            });
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "crisp_conversation_notes" },
        (payload) => {
          const activeId = selectedConversationIdRef.current;
          if (
            activeId &&
            payload.new &&
            (payload.new as any).conversation_id === activeId
          ) {
            loadNotes(activeId);
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
  }, []);

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

  // Sorted Workspaces based ON UNREAD STATUS/ACTIVITY (NOT total chat count)
  // 1. All Workspaces stays pinned first
  // 2. Workspaces with at least one unread chat come next (sorted by newest unread activity DESC)
  // 3. Workspaces with zero unread chats come after (sorted alphabetically by name ASC)
  const sortedWorkspaces = useMemo(() => {
    return [...workspaces].sort((a, b) => {
      const hasUnreadA = workspaceHasUnreadMap.get(a.crisp_website_id) || false;
      const hasUnreadB = workspaceHasUnreadMap.get(b.crisp_website_id) || false;

      // Primary: Unread workspaces come before read-only workspaces
      if (hasUnreadA !== hasUnreadB) {
        return hasUnreadA ? -1 : 1;
      }

      // Secondary: If both have unread chats, sort by newest unread customer activity DESC
      if (hasUnreadA && hasUnreadB) {
        const timeA = workspaceLatestUnreadAtMap.get(a.crisp_website_id) || "";
        const timeB = workspaceLatestUnreadAtMap.get(b.crisp_website_id) || "";
        if (timeA !== timeB) {
          return timeB.localeCompare(timeA);
        }
      }

      // Tertiary: Stable alphabetical ordering by workspace name ASC
      const nameA = getWorkspaceDisplayName(a.crisp_website_id, workspacesMap).toLowerCase();
      const nameB = getWorkspaceDisplayName(b.crisp_website_id, workspacesMap).toLowerCase();
      return nameA.localeCompare(nameB);
    });
  }, [workspaces, workspaceHasUnreadMap, workspaceLatestUnreadAtMap, workspacesMap]);

  // Filtered & Sorted Conversations (Unread conversations first, then newest last_message_at)
  const filteredConversations = useMemo(() => {
    let list = conversations.filter((c) => {
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

    // Primary: Unread state (unread_count > 0) DESC; Secondary: last_message_at DESC
    return list.sort((a, b) => {
      const unreadA = (a.unread_count || 0) > 0 ? 1 : 0;
      const unreadB = (b.unread_count || 0) > 0 ? 1 : 0;
      if (unreadA !== unreadB) {
        return unreadB - unreadA;
      }
      const timeA = a.last_message_at || "";
      const timeB = b.last_message_at || "";
      return timeB.localeCompare(timeA);
    });
  }, [conversations, searchQuery]);

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
        await loadMessages(selectedConversationId);
        scrollToBottom("smooth");
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
        loadWorkspaceCounts();
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

  // Handle View Webhook URL (Admin Only, reads existing URL without regenerating)
  const handleOpenViewWebhook = async (ws: WorkspaceRecord) => {
    setViewWebhookWs(ws);
    setViewWebhookUrl(null);
    setIsFetchingWebhook(true);

    try {
      const res = await getCrispWorkspaceWebhookUrl({ data: { websiteId: ws.crisp_website_id } });
      if (!res.ok || !res.webhook_url) {
        toast.error(res.error || "Could not fetch Webhook URL");
      } else {
        setViewWebhookUrl(res.webhook_url);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to retrieve Webhook URL");
    } finally {
      setIsFetchingWebhook(false);
    }
  };

  // Handle Regenerate Webhook URL
  const handleConfirmRegenerateWebhook = async () => {
    if (!regenWebhookWs || isRegenerating) return;
    setIsRegenerating(true);

    try {
      const res = await regenerateCrispWebhookSecret({ data: { websiteId: regenWebhookWs.crisp_website_id } });
      if (!res.ok || !res.webhook_url) {
        toast.error(res.error || "Could not regenerate Webhook Secret");
      } else {
        setRegenResultUrl(res.webhook_url);
        toast.success("Webhook URL regenerated successfully!");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to regenerate Webhook Secret");
    } finally {
      setIsRegenerating(false);
    }
  };

  // Handle Delete Workspace
  const handleConfirmDeleteWorkspace = async () => {
    if (!deleteWs || isDeletingWs) return;
    setIsDeletingWs(true);

    try {
      const res = await deleteCrispWorkspace({ data: { websiteId: deleteWs.crisp_website_id } });
      if (!res.ok) {
        toast.error(res.error || "Could not delete workspace");
      } else {
        toast.success(`Disconnected workspace "${deleteWs.workspace_name || deleteWs.crisp_website_id}"`);

        if (selectedWebsiteId === deleteWs.crisp_website_id) {
          setSelectedWebsiteId("all");
        }

        setDeleteWs(null);
        loadWorkspaces();
        loadWorkspaceCounts();
        loadConversations("all");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to delete workspace");
    } finally {
      setIsDeletingWs(false);
    }
  };

  const handleCopyText = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedUrl(true);
    toast.success("Copied to clipboard!");
    setTimeout(() => setCopiedUrl(false), 2500);
  };

  return (
    <div className="h-full min-h-0 flex-1 w-full flex overflow-hidden border border-border/40 rounded-2xl bg-card/20 shadow-sm">
      {/* ========================================================================= */}
      {/* COLUMN 1: CRISP WORKSPACES (~220px) */}
      {/* ========================================================================= */}
      <div className="w-56 shrink-0 border-r border-border/40 bg-card/40 flex flex-col h-full overflow-hidden">
        <div className="p-3 border-b border-border/40 flex items-center justify-between font-medium text-xs text-muted-foreground uppercase tracking-wider shrink-0">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-primary shrink-0" />
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

        <div className="flex-1 min-h-0 overflow-y-auto p-2 overscroll-contain">
          <div className="space-y-1">
            {/* All Workspaces (Pinned First) */}
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
                {hasAnyUnread && (
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 animate-pulse ml-0.5" title="Has unread conversations" />
                )}
              </div>
              <Badge
                variant={selectedWebsiteId === "all" ? "secondary" : "outline"}
                className="ml-1 shrink-0 text-xs px-1.5 py-0 font-semibold border-border/60"
              >
                {totalChatsCount}
              </Badge>
            </button>

            <div className="my-2 border-t border-border/40" />

            {/* Individual Workspaces List (Sorted by Unread Activity DESC, Number = TOTAL chats) */}
            {sortedWorkspaces.map((ws) => {
              const totalChats = workspaceTotalChatsMap.get(ws.crisp_website_id) || 0;
              const hasUnread = workspaceHasUnreadMap.get(ws.crisp_website_id) || false;
              const displayName = getWorkspaceDisplayName(ws.crisp_website_id, workspacesMap);
              const isSelected = selectedWebsiteId === ws.crisp_website_id;

              return (
                <div
                  key={ws.crisp_website_id}
                  className={cn(
                    "w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-sm transition-colors group",
                    isSelected
                      ? "bg-primary text-primary-foreground font-medium shadow-sm"
                      : "hover:bg-accent hover:text-accent-foreground text-muted-foreground"
                  )}
                >
                  <button
                    onClick={() => setSelectedWebsiteId(ws.crisp_website_id)}
                    className="flex-1 flex items-center gap-2 min-w-0 text-left py-0.5"
                  >
                    <span className={cn("w-2 h-2 rounded-full shrink-0", ws.enabled ? "bg-emerald-500/60" : "bg-muted")} />
                    <span className="truncate">{displayName}</span>
                    {hasUnread && (
                      <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 animate-pulse ml-0.5" title="Has unread conversations" />
                    )}
                  </button>

                  <div className="flex items-center gap-1 shrink-0 ml-1">
                    <Badge
                      variant={isSelected ? "secondary" : "outline"}
                      className="text-xs px-1.5 py-0 font-semibold border-border/60"
                    >
                      {totalChats}
                    </Badge>

                    {isAdmin && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className={cn(
                              "h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity rounded-md",
                              isSelected ? "hover:bg-primary-foreground/20 text-primary-foreground" : "hover:bg-accent text-muted-foreground"
                            )}
                          >
                            <MoreVertical className="w-3.5 h-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48 text-xs">
                          <DropdownMenuItem onClick={() => handleOpenViewWebhook(ws)} className="cursor-pointer">
                            <Copy className="w-3.5 h-3.5 mr-2 text-primary" />
                            <span>View Webhook URL</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleCopyWebhookUrlFromWs(ws)} className="cursor-pointer">
                            <Check className="w-3.5 h-3.5 mr-2 text-emerald-500" />
                            <span>Copy Webhook URL</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => { setRegenWebhookWs(ws); setRegenResultUrl(null); }} className="cursor-pointer">
                            <RefreshCw className="w-3.5 h-3.5 mr-2 text-amber-500" />
                            <span>Regenerate Webhook URL</span>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setDeleteWs(ws)} className="cursor-pointer text-destructive focus:text-destructive">
                            <Trash2 className="w-3.5 h-3.5 mr-2" />
                            <span>Delete Workspace</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* COLUMN 2: CONVERSATIONS LIST (~320px) */}
      {/* ========================================================================= */}
      <div className="w-80 shrink-0 border-r border-border/40 bg-card/20 flex flex-col h-full overflow-hidden">
        {/* Search & Sync Header */}
        <div className="p-3 border-b border-border/40 shrink-0">
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
        </div>

        {/* Conversations Scroll Area */}
        <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1 overscroll-contain">
          {filteredConversations.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-xs">
              No conversations found.
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const isSelected = selectedConversationId === conv.id;
              const isUnread = (conv.unread_count || 0) > 0;
              const wsLabel = getWorkspaceDisplayName(conv.crisp_website_id, workspacesMap);

              return (
                <button
                  key={conv.id}
                  onClick={() => handleSelectConversation(conv.id)}
                  className={cn(
                    "w-full text-left p-3 rounded-lg border transition-all space-y-1.5",
                    isSelected
                      ? "bg-accent/80 border-primary/50 shadow-sm"
                      : isUnread
                      ? "bg-primary/5 border-primary/20 hover:bg-accent/40"
                      : "border-transparent hover:bg-accent/40"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {isUnread && (
                        <span className="w-2.5 h-2.5 rounded-full bg-primary shrink-0 animate-pulse" />
                      )}
                      <span className={cn("text-sm truncate text-foreground", isUnread ? "font-bold" : "font-semibold")}>
                        {conv.customer_name || "Visitor"}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0 font-medium">
                      {conv.last_message_at
                        ? new Date(conv.last_message_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                        : ""}
                    </span>
                  </div>

                  <p className={cn("text-xs line-clamp-2 break-words leading-relaxed", isUnread ? "text-foreground font-medium" : "text-muted-foreground")}>
                    {conv.last_message || "No messages yet"}
                  </p>

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 truncate border-border/60 font-normal">
                      {wsLabel}
                    </Badge>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* COLUMN 3: ACTIVE CHAT THREAD (Flex-1) */}
      {/* ========================================================================= */}
      <div className="flex-1 flex flex-col bg-background min-w-0 h-full overflow-hidden">
        {activeConversation ? (
          <>
            {/* Chat Header */}
            <div className="p-3 border-b border-border/40 flex items-center justify-between bg-card/20 shrink-0">
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
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground hidden lg:flex"
                  onClick={() => setShowRightPanel((prev) => !prev)}
                  title={showRightPanel ? "Hide Details Panel" : "Show Details Panel"}
                >
                  {showRightPanel ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            {/* Messages Scroll Area */}
            <div ref={messagesContainerRef} className="flex-1 min-h-0 overflow-y-auto p-4 overscroll-contain">
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
                        <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                      </div>
                      <span className="text-[10px] text-muted-foreground px-1 mt-0.5 font-medium">
                        {new Date(msg.sent_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Message Composer - Anchored to Bottom */}
            <form onSubmit={handleSendMessage} className="p-3 border-t border-border/40 flex items-center gap-2 bg-card/20 shrink-0 mt-auto">
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
      {showRightPanel && (
        <div className="w-72 shrink-0 border-l border-border/40 bg-card/30 flex flex-col h-full overflow-hidden hidden lg:flex">
          {activeConversation ? (
            <div className="flex-1 min-h-0 overflow-y-auto p-4 overscroll-contain">
              <div className="space-y-6">
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
                      <p className="text-xs text-muted-foreground font-mono truncate">
                        {activeConversation.crisp_session_id.slice(0, 14)}...
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
            </div>
          ) : (
            <div className="p-8 text-center text-muted-foreground text-xs">
              Select a conversation to view customer details & internal notes.
            </div>
          )}
        </div>
      )}

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
                      onClick={() => handleCopyText(addSuccessResult.webhookUrl)}
                    >
                      {copiedUrl ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Add this URL as a Website Hook in Crisp under <strong>Settings → Advanced configuration → Webhooks</strong>.
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

      {/* ========================================================================= */}
      {/* ADMIN VIEW WEBHOOK URL MODAL */}
      {/* ========================================================================= */}
      {isAdmin && viewWebhookWs && (
        <Dialog open={Boolean(viewWebhookWs)} onOpenChange={(open) => !open && setViewWebhookWs(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base font-semibold">
                <Globe className="w-5 h-5 text-primary" />
                <span>Webhook URL</span>
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Current Webhook URL for <strong>{getWorkspaceDisplayName(viewWebhookWs.crisp_website_id, workspacesMap)}</strong>.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 pt-2">
              {isFetchingWebhook ? (
                <div className="flex items-center justify-center p-6">
                  <Loader2 className="w-5 h-5 animate-spin text-primary mr-2" />
                  <span className="text-xs text-muted-foreground">Retrieving Webhook Secret from Vault...</span>
                </div>
              ) : viewWebhookUrl ? (
                <div className="space-y-2">
                  <Label className="text-xs font-semibold">Website Hook Setup URL</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      value={viewWebhookUrl}
                      className="text-xs font-mono bg-muted/50 select-all"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="shrink-0 h-9 w-9"
                      onClick={() => handleCopyText(viewWebhookUrl)}
                    >
                      {copiedUrl ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    This is the existing Webhook URL for this workspace. Paste it into Crisp under <strong>Settings → Advanced configuration → Webhooks</strong>.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-destructive">Could not retrieve Webhook URL.</p>
              )}

              <div className="flex justify-end pt-2 border-t border-border/40">
                <Button type="button" size="sm" onClick={() => setViewWebhookWs(null)}>
                  Close
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ========================================================================= */}
      {/* ADMIN REGENERATE WEBHOOK DIALOG */}
      {/* ========================================================================= */}
      {isAdmin && regenWebhookWs && (
        <Dialog open={Boolean(regenWebhookWs)} onOpenChange={(open) => !open && setRegenWebhookWs(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base font-semibold text-amber-500">
                <ShieldAlert className="w-5 h-5" />
                <span>Regenerate Webhook URL?</span>
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
                Regenerating the webhook URL will invalidate the previous URL. You will need to replace the URL inside Crisp immediately.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 pt-2">
              {!regenResultUrl ? (
                <div className="flex justify-end gap-2 border-t border-border/40 pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setRegenWebhookWs(null)}
                    disabled={isRegenerating}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    className="bg-amber-500 hover:bg-amber-600 text-white"
                    onClick={handleConfirmRegenerateWebhook}
                    disabled={isRegenerating}
                  >
                    {isRegenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
                    <span>Regenerate Webhook URL</span>
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="p-3 rounded bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600 dark:text-amber-400 font-medium">
                    New Webhook URL Generated. Replace it inside Crisp immediately.
                  </div>
                  <div className="flex items-center gap-2">
                    <Input readOnly value={regenResultUrl} className="text-xs font-mono bg-muted/50 select-all" />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="shrink-0 h-9 w-9"
                      onClick={() => handleCopyText(regenResultUrl)}
                    >
                      {copiedUrl ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                  <div className="flex justify-end pt-2 border-t border-border/40">
                    <Button type="button" size="sm" onClick={() => setRegenWebhookWs(null)}>
                      Done
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ========================================================================= */}
      {/* ADMIN DELETE WORKSPACE DIALOG */}
      {/* ========================================================================= */}
      {isAdmin && deleteWs && (
        <Dialog open={Boolean(deleteWs)} onOpenChange={(open) => !open && setDeleteWs(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base font-semibold text-destructive">
                <Trash2 className="w-5 h-5" />
                <span>Delete Crisp Workspace?</span>
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
                This will disconnect <strong>"{getWorkspaceDisplayName(deleteWs.crisp_website_id, workspacesMap)}"</strong> from JellyBean.
                The Crisp credentials and webhook configuration stored for this workspace will no longer be used.
              </DialogDescription>
            </DialogHeader>

            <div className="flex justify-end gap-2 border-t border-border/40 pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDeleteWs(null)}
                disabled={isDeletingWs}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleConfirmDeleteWorkspace}
                disabled={isDeletingWs}
              >
                {isDeletingWs ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
                <span>Delete Workspace</span>
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );

  // Helper to copy existing Webhook URL directly from action menu
  async function handleCopyWebhookUrlFromWs(ws: WorkspaceRecord) {
    try {
      const res = await getCrispWorkspaceWebhookUrl({ data: { websiteId: ws.crisp_website_id } });
      if (!res.ok || !res.webhook_url) {
        toast.error(res.error || "Could not fetch Webhook URL");
      } else {
        handleCopyText(res.webhook_url);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to fetch Webhook URL");
    }
  }
}
