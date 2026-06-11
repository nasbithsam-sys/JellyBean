import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Phone,
  MapPin,
  MessageSquarePlus,
  ArrowRight,
  Search,
  RefreshCw,
  UserPlus,
  UserCheck,
  Download,
  Bell,
  BellOff,
  Trash2,
  ArrowRightCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { listCsTeam, type CsTeamMember } from "@/lib/cs-team.functions";
import { downloadCsv, formatPhone } from "@/lib/crm-lite";

import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/cs-leads")({ component: Page });

const UNASSIGNED_VALUE = "__unassigned__";
type CsStatus = Database["public"]["Enums"]["cs_status"];
type LeadNote = { at: string; by: string; text: string };

function playNotificationBeep() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const beep = (freq: number, start: number, dur: number, vol = 0.6) => {
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
    // Loud three-tone alert chime, repeated three times — clearly audible
    // even when CS has another tab focused.
    for (let i = 0; i < 3; i++) {
      const t0 = i * 1.0;
      beep(880, t0 + 0.0, 0.22);
      beep(1175, t0 + 0.22, 0.22);
      beep(1568, t0 + 0.46, 0.38);
    }
    setTimeout(() => ctx.close(), 3500);
  } catch {
    // ignore — autoplay may be blocked until user interacts
  }
}

