import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
  ImagePlus,
  CheckCircle2,
  Plus,
  TrendingUp,
  CalendarDays,
  Send,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  LeadForm,
  uploadLeadImages,
  type LeadFormValues,
  type LeadReferenceMode,
} from "@/components/lead-form";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { DateRange } from "react-day-picker";
import { formatPhone } from "@/lib/crm-lite";

export const Route = createFileRoute("/app/submit-lead")({ component: Page });

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
  const [isDirty, setIsDirty] = useState(false);
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

    for (const lead of leads) {
      const d = new Date(lead.created_at);
      if (d >= todayStart) today++;
      if (d >= weekStart) week++;
      if (d >= monthStart) month++;
      if (rFrom && rTo && inRange(d, rFrom, rTo)) {
        ranged++;
        const key = format(d, "yyyy-MM-dd");
        byDay[key] = (byDay[key] ?? 0) + 1;
        byStatus[lead.cs_status] = (byStatus[lead.cs_status] ?? 0) + 1;
      }
    }

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
      ? `${format(range.from, "MMM d")} - ${format(range.to, "MMM d, yyyy")}`
      : format(range.from, "MMM d, yyyy")
    : "Pick a date range";

  return (
    <div>
      <PageHeader
        title="Submissions dashboard"
        description={`Track the leads you sent to CS${role === "facebook" || role === "seo" ? ` as ${role.toUpperCase()}` : ""}.`}
        actions={
          <Dialog open={open} onOpenChange={(newOpen) => {
            if (!newOpen && isDirty && !window.confirm("You have unsaved changes. Are you sure you want to close?")) return;
            setOpen(newOpen);
          }}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1.5" />
                New lead
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined} onInteractOutside={(e) => e.preventDefault()}>
              <DialogHeader>
                <DialogTitle>Send a new lead to CS</DialogTitle>
              </DialogHeader>
              <SubmitForm role={role} onDone={() => { setOpen(false); setIsDirty(false); }} onDirtyChange={setIsDirty} />
            </DialogContent>
          </Dialog>
        }
      />
      <PageBody className="space-y-6">
        <div className="crm-section-panel">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard label="Today" value={stats.today} icon={<Send className="h-4 w-4 text-[#1e3a5f]" />} />
            <StatCard
              label="This week"
              value={stats.week}
              icon={<CalendarDays className="h-4 w-4 text-[#3b6fa0]" />}
            />
            <StatCard
              label="This month"
              value={stats.month}
              icon={<TrendingUp className="h-4 w-4 text-[#07B053]" />}
            />
            <StatCard
              label="All time"
              value={leads.length}
              icon={<CheckCircle2 className="h-4 w-4 text-[#d4ae48]" />}
            />
          </div>
        </div>

        <div className="crm-section-panel">
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
              stats.series.map((seriesItem) => {
                const h = stats.max > 0 ? (seriesItem.count / stats.max) * 100 : 0;
                return (
                  <div
                    key={seriesItem.date}
                    className="flex-1 group relative flex flex-col items-center justify-end h-full"
                  >
                    <div
                      className="w-full bg-primary/80 hover:bg-primary rounded-t transition-colors min-h-[2px]"
                      style={{ height: `${h}%` }}
                      title={`${seriesItem.label}: ${seriesItem.count}`}
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
              {Object.entries(stats.byStatus).map(([key, value]) => (
                <div
                  key={key}
                  className="text-[11px] px-2.5 py-1 rounded-full bg-muted border border-border"
                >
                  <span className="uppercase tracking-wide text-muted-foreground mr-1.5">
                    {key}
                  </span>
                  <span className="font-semibold tabular-nums">{value}</span>
                </div>
              ))}
            </div>
          )}
          </div>
        </div>

        <div className="crm-section-panel">
          <h2 className="text-sm font-semibold mb-3">Recent submissions</h2>
          {all.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : leads.length === 0 ? (
            <div className="text-sm text-muted-foreground glass-card p-6 text-center">
              No leads submitted yet. Click <strong>New lead</strong> to send your first one.
            </div>
          ) : (
            <div className="space-y-2">
              {leads.slice(0, 30).map((lead) => (
                <div key={lead.id} className="glass-card p-3 flex items-start gap-3">
                  {Array.isArray(lead.images) && lead.images.length > 0 ? (
                    <img
                      src={lead.images[0]}
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
                      <div className="font-semibold text-sm truncate">{lead.customer_name}</div>
                      <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground">
                        {lead.cs_status}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {lead.customer_number}
                      {lead.service && ` - ${lead.service}`}
                      {lead.main_area && ` - ${lead.main_area}`}
                    </div>
                    <div className="text-[10.5px] text-muted-foreground/70 mt-0.5">
                      {formatDistanceToNow(new Date(lead.created_at), { addSuffix: true })}
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
    <div className="crm-surface-card p-4">
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

function SubmitForm({ role, onDone, onDirtyChange }: { role: string; onDone: () => void; onDirtyChange?: (isDirty: boolean) => void }) {
  const auth = useAuth();
  const qc = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const referenceMode: LeadReferenceMode =
    role === "facebook" ? "auto-fb" : role === "seo" ? "manual-text" : "manual-dropdown";
  const forwardedBy =
    auth.profile?.full_name ?? auth.profile?.username ?? auth.profile?.email ?? "Current user";

  async function submit(values: LeadFormValues) {
    if (!auth.user?.id) return;
    setSubmitting(true);
    try {
      const imageUrls =
        values.files.length > 0
          ? await uploadLeadImages({ files: values.files, userId: auth.user.id, supabase })
          : [];
      const cleanedExtras = (values.extraNumbers || [])
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
        .map((p) => formatPhone(p) || p);
      const { error } = await supabase.from("qualified_leads").insert({
        customer_name: values.customerName,
        customer_number: values.customerNumber,
        customer_number_2: cleanedExtras[0] ?? null,
        extra_numbers: cleanedExtras,
        service: values.service,
        pass_it_to:
          role === "facebook" || role === "seo" ? null : values.service,
        main_area: values.area || null,
        sub_area: values.area || null,
        context: values.context,
        post_text: values.exactCustomerText,
        reference: values.reference,
        images: imageUrls,
        submitted_by_role: role,
        is_important: values.isImportant,
        pinned_important: values.isImportant,
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
          customer_name: values.customerName,
          customer_number: values.customerNumber,
          area: values.area || null,
          reference: values.reference,
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

  return (
    <LeadForm
      title="Send a new lead to CS"
      submitLabel="Send to CS"
      forwardedBy={forwardedBy}
      showAttachments
      areaRequired={role !== "seo"}
      referenceMode={referenceMode}
      submitting={submitting}
      onDirtyChange={onDirtyChange}
      onCancel={onDone}
      onSubmit={submit}
    />
  );
}
