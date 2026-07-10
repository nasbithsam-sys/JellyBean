import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useRef, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, Edit3, Loader2, MapPin, Phone, RefreshCw, Search, Trash2, ImagePlus, Plus, X, Lock, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ExternalLink } from "lucide-react";
import { useSignedLeadUrls } from "@/lib/lead-attachments";
import { formatDistanceToNow, startOfDay, endOfDay } from "date-fns";
import { toast } from "sonner";
import { friendlyError } from "@/lib/error-messages";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { formatPhone, normalizePhone } from "@/lib/crm-lite";
import { checkDuplicatePhone } from "@/lib/raw-leads.functions";
import { DuplicateLeadDialog, type DuplicateMatchPreview } from "@/components/duplicate-lead-dialog";
import {
  LeadForm,
  formatPhoneInput,
  uploadLeadImages,
  type LeadFormValues,
  type LeadReferenceMode,
} from "@/components/lead-form";
import type { ForwardedStatus } from "@/lib/crm-types";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/lead-statuses";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/forwarded-leads")({ component: Page });

type Row = {
  id: string;
  customer_name: string;
  customer_number: string;
  customer_number_2: string | null;
  service: string | null;
  context: string | null;
  pass_it_to: string | null;
  main_area: string | null;
  sub_area: string | null;
  original_lead_link: string | null;
  cs_status: ForwardedStatus | string;
  assigned_at: string;
  assigned_by: string | null;
  updated_at: string;
  created_by: string | null;
  extra_numbers: string[];
  images: string[];
  post_text: string | null;
  reference: string | null;
  is_important: boolean;
  pinned_important: boolean;
  submitted_by_role: string | null;
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
          allow={["admin", "sub_admin", "maturing", "acc_handler", "facebook", "seo"]}
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
  const [forwardedByFilter, setForwardedByFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  const dbSearch = useMemo(() => {
    return debouncedQuery.replace(/[,"'%\\]/g, ""); // Strip characters that break postgrest .or()
  }, [debouncedQuery]);

  const [page, setPage] = useState(1);
  const PAGE_SIZE = 500;

  const dbDateFrom = useMemo(() => {
    return dateFrom ? startOfDay(new Date(dateFrom)).toISOString() : null;
  }, [dateFrom]);

  const dbDateTo = useMemo(() => {
    return dateTo ? endOfDay(new Date(dateTo)).toISOString() : null;
  }, [dateTo]);

  useEffect(() => {
    setPage(1);
  }, [dbDateFrom, dbDateTo, forwardedByFilter, outcomeFilter, dbSearch]);

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

  const allProfiles = useQuery({
    queryKey: ["all_profiles"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, full_name, email");

      if (error) throw error;
      return data ?? [];
    },
  });

  const profilesById = useMemo(() => {
    const map = new Map<string, { full_name: string | null; email: string }>();
    for (const p of allProfiles.data ?? []) {
      map.set(p.user_id, { full_name: p.full_name, email: p.email });
    }
    return map;
  }, [allProfiles.data]);

  const list = useQuery({
    queryKey: ["forwarded-leads", auth.user?.id, isAdmin, { page, dbDateFrom, dbDateTo, forwardedByFilter, outcomeFilter, dbSearch }],
    enabled: !!auth.user?.id,
    queryFn: async () => {
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let q = supabase
        .from("qualified_leads")
        .select(
          "id, customer_name, customer_number, customer_number_2, extra_numbers, service, context, post_text, pass_it_to, main_area, sub_area, original_lead_link, reference, is_important, pinned_important, images, submitted_by_role, cs_status, assigned_at, assigned_by, updated_at, created_by",
        )
        .order("updated_at", { ascending: false })
        .range(from, to);

      if (dbDateFrom) q = q.gte("assigned_at", dbDateFrom);
      if (dbDateTo) q = q.lte("assigned_at", dbDateTo);

      if (outcomeFilter === "pending") {
        q = q.eq("cs_status", "new");
      } else if (outcomeFilter !== "all") {
        q = q.eq("cs_status", outcomeFilter);
      }

      if (forwardedByFilter !== "all") {
        q = q.or(`created_by.eq.${forwardedByFilter},assigned_by.eq.${forwardedByFilter}`);
      }

      if (dbSearch) {
        const s = `%${dbSearch}%`;
        q = q.or(
          `customer_name.ilike.${s},customer_number.ilike.${s},service.ilike.${s},context.ilike.${s},pass_it_to.ilike.${s},main_area.ilike.${s},sub_area.ilike.${s}`,
        );
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
    placeholderData: keepPreviousData,
  });

  const totalCount = useQuery({
    queryKey: ["forwarded-leads-count", auth.user?.id, isAdmin, { dbDateFrom, dbDateTo, forwardedByFilter, outcomeFilter, dbSearch }],
    enabled: !!auth.user?.id,
    queryFn: async () => {
      let q = supabase
        .from("qualified_leads")
        .select("id", { count: "exact", head: true });

      if (dbDateFrom) q = q.gte("assigned_at", dbDateFrom);
      if (dbDateTo) q = q.lte("assigned_at", dbDateTo);

      if (outcomeFilter === "pending") {
        q = q.eq("cs_status", "new");
      } else if (outcomeFilter !== "all") {
        q = q.eq("cs_status", outcomeFilter);
      }

      if (forwardedByFilter !== "all") {
        q = q.or(`created_by.eq.${forwardedByFilter},assigned_by.eq.${forwardedByFilter}`);
      }

      if (dbSearch) {
        const s = `%${dbSearch}%`;
        q = q.or(
          `customer_name.ilike.${s},customer_number.ilike.${s},service.ilike.${s},context.ilike.${s},pass_it_to.ilike.${s},main_area.ilike.${s},sub_area.ilike.${s}`,
        );
      }

      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
    placeholderData: keepPreviousData,
  });

  const totalPages = Math.max(1, Math.ceil((totalCount.data ?? 0) / PAGE_SIZE));

  const filtered = useMemo(() => {
    return list.data ?? [];
  }, [list.data]);

  return (
    <div className="space-y-4">
      <div className="crm-section-panel">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
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
      </div>

      <div className="crm-toolbar-panel">
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
        {isAdmin && (
          <Select value={forwardedByFilter} onValueChange={setForwardedByFilter}>
            <SelectTrigger className="h-9 w-[190px] text-[12px]">
              <SelectValue placeholder="Forwarded by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All forwarders</SelectItem>
              {(allProfiles.data ?? [])
                .slice()
                .sort((a, b) =>
                  (a.full_name || a.email).localeCompare(b.full_name || b.email),
                )
                .map((profile) => (
                  <SelectItem key={profile.user_id} value={profile.user_id}>
                    {profile.full_name || profile.email}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        )}
        <div className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-2 h-9">
          <CalendarRange className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            aria-label="Forwarded from date"
            className="h-7 w-[132px] border-0 bg-transparent px-1 text-[12px] shadow-none"
          />
          <span className="text-[11px] text-muted-foreground">to</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            min={dateFrom || undefined}
            aria-label="Forwarded to date"
            className="h-7 w-[132px] border-0 bg-transparent px-1 text-[12px] shadow-none"
          />
        </div>
        {(dateFrom || dateTo || forwardedByFilter !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9"
            onClick={() => {
              setDateFrom("");
              setDateTo("");
              setForwardedByFilter("all");
            }}
          >
            Clear filters
          </Button>
        )}
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
      </div>

      {list.error && (
        <div className="text-[12.5px] text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
          {(list.error as Error).message}
        </div>
      )}

      {list.isLoading && !list.data ? (
        <div className="crm-section-panel">
          <div className="glass-card p-16 text-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Loading...
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="crm-section-panel">
          <div className="glass-card p-10 text-center text-[12.5px] text-muted-foreground">
            <Search className="h-5 w-5 mx-auto mb-2 opacity-50" />
            No forwarded leads found for the current filter.
          </div>
        </div>
      ) : (
        <>
          <div className="crm-section-panel">
            <ForwardedTable
              rows={filtered}
              onEdit={setEditing}
              auth={auth}
              qc={qc}
              profilesById={profilesById}
              isAdmin={isAdmin}
            />
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 py-4">
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2"
                onClick={() => setPage(1)}
                disabled={page <= 1 || list.isFetching}
                title="First Page"
              >
                <ChevronsLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3 text-[12px]"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || list.isFetching}
              >
                <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                Previous
              </Button>
              <span className="text-[12px] text-muted-foreground tabular-nums px-2">
                Page {page} of {totalPages}
                {totalCount.data != null && (
                  <span className="ml-1 text-[11px]">({totalCount.data} total)</span>
                )}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3 text-[12px]"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || list.isFetching}
              >
                Next
                <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2"
                onClick={() => setPage(totalPages)}
                disabled={page >= totalPages || list.isFetching}
                title="Last Page"
              >
                <ChevronsRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </>
      )}

      <Dialog open={!!editing} onOpenChange={(open) => {
        if (!open) {
          if (isDirty && !window.confirm("You have unsaved changes. Are you sure you want to close?")) return;
          setEditing(null);
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined} onInteractOutside={(e) => e.preventDefault()}>
          <DialogTitle className="sr-only">Edit Forwarded Lead</DialogTitle>
          {editing && (
            <UnifiedForwardedLeadForm
              lead={editing}
              onDirtyChange={setIsDirty}
              forwardedBy={
                (() => {
                  const id = editing.created_by ?? editing.assigned_by;
                  const profile = id ? profilesById.get(id) : null;
                  return profile?.full_name || profile?.email || "Unknown user";
                })()
              }
              onCancel={() => { setEditing(null); setIsDirty(false); }}
              onSaved={() => {
                setEditing(null);
                setIsDirty(false);
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
    <div className="crm-surface-card p-5">
      <div className="crm-kicker">{label}</div>
      <div className="crm-card-value mt-1 tabular-nums">{value ?? "-"}</div>
      {sub && <div className="crm-card-label mt-1">{sub}</div>}
    </div>
  );
}

function ForwardedTable({
  rows,
  onEdit,
  auth,
  qc,
  profilesById,
  isAdmin,
}: {
  rows: Row[];
  onEdit: (row: Row) => void;
  auth: ReturnType<typeof useAuth>;
  qc: ReturnType<typeof useQueryClient>;
  profilesById: Map<string, { full_name: string | null; email: string }>;
  isAdmin: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="crm-data-table">
        <thead className="bg-surface text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-2 font-medium">Customer</th>
            <th className="text-left px-3 py-2 font-medium">Phone</th>
            <th className="text-left px-3 py-2 font-medium">Area</th>
            <th className="text-left px-3 py-2 font-medium">Details</th>
            <th className="text-left px-3 py-2 font-medium">Post Link</th>
            <th className="text-left px-3 py-2 font-medium">Outcome</th>
            {isAdmin && <th className="text-left px-3 py-2 font-medium">Forwarded by</th>}
            <th className="text-left px-3 py-2 font-medium">Forwarded</th>
            <th className="text-left px-3 py-2 font-medium">Updated</th>
            <th className="text-right px-3 py-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="crm-data-row border-t border-border">
              <td className="px-3 py-2 font-semibold text-foreground">{r.customer_name}</td>
              <td className="px-3 py-2">
                <a
                  href={`tel:${r.customer_number}`}
                  className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary"
                >
                  <Phone className="h-3 w-3" /> {formatPhone(r.customer_number)}
                </a>
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {r.sub_area && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {r.sub_area}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-muted-foreground max-w-[260px]">
                <div className="truncate">
                  {[r.service, r.pass_it_to].filter(Boolean).join(" / ")}
                </div>
                {r.context && <div className="truncate text-[11.5px] crm-muted-text">{r.context}</div>}
              </td>
              <td className="px-3 py-2">
                {r.original_lead_link ? (
                  <a
                    href={r.original_lead_link}
                    target="_blank"
                    rel="noreferrer noopener"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-primary hover:underline text-[12px] font-medium whitespace-nowrap"
                  >
                    <ExternalLink className="h-3 w-3 shrink-0" />
                    View Post
                  </a>
                ) : null}
              </td>
              <td className="px-3 py-2">
                {r.cs_status === "new" ? (
                  <span className="text-[10.5px] px-2.5 py-1 rounded-full border font-medium bg-surface-hover text-foreground border-border shadow-sm">
                    Pending
                  </span>
                ) : (
                  <span
                    className={cn(
                      "text-[10.5px] px-2.5 py-1 rounded-full border font-medium shadow-sm",
                      STATUS_TONE[r.cs_status] ?? "bg-muted text-muted-foreground border-border",
                    )}
                  >
                    {STATUS_LABEL[r.cs_status] ?? r.cs_status.replace(/_/g, " ")}
                  </span>
                )}
              </td>
              {isAdmin && (
                <td className="px-3 py-2 text-muted-foreground">
                  {r.created_by || r.assigned_by
                    ? (profilesById.get(r.created_by ?? r.assigned_by!)?.full_name ??
                       profilesById.get(r.created_by ?? r.assigned_by!)?.email ??
                       "Unknown user")
                    : "-"}
                </td>
              )}
              <td className="px-3 py-2 text-muted-foreground tabular-nums">
                {formatDistanceToNow(new Date(r.assigned_at), { addSuffix: true })}
              </td>
              <td className="px-3 py-2 text-muted-foreground tabular-nums">
                {formatDistanceToNow(new Date(r.updated_at), { addSuffix: true })}
              </td>
              <td className="px-3 py-2">
                <div className="flex justify-end gap-1.5">
                  {isAdmin || r.cs_status === "new" ? (
                    <>
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
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60 italic pr-2" title="Only pending leads can be modified by staff">
                      <Lock className="h-3 w-3" /> Locked
                    </span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UnifiedForwardedLeadForm({
  lead,
  forwardedBy,
  onDirtyChange,
  onCancel,
  onSaved,
}: {
  lead: Row;
  forwardedBy: string;
  onDirtyChange?: (isDirty: boolean) => void;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const auth = useAuth();
  const [saving, setSaving] = useState(false);
  const role = lead.submitted_by_role ?? auth.primaryRole ?? "maturing";
  const referenceMode: LeadReferenceMode =
    role === "facebook" ? "auto-fb" : role === "seo" ? "manual-text" : "manual-dropdown";

  async function save(values: LeadFormValues) {
    const isAdmin = auth.primaryRole === "admin" || auth.primaryRole === "sub_admin";
    if (!isAdmin && lead.cs_status !== "new") {
      toast.error("Only pending leads can be edited.");
      return;
    }
    setSaving(true);
    try {
      const uploadedImages =
        values.files.length > 0 && auth.user?.id
          ? await uploadLeadImages({ files: values.files, userId: auth.user.id, supabase })
          : [];
      const cleanedExtras = (values.extraNumbers ?? [])
        .map((number) => number.trim())
        .filter(Boolean)
        .map((number) => formatPhone(number) || number);
      const { error } = await supabase
        .from("qualified_leads")
        .update({
          customer_name: values.customerName,
          customer_number: formatPhone(values.customerNumber) || values.customerNumber,
          customer_number_2: cleanedExtras[0] ?? null,
          extra_numbers: cleanedExtras,
          service: values.service,
          pass_it_to: role === "facebook" || role === "seo" ? null : values.service,
          main_area: values.area || null,
          sub_area: values.area || null,
          context: values.context,
          post_text: values.exactCustomerText,
          reference: values.reference,
          is_important: lead.pinned_important ? true : values.isImportant,
          images: [...(values.existingImages ?? []), ...uploadedImages],
          original_lead_link: values.originalLeadLink !== undefined ? values.originalLeadLink : lead.original_lead_link,
        } as never)
        .eq("id", lead.id);
      if (error) throw error;
      toast.success("Forwarded lead updated");
      onSaved();
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <LeadForm
      title="Edit forwarded lead"
      submitLabel="Save changes"
      forwardedBy={forwardedBy}
      showAttachments
      areaRequired
      referenceMode={referenceMode}
      initialValues={{
        id: lead.id,
        customerName: lead.customer_name,
        customerNumber: lead.customer_number,
        extraNumbers: lead.extra_numbers ?? [],
        area: lead.main_area || lead.sub_area || "",
        service: lead.service || lead.pass_it_to || "",
        context: lead.context || "",
        exactCustomerText: lead.post_text || lead.context || "",
        reference: lead.reference || undefined,
        isImportant: lead.is_important,
        images: Array.isArray(lead.images) ? (lead.images as string[]) : [],
        originalLeadLink: lead.original_lead_link,
      }}
      submitting={saving}
      onDirtyChange={onDirtyChange}
      onCancel={onCancel}
      onSubmit={save}
    />
  );
}

function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <Label className="block mb-1.5">
        {label}
        {required ? <span className="text-destructive"> (Required)</span> : null}
      </Label>
      {children}
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
  const auth = useAuth();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState(lead.customer_name);
  const [number, setNumber] = useState(lead.customer_number);
  const [extraNumbers, setExtraNumbers] = useState<string[]>(
    Array.isArray(lead.extra_numbers) ? lead.extra_numbers : []
  );
  const [existingImages, setExistingImages] = useState<string[]>(
    Array.isArray(lead.images) ? (lead.images as string[]) : []
  );
  const [files, setFiles] = useState<File[]>([]);
  const [service, setService] = useState(lead.service ?? "");
  const [passItTo, setPassItTo] = useState(lead.pass_it_to ?? "");
  const [mainArea, setMainArea] = useState(lead.main_area ?? "");
  const [subArea, setSubArea] = useState(lead.sub_area ?? "");
  const [context, setContext] = useState(lead.context ?? "");
  const [postLink, setPostLink] = useState(lead.original_lead_link ?? "");
  const [saving, setSaving] = useState(false);

  const checkDuplicate = useServerFn(checkDuplicatePhone);
  const [isCheckingBeforeSubmit, setIsCheckingBeforeSubmit] = useState(false);
  const [showDupConfirm, setShowDupConfirm] = useState(false);
  const [dupConfirmMatches, setDupConfirmMatches] = useState<DuplicateMatchPreview[]>([]);

  function addFiles(picked: FileList | null) {
    if (!picked) return;
    const incoming = Array.from(picked);
    const valid: File[] = [];
    const maxBytes = 10 * 1024 * 1024;
    for (const file of incoming) {
      if (!file.type.startsWith("image/")) {
        toast.error(`${file.name} is not an image`);
        continue;
      }
      if (file.size > maxBytes) {
        toast.error(`${file.name} is larger than 10 MB`);
        continue;
      }
      valid.push(file);
    }
    const combinedLength = existingImages.length + files.length + valid.length;
    if (combinedLength > 20) {
      toast.error("Maximum 20 images limit reached");
      const allowedCount = 20 - (existingImages.length + files.length);
      if (allowedCount > 0) {
        setFiles((prev) => [...prev, ...valid.slice(0, allowedCount)]);
      }
    } else {
      setFiles((prev) => [...prev, ...valid]);
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  function handlePaste(event: React.ClipboardEvent) {
    const items = event.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length === 0) return;
    event.preventDefault();
    const dt = new DataTransfer();
    imageFiles.forEach((file) => dt.items.add(file));
    addFiles(dt.files);
    toast.success(`Pasted ${imageFiles.length} image${imageFiles.length === 1 ? "" : "s"}`);
  }

  async function performSave() {
    setSaving(true);
    try {
      const newUploadedUrls = files.length > 0 && auth.user?.id
        ? await uploadLeadImages({ files, userId: auth.user.id, supabase })
        : [];
      const finalImages = [...existingImages, ...newUploadedUrls];

      const cleanedExtras = extraNumbers
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
        .map((p) => formatPhone(p) || p);

      const { error } = await supabase
        .from("qualified_leads")
        .update({
          customer_name: name.trim(),
          customer_number: formatPhone(number.trim()) || number.trim(),
          customer_number_2: cleanedExtras[0] ?? null,
          extra_numbers: cleanedExtras,
          images: finalImages,
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const isAdmin = auth.primaryRole === "admin" || auth.primaryRole === "sub_admin";
    if (!isAdmin && lead.cs_status !== "new") {
      toast.error("Only pending leads can be edited.");
      return;
    }
    if (!name.trim() || !number.trim()) {
      toast.error("Name and number are required");
      return;
    }
    if (!passItTo.trim()) {
      toast.error("Pass it to is required");
      return;
    }
    
    setIsCheckingBeforeSubmit(true);
    try {
      const phoneDigits = [number, ...extraNumbers]
        .map((p) => normalizePhone(p ?? ""))
        .filter((d) => d.length >= 7);

      if (phoneDigits.length > 0) {
        const results = await Promise.all(
          phoneDigits.map((digits) => checkDuplicate({ data: { phone: digits } }))
        );
        const allMatches = results.flatMap((r) => (r.matches ?? []));
        
        const excludeId = lead.id;
        const seen = new Set<string>([excludeId]);
        const freshMatches = allMatches.filter((m) => {
          if (seen.has(m.id)) return false;
          seen.add(m.id);
          return true;
        });

        if (freshMatches.length > 0) {
          const targetNumber = normalizePhone(number);
          const secondTargetNumbers = extraNumbers.map((n) => normalizePhone(n)).filter((n) => n.length >= 7);
          
          const previewMatches: DuplicateMatchPreview[] = freshMatches.map((match) => {
            let sourceLabel = "Primary number";
            if (
              secondTargetNumbers.length > 0 &&
              (secondTargetNumbers.includes(normalizePhone(match.customer_number)) ||
               (match.customer_number_2 && secondTargetNumbers.includes(normalizePhone(match.customer_number_2))))
            ) {
              sourceLabel = "Additional number";
            }
            return {
              source: sourceLabel,
              match: match as any,
            };
          });

          setDupConfirmMatches(previewMatches);
          setShowDupConfirm(true);
          return;
        }
      }
    } catch (err) {
      // Ignore duplicate check errors and proceed to save
    } finally {
      setIsCheckingBeforeSubmit(false);
    }

    await performSave();
  }

  function continueDespiteDuplicate() {
    setShowDupConfirm(false);
    void performSave();
  }

  return (
    <form onSubmit={submit} onPaste={handlePaste} className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Customer Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </Field>
        <Field label="Customer Number" required>
          <Input
            value={number}
            onChange={(e) => setNumber(formatPhoneInput(e.target.value))}
            maxLength={40}
            inputMode="tel"
          />
        </Field>

        {/* Additional Numbers (Optional, Max 5) */}
        <div className="col-span-1 md:col-span-2 space-y-2.5">
          <Label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Additional Numbers (Optional, Max 5)
          </Label>
          <div className="space-y-2">
            {extraNumbers.map((num, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <Input
                  value={num}
                  onChange={(e) => {
                    const val = e.target.value;
                    setExtraNumbers((prev) => prev.map((n, i) => (i === idx ? formatPhoneInput(val) : n)));
                  }}
                  maxLength={40}
                  placeholder={`Additional number ${idx + 1}`}
                  inputMode="tel"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => {
                    setExtraNumbers((prev) => prev.filter((_, i) => i !== idx));
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {extraNumbers.length < 5 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => setExtraNumbers((prev) => [...prev, ""])}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add another number
              </Button>
            )}
          </div>
        </div>

        <Field label="Service">
          <Input value={service} onChange={(e) => setService(e.target.value)} maxLength={120} />
        </Field>
        <Field label="Pass It To" required>
          <Input
            value={passItTo}
            onChange={(e) => setPassItTo(e.target.value)}
            maxLength={120}
          />
        </Field>
        <Field label="Main Area">
          <Input value={mainArea} onChange={(e) => setMainArea(e.target.value)} maxLength={160} />
        </Field>
        <Field label="Sub Area">
          <Input value={subArea} onChange={(e) => setSubArea(e.target.value)} maxLength={160} />
        </Field>
      </div>

      <Field label="Context">
        <Textarea value={context} onChange={(e) => setContext(e.target.value)} rows={3} />
      </Field>

      <Field label="Original Post Link">
        <Input
          value={postLink}
          onChange={(e) => setPostLink(e.target.value)}
          placeholder="https://..."
        />
      </Field>

      {/* Attachments Section */}
      <Field label="Attachments (Optional, Max 20)">
        <div className="space-y-3">
          <div className="text-[11px] text-muted-foreground">
            Up to 20 images total. Paste with Ctrl/Cmd+V is supported.
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
          />
          <div className="flex flex-wrap gap-3 items-start">
            {/* Existing Images from DB */}
            {existingImages.map((ref, idx) => {
              const url = existingSignedUrls[idx] ?? ref;
              const isVideo = /\.(mp4|webm|mov)(\?.*)?$/i.test(ref);
              return (
                <div
                  key={`existing-${idx}`}
                  className={cn(
                    "relative rounded-md overflow-hidden border border-border bg-muted",
                    isVideo ? "h-32 w-48" : "h-20 w-20"
                  )}
                >
                  {isVideo ? (
                    <video
                      src={url}
                      className="h-full w-full object-cover"
                      controls
                      controlsList="nodownload"
                      preload="metadata"
                    />
                  ) : (
                    <img
                      src={url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setExistingImages((prev) => prev.filter((_, i) => i !== idx));
                    }}
                    className="crm-motion absolute top-0.5 right-0.5 h-5 w-5 grid place-items-center rounded-full bg-background/90 hover:bg-destructive hover:text-destructive-foreground z-10"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
            {/* New Files */}
            {files.map((file, idx) => {
              const isVideo = file.type.startsWith("video/");
              return (
                <div
                  key={`new-${idx}`}
                  className={cn(
                    "relative rounded-md overflow-hidden border border-border bg-muted",
                    isVideo ? "h-32 w-48" : "h-20 w-20"
                  )}
                >
                  {isVideo ? (
                    <video
                      src={URL.createObjectURL(file)}
                      className="h-full w-full object-cover"
                      controls
                      controlsList="nodownload"
                      preload="metadata"
                    />
                  ) : (
                    <img
                      src={URL.createObjectURL(file)}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  )}
                <button
                  type="button"
                  onClick={() => {
                    setFiles((prev) => prev.filter((_, i) => i !== idx));
                  }}
                  className="crm-motion absolute top-0.5 right-0.5 h-5 w-5 grid place-items-center rounded-full bg-background/90 hover:bg-destructive hover:text-destructive-foreground z-10"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              );
            })}
            {existingImages.length + files.length < 20 && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="crm-motion h-20 w-20 rounded-md border-2 border-dashed border-border hover:border-primary hover:bg-primary/5 grid place-items-center text-muted-foreground hover:text-primary"
              >
                <div className="flex flex-col items-center gap-1 text-[11px]">
                  <ImagePlus className="h-4 w-4" />
                  Add
                </div>
              </button>
            )}
          </div>
        </div>
      </Field>

      <div className="flex justify-end gap-2 pt-2 border-t border-border">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving || isCheckingBeforeSubmit}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving || isCheckingBeforeSubmit}>
          {saving || isCheckingBeforeSubmit ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {saving ? "Saving..." : "Checking duplicate..."}
            </>
          ) : (
            "Save Changes"
          )}
        </Button>
      </div>

      <DuplicateLeadDialog
        open={showDupConfirm}
        onOpenChange={setShowDupConfirm}
        matches={dupConfirmMatches}
        isConfirming={saving}
        onCancel={() => setShowDupConfirm(false)}
        onConfirm={continueDespiteDuplicate}
      />
    </form>
  );
}

async function deleteForwardedLead(
  lead: Row,
  auth: ReturnType<typeof useAuth>,
  qc: ReturnType<typeof useQueryClient>,
) {
  const isAdmin = auth.primaryRole === "admin" || auth.primaryRole === "sub_admin";
  if (!isAdmin && lead.cs_status !== "new") {
    toast.error("Only pending leads can be deleted.");
    return;
  }
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