function showBrowserNotification(title: string, body: string) {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    const n = new Notification(title, {
      body,
      icon: "/favicon.ico",
      tag: "cs-new-lead",
      requireInteraction: false,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* ignore */
  }
}

type Lead = {
  id: string;
  customer_name: string;
  customer_number: string;
  context: string | null;
  post_text: string | null;
  pass_it_to: string | null;
  main_area: string | null;
  sub_area: string | null;
  marketing_notes: string | null;
  original_lead_link: string | null;
  cs_status: CsStatus;
  cs_notes: LeadNote[];
  followup_at: string | null;
  assigned_at: string;
  assigned_to: string | null;
  cs_outcome: "already_done" | "wrong_number" | "processed" | "wrong_lead" | null;
  is_important: boolean;
};

// CS pipeline statuses surfaced in the UI (subset of the DB enum).
const PIPELINE_STATUSES = [
  "new",
  "undeliver",
  "wrong_number",
  "already_got_someone",
  "service_provider_himself",
  "converted",
  "need_follow_up",
] as const satisfies readonly CsStatus[];

function Page() {
  const auth = useAuth();
  const isCs = auth.primaryRole === "cs";
  return (
    <div>
      <PageHeader
        title={isCs ? "Dashboard" : "CS Pipeline"}
        description="Qualified leads handed off to CS — reach out, log the outcome, and add a comment."
      />
      <PageBody className="!pt-5">
        <RoleGate allow={["admin", "cs"]} current={auth.primaryRole}>
          <Inner />
        </RoleGate>
      </PageBody>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  new: "New (to contact)",
  undeliver: "Undeliver",
  wrong_number: "Wrong Number",
  already_got_someone: "Already Got Someone",
  service_provider_himself: "Service Provider Himself",
  converted: "Converted",
  need_follow_up: "Need Follow Up",
  // legacy values (kept so old rows still render)
  called: "Called",
  messaged: "Messaged",
  follow_up: "Follow-up",
  interested: "Interested",
  not_interested: "Not interested",
  already_done: "Already done",
  no_response: "No response",
  closed_won: "Closed (done)",
  closed_lost: "Closed (lost)",
};

const STATUS_TONE: Record<string, string> = {
  new: "bg-primary",
  undeliver: "bg-destructive",
  wrong_number: "bg-destructive",
  already_got_someone: "bg-destructive",
  service_provider_himself: "bg-destructive",
  converted: "bg-success",
  need_follow_up: "bg-warning",
};

function Inner() {
  const auth = useAuth();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [areaFilter, setAreaFilter] = useState("all");
  const [visibleLimit, setVisibleLimit] = useState(60);
  const [opened, setOpened] = useState<Lead | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const isCs = auth.primaryRole === "cs";

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  async function bulkAssignToMe() {
    if (!auth.user?.id || selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      const ids = Array.from(selectedIds);
      const CHUNK = 25;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const { error } = await supabase
          .from("qualified_leads")
          .update({ assigned_to: auth.user.id })
          .in("id", slice);
        if (error) throw error;
      }
      toast.success(`Assigned ${ids.length} lead${ids.length === 1 ? "" : "s"} to you`);
      clearSelection();
      qc.invalidateQueries({ queryKey: ["cs_leads"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBulkBusy(false);
    }
  }

  const list = useQuery({
    queryKey: ["cs_leads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qualified_leads")
        .select(
          "id, customer_name, customer_number, context, post_text, pass_it_to, main_area, sub_area, marketing_notes, original_lead_link, cs_status, cs_notes, followup_at, assigned_at, assigned_to, cs_outcome, is_important",
        )
        // Pin important / urgent jobs to the top, then most recent first.
        .order("is_important", { ascending: false })
        .order("assigned_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as Lead[];
    },
  });

  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);
  const sentToday = useQuery({
    queryKey: ["cs_sent_today", auth.user?.id, todayStart],
    enabled: !!auth.user?.id,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("qualified_leads")
        .select("id", { count: "exact", head: true })
        .eq("assigned_by", auth.user!.id)
        .gte("assigned_at", todayStart);
      if (error) throw error;
      return count ?? 0;
    },
  });

  // CS team — used to display assignee names and (for admins) to reassign.
  const listTeam = useServerFn(listCsTeam);
  const team = useQuery({
    queryKey: ["cs_team"],
    queryFn: () => listTeam(),
  });
  const teamById = useMemo(() => {
    const map = new Map<string, CsTeamMember>();
    for (const m of team.data ?? []) map.set(m.user_id, m);
    return map;
  }, [team.data]);

  const areaOptions = useMemo(() => {
    const areas = new Set<string>();
    for (const lead of list.data ?? []) {
      const area = lead.main_area?.trim() || lead.sub_area?.trim();
      if (area) areas.add(area);
    }
    return Array.from(areas).sort();
  }, [list.data]);

  // ── New-lead sound notification (Supabase Realtime — instant for every CS) ──
  // Listens for INSERT events on qualified_leads. Every signed-in CS/admin
  // tab fires the chime + toast the moment the lead is forwarded, with no
  // polling delay. The realtime-sync hook handles cache invalidation, but
  // we mount a dedicated channel here so we get the *new row* payload to
  // surface the customer name in the toast.
  const armedRef = useRef(false);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">(
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "unsupported",
  );
  const [incomingLead, setIncomingLead] = useState<{
    name: string;
    area: string | null;
    context: string | null;
    at: number;
  } | null>(null);

  useEffect(() => {
    // Arm after first paint so we don't beep for historical rows during
    // initial subscription replay.
    const t = setTimeout(() => {
      armedRef.current = true;
    }, 1500);
    const channel = supabase.channel("cs-leads-new-ping");
    (channel as unknown as { on: (...args: unknown[]) => typeof channel }).on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "qualified_leads" },
      (payload: {
        new: {
          customer_name?: string;
          main_area?: string | null;
          sub_area?: string | null;
          context?: string | null;
        };
      }) => {
        if (!armedRef.current) return;
        const name = payload.new?.customer_name ?? "incoming";
        const area = payload.new?.main_area || payload.new?.sub_area || null;
        playNotificationBeep();
        showBrowserNotification("New lead forwarded to CS", area ? `${name} — ${area}` : name);
        toast.success(`New lead: ${name}`, { duration: 8000 });
        setIncomingLead({
          name,
          area,
          context: payload.new?.context ?? null,
          at: Date.now(),
        });
      },
    );
    channel.subscribe();
    return () => {
      clearTimeout(t);
      supabase.removeChannel(channel);
    };
  }, []);

  const enableAlerts = async () => {
    try {
      if (!("Notification" in window)) {
        toast.error("This browser does not support notifications");
        return;
      }
      const perm = await Notification.requestPermission();
      setNotifPermission(perm);
      // Play a short test tone — this also unlocks the AudioContext so
      // future real-time alerts can play without a user gesture.
      playNotificationBeep();
      if (perm === "granted") {
        showBrowserNotification("Alerts enabled", "You'll be pinged for new CS leads.");
        toast.success("Alerts enabled — you'll hear and see new leads.");
      } else {
        toast.message("Sound enabled. Allow notifications in the browser for pop-ups.");
      }
    } catch {
      toast.error("Could not enable alerts");
    }
  };

  const isAdmin = auth.primaryRole === "admin";
  const [activeStatus, setActiveStatus] = useState<CsStatus | "__all__" | "__wrong__">("new");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (list.data ?? []).filter((l) => {
      if (
        q &&
        ![l.customer_name, l.customer_number, l.main_area, l.sub_area, l.pass_it_to].some((f) =>
          f?.toLowerCase().includes(q),
        )
      ) {
        return false;
      }
      if (ownerFilter === "mine" && l.assigned_to !== auth.user?.id) return false;
      if (ownerFilter === "unassigned" && l.assigned_to) return false;
      if (
        ownerFilter !== "all" &&
        ownerFilter !== "mine" &&
        ownerFilter !== "unassigned" &&
        l.assigned_to !== ownerFilter
      ) {
        return false;
      }
      if (areaFilter !== "all" && l.main_area !== areaFilter && l.sub_area !== areaFilter) {
        return false;
      }
      return true;
    });
  }, [areaFilter, auth.user?.id, list.data, ownerFilter, query]);

  const wrongLeads = useMemo(
    () => filtered.filter((l) => l.cs_outcome === "wrong_lead"),
    [filtered],
  );
  // Wrong leads live in their own bucket; hide them from every regular tab.
  const activePool = useMemo(
    () => filtered.filter((l) => l.cs_outcome !== "wrong_lead"),
    [filtered],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of PIPELINE_STATUSES) c[s] = 0;
    for (const l of activePool) c[l.cs_status] = (c[l.cs_status] ?? 0) + 1;
    return c;
  }, [activePool]);

  const visibleLeads = useMemo(() => {
    if (activeStatus === "__wrong__") return wrongLeads;
    if (activeStatus === "__all__") return activePool;
    return activePool.filter((l) => l.cs_status === activeStatus);
  }, [activePool, wrongLeads, activeStatus]);
  const shownLeads = visibleLeads.slice(0, visibleLimit);

  function exportLeads() {
    downloadCsv(
      "cs-leads.csv",
      ["Customer", "Phone", "Status", "Assigned To", "Area", "Sub Area", "Created"],
      visibleLeads.map((lead) => [
        lead.customer_name,
        formatPhone(lead.customer_number),
        STATUS_LABEL[lead.cs_status] ?? lead.cs_status,
        lead.assigned_to
          ? (teamById.get(lead.assigned_to)?.full_name ??
            teamById.get(lead.assigned_to)?.email ??
            "")
          : "Unassigned",
        lead.main_area ?? "",
        lead.sub_area ?? "",
        lead.assigned_at,
      ]),
    );
    toast.success(`Exported ${visibleLeads.length} CS lead${visibleLeads.length === 1 ? "" : "s"}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search customer, area, phone…"
            className="w-full h-9 pl-9 pr-3 rounded-md bg-surface border border-border text-[13px] placeholder:text-muted-foreground/70 focus:outline-none"
          />
        </div>
        <Select value={ownerFilter} onValueChange={setOwnerFilter}>
          <SelectTrigger className="h-9 w-[150px] text-[12px]">
            <SelectValue placeholder="Owner" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All owners</SelectItem>
            <SelectItem value="mine">My leads</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            {team.data?.map((member) => (
              <SelectItem key={member.user_id} value={member.user_id}>
                {member.full_name || member.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={areaFilter} onValueChange={setAreaFilter}>
          <SelectTrigger className="h-9 w-[150px] text-[12px]">
            <SelectValue placeholder="Area" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All areas</SelectItem>
            {areaOptions.map((area) => (
              <SelectItem key={area} value={area}>
                {area}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <div className="px-3 h-9 inline-flex items-center gap-2 rounded-md bg-surface border border-border text-[12px]">
            <span className="text-muted-foreground">Sent today</span>
            <span className="font-semibold tabular-nums">{sentToday.data ?? "—"}</span>
          </div>
          <Button
            variant={notifPermission === "granted" ? "outline" : "default"}
            size="sm"
            className="h-9"
            onClick={enableAlerts}
            title={
              notifPermission === "granted"
                ? "Alerts on — click to test"
                : notifPermission === "denied"
                  ? "Notifications blocked in browser settings — click to enable sound"
                  : "Enable sound + pop-up alerts for new leads"
            }
          >
            {notifPermission === "granted" ? (
              <Bell className="h-3.5 w-3.5 mr-1.5" />
            ) : (
              <BellOff className="h-3.5 w-3.5 mr-1.5" />
            )}
            {notifPermission === "granted" ? "Alerts on" : "Enable alerts"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => qc.invalidateQueries({ queryKey: ["cs_leads"] })}
            disabled={list.isFetching}
          >
            {list.isFetching ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            )}
            Refresh
          </Button>
          <Button variant="outline" size="sm" className="h-9" onClick={exportLeads}>
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Export
          </Button>
        </div>
      </div>

      {/* Status tabs */}
      <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-lg bg-surface border border-border">
        {isAdmin && (
          <button
            onClick={() => setActiveStatus("__all__")}
            className={cn(
              "px-3 h-8 text-[12px] font-medium rounded-md transition-all inline-flex items-center gap-1.5",
              activeStatus === "__all__"
                ? "bg-card text-foreground shadow-sm ring-1 ring-border-strong"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-foreground" />
            All Leads
            <span className="text-[10.5px] text-muted-foreground tabular-nums">
              {filtered.length}
            </span>
          </button>
        )}
        {PIPELINE_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setActiveStatus(s)}
            className={cn(
              "px-3 h-8 text-[12px] font-medium rounded-md transition-all inline-flex items-center gap-1.5",
              activeStatus === s
                ? "bg-card text-foreground shadow-sm ring-1 ring-border-strong"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span
              className={cn("h-1.5 w-1.5 rounded-full", STATUS_TONE[s] ?? "bg-muted-foreground")}
            />
            {STATUS_LABEL[s] ?? s}
            <span className="text-[10.5px] text-muted-foreground tabular-nums">
              {counts[s] ?? 0}
            </span>
          </button>
        ))}
        <button
          onClick={() => setActiveStatus("__wrong__")}
          className={cn(
            "px-3 h-8 text-[12px] font-medium rounded-md transition-all inline-flex items-center gap-1.5",
            activeStatus === "__wrong__"
              ? "bg-card text-foreground shadow-sm ring-1 ring-border-strong"
              : "text-muted-foreground hover:text-foreground",
          )}
          title="Leads marked as Wrong lead by CS"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
          Wrong leads
          <span className="text-[10.5px] text-muted-foreground tabular-nums">
            {wrongLeads.length}
          </span>
        </button>
      </div>

      {list.error && (
        <div className="text-[12.5px] text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
          {(list.error as Error).message}
        </div>
      )}

      {list.isLoading ? (
        <div className="glass-card p-16 text-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Loading pipeline…
        </div>
      ) : visibleLeads.length === 0 ? (
        <div className="glass-card p-10 text-center text-[12.5px] text-muted-foreground">
          No leads in this status.
        </div>
      ) : (
        <>
          {isCs && (
            <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-surface border border-border text-[12px]">
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground">
                  {selectedIds.size > 0
                    ? `${selectedIds.size} selected`
                    : "Select leads to bulk-assign"}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const ids = new Set(shownLeads.map((l) => l.id));
                    setSelectedIds(ids);
                  }}
                  className="text-primary hover:underline"
                >
                  Select all visible
                </button>
                {selectedIds.size > 0 && (
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                )}
              </div>
              <Button
                size="sm"
                className="h-8"
                disabled={selectedIds.size === 0 || bulkBusy}
                onClick={bulkAssignToMe}
              >
                {bulkBusy ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                )}
                Assign {selectedIds.size > 0 ? selectedIds.size : ""} to myself
              </Button>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {shownLeads.map((l) => (
              <LeadCard
                key={l.id}
                lead={l}
                team={team.data ?? []}
                teamById={teamById}
                onOpen={() => setOpened(l)}
                selected={selectedIds.has(l.id)}
                onToggleSelect={() => toggleSelect(l.id)}
                showSelect={isCs}
              />
            ))}
          </div>
        </>
      )}

      {visibleLeads.length > shownLeads.length && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => setVisibleLimit((n) => n + 60)}>
            Load more ({visibleLeads.length - shownLeads.length} remaining)
          </Button>
        </div>
      )}

      {opened && (
        <LeadDrawer
          lead={opened}
          team={team.data ?? []}
          teamById={teamById}
          onClose={() => setOpened(null)}
          onSaved={() => {
            setOpened(null);
            qc.invalidateQueries({ queryKey: ["cs_leads"] });
          }}
        />
      )}

      <Dialog open={!!incomingLead} onOpenChange={(o) => !o && setIncomingLead(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" />
              New lead forwarded to CS
            </DialogTitle>
            <DialogDescription>
              A new qualified lead just landed in your pipeline.
            </DialogDescription>
          </DialogHeader>
          {incomingLead && (
            <div className="space-y-2 text-sm">
              <div>
                <div className="text-muted-foreground text-xs">Customer</div>
                <div className="font-semibold">{incomingLead.name}</div>
              </div>
              {incomingLead.area && (
                <div>
                  <div className="text-muted-foreground text-xs">Area</div>
                  <div>{incomingLead.area}</div>
                </div>
              )}
              {incomingLead.context && (
                <div>
                  <div className="text-muted-foreground text-xs">Context</div>
                  <div className="line-clamp-3">{incomingLead.context}</div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIncomingLead(null)}>
              Dismiss
            </Button>
            <Button
              onClick={() => {
                setActiveStatus("new");
                qc.invalidateQueries({ queryKey: ["cs_leads"] });
                setIncomingLead(null);
              }}
            >
              View new leads
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LeadCard({
  lead,
  team,
  teamById,
  onOpen,
  selected = false,
  onToggleSelect,
  showSelect = false,
}: {
  lead: Lead;
  team: CsTeamMember[];
  teamById: Map<string, CsTeamMember>;
  onOpen: () => void;
  selected?: boolean;
  onToggleSelect?: () => void;
  showSelect?: boolean;
}) {
  const qc = useQueryClient();
  const auth = useAuth();
  const [status, setStatus] = useState<CsStatus>(lead.cs_status);
  const [outcome, setOutcome] = useState<Lead["cs_outcome"]>(lead.cs_outcome);
  const [assignedTo, setAssignedTo] = useState<string | null>(lead.assigned_to);
  const [saving, setSaving] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [name, setName] = useState(lead.customer_name);
  const [number, setNumber] = useState(lead.customer_number);
  const [compose, setCompose] = useState(lead.marketing_notes ?? "");
  const initials = (name || "?")
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const isAdmin = auth.primaryRole === "admin";
  const isCs = auth.primaryRole === "cs";
  const assignee = assignedTo ? teamById.get(assignedTo) : null;
  const assignedToMe = !!assignedTo && assignedTo === auth.user?.id;

  async function saveField(patch: Partial<Lead>) {
    const { error } = await supabase
      .from("qualified_leads")
      .update(patch as never)
      .eq("id", lead.id);
    if (error) {
      toast.error(error.message);
      return false;
    }
    return true;
  }

  async function changeOutcome(nextValue: string) {
    const next = (nextValue === "__none__" ? null : nextValue) as Lead["cs_outcome"];
    const prev = outcome;
    setOutcome(next);
    if (await saveField({ cs_outcome: next })) {
      toast.success(next ? `Outcome → ${next.replace(/_/g, " ")}` : "Outcome cleared");
      qc.invalidateQueries({ queryKey: ["cs_leads"] });
    } else {
      setOutcome(prev);
    }
  }

  async function changeStatus(next: CsStatus) {
    const prev = status;
    setStatus(next);
    setSaving(true);
    try {
      const { error } = await supabase
        .from("qualified_leads")
        .update({ cs_status: next })
        .eq("id", lead.id);
      if (error) throw error;
      await supabase.from("activity_logs").insert({
        actor_id: auth.user?.id,
        actor_name: auth.profile?.full_name,
        actor_role: auth.primaryRole,
        action: "cs.status_changed",
        entity_type: "qualified_lead",
        entity_id: lead.id,
        metadata: { status: next, from: "card" },
      });
      toast.success(`Status → ${STATUS_LABEL[next] ?? next}`);
      qc.invalidateQueries({ queryKey: ["cs_leads"] });
    } catch (e) {
      setStatus(prev);
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function changeAssignee(nextValue: string) {
    const next = nextValue === UNASSIGNED_VALUE ? null : nextValue;
    const prev = assignedTo;
    setAssignedTo(next);
    setAssigning(true);
    try {
      const { error } = await supabase
        .from("qualified_leads")
        .update({ assigned_to: next })
        .eq("id", lead.id);
      if (error) throw error;
      const nextName = next ? (teamById.get(next)?.full_name ?? "teammate") : "unassigned";
      await supabase.from("activity_logs").insert({
        actor_id: auth.user?.id,
        actor_name: auth.profile?.full_name,
        actor_role: auth.primaryRole,
        action: "cs.assigned",
        entity_type: "qualified_lead",
        entity_id: lead.id,
        metadata: { assigned_to: next, assigned_to_name: nextName },
      });
      toast.success(next ? `Assigned to ${nextName}` : "Unassigned");
      qc.invalidateQueries({ queryKey: ["cs_leads"] });
    } catch (e) {
      setAssignedTo(prev);
      toast.error((e as Error).message);
    } finally {
      setAssigning(false);
    }
  }

  async function assignToMe(e: React.MouseEvent) {
    e.stopPropagation();
    if (!auth.user?.id) return;
    await changeAssignee(auth.user.id);
  }

  async function deleteLead(e: React.MouseEvent) {
    e.stopPropagation();
    if (!isAdmin) return;
    if (!confirm(`Delete lead for "${lead.customer_name}"? This cannot be undone.`)) return;
    try {
      const { error } = await supabase.from("qualified_leads").delete().eq("id", lead.id);
      if (error) throw error;
      await supabase.from("activity_logs").insert({
        actor_id: auth.user?.id,
        actor_name: auth.profile?.full_name,
        actor_role: auth.primaryRole,
        action: "cs.deleted",
        entity_type: "qualified_lead",
        entity_id: lead.id,
        metadata: { customer_name: lead.customer_name },
      });
      toast.success("Lead deleted");
      qc.invalidateQueries({ queryKey: ["cs_leads"] });
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div
      className={cn(
        "glass-card p-4 group hover:border-border-strong hover:-translate-y-0.5 transition-all duration-200 cursor-pointer animate-fade-in-up",
        selected && "ring-2 ring-primary border-primary",
        lead.is_important && "border-warning/60 bg-warning/5",
      )}
      onClick={onOpen}
    >
      {lead.is_important && (
        <div className="-mt-1 mb-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning/15 text-warning border border-warning/40 text-[10.5px] font-semibold uppercase tracking-wide">
          <span className="h-1.5 w-1.5 rounded-full bg-warning animate-pulse" />
          Important job
        </div>
      )}
      <div className="flex items-start gap-3">
        {showSelect && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            onClick={(e) => e.stopPropagation()}
            className="mt-1.5 h-4 w-4 accent-primary cursor-pointer"
            title="Select for bulk assignment"
          />
        )}
        <div className="h-10 w-10 shrink-0 rounded-sm bg-surface border border-border-strong grid place-items-center text-[12px] font-mono font-semibold text-primary">
          {initials || "·"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[13.5px] font-semibold truncate">{lead.customer_name}</h3>
            <StatusBadge status={status} />
          </div>
          <a
            href={`tel:${lead.customer_number}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-primary transition-colors mt-0.5"
          >
            <Phone className="h-3 w-3" /> {formatPhone(lead.customer_number)}
          </a>
        </div>
      </div>

      {lead.main_area && (
        <div className="mt-3 flex items-start gap-1.5 text-[12px]">
          <MapPin className="h-3 w-3 mt-0.5 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <span className="text-muted-foreground">Main Area: </span>
            <span className="text-foreground/90 font-medium">{lead.main_area}</span>
            {lead.sub_area && (
              <span className="text-muted-foreground"> · {lead.sub_area}</span>
            )}
          </div>
        </div>
      )}

      {lead.pass_it_to && (
        <div className="mt-2 flex items-start gap-1.5 text-[12px]">
          <ArrowRightCircle className="h-3 w-3 mt-0.5 text-primary shrink-0" />
          <div className="min-w-0">
            <span className="text-muted-foreground">Pass it to: </span>
            <span className="text-foreground/90 font-medium">{lead.pass_it_to}</span>
          </div>
        </div>
      )}

      {lead.context && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-0.5">
            Context
          </div>
          <p className="text-[12.5px] text-foreground/90 leading-relaxed line-clamp-3 whitespace-pre-wrap">
            {lead.context}
          </p>
        </div>
      )}

      {lead.post_text && (
        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-0.5">
            Exact customer requirement
          </div>
          <p className="text-[12.5px] text-muted-foreground/90 leading-relaxed line-clamp-3 whitespace-pre-wrap">
            {lead.post_text}
          </p>
        </div>
      )}

      <div className="mt-3" onClick={(e) => e.stopPropagation()}>
        <Select
          value={status}
          onValueChange={(next) => changeStatus(next as CsStatus)}
          disabled={saving}
        >
          <SelectTrigger className="h-8 text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PIPELINE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s] ?? s.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Outcome (visible to forwarder) */}
      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
        <Select value={outcome ?? "__none__"} onValueChange={changeOutcome}>
          <SelectTrigger className="h-8 text-[12px]">
            <SelectValue placeholder="Outcome…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">— Outcome not set —</SelectItem>
            <SelectItem value="already_done">Already done</SelectItem>
            <SelectItem value="wrong_number">Wrong number</SelectItem>
            <SelectItem value="processed">Processed</SelectItem>
            <SelectItem value="wrong_lead">Wrong lead</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Manual fields filled by CS */}
      <div className="mt-3 grid grid-cols-2 gap-2" onClick={(e) => e.stopPropagation()}>
        <div>
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={async () => {
              if (name !== lead.customer_name && name.trim()) {
                if (await saveField({ customer_name: name.trim() } as Partial<Lead>)) {
                  qc.invalidateQueries({ queryKey: ["cs_leads"] });
                }
              }
            }}
            className="h-8 text-[12px] mt-0.5"
            placeholder="Customer name"
          />
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Number</Label>
          <Input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            onBlur={async () => {
              if (number !== lead.customer_number && number.trim()) {
                if (await saveField({ customer_number: number.trim() } as Partial<Lead>)) {
                  qc.invalidateQueries({ queryKey: ["cs_leads"] });
                }
              }
            }}
            className="h-8 text-[12px] mt-0.5"
            placeholder="Phone"
          />
        </div>
      </div>
      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Compose</Label>
        <Textarea
          value={compose}
          rows={2}
          onChange={(e) => setCompose(e.target.value)}
          onBlur={async () => {
            if ((compose || "") !== (lead.marketing_notes ?? "")) {
              if (await saveField({ marketing_notes: compose } as Partial<Lead>)) {
                qc.invalidateQueries({ queryKey: ["cs_leads"] });
              }
            }
          }}
          className="text-[12px] mt-0.5 resize-none"
          placeholder="Compose a message or note for this lead…"
        />
      </div>

      {/* Assignment row */}
      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
        {isAdmin ? (
          <Select
            value={assignedTo ?? UNASSIGNED_VALUE}
            onValueChange={changeAssignee}
            disabled={assigning}
          >
            <SelectTrigger className="h-8 text-[12px]">
              <div className="inline-flex items-center gap-1.5 truncate">
                <UserPlus className="h-3 w-3 text-muted-foreground" />
                <SelectValue placeholder="Assign to…" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED_VALUE}>Unassigned</SelectItem>
              {team.map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>
                  {m.full_name || m.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="flex items-center justify-between gap-2 text-[12px]">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground truncate">
              <UserCheck className="h-3 w-3" />
              {assignee ? (
                <span className={cn("truncate", assignedToMe && "text-primary font-medium")}>
                  {assignedToMe ? "You" : assignee.full_name || assignee.email}
                </span>
              ) : (
                <span className="italic text-muted-foreground/70">Unassigned</span>
              )}
            </span>
            {isCs && !assignedToMe && (
              <Button
                size="sm"
                variant={assignedTo ? "outline" : "default"}
                className="h-7 text-[11.5px] px-2"
                disabled={assigning}
                onClick={assignToMe}
              >
                {assigning ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <UserPlus className="h-3 w-3 mr-1" />
                )}
                {assignedTo ? "Take over" : "Assign to me"}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-[11.5px] text-muted-foreground">
        <span className="tabular-nums">
          {formatDistanceToNow(new Date(lead.assigned_at), { addSuffix: true })}
        </span>
        {lead.followup_at && (
          <span className="inline-flex items-center gap-1 text-warning">
            <span className="h-1.5 w-1.5 rounded-full bg-warning" />
            Follow-up {formatDistanceToNow(new Date(lead.followup_at), { addSuffix: true })}
          </span>
        )}
        {isAdmin && (
          <button
            type="button"
            onClick={deleteLead}
            className="inline-flex items-center gap-1 text-destructive hover:text-destructive/80 transition-colors"
            title="Delete this lead"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        )}
        <ArrowRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all text-primary" />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "converted" || status === "closed_won"
      ? "bg-success/15 text-success border-success/30"
      : status === "undeliver" ||
          status === "wrong_number" ||
          status === "already_got_someone" ||
          status === "service_provider_himself" ||
          status === "closed_lost" ||
          status === "not_interested" ||
          status === "already_done"
        ? "bg-destructive/15 text-destructive border-destructive/30"
        : status === "need_follow_up" || status === "follow_up"
          ? "bg-warning/15 text-warning border-warning/30"
          : status === "interested"
            ? "bg-primary/15 text-primary border-primary/30"
            : status === "called" || status === "messaged"
              ? "bg-warning/15 text-warning border-warning/30"
              : "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={cn(
        "text-[10.5px] px-2 py-0.5 rounded-full border font-medium whitespace-nowrap",
        tone,
      )}
    >
      {STATUS_LABEL[status] ?? status.replace(/_/g, " ")}
    </span>
  );
}

