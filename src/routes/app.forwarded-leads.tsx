import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit3, Loader2, MapPin, Phone, RefreshCw, Search, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { friendlyError } from "@/lib/error-messages";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { formatPhone } from "@/lib/crm-lite";
import type { ForwardedStatus } from "@/lib/crm-types";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/lead-statuses";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/forwarded-leads")({ component: Page });

type Row = {
  id: string;
  customer_name: string;
  customer_number: string;
  service: string | null;
  context: string | null;
  pass_it_to: string | null;
  main_area: string | null;
  sub_area: string | null;
  original_lead_link: string | null;
  cs_status: ForwardedStatus | string;
  assigned_at: string;
  updated_at: string;
  created_by: string | null;
};

const OUTCOME_FILTERS = [
  "undeliver",
  "wrong_number",
  "wrong_lead",
  "already_got_someone",
  "service_provider_himself",
  "converted",
  "need_follow_up",
] as const;

function Page() {
  const auth = useAuth();
  return (
    <div>
      <PageHeader
        title="Forwarded Leads"
        description="Leads you forwarded to CS, and how CS resolved them."
      />
      <PageBody className="!pt-5">
        <RoleGate
          allow={["admin", "sub_admin", "processor", "acc_handler", "facebook", "seo"]}
          current={auth.primaryRole}
        >
          <Inner />
        </RoleGate>
      </PageBody>
    </div>
  );
}

