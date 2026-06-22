import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Edit3,
  Loader2,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  Trash2,
  CalendarDays,
  Plus,
  X,
  ImagePlus,
  Star,
} from "lucide-react";
import { formatDistanceToNow, format, startOfDay, endOfDay, subDays } from "date-fns";
import { toast } from "sonner";
import { friendlyError } from "@/lib/error-messages";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { supabase } from "@/integrations/supabase/client";
import { formatPhone } from "@/lib/crm-lite";
import type { ForwardedStatus } from "@/lib/crm-types";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/lead-statuses";
import { cn } from "@/lib/utils";
import type { DateRange } from "react-day-picker";

export const Route = createFileRoute("/app/forwarded-leads")({ component: Page });

const BUCKET = "lead-attachments";
const MAX_IMAGES = 20;
const MAX_BYTES = 10 * 1024 * 1024;

type Row = {
  id: string;
  customer_name: string;
  customer_number: string;
  customer_number_2: string | null;
  extra_numbers: string[];
  service: string | null;
  context: string | null;
  pass_it_to: string | null;
  main_area: string | null;
  sub_area: string | null;
  original_lead_link: string | null;
  post_text: string | null;
  requirement_2: string | null;
  is_important: boolean;
  images: string[];
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

  const listProfiles = useQuery({
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

  const profilesByUserId = useMemo(() => {
    const map = new Map<string, { full_name: string; email: string }>();
    for (const p of listProfiles.data ?? []) {
      map.set(p.user_id, p);
    }
    return map;
  }, [listProfiles.data]);

  const [query, setQuery] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<"all" | "pending" | ForwardedStatus>("all");
  const [forwardedByFilter, setForwardedByFilter] = useState("all");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
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
          "id, customer_name, customer_number, customer_number_2, extra_numbers, service, context, pass_it_to, main_area, sub_area, original_lead_link, post_text, requirement_2, is_important, images, cs_status, assigned_at, updated_at, created_by",
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
    const rFrom = dateRange?.from ? startOfDay(dateRange.from).getTime() : null;
    const rTo = dateRange?.to
      ? endOfDay(dateRange.to).getTime()
      : dateRange?.from
        ? endOfDay(dateRange.from).getTime()
        : null;

    return (list.data ?? []).filter((r) => {
      if (outcomeFilter === "pending" && r.cs_status !== "new") return false;
      if (outcomeFilter !== "all" && outcomeFilter !== "pending" && r.cs_status !== outcomeFilter)
        return false;
      if (isAdmin && forwardedByFilter !== "all" && r.created_by !== forwardedByFilter)
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
      if (rFrom !== null && rTo !== null) {
        const t = new Date(r.assigned_at).getTime();
        if (t < rFrom || t > rTo) return false;
      }
      return true;
    });
  }, [list.data, query, outcomeFilter, forwardedByFilter, isAdmin, dateRange]);

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

        {isAdmin && (
          <Select value={forwardedByFilter} onValueChange={setForwardedByFilter}>
            <SelectTrigger className="h-9 w-[180px] text-[12px]">
              <SelectValue placeholder="Forwarded by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All users</SelectItem>
              {listProfiles.data?.map((p) => (
                <SelectItem key={p.user_id} value={p.user_id}>
                  {p.full_name || p.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Date Range Filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 text-[12px]">
              <CalendarDays className="h-3.5 w-3.5 mr-1.5" />
              {dateRange?.from
                ? dateRange.to
                  ? `${format(dateRange.from, "MMM d")} – ${format(dateRange.to, "MMM d")}`
                  : format(dateRange.from, "MMM d, yyyy")
                : "Date range"}
              {dateRange?.from && (
                <span
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDateRange(undefined);
                  }}
                  className="ml-1.5 -mr-1 h-4 w-4 grid place-items-center rounded-full hover:bg-destructive/20"
                >
                  <X className="h-3 w-3" />
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <div className="flex items-center gap-1.5 p-2 border-b border-border">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[11px]"
                onClick={() => setDateRange({ from: new Date(), to: new Date() })}
              >
                Today
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[11px]"
                onClick={() => setDateRange({ from: subDays(new Date(), 6), to: new Date() })}
              >
                7d
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[11px]"
                onClick={() => setDateRange({ from: subDays(new Date(), 29), to: new Date() })}
              >
                30d
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[11px]"
                onClick={() => setDateRange(undefined)}
              >
                Clear
              </Button>
            </div>
            <Calendar
              mode="range"
              selected={dateRange}
              onSelect={setDateRange}
              numberOfMonths={2}
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>

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
        <ForwardedTable rows={filtered} onEdit={setEditing} auth={auth} qc={qc} profilesByUserId={profilesByUserId} isAdmin={isAdmin} />
      )}

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
  profilesByUserId,
  isAdmin,
}: {
  rows: Row[];
  onEdit: (row: Row) => void;
  auth: ReturnType<typeof useAuth>;
  qc: ReturnType<typeof useQueryClient>;
  profilesByUserId?: Map<string, { full_name: string; email: string }>;
  isAdmin?: boolean;
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
            {isAdmin && <th className="text-left px-3 py-2 font-medium">Forwarded By</th>}
            <th className="text-right px-3 py-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border hover:bg-surface/50">
              <td className="px-3 py-2 font-medium">
                {r.customer_name}
                {r.is_important && (
                  <span className="ml-1.5 inline-flex items-center gap-0.5 text-[9.5px] text-warning font-semibold">
                    <Star className="h-2.5 w-2.5 fill-warning" /> PINNED
                  </span>
                )}
              </td>
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
              {isAdmin && (
                <td className="px-3 py-2 text-muted-foreground">
                  {r.created_by
                    ? (profilesByUserId?.get(r.created_by)?.full_name ||
                      profilesByUserId?.get(r.created_by)?.email ||
                      "-")
                    : "-"}
                </td>
              )}
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

// ─── Extra Phone Row (same as submit-lead form) ──────────────────────────────
function ExtraPhoneRow({
  index,
  value,
  onChange,
  onRemove,
}: {
  index: number;
  value: string;
  onChange: (next: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="border border-border/60 rounded-md p-3 bg-muted/20 space-y-2 mt-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
          Additional Contact {index + 1}
        </Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onRemove}
        >
          <X className="mr-1 h-3.5 w-3.5" />
          Remove
        </Button>
      </div>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Extra phone number"
      />
    </div>
  );
}

// ─── Forwarded Lead Form (matches manual lead form) ──────────────────────────
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
  const [service, setService] = useState(lead.service ?? "");
  const [passItTo, setPassItTo] = useState(lead.pass_it_to ?? "");
  const [mainArea, setMainArea] = useState(lead.main_area ?? "");
  const [subArea, setSubArea] = useState(lead.sub_area ?? "");
  const [context, setContext] = useState(lead.context ?? "");
  const [exactText, setExactText] = useState(lead.post_text ?? "");
  const [reference, setReference] = useState(lead.requirement_2 ?? "Scraping Manually");
  const [isImportant, setIsImportant] = useState(lead.is_important);
  const [postLink, setPostLink] = useState(lead.original_lead_link ?? "");

  // Additional contacts
  const initialExtras = useMemo(() => {
    const extras: string[] = [];
    if (lead.customer_number_2) extras.push(lead.customer_number_2);
    if (Array.isArray(lead.extra_numbers)) {
      for (const n of lead.extra_numbers) {
        if (n && n !== lead.customer_number_2) extras.push(n);
      }
    }
    return extras;
  }, [lead]);
  const [extraPhones, setExtraPhones] = useState<string[]>(initialExtras);

  // Images
  const [existingImages, setExistingImages] = useState<string[]>(
    Array.isArray(lead.images) ? lead.images : [],
  );
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  function addFiles(picked: FileList | null) {
    if (!picked) return;
    const incoming = Array.from(picked);
    const valid: File[] = [];
    for (const f of incoming) {
      if (!f.type.startsWith("image/")) {
        toast.error(`${f.name} is not an image`);
        continue;
      }
      if (f.size > MAX_BYTES) {
        toast.error(`${f.name} is larger than 10 MB`);
        continue;
      }
      valid.push(f);
    }
    setNewFiles((prev) => {
      const merged = [...prev, ...valid];
      if (merged.length + existingImages.length > MAX_IMAGES) {
        toast.error(`Maximum ${MAX_IMAGES} images`);
        return merged.slice(0, MAX_IMAGES - existingImages.length);
      }
      return merged;
    });
    if (fileRef.current) fileRef.current.value = "";
  }

  async function uploadNewImages(): Promise<string[]> {
    if (newFiles.length === 0 || !auth.user?.id) return [];
    const urls: string[] = [];
    for (const f of newFiles) {
      const ext = f.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${auth.user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, f, { cacheControl: "3600", upsert: false, contentType: f.type });
      if (error) throw new Error(`Upload failed: ${error.message}`);
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      urls.push(pub.publicUrl);
    }
    return urls;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !number.trim()) {
      toast.error("Name and number are required");
      return;
    }
    setSaving(true);
    try {
      const uploadedUrls = await uploadNewImages();
      const allImages = [...existingImages, ...uploadedUrls];

      const cleanedExtras = extraPhones
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
        .map((p) => formatPhone(p) || p);

      const { error } = await supabase
        .from("qualified_leads")
        .update({
          customer_name: name.trim(),
          customer_number: number.trim(),
          customer_number_2: cleanedExtras[0] ?? null,
          extra_numbers: cleanedExtras,
          service: service.trim() || null,
          pass_it_to: passItTo.trim() || null,
          main_area: mainArea.trim() || null,
          sub_area: subArea.trim() || null,
          context: context.trim() || null,
          post_text: exactText.trim() || null,
          requirement_2: reference.trim() || null,
          original_lead_link: postLink.trim() || null,
          is_important: isImportant,
          images: allImages,
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
        {/* Customer Name */}
        <div>
          <Label className="mb-1.5 block">
            Customer name <span className="text-destructive">*</span>
          </Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        </div>
        {/* Customer Number */}
        <div>
          <Label className="mb-1.5 block">
            Customer number <span className="text-destructive">*</span>
          </Label>
          <Input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            maxLength={40}
            inputMode="tel"
            required
          />
        </div>
        {/* Area */}
        <div>
          <Label className="mb-1.5 block">Main Area</Label>
          <Input value={mainArea} onChange={(e) => setMainArea(e.target.value)} maxLength={160} />
        </div>
        {/* Sub Area */}
        <div>
          <Label className="mb-1.5 block">Sub Area</Label>
          <Input value={subArea} onChange={(e) => setSubArea(e.target.value)} maxLength={160} />
        </div>
        {/* Service */}
        <div>
          <Label className="mb-1.5 block">Service</Label>
          <Input
            value={service}
            onChange={(e) => setService(e.target.value)}
            placeholder="e.g. Plumbing"
            maxLength={120}
          />
        </div>
        {/* Reference */}
        <div>
          <Label className="mb-1.5 block">Reference</Label>
          <Select value={reference} onValueChange={(val) => setReference(val)}>
            <SelectTrigger>
              <SelectValue placeholder="Select reference" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Scraping Manually">Scraping Manually</SelectItem>
              <SelectItem value="Listing">Listing</SelectItem>
              <SelectItem value="Posting">Posting</SelectItem>
              <SelectItem value="FB">Facebook (FB)</SelectItem>
              <SelectItem value="SEO">SEO</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {/* Pass it to */}
        <div>
          <Label className="mb-1.5 block">Pass it to</Label>
          <Input
            value={passItTo}
            onChange={(e) => setPassItTo(e.target.value)}
            placeholder="CS rep / team"
            maxLength={120}
          />
        </div>
        {/* Original Post Link */}
        <div>
          <Label className="mb-1.5 block">Original post link</Label>
          <Input
            value={postLink}
            onChange={(e) => setPostLink(e.target.value)}
            placeholder="https://..."
          />
        </div>
        {/* Exact Customer Text */}
        <div className="col-span-1 md:col-span-2">
          <Label className="mb-1.5 block">Exact Customer Text</Label>
          <Input
            value={exactText}
            onChange={(e) => setExactText(e.target.value)}
            placeholder="Exact text or request from customer"
            maxLength={500}
          />
        </div>
        {/* Context */}
        <div className="col-span-1 md:col-span-2">
          <Label className="mb-1.5 block">Context / Conversation</Label>
          <Textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={3}
            placeholder="Enter context or conversation notes..."
            maxLength={2000}
          />
        </div>

        {/* Additional Contacts */}
        <div className="col-span-1 md:col-span-2">
          <Label className="mb-1.5 block">Additional Contacts</Label>
          <div className="space-y-2">
            {extraPhones.map((val, idx) => (
              <ExtraPhoneRow
                key={idx}
                index={idx}
                value={val}
                onChange={(next) =>
                  setExtraPhones((prev) => prev.map((p, i) => (i === idx ? next : p)))
                }
                onRemove={() => setExtraPhones((prev) => prev.filter((_, i) => i !== idx))}
              />
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 mt-2"
              onClick={() => setExtraPhones((prev) => [...prev, ""])}
              disabled={extraPhones.length >= 5}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              {extraPhones.length >= 5 ? "Limit reached (Max 5)" : "Add Additional Contact"}
            </Button>
          </div>
        </div>
      </div>

      {/* Mark as Important */}
      <div className="flex items-center gap-2 p-3 rounded-md border border-warning/40 bg-warning/5">
        <Checkbox
          id="edit-important"
          checked={isImportant}
          onCheckedChange={(v) => setIsImportant(v === true)}
        />
        <Label htmlFor="edit-important" className="flex items-center gap-1.5 cursor-pointer text-sm">
          <Star
            className={cn(
              "h-3.5 w-3.5",
              isImportant ? "fill-warning text-warning" : "text-muted-foreground",
            )}
          />
          Mark as important — pin to top of CS pipeline
        </Label>
      </div>

      {/* Attachments */}
      <div>
        <Label className="mb-1.5 block">
          Attachments{" "}
          <span className="text-xs text-muted-foreground font-normal">
            (up to {MAX_IMAGES} images, 10 MB each)
          </span>
        </Label>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
        <div className="flex flex-wrap gap-3 items-start">
          {/* Existing images */}
          {existingImages.map((url) => (
            <div
              key={url}
              className="relative h-20 w-20 rounded-md overflow-hidden border border-border bg-muted"
            >
              <img src={url} alt="Existing attachment" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => setExistingImages((prev) => prev.filter((u) => u !== url))}
                className="absolute top-0.5 right-0.5 h-5 w-5 grid place-items-center rounded-full bg-background/90 hover:bg-destructive hover:text-destructive-foreground transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {/* New files */}
          {newFiles.map((f, idx) => (
            <div
              key={`${f.name}-${idx}`}
              className="relative h-20 w-20 rounded-md overflow-hidden border border-border bg-muted"
            >
              <img src={URL.createObjectURL(f)} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => setNewFiles((prev) => prev.filter((_, i) => i !== idx))}
                className="absolute top-0.5 right-0.5 h-5 w-5 grid place-items-center rounded-full bg-background/90 hover:bg-destructive hover:text-destructive-foreground transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {existingImages.length + newFiles.length < MAX_IMAGES && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="h-20 w-20 rounded-md border-2 border-dashed border-border hover:border-primary hover:bg-primary/5 transition-colors grid place-items-center text-muted-foreground hover:text-primary"
            >
              <div className="flex flex-col items-center gap-1 text-[11px]">
                <ImagePlus className="h-4 w-4" />
                Add
              </div>
            </button>
          )}
        </div>
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
