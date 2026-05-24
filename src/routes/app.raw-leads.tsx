import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import type { Tables } from "@/integrations/supabase/types";
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
import { Loader2, ExternalLink, CheckCircle2, XCircle, Search, Filter, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Constants } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/raw-leads")({ component: Page });

type Status = "new" | "qualified" | "cancelled";

function Page() {
  const auth = useAuth();
  return (
    <div>
      <PageHeader
        title="Raw Leads"
        description="Review captured social posts and qualify them for the CS team."
      />
      <PageBody className="!pt-5">
        <RoleGate allow={["admin", "marketing"]} current={auth.primaryRole}>
          <Inner />
        </RoleGate>
      </PageBody>
    </div>
  );
}

const TABS: { value: Status; label: string; tone: string }[] = [
  { value: "new", label: "New", tone: "bg-primary" },
  { value: "qualified", label: "Qualified", tone: "bg-success" },
  { value: "cancelled", label: "Cancelled", tone: "bg-destructive" },
];

function Inner() {
  const [status, setStatus] = useState<Status>("new");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const qc = useQueryClient();

  const leads = useQuery({
    queryKey: ["raw_leads", status],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_leads")
        .select("*")
        .eq("status", status)
        .order("captured_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return leads.data ?? [];
    return (leads.data ?? []).filter((l) =>
      [l.poster_name, l.post_text, l.account_area, l.sub_area].some((f) => f?.toLowerCase().includes(q))
    );
  }, [leads.data, query]);

  const counts = useQuery({
    queryKey: ["raw_leads_counts"],
    queryFn: async () => {
      const get = (s: Status) =>
        supabase.from("raw_leads").select("id", { count: "exact", head: true }).eq("status", s);
      const [n, q, c] = await Promise.all([get("new"), get("qualified"), get("cancelled")]);
      return { new: n.count ?? 0, qualified: q.count ?? 0, cancelled: c.count ?? 0 } as Record<Status, number>;
    },
  });

  const [qualify, setQualify] = useState<Tables<"raw_leads"> | null>(null);
  const [cancelling, setCancelling] = useState<null | string>(null);

  const allChecked = filtered.length > 0 && filtered.every((l) => selected.has(l.id));
  const toggleAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(filtered.map((l) => l.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Pill tabs */}
        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-surface border border-border">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => { setStatus(t.value); setSelected(new Set()); }}
              className={cn(
                "relative px-3 h-8 text-[12.5px] font-medium rounded-md transition-all flex items-center gap-2",
                status === t.value
                  ? "bg-card text-foreground shadow-sm ring-1 ring-border-strong"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", t.tone)} />
              {t.label}
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {counts.data?.[t.value] ?? "·"}
              </span>
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search poster, area, post text…"
            className="w-full h-9 pl-9 pr-3 rounded-md bg-surface border border-border text-[13px] placeholder:text-muted-foreground/70 focus:outline-none"
          />
        </div>

        <Button variant="outline" size="sm" className="h-9">
          <Filter className="h-3.5 w-3.5 mr-1.5" /> Filter
        </Button>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-md bg-primary/10 border border-primary/30 ring-glow animate-fade-in-up">
          <div className="text-[13px] font-medium">
            {selected.size} selected
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              <X className="h-3.5 w-3.5 mr-1" /> Clear
            </Button>
          </div>
        </div>
      )}

      {/* Table workspace */}
      <div className="glass-card overflow-hidden">
        <div className="max-h-[calc(100vh-280px)] overflow-auto">
          <table className="crm-table">
            <thead>
              <tr>
                <th className="w-8 pl-4">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    className="h-3.5 w-3.5 rounded border-border accent-[color:var(--primary)] cursor-pointer"
                  />
                </th>
                <th>Poster</th>
                <th>Post</th>
                <th>Area</th>
                <th>Captured</th>
                <th className="text-right pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {leads.isLoading && (
                <tr><td colSpan={6} className="text-center text-muted-foreground py-12">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading leads…
                </td></tr>
              )}
              {!leads.isLoading && filtered.length === 0 && (
                <tr><td colSpan={6} className="text-center py-16">
                  <div className="text-sm text-muted-foreground">No leads {query ? "match your search" : "in this view"}.</div>
                </td></tr>
              )}
              {filtered.map((l) => (
                <tr key={l.id} data-selected={selected.has(l.id) ? "true" : "false"}>
                  <td className="pl-4">
                    <input
                      type="checkbox"
                      checked={selected.has(l.id)}
                      onChange={() => toggleOne(l.id)}
                      className="h-3.5 w-3.5 rounded border-border accent-[color:var(--primary)] cursor-pointer"
                    />
                  </td>
                  <td className="font-medium text-[13px] text-foreground">{l.poster_name ?? "—"}</td>
                  <td className="max-w-md">
                    <div className="line-clamp-2 text-[12.5px] text-muted-foreground leading-relaxed">{l.post_text ?? "—"}</div>
                  </td>
                  <td>
                    {(l.account_area || l.sub_area) ? (
                      <span className="inline-flex items-center gap-1 text-[11.5px] px-2 py-0.5 rounded-full bg-accent/60 text-accent-foreground border border-border">
                        {[l.account_area, l.sub_area].filter(Boolean).join(" · ")}
                      </span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="text-[11.5px] text-muted-foreground whitespace-nowrap tabular-nums">
                    {formatDistanceToNow(new Date(l.captured_at), { addSuffix: true })}
                  </td>
                  <td className="text-right whitespace-nowrap pr-4">
                    <div className="inline-flex items-center gap-1.5">
                      {l.lead_link && (
                        <a
                          href={l.lead_link}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                          title="Open source"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                      {status === "new" && (
                        <>
                          <Button size="sm" onClick={() => setQualify(l)} className="h-7 px-2.5 text-[12px] shadow-sm hover:shadow-md">
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />Qualify
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setCancelling(l.id)} className="h-7 px-2.5 text-[12px]">
                            <XCircle className="h-3.5 w-3.5 mr-1" />Cancel
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {qualify && <QualifyDialog lead={qualify} onClose={() => setQualify(null)} onDone={() => { setQualify(null); qc.invalidateQueries({ queryKey: ["raw_leads"] }); qc.invalidateQueries({ queryKey: ["raw_leads_counts"] }); }} />}
      {cancelling && <CancelDialog leadId={cancelling} onClose={() => setCancelling(null)} onDone={() => { setCancelling(null); qc.invalidateQueries({ queryKey: ["raw_leads"] }); qc.invalidateQueries({ queryKey: ["raw_leads_counts"] }); }} />}
    </div>
  );
}

function QualifyDialog({ lead, onClose, onDone }: { lead: { id: string; poster_name: string | null; lead_link: string | null; account_area: string | null; sub_area: string | null; post_text: string | null }; onClose: () => void; onDone: () => void }) {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    customer_name: lead.poster_name ?? "",
    customer_number: "",
    context: lead.post_text ?? "",
    pass_it_to: "",
    main_area: lead.account_area ?? "",
    sub_area: lead.sub_area ?? "",
    marketing_notes: "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { error: insErr } = await supabase.from("qualified_leads").insert({
        raw_lead_id: lead.id,
        customer_name: form.customer_name,
        customer_number: form.customer_number,
        context: form.context || null,
        pass_it_to: form.pass_it_to || null,
        main_area: form.main_area || null,
        sub_area: form.sub_area || null,
        marketing_notes: form.marketing_notes || null,
        original_lead_link: lead.lead_link,
        assigned_by: auth.user?.id,
      });
      if (insErr) throw insErr;
      const { error: updErr } = await supabase
        .from("raw_leads")
        .update({ status: "qualified", reviewed_at: new Date().toISOString(), reviewed_by: auth.user?.id })
        .eq("id", lead.id);
      if (updErr) throw updErr;
      await supabase.from("activity_logs").insert({
        actor_id: auth.user?.id, actor_name: auth.profile?.full_name, actor_role: auth.primaryRole,
        action: "lead.qualified", entity_type: "raw_lead", entity_id: lead.id,
      });
      toast.success("Lead qualified and sent to CS");
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title="Qualify lead" subtitle="Send this lead into the CS pipeline.">
      <form onSubmit={submit} className="space-y-3.5">
        <Row><Field label="Customer name"><Input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} required /></Field>
        <Field label="Phone number"><Input value={form.customer_number} onChange={(e) => setForm({ ...form, customer_number: e.target.value })} required /></Field></Row>
        <Row><Field label="Main area"><Input value={form.main_area} onChange={(e) => setForm({ ...form, main_area: e.target.value })} /></Field>
        <Field label="Sub area"><Input value={form.sub_area} onChange={(e) => setForm({ ...form, sub_area: e.target.value })} /></Field></Row>
        <Field label="Pass it to"><Input value={form.pass_it_to} onChange={(e) => setForm({ ...form, pass_it_to: e.target.value })} placeholder="CS rep / team" /></Field>
        <Field label="Context"><Textarea rows={3} value={form.context} onChange={(e) => setForm({ ...form, context: e.target.value })} /></Field>
        <Field label="Marketing notes"><Textarea rows={2} value={form.marketing_notes} onChange={(e) => setForm({ ...form, marketing_notes: e.target.value })} /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Send to CS</Button>
        </div>
      </form>
    </Modal>
  );
}

function CancelDialog({ leadId, onClose, onDone }: { leadId: string; onClose: () => void; onDone: () => void }) {
  const auth = useAuth();
  const [reason, setReason] = useState<string>(Constants.public.Enums.raw_lead_cancel_reason[0]);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      const { error } = await supabase.from("raw_leads")
        .update({ status: "cancelled", cancel_reason: reason as never, reviewed_at: new Date().toISOString(), reviewed_by: auth.user?.id })
        .eq("id", leadId);
      if (error) throw error;
      await supabase.from("activity_logs").insert({
        actor_id: auth.user?.id, actor_name: auth.profile?.full_name, actor_role: auth.primaryRole,
        action: "lead.cancelled", entity_type: "raw_lead", entity_id: leadId, metadata: { reason },
      });
      toast.success("Lead cancelled");
      onDone();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <Modal onClose={onClose} title="Cancel lead" subtitle="Tell us why this lead isn't worth pursuing.">
      <div className="space-y-3.5">
        <Field label="Reason">
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Constants.public.Enums.raw_lead_cancel_reason.map((r) => (
                <SelectItem key={r} value={r} className="capitalize">{r.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Back</Button>
          <Button onClick={submit} disabled={busy} variant="destructive">{busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Cancel lead</Button>
        </div>
      </div>
    </Modal>
  );
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-background/70 backdrop-blur-md grid place-items-center p-4 animate-fade-in-up" onClick={onClose}>
      <div className="glass-card w-full max-w-lg p-6 shadow-lg ring-glow" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="text-[12.5px] text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex-1 min-w-0"><Label className="block mb-1.5 text-[11.5px] uppercase tracking-wide text-muted-foreground font-medium">{label}</Label>{children}</div>;
}
function Row({ children }: { children: React.ReactNode }) { return <div className="flex gap-3">{children}</div>; }