function LeadDrawer({
  lead,
  team,
  teamById,
  onClose,
  onSaved,
}: {
  lead: Lead;
  team: CsTeamMember[];
  teamById: Map<string, CsTeamMember>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const auth = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState<CsStatus>(lead.cs_status);
  const [csOutcome, setCsOutcome] = useState<Lead["cs_outcome"]>(lead.cs_outcome);
  const [assignedTo, setAssignedTo] = useState<string | null>(lead.assigned_to);
  const [note, setNote] = useState("");
  const [followup, setFollowup] = useState(lead.followup_at ? lead.followup_at.slice(0, 16) : "");
  const [busy, setBusy] = useState(false);
  const notes = useMemo(() => (Array.isArray(lead.cs_notes) ? lead.cs_notes : []), [lead.cs_notes]);
  const isAdmin = auth.primaryRole === "admin";
  const isCs = auth.primaryRole === "cs";
  const assignee = assignedTo ? teamById.get(assignedTo) : null;
  const assignedToMe = !!assignedTo && assignedTo === auth.user?.id;

  async function save() {
    setBusy(true);
    try {
      const newNotes = note.trim()
        ? [
            ...notes,
            {
              at: new Date().toISOString(),
              by: auth.profile?.full_name ?? auth.user?.email ?? "user",
              text: note.trim(),
            },
          ]
        : notes;
      const { error } = await supabase
        .from("qualified_leads")
        .update({
          cs_status: status,
          cs_notes: newNotes as Json,
          followup_at: followup ? new Date(followup).toISOString() : null,
          assigned_to: assignedTo,
          cs_outcome: csOutcome,
        } as never)
        .eq("id", lead.id);
      if (error) throw error;
      await supabase.from("activity_logs").insert({
        actor_id: auth.user?.id,
        actor_name: auth.profile?.full_name,
        actor_role: auth.primaryRole,
        action: "cs.updated",
        entity_type: "qualified_lead",
        entity_id: lead.id,
        metadata: { status, hasNote: !!note.trim(), assigned_to: assignedTo },
      });
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["cs_leads"] });
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur-md flex justify-end animate-fade-in-up"
      onClick={onClose}
    >
      <div
        className="bg-card w-full max-w-lg h-full overflow-y-auto border-l border-border p-7 space-y-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-medium">
            Customer
          </div>
          <h2 className="text-[22px] font-semibold tracking-tight mt-1">{lead.customer_name}</h2>
          <a
            href={`tel:${lead.customer_number}`}
            className="text-sm text-primary inline-flex items-center mt-1.5 hover:text-primary-glow transition-colors"
          >
            <Phone className="h-3.5 w-3.5 mr-1.5" />
            {formatPhone(lead.customer_number)}
          </a>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {(lead.main_area || lead.sub_area) && (
            <Info
              label="Area"
              value={[lead.main_area, lead.sub_area].filter(Boolean).join(" · ")}
            />
          )}
          {lead.pass_it_to && <Info label="Pass to" value={lead.pass_it_to} />}
        </div>
        {lead.post_text && (
          <Info label="Customer exact requirement" value={lead.post_text} multiline />
        )}
        {lead.context && <Info label="Context" value={lead.context} multiline />}
        {lead.marketing_notes && (
          <Info label="Marketing notes" value={lead.marketing_notes} multiline />
        )}

        <div className="border-t border-border pt-5 space-y-4">
          <div>
            <Label className="block mb-1.5 text-[11.5px] uppercase tracking-wide text-muted-foreground font-medium">
              Status
            </Label>
            <Select value={status} onValueChange={(next) => setStatus(next as CsStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PIPELINE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABEL[s] ?? s.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="block mb-1.5 text-[11.5px] uppercase tracking-wide text-muted-foreground font-medium">
              Outcome (visible to forwarder)
            </Label>
            <Select
              value={csOutcome ?? "__none__"}
              onValueChange={(v) =>
                setCsOutcome(v === "__none__" ? null : (v as Lead["cs_outcome"]))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Not set —</SelectItem>
                <SelectItem value="already_done">Already done</SelectItem>
                <SelectItem value="wrong_number">Wrong number</SelectItem>
                <SelectItem value="processed">Processed</SelectItem>
                <SelectItem value="wrong_lead">Wrong lead</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="block mb-1.5 text-[11.5px] uppercase tracking-wide text-muted-foreground font-medium">
              Assigned to
            </Label>
            {isAdmin ? (
              <Select
                value={assignedTo ?? UNASSIGNED_VALUE}
                onValueChange={(v) => setAssignedTo(v === UNASSIGNED_VALUE ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED_VALUE}>Unassigned</SelectItem>
                  {team.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {m.full_name || m.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex items-center justify-between gap-2 px-3 h-10 rounded-md border border-border bg-surface/60 text-[13px]">
                <span className="inline-flex items-center gap-2 truncate">
                  <UserCheck className="h-3.5 w-3.5 text-muted-foreground" />
                  {assignee ? (
                    <span className={cn("truncate", assignedToMe && "text-primary font-medium")}>
                      {assignedToMe ? "You" : assignee.full_name || assignee.email}
                    </span>
                  ) : (
                    <span className="italic text-muted-foreground/70">Unassigned</span>
                  )}
                </span>
                {isCs && !assignedToMe && (
                  <Button
                    size="sm"
                    variant={assignedTo ? "outline" : "default"}
                    className="h-7 text-[11.5px] px-2"
                    onClick={() => auth.user?.id && setAssignedTo(auth.user.id)}
                  >
                    <UserPlus className="h-3 w-3 mr-1" />
                    {assignedTo ? "Take over" : "Assign to me"}
                  </Button>
                )}
              </div>
            )}
          </div>
          <div>
            <Label className="block mb-1.5 text-[11.5px] uppercase tracking-wide text-muted-foreground font-medium">
              Follow-up at
            </Label>
            <Input
              type="datetime-local"
              value={followup}
              onChange={(e) => setFollowup(e.target.value)}
            />
          </div>
          <div>
            <Label className="block mb-1.5 text-[11.5px] uppercase tracking-wide text-muted-foreground font-medium">
              Comment
            </Label>
            <Textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Write what happened in your own words — e.g. customer is interested, already done by someone else, asked to message later…"
            />
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Free-text comment. Appended to the history when you save.
            </p>
          </div>
          <div className="flex items-center justify-between gap-2">
            {isAdmin ? (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                disabled={busy}
                onClick={async () => {
                  if (!confirm(`Delete lead for "${lead.customer_name}"? This cannot be undone.`))
                    return;
                  setBusy(true);
                  try {
                    const { error } = await supabase
                      .from("qualified_leads")
                      .delete()
                      .eq("id", lead.id);
                    if (error) throw error;
                    await supabase.from("activity_logs").insert({
                      actor_id: auth.user?.id,
                      actor_name: auth.profile?.full_name,
                      actor_role: auth.primaryRole,
                      action: "cs.deleted",
                      entity_type: "qualified_lead",
                      entity_id: lead.id,
                      metadata: { customer_name: lead.customer_name },
                    });
                    toast.success("Lead deleted");
                    qc.invalidateQueries({ queryKey: ["cs_leads"] });
                    onSaved();
                  } catch (e) {
                    toast.error((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Trash2 className="h-4 w-4 mr-1.5" />
                Delete lead
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose} disabled={busy}>
                Close
              </Button>
              <Button onClick={save} disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Save
              </Button>
            </div>
          </div>
        </div>

        {notes.length > 0 && (
          <div className="border-t border-border pt-5">
            <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-medium mb-3 flex items-center gap-2">
              <MessageSquarePlus className="h-3 w-3" /> History · {notes.length}
            </div>
            <div className="space-y-2.5">
              {[...notes].reverse().map((n, i) => (
                <div key={i} className="bg-surface/60 border border-border rounded-md p-3">
                  <div className="text-[11px] text-muted-foreground tabular-nums">
                    {n.by} · {new Date(n.at).toLocaleString()}
                  </div>
                  <div className="text-[13px] mt-1 whitespace-pre-wrap leading-relaxed">
                    {n.text}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Info({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-medium">
        {label}
      </div>
      <div
        className={cn("text-[13px] mt-1 leading-relaxed", multiline ? "whitespace-pre-wrap" : "")}
      >
        {value}
      </div>
    </div>
  );
}
