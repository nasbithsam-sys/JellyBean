import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, ExternalLink, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Constants } from "@/integrations/supabase/types";

export const Route = createFileRoute("/app/raw-leads")({ component: Page });

type Status = "new" | "qualified" | "cancelled";

function Page() {
  const auth = useAuth();
  return (
    <div>
      <PageHeader title="Raw Leads" description="Review captured social posts and qualify them for CS." />
      <PageBody>
        <RoleGate allow={["admin", "marketing"]} current={auth.primaryRole}>
          <Inner />
        </RoleGate>
      </PageBody>
    </div>
  );
}

function Inner() {
  const [status, setStatus] = useState<Status>("new");
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
  const [qualify, setQualify] = useState<null | (typeof leads.data extends (infer T)[] | undefined ? T : never)>(null);
  const [cancelling, setCancelling] = useState<null | string>(null);

  return (
    <div className="space-y-4">
      <Tabs value={status} onValueChange={(v) => setStatus(v as Status)}>
        <TabsList>
          <TabsTrigger value="new">New</TabsTrigger>
          <TabsTrigger value="qualified">Qualified</TabsTrigger>
          <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="bg-card border rounded-lg overflow-hidden">
        <table className="crm-table">
          <thead>
            <tr>
              <th>Poster</th>
              <th>Post</th>
              <th>Area</th>
              <th>Captured</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {leads.isLoading && <tr><td colSpan={5} className="text-center text-muted-foreground py-6">Loading…</td></tr>}
            {leads.data?.length === 0 && <tr><td colSpan={5} className="text-center text-muted-foreground py-6">No leads.</td></tr>}
            {leads.data?.map((l) => (
              <tr key={l.id}>
                <td className="font-medium">{l.poster_name ?? "—"}</td>
                <td className="max-w-md"><div className="line-clamp-2 text-sm">{l.post_text ?? "—"}</div></td>
                <td className="text-sm">{[l.account_area, l.sub_area].filter(Boolean).join(" · ") || "—"}</td>
                <td className="text-xs text-muted-foreground whitespace-nowrap">{formatDistanceToNow(new Date(l.captured_at), { addSuffix: true })}</td>
                <td className="text-right space-x-2 whitespace-nowrap">
                  {l.lead_link && (
                    <a href={l.lead_link} target="_blank" rel="noreferrer" className="inline-flex items-center text-xs text-primary hover:underline">
                      <ExternalLink className="h-3 w-3 mr-1" /> Open
                    </a>
                  )}
                  {status === "new" && (
                    <>
                      <Button size="sm" onClick={() => setQualify(l)}><CheckCircle2 className="h-3.5 w-3.5 mr-1" />Qualify</Button>
                      <Button size="sm" variant="outline" onClick={() => setCancelling(l.id)}><XCircle className="h-3.5 w-3.5 mr-1" />Cancel</Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {qualify && <QualifyDialog lead={qualify} onClose={() => setQualify(null)} onDone={() => { setQualify(null); qc.invalidateQueries({ queryKey: ["raw_leads"] }); }} />}
      {cancelling && <CancelDialog leadId={cancelling} onClose={() => setCancelling(null)} onDone={() => { setCancelling(null); qc.invalidateQueries({ queryKey: ["raw_leads"] }); }} />}
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
    <Modal onClose={onClose} title="Qualify lead">
      <form onSubmit={submit} className="space-y-3">
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
    <Modal onClose={onClose} title="Cancel lead">
      <div className="space-y-3">
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
          <Button onClick={submit} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Cancel lead</Button>
        </div>
      </div>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-card w-full max-w-lg rounded-lg border p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4">{title}</h2>
        {children}
      </div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex-1"><Label className="block mb-1.5">{label}</Label>{children}</div>;
}
function Row({ children }: { children: React.ReactNode }) { return <div className="flex gap-3">{children}</div>; }
