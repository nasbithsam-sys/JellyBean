import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  formatDistanceToNow,
  format,
  startOfDay,
  endOfDay,
  subDays,
  startOfWeek,
  startOfMonth,
} from "date-fns";
import {
  Loader2,
  Upload,
  X,
  ImagePlus,
  CheckCircle2,
  Plus,
  TrendingUp,
  CalendarDays,
  Send,
  Star,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { DateRange } from "react-day-picker";
import { useServerFn } from "@tanstack/react-start";
import { checkDuplicatePhone } from "@/lib/raw-leads.functions";
import { normalizePhone, formatPhone } from "@/lib/crm-lite";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/app/submit-lead")({ component: Page });

const BUCKET = "lead-attachments";
const MAX_IMAGES = 20;
const MAX_BYTES = 10 * 1024 * 1024;

function Page() {
  const auth = useAuth();
  return (
    <RoleGate
      allow={["facebook", "seo", "admin", "sub_admin", "maturing", "acc_handler"]}
      current={auth.primaryRole}
    >
      <Dashboard />
    </RoleGate>
  );
}

type LeadRow = {
  id: string;
  customer_name: string;
  customer_number: string;
  service: string | null;
  main_area: string | null;
  context: string | null;
  cs_status: string;
  created_at: string;
  images: string[];
};

function Dashboard() {
  const auth = useAuth();
  const role = auth.primaryRole ?? "submitter";
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 29),
    to: new Date(),
  });

  const all = useQuery({
    queryKey: ["my-submitted-leads", auth.user?.id],
    enabled: !!auth.user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qualified_leads")
        .select(
          "id, customer_name, customer_number, service, main_area, context, cs_status, created_at, images",
        )
        .eq("created_by", auth.user!.id)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as LeadRow[];
    },
  });

  const leads = useMemo(() => all.data ?? [], [all.data]);

  const stats = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const monthStart = startOfMonth(now);
    const inRange = (d: Date, from: Date, to: Date) => d >= from && d <= to;

    let today = 0,
      week = 0,
      month = 0,
      ranged = 0;
    const byStatus: Record<string, number> = {};
    const byDay: Record<string, number> = {};
    const rFrom = range?.from ? startOfDay(range.from) : null;
    const rTo = range?.to ? endOfDay(range.to) : range?.from ? endOfDay(range.from) : null;

    for (const l of leads) {
      const d = new Date(l.created_at);
      if (d >= todayStart) today++;
      if (d >= weekStart) week++;
      if (d >= monthStart) month++;
      if (rFrom && rTo && inRange(d, rFrom, rTo)) {
        ranged++;
        const key = format(d, "yyyy-MM-dd");
        byDay[key] = (byDay[key] ?? 0) + 1;
        byStatus[l.cs_status] = (byStatus[l.cs_status] ?? 0) + 1;
      }
    }

    // build day series for the range
    const series: { date: string; label: string; count: number }[] = [];
    if (rFrom && rTo) {
      const days = Math.min(
        90,
        Math.floor((rTo.getTime() - rFrom.getTime()) / (1000 * 60 * 60 * 24)) + 1,
      );
      for (let i = 0; i < days; i++) {
        const d = new Date(rFrom.getTime() + i * 86400000);
        const key = format(d, "yyyy-MM-dd");
        series.push({ date: key, label: format(d, "MMM d"), count: byDay[key] ?? 0 });
      }
    }
    const max = series.reduce((m, s) => Math.max(m, s.count), 0);
    return { today, week, month, ranged, series, max, byStatus };
  }, [leads, range]);

  const rangeLabel = range?.from
    ? range.to
      ? `${format(range.from, "MMM d")} – ${format(range.to, "MMM d, yyyy")}`
      : format(range.from, "MMM d, yyyy")
    : "Pick a date range";

  return (
    <div>
      <PageHeader
        title="Submissions dashboard"
        description={`Track the leads you sent to CS${role === "facebook" || role === "seo" ? ` as ${role.toUpperCase()}` : ""}.`}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1.5" />
                New lead
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Send a new lead to CS</DialogTitle>
              </DialogHeader>
              <SubmitForm role={role} onDone={() => setOpen(false)} />
            </DialogContent>
          </Dialog>
        }
      />
      <PageBody className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Today" value={stats.today} icon={<Send className="h-4 w-4" />} />
          <StatCard
            label="This week"
            value={stats.week}
            icon={<CalendarDays className="h-4 w-4" />}
          />
          <StatCard
            label="This month"
            value={stats.month}
            icon={<TrendingUp className="h-4 w-4" />}
          />
          <StatCard
            label="All time"
            value={leads.length}
            icon={<CheckCircle2 className="h-4 w-4" />}
          />
        </div>

        <div className="glass-card p-5 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm font-semibold">Leads in range</div>
              <div className="text-xs text-muted-foreground">{rangeLabel}</div>
            </div>
            <div className="flex items-center gap-2">
              <QuickRange
                label="7d"
                onClick={() => setRange({ from: subDays(new Date(), 6), to: new Date() })}
              />
              <QuickRange
                label="30d"
                onClick={() => setRange({ from: subDays(new Date(), 29), to: new Date() })}
              />
              <QuickRange
                label="90d"
                onClick={() => setRange({ from: subDays(new Date(), 89), to: new Date() })}
              />
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm">
                    <CalendarDays className="h-3.5 w-3.5 mr-1.5" />
                    Custom
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="range"
                    selected={range}
                    onSelect={setRange}
                    numberOfMonths={2}
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="flex items-end gap-4">
            <div className="text-3xl font-bold tabular-nums">{stats.ranged}</div>
            <div className="text-xs text-muted-foreground pb-1">leads in selected range</div>
          </div>

          <div className="h-40 flex items-end gap-1 border-b border-border-strong pb-1">
            {stats.series.length === 0 ? (
              <div className="text-xs text-muted-foreground self-center mx-auto">
                Pick a date range to see daily trend.
              </div>
            ) : (
              stats.series.map((s) => {
                const h = stats.max > 0 ? (s.count / stats.max) * 100 : 0;
                return (
                  <div
                    key={s.date}
                    className="flex-1 group relative flex flex-col items-center justify-end h-full"
                  >
                    <div
                      className="w-full bg-primary/80 hover:bg-primary rounded-t transition-colors min-h-[2px]"
                      style={{ height: `${h}%` }}
                      title={`${s.label}: ${s.count}`}
                    />
                  </div>
                );
              })
            )}
          </div>
          {stats.series.length > 0 && (
            <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
              <span>{stats.series[0].label}</span>
              <span>{stats.series[stats.series.length - 1].label}</span>
            </div>
          )}

          {Object.keys(stats.byStatus).length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
              {Object.entries(stats.byStatus).map(([k, v]) => (
                <div
                  key={k}
                  className="text-[11px] px-2.5 py-1 rounded-full bg-muted border border-border"
                >
                  <span className="uppercase tracking-wide text-muted-foreground mr-1.5">{k}</span>
                  <span className="font-semibold tabular-nums">{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="text-sm font-semibold mb-3">Recent submissions</h2>
          {all.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : leads.length === 0 ? (
            <div className="text-sm text-muted-foreground glass-card p-6 text-center">
              No leads submitted yet. Click <strong>New lead</strong> to send your first one.
            </div>
          ) : (
            <div className="space-y-2">
              {leads.slice(0, 30).map((l) => (
                <div key={l.id} className="glass-card p-3 flex items-start gap-3">
                  {Array.isArray(l.images) && l.images.length > 0 ? (
                    <img
                      src={l.images[0]}
                      alt=""
                      className="h-12 w-12 rounded object-cover border border-border shrink-0"
                    />
                  ) : (
                    <div className="h-12 w-12 rounded bg-muted border border-border shrink-0 grid place-items-center text-muted-foreground">
                      <ImagePlus className="h-4 w-4 opacity-50" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-sm truncate">{l.customer_name}</div>
                      <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground">
                        {l.cs_status}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {l.customer_number}
                      {l.service && ` · ${l.service}`}
                      {l.main_area && ` · ${l.main_area}`}
                    </div>
                    <div className="text-[10.5px] text-muted-foreground/70 mt-0.5">
                      {formatDistanceToNow(new Date(l.created_at), { addSuffix: true })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </PageBody>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-[10px] uppercase tracking-[0.18em] font-mono">{label}</span>
        {icon}
      </div>
      <div className="text-2xl font-bold mt-1 tabular-nums">{value}</div>
    </div>
  );
}

function QuickRange({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} className="h-8 px-2.5 text-xs">
      {label}
    </Button>
  );
}

type DuplicatePhoneMatch = {
  id: string;
  customer_name: string;
  customer_number: string;
  customer_number_2: string | null;
  assigned_at: string;
};

function ExtraPhoneRow({
  index,
  value,
  onChange,
  onRemove,
  onDuplicateChange,
}: {
  index: number;
  value: string;
  onChange: (next: string) => void;
  onRemove: () => void;
  onDuplicateChange: (dup: boolean) => void;
}) {
  const checkDuplicate = useServerFn(checkDuplicatePhone);
  const digits = normalizePhone(value);
  const query = useQuery({
    queryKey: ["duplicate-phone", digits],
    enabled: digits.length >= 7,
    queryFn: () => checkDuplicate({ data: { phone: value } }),
    staleTime: 15_000,
  });
  const matches = (query.data?.matches ?? []) as DuplicatePhoneMatch[];
  const hasDup = matches.length > 0;
  useEffect(() => {
    onDuplicateChange(hasDup);
    return () => onDuplicateChange(false);
  }, [hasDup, onDuplicateChange]);

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
        onChange={(e) => onChange(formatPhoneInput(e.target.value))}
        placeholder="Extra phone number"
      />
      {query.isFetching && (
        <p className="text-[10px] text-muted-foreground">Checking duplicates...</p>
      )}
      {hasDup && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
          Duplicate phone number detected in the last 72 hours
          {matches[0]?.customer_name ? `: ${matches[0].customer_name}` : ""}
        </div>
      )}
    </div>
  );
}

function formatPhoneInput(value: string): string {
  const digits = normalizePhone(value);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

function SubmitForm({ role, onDone }: { role: string; onDone: () => void }) {
  const auth = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);
  
  const isFacebookRole = role === "facebook";
  const isSeoRole = role === "seo";
  const isSubmitterRole = isFacebookRole || isSeoRole;

  const [name, setName] = useState("");
  const [service, setService] = useState("");
  const [area, setArea] = useState("");
  const [number, setNumber] = useState("");
  const [passItTo, setPassItTo] = useState("");
  const [context, setContext] = useState("");
  const [exactText, setExactText] = useState("");
  const [important, setImportant] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Reference for Manual Lead dropdown / SEO text field
  const [reference, setReference] = useState(() => {
    if (role === "seo") return "";
    return "Scraping Manually";
  });

  // Additional Contacts (unlimited)
  const [extraPhones, setExtraPhones] = useState<string[]>([]);
  const [extraDuplicates, setExtraDuplicates] = useState<boolean[]>([]);

  // Primary number duplicate check
  const checkDuplicate = useServerFn(checkDuplicatePhone);
  const numberDigits = normalizePhone(number);
  const duplicatePrimary = useQuery({
    queryKey: ["duplicate-phone", numberDigits],
    enabled: numberDigits.length >= 7,
    queryFn: () => checkDuplicate({ data: { phone: number } }),
    staleTime: 15_000,
  });
  const primaryMatches = (duplicatePrimary.data?.matches ?? []) as DuplicatePhoneMatch[];
  const hasExtraDup = extraDuplicates.some(Boolean);
  const duplicateMessage =
    primaryMatches.length > 0
      ? `Duplicate phone number detected in the last 72 hours${primaryMatches[0]?.customer_name ? `: ${primaryMatches[0].customer_name}` : ""}`
      : hasExtraDup
        ? `Duplicate phone number detected in extra numbers (last 72 hours)`
        : null;

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
    setFiles((prev) => {
      const merged = [...prev, ...valid];
      if (merged.length > MAX_IMAGES) {
        toast.error(`Maximum ${MAX_IMAGES} images`);
        return merged.slice(0, MAX_IMAGES);
      }
      return merged;
    });
    if (fileRef.current) fileRef.current.value = "";
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function uploadImages(): Promise<string[]> {
    if (files.length === 0 || !auth.user?.id) return [];
    const urls: string[] = [];
    for (const f of files) {
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
    if (!auth.user?.id) return;
    
    // Basic verification
    if (!name.trim() || !number.trim()) {
      toast.error("Customer name and number are required");
      return;
    }
    
    if (isSeoRole) {
      if (!service.trim() || !context.trim() || !exactText.trim() || !reference.trim()) {
        toast.error("Customer name, Contact, Service, Conversation, Exact Customer Text, and Reference are required");
        return;
      }
    } else if (isFacebookRole) {
      if (!area.trim() || !service.trim() || !context.trim() || !exactText.trim()) {
        toast.error("Name, Number, Area, Service, Context, and Exact Customer Text are required");
        return;
      }
    } else {
      if (!area.trim() || !service.trim() || !context.trim() || !exactText.trim() || !passItTo.trim() || !reference.trim()) {
        toast.error("Customer name, Customer number, Area, Service, Context, Exact Customer Text, Pass it to, and Reference are required");
        return;
      }
    }
    
    if (duplicateMessage) {
      toast.error(duplicateMessage);
      return;
    }

    setSubmitting(true);
    try {
      const imageUrls = await uploadImages();

      const cleanedExtras = extraPhones
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
        .map((p) => formatPhone(p) || p);

      let finalContext = context.trim();
      let finalMainArea = area.trim() || null;
      let finalSubArea = area.trim() || null;
      let finalService = service.trim() || null;
      let finalPassItTo = isSubmitterRole ? null : passItTo.trim() || null;
      let finalReference = reference.trim();

      if (isFacebookRole) {
        finalReference = "FB";
      }

      // Format Context by prefixing metadata
      const formattedMetadata = [
        `Reference: ${finalReference}`,
        finalMainArea ? `Address: ${finalMainArea}` : "",
      ].filter(Boolean).join("\n");
      
      finalContext = `${formattedMetadata}\n\nContext:\n${context.trim()}`;

      const { error } = await supabase.from("qualified_leads").insert({
        customer_name: name.trim(),
        customer_number: formatPhone(number.trim()) || number.trim(),
        customer_number_2: cleanedExtras[0] ?? null,
        extra_numbers: cleanedExtras,
        service: finalService,
        main_area: finalMainArea,
        sub_area: finalSubArea,
        pass_it_to: finalPassItTo,
        context: finalContext,
        post_text: exactText.trim() || null,
        requirement_2: finalReference,
        images: imageUrls,
        submitted_by_role: role,
        is_important: important,
        created_by: auth.user.id,
        assigned_by: auth.user.id,
        cs_status: "new",
      } as never);
      if (error) throw error;
      await supabase.from("activity_logs").insert({
        actor_id: auth.user.id,
        actor_name:
          auth.profile?.full_name ?? auth.profile?.username ?? auth.profile?.email ?? null,
        actor_role: auth.primaryRole,
        action: "lead.submitted_to_cs",
        entity_type: "qualified_lead",
        metadata: {
          customer_name: name.trim(),
          customer_number: number.trim(),
          area: area.trim() || null,
          submitted_by_role: role,
        },
      });
      toast.success("Lead sent to CS");
      qc.invalidateQueries({ queryKey: ["my-submitted-leads"] });
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) imageFiles.push(f);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      const dt = new DataTransfer();
      imageFiles.forEach((f) => dt.items.add(f));
      addFiles(dt.files);
      toast.success(`Pasted ${imageFiles.length} image${imageFiles.length === 1 ? "" : "s"}`);
    }
  }

  const passItToMissing = !isSubmitterRole && !passItTo.trim();
  const seoMissing = isSeoRole && (!name.trim() || !number.trim() || !service.trim() || !context.trim() || !exactText.trim() || !reference.trim());
  const fbMissing = isFacebookRole && (!name.trim() || !number.trim() || !area.trim() || !service.trim() || !context.trim() || !exactText.trim());
  const manualMissing = !isSubmitterRole && (!name.trim() || !number.trim() || !area.trim() || !service.trim() || !context.trim() || !exactText.trim() || !passItTo.trim() || !reference.trim());

  const isFormInvalid = seoMissing || fbMissing || manualMissing;

  return (
    <form onSubmit={submit} onPaste={handlePaste} className="space-y-4">
      {isSeoRole ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label className="mb-1.5 block">
              Customer name <span className="text-destructive">*</span>
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={120}
            />
          </div>
          <div>
            <Label className="mb-1.5 block">
              Contact <span className="text-destructive">*</span>
            </Label>
            <Input
              value={number}
              onChange={(e) => setNumber(formatPhoneInput(e.target.value))}
              required
              maxLength={40}
              inputMode="tel"
            />
          </div>
          <div>
            <Label className="mb-1.5 block">Address (Area)</Label>
            <Input
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="e.g. 123 Main St"
              maxLength={160}
            />
          </div>
          <div>
            <Label className="mb-1.5 block">
              Service <span className="text-destructive">*</span>
            </Label>
            <Input
              value={service}
              onChange={(e) => setService(e.target.value)}
              placeholder="e.g. Plumbing"
              required
              maxLength={120}
            />
          </div>
          <div>
            <Label className="mb-1.5 block">
              Reference <span className="text-destructive">*</span>
            </Label>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. Google Search"
              required
              maxLength={120}
            />
          </div>
          <div>
            <Label className="mb-1.5 block">
              Exact Customer Text <span className="text-destructive">*</span>
            </Label>
            <Input
              value={exactText}
              onChange={(e) => setExactText(e.target.value)}
              placeholder="Exact text or request"
              required
              maxLength={500}
            />
          </div>
          <div className="col-span-1 md:col-span-2">
            <Label className="mb-1.5 block">
              Conversation <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={3}
              placeholder="Enter conversation notes..."
              required
              maxLength={2000}
            />
          </div>
          <div className="col-span-1 md:col-span-2">
            {duplicateMessage && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                {duplicateMessage}
              </div>
            )}
          </div>
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
                  onRemove={() => {
                    setExtraPhones((prev) => prev.filter((_, i) => i !== idx));
                    setExtraDuplicates((prev) => prev.filter((_, i) => i !== idx));
                  }}
                  onDuplicateChange={(dup) =>
                    setExtraDuplicates((prev) => {
                      const next = [...prev];
                      while (next.length <= idx) next.push(false);
                      next[idx] = dup;
                      return next;
                    })
                  }
                />
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 mt-2"
                onClick={() => setExtraPhones((prev) => [...prev, ""])}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add Additional Contact
              </Button>
            </div>
          </div>
        </div>
      ) : isFacebookRole ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label className="mb-1.5 block">
              Customer name <span className="text-destructive">*</span>
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={120}
            />
          </div>
          <div>
            <Label className="mb-1.5 block">
              Contact <span className="text-destructive">*</span>
            </Label>
            <Input
              value={number}
              onChange={(e) => setNumber(formatPhoneInput(e.target.value))}
              required
              maxLength={40}
              inputMode="tel"
            />
          </div>
          <div>
            <Label className="mb-1.5 block">
              Area <span className="text-destructive">*</span>
            </Label>
            <Input
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="e.g. Area name"
              required
              maxLength={160}
            />
          </div>
          <div>
            <Label className="mb-1.5 block">
              Service <span className="text-destructive">*</span>
            </Label>
            <Input
              value={service}
              onChange={(e) => setService(e.target.value)}
              placeholder="e.g. Plumbing"
              required
              maxLength={120}
            />
          </div>
          <div className="col-span-1 md:col-span-2">
            <Label className="mb-1.5 block">
              Exact Customer Text <span className="text-destructive">*</span>
            </Label>
            <Input
              value={exactText}
              onChange={(e) => setExactText(e.target.value)}
              placeholder="Exact text or request"
              required
              maxLength={500}
            />
          </div>
          <div className="col-span-1 md:col-span-2">
            <Label className="mb-1.5 block">
              Context <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={3}
              placeholder="Enter context notes..."
              required
              maxLength={2000}
            />
          </div>
          <div className="col-span-1 md:col-span-2">
            {duplicateMessage && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                {duplicateMessage}
              </div>
            )}
          </div>
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
                  onRemove={() => {
                    setExtraPhones((prev) => prev.filter((_, i) => i !== idx));
                    setExtraDuplicates((prev) => prev.filter((_, i) => i !== idx));
                  }}
                  onDuplicateChange={(dup) =>
                    setExtraDuplicates((prev) => {
                      const next = [...prev];
                      while (next.length <= idx) next.push(false);
                      next[idx] = dup;
                      return next;
                    })
                  }
                />
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 mt-2"
                onClick={() => setExtraPhones((prev) => [...prev, ""])}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add Additional Contact
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label className="mb-1.5 block">
              Customer name <span className="text-destructive">*</span>
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={120}
            />
          </div>
          <div>
            <Label className="mb-1.5 block">
              Customer number <span className="text-destructive">*</span>
            </Label>
            <Input
              value={number}
              onChange={(e) => setNumber(formatPhoneInput(e.target.value))}
              required
              maxLength={40}
              inputMode="tel"
            />
          </div>
          <div>
            <Label className="mb-1.5 block">
              Area <span className="text-destructive">*</span>
            </Label>
            <Input
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="e.g. Area name"
              required
              maxLength={160}
            />
          </div>
          <div>
            <Label className="mb-1.5 block">
              Service <span className="text-destructive">*</span>
            </Label>
            <Input
              value={service}
              onChange={(e) => setService(e.target.value)}
              placeholder="e.g. Plumbing"
              required
              maxLength={120}
            />
          </div>
          <div>
            <Label className="mb-1.5 block">
              Reference <span className="text-destructive">*</span>
            </Label>
            <Select value={reference} onValueChange={(val) => setReference(val)}>
              <SelectTrigger>
                <SelectValue placeholder="Select reference" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Scraping Manually">Scraping Manually</SelectItem>
                <SelectItem value="Listing">Listing</SelectItem>
                <SelectItem value="Posting">Posting</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1.5 block">
              Pass it to <span className="text-destructive">*</span>
            </Label>
            <Input
              value={passItTo}
              onChange={(e) => setPassItTo(e.target.value)}
              placeholder="CS rep / team"
              maxLength={120}
              required
            />
          </div>
          <div className="col-span-1 md:col-span-2">
            <Label className="mb-1.5 block">
              Exact Customer Text <span className="text-destructive">*</span>
            </Label>
            <Input
              value={exactText}
              onChange={(e) => setExactText(e.target.value)}
              placeholder="Exact text or request"
              required
              maxLength={500}
            />
          </div>
          <div className="col-span-1 md:col-span-2">
            <Label className="mb-1.5 block">
              Context <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={3}
              placeholder="Enter context notes..."
              required
              maxLength={2000}
            />
          </div>
          <div className="col-span-1 md:col-span-2">
            {duplicateMessage && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                {duplicateMessage}
              </div>
            )}
          </div>
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
                  onRemove={() => {
                    setExtraPhones((prev) => prev.filter((_, i) => i !== idx));
                    setExtraDuplicates((prev) => prev.filter((_, i) => i !== idx));
                  }}
                  onDuplicateChange={(dup) =>
                    setExtraDuplicates((prev) => {
                      const next = [...prev];
                      while (next.length <= idx) next.push(false);
                      next[idx] = dup;
                      return next;
                    })
                  }
                />
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 mt-2"
                onClick={() => setExtraPhones((prev) => [...prev, ""])}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add Additional Contact
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 p-3 rounded-md border border-warning/40 bg-warning/5">
        <Checkbox
          id="important"
          checked={important}
          onCheckedChange={(v) => setImportant(v === true)}
        />
        <Label htmlFor="important" className="flex items-center gap-1.5 cursor-pointer text-sm">
          <Star
            className={cn(
              "h-3.5 w-3.5",
              important ? "fill-warning text-warning" : "text-muted-foreground",
            )}
          />
          Mark as important — pin to top of CS pipeline
        </Label>
      </div>

      <div>
        <Label className="mb-1.5 block">
          Attachments{" "}
          <span className="text-xs text-muted-foreground font-normal">
            (up to {MAX_IMAGES} images, 10 MB each — paste with Ctrl/Cmd+V)
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
          {files.map((f, idx) => (
            <div
              key={`${f.name}-${idx}`}
              className="relative h-20 w-20 rounded-md overflow-hidden border border-border bg-muted"
            >
              <img src={URL.createObjectURL(f)} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removeFile(idx)}
                className="absolute top-0.5 right-0.5 h-5 w-5 grid place-items-center rounded-full bg-background/90 hover:bg-destructive hover:text-destructive-foreground transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {files.length < MAX_IMAGES && (
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
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting || isFormInvalid || !!duplicateMessage}>
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Sending…
            </>
          ) : (
            <>
              <Upload className="h-4 w-4 mr-2" />
              Send to CS
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