function Inner() {
  const auth = useAuth();
  const qc = useQueryClient();
  const isAdmin = auth.primaryRole === "admin" || auth.primaryRole === "sub_admin";
  const [query, setQuery] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<"all" | "pending" | ForwardedStatus>("all");
  const [editing, setEditing] = useState<Row | null>(null);

  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);

  const sentToday = useQuery({
    queryKey: ["forwarded-sent-today", auth.user?.id],
    enabled: !!auth.user?.id,
    queryFn: async () => {
      let q = supabase
        .from("qualified_leads")
        .select("id", { count: "exact", head: true })
        .gte("assigned_at", todayStart);
      if (!isAdmin) q = q.eq("created_by", auth.user!.id);
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
  });

  const notFoundCount = useQuery({
    queryKey: ["forwarded-not-found", auth.user?.id, isAdmin],
    enabled: !!auth.user?.id,
    queryFn: async () => {
      let q = supabase
        .from("raw_lead_cache")
        .select("row_key", { count: "exact", head: true })
        .eq("category", "not_found");
      if (!isAdmin) q = q.eq("categorized_by", auth.user!.id);
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
  });

  const list = useQuery({
    queryKey: ["forwarded-leads", auth.user?.id, isAdmin],
    enabled: !!auth.user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qualified_leads")
        .select(
          "id, customer_name, customer_number, service, context, pass_it_to, main_area, sub_area, original_lead_link, cs_status, assigned_at, updated_at, created_by",
        )
        .order("updated_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
    placeholderData: keepPreviousData,
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (list.data ?? []).filter((r) => {
      if (outcomeFilter === "pending" && r.cs_status !== "new") return false;
      if (outcomeFilter !== "all" && outcomeFilter !== "pending" && r.cs_status !== outcomeFilter)
        return false;
      if (
        q &&
        ![
          r.customer_name,
          r.customer_number,
          r.service,
          r.context,
          r.pass_it_to,
          r.main_area,
          r.sub_area,
        ].some((f) => f?.toLowerCase().includes(q))
      ) {
        return false;
      }
      return true;
    });
  }, [list.data, query, outcomeFilter]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat
          label="Sent to CS today"
          value={sentToday.data}
          sub={isAdmin ? "All users" : "By you"}
        />
        <Stat label="Total forwarded" value={list.data?.length} />
        <Stat
          label="Pending outcome"
          value={(list.data ?? []).filter((r) => r.cs_status === "new").length}
        />
        <Stat
          label="Number not found"
          value={notFoundCount.data}
          sub={isAdmin ? "All users" : "Checked by you"}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search customer, area, phone..."
            className="w-full h-9 pl-9 pr-3 rounded-md bg-surface border border-border text-[13px] placeholder:text-muted-foreground/70 focus:outline-none"
          />
        </div>
        <Select
          value={outcomeFilter}
          onValueChange={(v) => setOutcomeFilter(v as typeof outcomeFilter)}
        >
          <SelectTrigger className="h-9 w-[180px] text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All outcomes</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            {OUTCOME_FILTERS.map((status) => (
              <SelectItem key={status} value={status}>
                {STATUS_LABEL[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          className="h-9 ml-auto"
          onClick={() => qc.invalidateQueries({ queryKey: ["forwarded-leads"] })}
          disabled={list.isFetching}
        >
          {list.isFetching ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          )}
          Refresh
        </Button>
      </div>

      {list.error && (
        <div className="text-[12.5px] text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
          {(list.error as Error).message}
        </div>
      )}

      {list.isLoading && !list.data ? (
        <div className="glass-card p-16 text-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Loading...
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-10 text-center text-[12.5px] text-muted-foreground">
          <Search className="h-5 w-5 mx-auto mb-2 opacity-50" />
          No forwarded leads found for the current filter.
        </div>
      ) : (
        <ForwardedTable rows={filtered} onEdit={setEditing} auth={auth} qc={qc} />
      )}

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit forwarded lead</DialogTitle>
          </DialogHeader>
          {editing && (
            <ForwardedLeadForm
              lead={editing}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                qc.invalidateQueries({ queryKey: ["forwarded-leads"] });
                qc.invalidateQueries({ queryKey: ["forwarded-sent-today"] });
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value?: number | null; sub?: string }) {
  return (
    <div className="glass-card p-4">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-mono">
        {label}
      </div>
      <div className="text-2xl font-bold mt-1 tabular-nums">{value ?? "-"}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function ForwardedTable({
  rows,
  onEdit,
  auth,
  qc,
}: {
  rows: Row[];
  onEdit: (row: Row) => void;
  auth: ReturnType<typeof useAuth>;
  qc: ReturnType<typeof useQueryClient>;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-[12.5px]">
        <thead className="bg-surface text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-2 font-medium">Customer</th>
            <th className="text-left px-3 py-2 font-medium">Phone</th>
            <th className="text-left px-3 py-2 font-medium">Area</th>
            <th className="text-left px-3 py-2 font-medium">Details</th>
            <th className="text-left px-3 py-2 font-medium">Outcome</th>
            <th className="text-left px-3 py-2 font-medium">Forwarded</th>
            <th className="text-left px-3 py-2 font-medium">Updated</th>
            <th className="text-right px-3 py-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border hover:bg-surface/50">
              <td className="px-3 py-2 font-medium">{r.customer_name}</td>
              <td className="px-3 py-2">
                <a
                  href={`tel:${r.customer_number}`}
                  className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary"
                >
                  <Phone className="h-3 w-3" /> {formatPhone(r.customer_number)}
                </a>
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {(r.main_area || r.sub_area) && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {[r.main_area, r.sub_area].filter(Boolean).join(", ")}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-muted-foreground max-w-[260px]">
                <div className="truncate">
                  {[r.service, r.pass_it_to].filter(Boolean).join(" / ")}
                </div>
                {r.context && <div className="truncate text-[11px]">{r.context}</div>}
              </td>
              <td className="px-3 py-2">
                {r.cs_status === "new" ? (
                  <span className="text-muted-foreground italic">Pending</span>
                ) : (
                  <span
                    className={cn(
                      "text-[10.5px] px-2 py-0.5 rounded-full border font-medium",
                      STATUS_TONE[r.cs_status] ?? "bg-muted text-muted-foreground border-border",
                    )}
                  >
                    {STATUS_LABEL[r.cs_status] ?? r.cs_status.replace(/_/g, " ")}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-muted-foreground tabular-nums">
                {formatDistanceToNow(new Date(r.assigned_at), { addSuffix: true })}
              </td>
              <td className="px-3 py-2 text-muted-foreground tabular-nums">
                {formatDistanceToNow(new Date(r.updated_at), { addSuffix: true })}
              </td>
              <td className="px-3 py-2">
                <div className="flex justify-end gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2"
                    onClick={() => onEdit(r)}
                    title="Edit lead"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 text-destructive hover:text-destructive"
                    onClick={() => void deleteForwardedLead(r, auth, qc)}
                    title="Delete lead"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ForwardedLeadForm({
  lead,
  onCancel,
  onSaved,
}: {
  lead: Row;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(lead.customer_name);
  const [number, setNumber] = useState(lead.customer_number);
  const [service, setService] = useState(lead.service ?? "");
  const [passItTo, setPassItTo] = useState(lead.pass_it_to ?? "");
  const [mainArea, setMainArea] = useState(lead.main_area ?? "");
  const [subArea, setSubArea] = useState(lead.sub_area ?? "");
  const [context, setContext] = useState(lead.context ?? "");
  const [postLink, setPostLink] = useState(lead.original_lead_link ?? "");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !number.trim()) {
      toast.error("Name and number are required");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("qualified_leads")
        .update({
          customer_name: name.trim(),
          customer_number: number.trim(),
          service: service.trim() || null,
          pass_it_to: passItTo.trim() || null,
          main_area: mainArea.trim() || null,
          sub_area: subArea.trim() || null,
          context: context.trim() || null,
          original_lead_link: postLink.trim() || null,
        } as never)
        .eq("id", lead.id);
      if (error) throw error;
      toast.success("Forwarded lead updated");
      onSaved();
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label className="mb-1.5 block">Customer name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        </div>
        <div>
          <Label className="mb-1.5 block">Customer number</Label>
          <Input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            maxLength={40}
            inputMode="tel"
            required
          />
        </div>
        <div>
          <Label className="mb-1.5 block">Service</Label>
          <Input value={service} onChange={(e) => setService(e.target.value)} maxLength={120} />
        </div>
        <div>
          <Label className="mb-1.5 block">Pass it to</Label>
          <Input value={passItTo} onChange={(e) => setPassItTo(e.target.value)} maxLength={120} />
        </div>
        <div>
          <Label className="mb-1.5 block">Main area</Label>
          <Input value={mainArea} onChange={(e) => setMainArea(e.target.value)} maxLength={160} />
        </div>
        <div>
          <Label className="mb-1.5 block">Sub area</Label>
          <Input value={subArea} onChange={(e) => setSubArea(e.target.value)} maxLength={160} />
        </div>
      </div>
      <div>
        <Label className="mb-1.5 block">Context</Label>
        <Textarea value={context} onChange={(e) => setContext(e.target.value)} rows={4} />
      </div>
      <div>
        <Label className="mb-1.5 block">Original post link</Label>
        <Input
          value={postLink}
          onChange={(e) => setPostLink(e.target.value)}
          placeholder="https://..."
        />
      </div>
      <div className="flex justify-end gap-2 pt-2 border-t border-border">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save changes
        </Button>
      </div>
    </form>
  );
}

async function deleteForwardedLead(
  lead: Row,
  auth: ReturnType<typeof useAuth>,
  qc: ReturnType<typeof useQueryClient>,
) {
  if (!confirm(`Delete lead for "${lead.customer_name}"? This cannot be undone.`)) return;
  try {
    const { error } = await supabase.from("qualified_leads").delete().eq("id", lead.id);
    if (error) throw error;
    await supabase.from("activity_logs").insert({
      actor_id: auth.user?.id,
      actor_name: auth.profile?.full_name,
      actor_role: auth.primaryRole,
      action: "forwarded.deleted",
      entity_type: "qualified_lead",
      entity_id: lead.id,
      metadata: { customer_name: lead.customer_name },
    });
    toast.success("Forwarded lead deleted");
    qc.invalidateQueries({ queryKey: ["forwarded-leads"] });
    qc.invalidateQueries({ queryKey: ["forwarded-sent-today"] });
  } catch (err) {
    toast.error(friendlyError(err));
  }
}
