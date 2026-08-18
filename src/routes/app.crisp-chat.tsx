import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Building2,
  CheckCircle2,
  Clock,
  Globe,
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
  deleteCrispConversationNote,
  sendCrispMessage,
  syncCrispHistory,
} from "@/lib/crisp.functions";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  if (workspacesMap.has(websiteId)) {
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
        toast.success(`Synced ${res.synced_conversations} conversations & ${res.synced_messages} messages across ${res.workspaces_synced} workspace(s).`);
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
        <div className="p-3 border-b border-border/40 flex items-center gap-2 font-medium text-xs text-muted-foreground uppercase tracking-wider">
          <Building2 className="w-4 h-4 text-primary" />
          <span>Workspaces</span>
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
          <div className="flex items-center justify-between">
            <span className="font-semibold text-sm">Chats</span>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSyncHistory}
              disabled={isSyncing}
              className="h-7 px-2 text-xs gap-1.5"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", isSyncing && "animate-spin")} />
              <span>{isSyncing ? "Syncing..." : "Sync"}</span>
            </Button>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-xs bg-background/50"
            />
          </div>

          {/* Status Tabs */}
          <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)} className="w-full">
            <TabsList className="grid grid-cols-4 h-7 p-0.5 text-xs bg-muted/50">
              <TabsTrigger value="all" className="text-[11px] px-1 py-0.5">All</TabsTrigger>
              <TabsTrigger value="unresolved" className="text-[11px] px-1 py-0.5">Open</TabsTrigger>
              <TabsTrigger value="pending" className="text-[11px] px-1 py-0.5">Pending</TabsTrigger>
              <TabsTrigger value="resolved" className="text-[11px] px-1 py-0.5">Done</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Conversation Cards List */}
        <ScrollArea className="flex-1">
          {isLoading ? (
            <div className="flex items-center justify-center p-8 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-xs">Loading chats...</span>
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-xs">
              No conversations found.
            </div>
          ) : (
            <div className="divide-y divide-border/20">
              {filteredConversations.map((conv) => {
                const isSelected = conv.id === selectedConversationId;
                const wsName = getWorkspaceDisplayName(conv.crisp_website_id, workspacesMap);
                const status = conv.status || "unresolved";

                return (
                  <div
                    key={conv.id}
                    onClick={() => setSelectedConversationId(conv.id)}
                    className={cn(
                      "p-3 cursor-pointer transition-colors hover:bg-accent/40 space-y-1.5",
                      isSelected && "bg-accent/80 border-l-4 border-l-primary"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 truncate">
                        <Avatar className="w-7 h-7">
                          <AvatarImage src={conv.customer_avatar || undefined} />
                          <AvatarFallback className="text-xs font-medium bg-primary/10 text-primary">
                            {(conv.customer_name || "V")[0].toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium text-xs truncate">
                          {conv.customer_name || "Visitor"}
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {conv.last_message_at
                          ? new Date(conv.last_message_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                          : ""}
                      </span>
                    </div>

                    <p className="text-xs text-muted-foreground line-clamp-1 truncate">
                      {conv.last_message || "[No messages]"}
                    </p>

                    <div className="flex items-center gap-1.5 pt-0.5">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] px-1.5 py-0 capitalize",
                          status === "resolved" ? "border-emerald-500/40 text-emerald-400" :
                          status === "pending" ? "border-amber-500/40 text-amber-400" :
                          "border-primary/40 text-primary"
                        )}
                      >
                        {status}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 truncate max-w-[130px]">
                        {wsName}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* ========================================================================= */}
      {/* COLUMN 3: ACTIVE CHAT & COMPOSER (Main Column) */}
      {/* ========================================================================= */}
      <div className="flex-1 flex flex-col bg-background/50 overflow-hidden">
        {activeConversation ? (
          <>
            {/* Active Header */}
            <div className="p-3 border-b border-border/40 flex items-center justify-between bg-card/30">
              <div className="flex items-center gap-3">
                <Avatar className="w-9 h-9">
                  <AvatarImage src={activeConversation.customer_avatar || undefined} />
                  <AvatarFallback className="bg-primary/20 text-primary font-semibold">
                    {(activeConversation.customer_name || "V")[0].toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">
                      {activeConversation.customer_name || "Visitor"}
                    </span>
                    <Badge variant="secondary" className="text-[11px] px-2 py-0">
                      {getWorkspaceDisplayName(activeConversation.crisp_website_id, workspacesMap)}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <span className="capitalize">{activeConversation.status || "unresolved"}</span>
                    {activeConversation.customer_email && <span>• {activeConversation.customer_email}</span>}
                    {activeConversation.customer_phone && <span>• {activeConversation.customer_phone}</span>}
                  </div>
                </div>
              </div>
            </div>

            {/* Chat Thread */}
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-3">
                {messages.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-xs">
                    No message history loaded for this session.
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isOperator = msg.sender_type === "operator" || msg.direction === "outgoing";

                    return (
                      <div
                        key={msg.id}
                        className={cn(
                          "flex flex-col max-w-[80%]",
                          isOperator ? "ml-auto items-end" : "mr-auto items-start"
                        )}
                      >
                        <div
                          className={cn(
                            "rounded-lg px-3.5 py-2 text-xs leading-relaxed shadow-sm",
                            isOperator
                              ? "bg-primary text-primary-foreground rounded-br-none"
                              : "bg-muted text-foreground border border-border/40 rounded-bl-none"
                          )}
                        >
                          <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                        </div>
                        <span className="text-[10px] text-muted-foreground mt-1 px-1">
                          {isOperator ? "Operator" : (activeConversation.customer_name || "Customer")} •{" "}
                          {new Date(msg.sent_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Message Composer */}
            <form onSubmit={handleSendMessage} className="p-3 border-t border-border/40 bg-card/30 flex gap-2">
              <Textarea
                placeholder="Write a reply..."
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage(e);
                  }
                }}
                className="flex-1 min-h-[44px] max-h-32 text-xs resize-none bg-background/60"
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
    </div>
  );
}
