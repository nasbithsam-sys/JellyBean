import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
import { Loader2, MessageSquarePlus, ExternalLink, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Constants } from "@/integrations/supabase/types";

export const Route = createFileRoute("/app/cs-leads")({ component: Page });

type Lead = {
  id: string; customer_name: string; customer_number: string;
  context: string | null; pass_it_to: string | null;
  main_area: string | null; sub_area: string | null;
  marketing_notes: string | null; original_lead_link: string | null;
  cs_status: string; cs_notes: Array<{ at: string; by: string; text: string }>;
  followup_at: string | null; assigned_at: string;
};

const STATUSES = Constants.public.Enums.cs_status;

function Page() {
  const auth = useAuth();
  return (
    <div>
      <PageHeader title="CS Leads" description="Work your assigned customer leads." />
      <PageBody>
        <RoleGate allow={["admin", "cs", "marketing"]} current={auth.primaryRole}>
          <Inner />
        </RoleGate>
      </PageBody>
    </div>
  );
}

const GROUPS: Record<string, string[]> = {
  Active: ["new", "called", "messaged", "follow_up", "interested"],
  Won: ["converted", "closed_won"],
  Lost: ["closed_lost"],
};

function Inner() {
  const qc = useQueryClient();
  const [group, setGroup] = useState<keyof typeof GROUPS>("Active");
  const [opened, setOpened] = useState<Lead | null>(null);

  const list = useQuery({
    queryKey: ["cs_leads", group],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qualified_leads")
        .select("*")
        .in("cs_status", GROUPS[group] as never)
        .order("assigned_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as unknown as Lead[];
    },
  });

  return (
    <div className="space-y-4">
      <Tabs value={group} onValueChange={(v) => setGroup(v as keyof typeof GROUPS)}>
        <TabsList>
          {Object.keys(GROUPS).map((g) => <TabsTrigger key={g} value={g}>{g}</TabsTrigger>)}
        </TabsList>
      </Tabs>

      <div className="bg-card border rounded-lg overflow-hidden">
        <table className="crm-table">
          <thead>
            <tr><th>Customer</th><th>Phone</th><th>Area</th><th>Status</th><th>Follow-up</th><th>Assigned</th><th className="text-right">Actions</th></tr>
          </thead>
          <tbody>
            {list.isLoading && <tr><td colSpan={7} className="text-center py-6 text-muted-foreground">Loading…</td></tr>}
            {list.data?.length === 0 && <tr><td colSpan={7} className="text-center py-6 text-muted-foreground">No leads in this view.</td></tr>}
            {list.data?.map((l) => (
              <tr key={l.id}>
                <td className="font-medium">{l.customer_name}</td>
                <td><a href={`tel:${l.customer_number}`} className="inline-flex items-center text-primary text-sm hover:underline"><Phone className="h-3 w-3 mr-1" />{l.customer_number}</a></td>
                <td className="text-sm">{[l.main_area, l.sub_area].filter(Boolean).join(" · ") || "—"}</td>
                <td><StatusBadge status={l.cs_status} /></td>
                <td className="text-xs whitespace-nowrap">{l.followup_at ? formatDistanceToNow(new Date(l.followup_at), { addSuffix: true }) : "—"}</td>
                <td className="text-xs text-muted-foreground whitespace-nowrap">{formatDistanceToNow(new Date(l.assigned_at), { addSuffix: true })}</td>
                <td className="text-right whitespace-nowrap">
                  <Button size="sm" variant="outline" onClick={() => setOpened(l)}><MessageSquarePlus className="h-3.5 w-3.5 mr-1" />Open</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {opened && <LeadDrawer lead={opened} onClose={() => setOpened(null)} onSaved={() => { setOpened(null); qc.invalidateQueries({ queryKey: ["cs_leads"] }); }} />}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "converted" || status === "closed_won" ? "bg-success/15 text-success"
      : status === "closed_lost" ? "bg-destructive/15 text-destructive"
        : status === "follow_up" || status === "interested" ? "bg-primary/15 text-primary"
          : "bg-muted text-muted-foreground";
  return <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${tone}`}>{status.replace(/_/g, " ")}</span>;
}

function LeadDrawer({ lead, onClose, onSaved }: { lead: Lead; onClose: () => void; onSaved: () => void }) {
  const auth = useAuth();
  const [status, setStatus] = useState(lead.cs_status);
  const [note, setNote] = useState("");
  const [followup, setFollowup] = useState(lead.followup_at ? lead.followup_at.slice(0, 16) : "");
  const [busy, setBusy] = useState(false);
  const notes = useMemo(() => Array.isArray(lead.cs_notes) ? lead.cs_notes : [], [lead.cs_notes]);

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
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose}>
      <div className="bg-card w-full max-w-lg h-full overflow-y-auto border-l p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Customer</div>
          <h2 className="text-xl font-semibold">{lead.customer_name}</h2>
          <a href={`tel:${lead.customer_number}`} className="text-sm text-primary inline-flex items-center mt-1"><Phone className="h-3 w-3 mr-1" />{lead.customer_number}</a>
        </div>

        {(lead.main_area || lead.sub_area) && (
          <Info label="Area" value={[lead.main_area, lead.sub_area].filter(Boolean).join(" · ")} />
        )}
        {lead.pass_it_to && <Info label="Pass to" value={lead.pass_it_to} />}
        {lead.context && <Info label="Context" value={lead.context} multiline />}
        {lead.marketing_notes && <Info label="Marketing notes" value={lead.marketing_notes} multiline />}
        {lead.original_lead_link && (
          <a href={lead.original_lead_link} target="_blank" rel="noreferrer" className="inline-flex items-center text-sm text-primary"><ExternalLink className="h-3 w-3 mr-1" />Original post</a>
        )}

        <div className="border-t pt-4 space-y-3">
          <div>
            <Label className="block mb-1.5">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, " ")}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="block mb-1.5">Follow-up at</Label>
            <Input type="datetime-local" value={followup} onChange={(e) => setFollowup(e.target.value)} />
          </div>
          <div>
            <Label className="block mb-1.5">Add a note</Label>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Conversation summary, next steps…" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Close</Button>
            <Button onClick={save} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Save</Button>
          </div>
        </div>

        {notes.length > 0 && (
          <div className="border-t pt-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">History</div>
            <div className="space-y-3">
              {[...notes].reverse().map((n, i) => (
                <div key={i} className="bg-muted/40 rounded-md p-3">
                  <div className="text-xs text-muted-foreground">{n.by} · {new Date(n.at).toLocaleString()}</div>
                  <div className="text-sm mt-1 whitespace-pre-wrap">{n.text}</div>
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
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm mt-0.5 ${multiline ? "whitespace-pre-wrap" : ""}`}>{value}</div>
    </div>
  );
}
