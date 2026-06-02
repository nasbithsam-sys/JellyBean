import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ExternalLink, Phone, MapPin, MessageSquarePlus, ArrowRight, Search, RefreshCw, Globe } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

import { cn } from "@/lib/utils";
import { launchIncognitonProfile, INCOG_UNREACHABLE } from "@/lib/incogniton";

export const Route = createFileRoute("/app/cs-leads")({ component: Page });

function playNotificationBeep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const beep = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + 0.02);
    };
    beep(880, 0, 0.18);
    beep(1175, 0.2, 0.22);
    setTimeout(() => ctx.close(), 700);
  } catch {
    // ignore — autoplay may be blocked until user interacts
  }
}

type Lead = {
  id: string; customer_name: string; customer_number: string;
  context: string | null; pass_it_to: string | null;
  main_area: string | null; sub_area: string | null;
  marketing_notes: string | null; original_lead_link: string | null;
  cs_status: string; cs_notes: Array<{ at: string; by: string; text: string }>;
  followup_at: string | null; assigned_at: string;
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
] as const;

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
        <RoleGate allow={["admin", "cs", "marketing"]} current={auth.primaryRole}>
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
  const [opened, setOpened] = useState<Lead | null>(null);

  const list = useQuery({
    queryKey: ["cs_leads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qualified_leads")
        .select("*")
        .order("assigned_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as unknown as Lead[];
    },
  });

  const todayStart = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString();
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

  // ── New-lead sound notification (poll every 20s) ────────────────────────────
  const lastSeenRef = useRef<string | null>(null);
  const newLeadPoll = useQuery({
    queryKey: ["cs_new_lead_ping"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qualified_leads")
        .select("id, customer_name, assigned_at")
        .order("assigned_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data?.[0] ?? null;
    },
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    const latest = newLeadPoll.data;
    if (!latest) return;
    if (lastSeenRef.current === null) {
      lastSeenRef.current = latest.assigned_at;
      return;
    }
    if (latest.assigned_at > lastSeenRef.current) {
      lastSeenRef.current = latest.assigned_at;
      playNotificationBeep();
      toast.success(`New lead: ${latest.customer_name}`);
      qc.invalidateQueries({ queryKey: ["cs_leads"] });
    }
  }, [newLeadPoll.data, qc]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list.data ?? [];
    return (list.data ?? []).filter((l) =>
      [l.customer_name, l.customer_number, l.main_area, l.sub_area, l.pass_it_to].some((f) => f?.toLowerCase().includes(q))
    );
  }, [list.data, query]);

  const sections = useMemo(() => {
    return PIPELINE_STATUSES.map((s) => ({
      status: s,
      leads: filtered.filter((l) => l.cs_status === s),
    }));
  }, [filtered]);

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
        <div className="ml-auto flex items-center gap-2">
          <div className="px-3 h-9 inline-flex items-center gap-2 rounded-md bg-surface border border-border text-[12px]">
            <span className="text-muted-foreground">Sent today</span>
            <span className="font-semibold tabular-nums">{sentToday.data ?? "—"}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => qc.invalidateQueries({ queryKey: ["cs_leads"] })}
            disabled={list.isFetching}
          >
            {list.isFetching ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
            Refresh
          </Button>
        </div>
      </div>

      {list.isLoading ? (
        <div className="glass-card p-16 text-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Loading pipeline…
        </div>
      ) : (
        <div className="space-y-6">
          {sections.map(({ status, leads }) => (
            <section key={status}>
              <div className="flex items-center gap-2 mb-3">
                <span className={cn("h-2 w-2 rounded-full", STATUS_TONE[status] ?? "bg-muted-foreground")} />
                <h3 className="text-[13px] font-semibold tracking-tight">{STATUS_LABEL[status] ?? status}</h3>
                <span className="text-[11px] text-muted-foreground tabular-nums">{leads.length}</span>
              </div>
              {leads.length === 0 ? (
                <div className="glass-card p-6 text-center text-[12px] text-muted-foreground">No leads.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {leads.map((l) => <LeadCard key={l.id} lead={l} onOpen={() => setOpened(l)} />)}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {opened && <LeadDrawer lead={opened} onClose={() => setOpened(null)} onSaved={() => { setOpened(null); qc.invalidateQueries({ queryKey: ["cs_leads"] }); }} />}
    </div>
  );
}

function LeadCard({ lead, onOpen }: { lead: Lead; onOpen: () => void }) {
  const qc = useQueryClient();
  const auth = useAuth();
  const [status, setStatus] = useState(lead.cs_status);
  const [saving, setSaving] = useState(false);
  const initials = (lead.customer_name || "?").split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();

  async function changeStatus(next: string) {
    const prev = status;
    setStatus(next);
    setSaving(true);
    try {
      const { error } = await supabase.from("qualified_leads").update({ cs_status: next as never }).eq("id", lead.id);
      if (error) throw error;
      await supabase.from("activity_logs").insert({
        actor_id: auth.user?.id, actor_name: auth.profile?.full_name, actor_role: auth.primaryRole,
        action: "cs.status_changed", entity_type: "qualified_lead", entity_id: lead.id,
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

  return (
    <div className="glass-card p-4 group hover:border-border-strong hover:-translate-y-0.5 transition-all duration-200 cursor-pointer animate-fade-in-up" onClick={onOpen}>
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 shrink-0 rounded-lg bg-gradient-to-br from-primary/30 to-primary-glow/20 grid place-items-center text-[12px] font-semibold ring-1 ring-primary/30">
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
            <Phone className="h-3 w-3" /> {lead.customer_number}
          </a>
        </div>
      </div>

      {(lead.main_area || lead.sub_area) && (
        <div className="mt-3 flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <MapPin className="h-3 w-3" />
          <span className="truncate">{[lead.main_area, lead.sub_area].filter(Boolean).join(" · ")}</span>
        </div>
      )}

      {lead.context && (
        <p className="mt-3 text-[12.5px] text-muted-foreground/90 leading-relaxed line-clamp-2">
          {lead.context}
        </p>
      )}

      <div className="mt-3" onClick={(e) => e.stopPropagation()}>
        <Select value={status} onValueChange={changeStatus} disabled={saving}>
          <SelectTrigger className="h-8 text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PIPELINE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABEL[s] ?? s.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-[11.5px] text-muted-foreground">
        <span className="tabular-nums">{formatDistanceToNow(new Date(lead.assigned_at), { addSuffix: true })}</span>
        {lead.followup_at && (
          <span className="inline-flex items-center gap-1 text-warning">
            <span className="h-1.5 w-1.5 rounded-full bg-warning" />
            Follow-up {formatDistanceToNow(new Date(lead.followup_at), { addSuffix: true })}
          </span>
        )}
        <ArrowRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all text-primary" />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "converted" || status === "closed_won" ? "bg-success/15 text-success border-success/30"
      : status === "undeliver" || status === "wrong_number" || status === "already_got_someone" || status === "service_provider_himself" || status === "closed_lost" || status === "not_interested" || status === "already_done" ? "bg-destructive/15 text-destructive border-destructive/30"
        : status === "need_follow_up" || status === "follow_up" ? "bg-warning/15 text-warning border-warning/30"
          : status === "interested" ? "bg-primary/15 text-primary border-primary/30"
            : status === "called" || status === "messaged" ? "bg-warning/15 text-warning border-warning/30"
              : "bg-muted text-muted-foreground border-border";
  return (
    <span className={cn("text-[10.5px] px-2 py-0.5 rounded-full border font-medium whitespace-nowrap", tone)}>
      {STATUS_LABEL[status] ?? status.replace(/_/g, " ")}
    </span>
  );
}

function LeadDrawer({ lead, onClose, onSaved }: { lead: Lead; onClose: () => void; onSaved: () => void }) {
  const auth = useAuth();
  const [status, setStatus] = useState(lead.cs_status);
  const [note, setNote] = useState("");
  const [followup, setFollowup] = useState(lead.followup_at ? lead.followup_at.slice(0, 16) : "");
  const [busy, setBusy] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const notes = useMemo(() => Array.isArray(lead.cs_notes) ? lead.cs_notes : [], [lead.cs_notes]);

  const linkedProfile = useQuery({
    queryKey: ["incog_profile_for_lead", lead.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("incogniton_profiles")
        .select("id, incogniton_profile_id, profile_name")
        .eq("linked_lead_id", lead.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  async function launchProfile() {
    if (!linkedProfile.data) {
      setLinkOpen(true);
      return;
    }
    try {
      await launchIncognitonProfile(linkedProfile.data.incogniton_profile_id);
      await supabase
        .from("incogniton_profiles")
        .update({ last_launched_at: new Date().toISOString() })
        .eq("id", linkedProfile.data.id);
      toast.success("Profile opened in Incogniton");
    } catch (e) {
      toast.error((e as Error).message || INCOG_UNREACHABLE);
    }
  }

  async function save() {
    setBusy(true);
    try {
      const newNotes = note.trim()
        ? [...notes, { at: new Date().toISOString(), by: auth.profile?.full_name ?? auth.user?.email ?? "user", text: note.trim() }]
        : notes;
      const { error } = await supabase.from("qualified_leads")
        .update({
          cs_status: status as never,
          cs_notes: newNotes as never,
          followup_at: followup ? new Date(followup).toISOString() : null,
        })
        .eq("id", lead.id);
      if (error) throw error;
      await supabase.from("activity_logs").insert({
        actor_id: auth.user?.id, actor_name: auth.profile?.full_name, actor_role: auth.primaryRole,
        action: "cs.updated", entity_type: "qualified_lead", entity_id: lead.id,
        metadata: { status, hasNote: !!note.trim() },
      });
      toast.success("Saved");
      onSaved();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-background/70 backdrop-blur-md flex justify-end animate-fade-in-up" onClick={onClose}>
      <div className="bg-card w-full max-w-lg h-full overflow-y-auto border-l border-border p-7 space-y-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div>
          <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-medium">Customer</div>
          <h2 className="text-[22px] font-semibold tracking-tight mt-1">{lead.customer_name}</h2>
          <a href={`tel:${lead.customer_number}`} className="text-sm text-primary inline-flex items-center mt-1.5 hover:text-primary-glow transition-colors">
            <Phone className="h-3.5 w-3.5 mr-1.5" />{lead.customer_number}
          </a>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {(lead.main_area || lead.sub_area) && <Info label="Area" value={[lead.main_area, lead.sub_area].filter(Boolean).join(" · ")} />}
          {lead.pass_it_to && <Info label="Pass to" value={lead.pass_it_to} />}
        </div>
        {lead.context && <Info label="Context" value={lead.context} multiline />}
        {lead.marketing_notes && <Info label="Marketing notes" value={lead.marketing_notes} multiline />}
        {auth.primaryRole !== "cs" && lead.original_lead_link && (
          <a href={lead.original_lead_link} target="_blank" rel="noreferrer" className="inline-flex items-center text-sm text-primary hover:text-primary-glow transition-colors">
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />Original post
          </a>
        )}

        {auth.primaryRole !== "cs" && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={launchProfile}>
              <Globe className="h-3.5 w-3.5 mr-1.5" />
              {linkedProfile.data ? "Launch Incogniton profile" : "Link & launch Incogniton profile"}
            </Button>
            {linkedProfile.data && (
              <span className="text-[11px] text-muted-foreground">→ {linkedProfile.data.profile_name}</span>
            )}
          </div>
        )}

        <div className="border-t border-border pt-5 space-y-4">
          <div>
            <Label className="block mb-1.5 text-[11.5px] uppercase tracking-wide text-muted-foreground font-medium">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PIPELINE_STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s] ?? s.replace(/_/g, " ")}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="block mb-1.5 text-[11.5px] uppercase tracking-wide text-muted-foreground font-medium">Follow-up at</Label>
            <Input type="datetime-local" value={followup} onChange={(e) => setFollowup(e.target.value)} />
          </div>
          <div>
            <Label className="block mb-1.5 text-[11.5px] uppercase tracking-wide text-muted-foreground font-medium">Comment</Label>
            <Textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Write what happened in your own words — e.g. customer is interested, already done by someone else, asked to message later…"
            />
            <p className="text-[11px] text-muted-foreground mt-1.5">Free-text comment. Appended to the history when you save.</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Close</Button>
            <Button onClick={save} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Save</Button>
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
                  <div className="text-[11px] text-muted-foreground tabular-nums">{n.by} · {new Date(n.at).toLocaleString()}</div>
                  <div className="text-[13px] mt-1 whitespace-pre-wrap leading-relaxed">{n.text}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {linkOpen && (
        <LinkProfileModal
          leadId={lead.id}
          onClose={() => setLinkOpen(false)}
          onLinked={async (profileId) => {
            setLinkOpen(false);
            await linkedProfile.refetch();
            try {
              await launchIncognitonProfile(profileId);
              toast.success("Profile opened in Incogniton");
            } catch (e) {
              toast.error((e as Error).message || INCOG_UNREACHABLE);
            }
          }}
        />
      )}
    </div>
  );
}

function LinkProfileModal({ leadId, onClose, onLinked }: { leadId: string; onClose: () => void; onLinked: (profileId: string) => void }) {
  const auth = useAuth();
  const [profileId, setProfileId] = useState("");
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [platform, setPlatform] = useState("");
  const [busy, setBusy] = useState(false);

  const groups = useQuery({
    queryKey: ["incog_groups"],
    queryFn: async () => {
      const { data } = await supabase.from("incogniton_profiles").select("group_name");
      return Array.from(new Set((data ?? []).map((r) => r.group_name).filter((g): g is string => !!g))).sort();
    },
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.from("incogniton_profiles").insert({
        incogniton_profile_id: profileId.trim(),
        profile_name: name.trim() || `Profile ${profileId.trim().slice(0, 6)}`,
        group_name: group.trim() || null,
        platform: platform.trim() || null,
        linked_lead_id: leadId,
        last_launched_at: new Date().toISOString(),
        created_by: auth.user?.id,
      });
      if (error) throw error;
      onLinked(profileId.trim());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <form onSubmit={save} className="bg-card w-full max-w-md rounded-lg border p-6 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">Link Incogniton profile</h2>
        <p className="text-[12.5px] text-muted-foreground">
          Find the profile in Incogniton, copy its ID, and link it to this lead. It will be launched right away.
        </p>
        <div>
          <Label className="block mb-1.5">Incogniton Profile ID</Label>
          <Input value={profileId} onChange={(e) => setProfileId(e.target.value)} required autoFocus className="font-mono text-[12.5px]" />
        </div>
        <div>
          <Label className="block mb-1.5">Profile name (optional)</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Auto-generated if blank" />
        </div>
        <div>
          <Label className="block mb-1.5">Group</Label>
          <Input
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            list="incog-group-suggestions"
            placeholder="Type or pick existing"
          />
          <datalist id="incog-group-suggestions">
            {(groups.data ?? []).map((g) => <option key={g} value={g} />)}
          </datalist>
        </div>
        <div>
          <Label className="block mb-1.5">Platform</Label>
          <Input value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="e.g. Facebook, Instagram" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy || !profileId.trim()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Save & launch
          </Button>
        </div>
      </form>
    </div>
  );
}

function Info({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-medium">{label}</div>
      <div className={cn("text-[13px] mt-1 leading-relaxed", multiline ? "whitespace-pre-wrap" : "")}>{value}</div>
    </div>
  );
}
