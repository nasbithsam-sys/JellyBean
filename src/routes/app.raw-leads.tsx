import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Loader2,
  ExternalLink,
  RefreshCw,
  Search,
  Settings as Gear,
  Send,
  Eye,
  PhoneOff,
  Download,
  Copy,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";
import { downloadCsv, formatPhone } from "@/lib/crm-lite";
import { analyzeRawLeadsWithAi } from "@/lib/raw-leads-ai.functions";

export const Route = createFileRoute("/app/raw-leads")({ component: Page });

const TABLE = "raw_lead_cache";
const RAW_LEADS_PAGE_SIZE = 200;
type RawLeadCacheUpdate = Database["public"]["Tables"]["raw_lead_cache"]["Update"];

// ── Types ─────────────────────────────────────────────────────────────────────
type Row = Record<string, string> & {
  "Account Name"?: string;
  "Sub Area / Neighborhood"?: string;
  "Posted Date & Time"?: string;
  "Post Text"?: string;
  Lead?: string;
  "Lead Link"?: string;
  "Captured Date (UTC)"?: string;
  "Captured Time (UTC)"?: string;
  "Account Area"?: string;
  "Incog Account"?: string;
};

type Category = "forwarded" | "not_found" | "wrong";
type Action = { category?: Category | null; lead?: "yes" | "no" | null; phone?: string | null };
type CacheEntry = {
  row_key: string;
  data: Row;
  lead: "yes" | "no" | null;
  phone: string | null;
  category: Category | null;
  captured_at: string | null;
  lead_link: string | null;
  sheet_row: number | null;
  assigned_to: string | null;
};
const EMPTY_CACHE_ENTRIES: CacheEntry[] = [];

const AI_LOCK_KEY = "raw_leads.ai_lock";
const AI_LOCK_MAX_AGE_MS = 5 * 60 * 1000;
type AiLockValue = { user_id: string; started_at: string; user_name?: string | null } | null;

const RAW_LEAD_COLUMNS = [
  "Account Name",
  "Sub Area / Neighborhood",
  "Posted Date & Time",
  "Post Text",
  "Lead",
  "Lead Link",
  "Captured Date (UTC)",
  "Captured Time (UTC)",
  "Account Area",
  "Incog Account",
] as const;

// ── Row helpers ───────────────────────────────────────────────────────────────
function keyFor(r: Row) {
  return (
    r["Lead Link"] ||
    `${r["Account Name"] ?? ""}|${r["Posted Date & Time"] ?? ""}|${(r["Post Text"] ?? "").slice(0, 40)}`
  );
}

function parseCapturedAt(r: Row): number {
  const d = r["Captured Date (UTC)"];
  if (!d) return 0;
  const t = Date.parse(d);
  return Number.isNaN(t) ? 0 : t;
}

function capturedIsoFromRow(r: Row): string | null {
  const t = parseCapturedAt(r);
  return t ? new Date(t).toISOString() : null;
}

function leadValueFromRow(r: Row): "yes" | "no" | null {
  const raw = (r.Lead ?? "").trim().toLowerCase();
  if (raw === "yes" || raw === "y" || raw === "true") return "yes";
  if (raw === "no" || raw === "n" || raw === "false") return "no";
  return null;
}

function effectiveLead(r: Row, a: Action | undefined): "yes" | "no" | "" {
  // User override (from Supabase action cache) always wins over the sheet value,
  // otherwise once the sheet says "yes"/"no" the dropdown can never be changed.
  if (a?.lead === "yes" || a?.lead === "no") return a.lead;
  const base = leadValueFromRow(r);
  if (base) return base;
  return "";
}

// ── Supabase cache helpers ────────────────────────────────────────────────────
async function loadCache(limit: number): Promise<CacheEntry[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select(
      "row_key, data, lead, phone, category, captured_at, lead_link, sheet_row, assigned_to",
    )
    .order("captured_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as CacheEntry[];
}

async function patchEntry(row_key: string, patch: Partial<CacheEntry>) {
  const { error } = await supabase
    .from(TABLE)
    .update(patch as RawLeadCacheUpdate)
    .eq("row_key", row_key);
  if (error) throw error;
}

async function loadAiLock(): Promise<AiLockValue> {
  const { data, error } = await supabase
    .from("shared_state")
    .select("value")
    .eq("key", AI_LOCK_KEY)
    .maybeSingle();
  if (error) return null;
  return ((data?.value ?? null) as AiLockValue) ?? null;
}

async function writeAiLock(value: AiLockValue, userId: string | null) {
  const payload = {
    key: AI_LOCK_KEY,
    value: (value ?? {}) as unknown as Record<string, unknown>,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("shared_state")
    .upsert(payload as never, { onConflict: "key" });
  if (error) throw error;
}

// ── Page ──────────────────────────────────────────────────────────────────────
function Page() {
  const auth = useAuth();
  return (
    <div>
      <PageHeader
        title="Raw Leads"
        description="Live feed from your scraper extension. Stored in Supabase — shared across all your devices."
      />
      <PageBody className="!pt-5">
        <RoleGate allow={["admin", "processor", "acc_handler"]} current={auth.primaryRole}>
          <Inner />
        </RoleGate>
      </PageBody>
    </div>
  );
}

function Inner() {
  const auth = useAuth();
  const qc = useQueryClient();
  const analyzeWithAi = useServerFn(analyzeRawLeadsWithAi);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const nextdoorWebhookUrl =
    typeof window === "undefined" ? "" : `${window.location.origin}/api/public/nextdoor-leads`;

  const [tab, setTab] = useState<"new" | "forwarded" | "not_found" | "wrong">("new");
  const [query, setQuery] = useState("");
  const [leadFilter, setLeadFilter] = useState("all");
  const [areaFilter, setAreaFilter] = useState("all");
  const [visibleLimit, setVisibleLimit] = useState(80);
  const [databaseLimit, setDatabaseLimit] = useState(RAW_LEADS_PAGE_SIZE);
  const [detailFor, setDetailFor] = useState<CacheEntry | null>(null);
  const [qualifyFor, setQualifyFor] = useState<CacheEntry | null>(null);
  const [aiPrompt, setAiPrompt] = useState(
    "Mark Yes only if the post is from someone likely needing a service, quote, repair, install, or recommendation. Mark No for ads, providers, spam, general discussion, or posts without buying/service intent.",
  );
  const [aiRunning, setAiRunning] = useState(false);

  // ── Persistent cache from Supabase ─────────────────────────────────────────
  const cacheQuery = useQuery({
    queryKey: ["raw-lead-cache", databaseLimit],
    queryFn: () => loadCache(databaseLimit),
    // staleTime: 0 (default) — allows invalidateQueries() from useRealtimeSync
    // to trigger a background refetch whenever new leads arrive from the extension.
    gcTime: Infinity,
    refetchOnWindowFocus: false,
  });

  // Build action map keyed by row_key for fast lookup
  const entries: CacheEntry[] = cacheQuery.data ?? EMPTY_CACHE_ENTRIES;
  const actions = useMemo(() => {
    const m: Record<string, Action> = {};
    for (const e of entries) {
      m[e.row_key] = { lead: e.lead, phone: e.phone, category: e.category };
    }
    return m;
  }, [entries]);

  const updateAction = useCallback(
    async (k: string, patch: Partial<Action>) => {
      // Optimistic update
      qc.setQueryData<CacheEntry[]>(["raw-lead-cache", databaseLimit], (prev) =>
        (prev ?? []).map((e) => (e.row_key === k ? { ...e, ...patch } : e)),
      );
      try {
        await patchEntry(k, patch as Partial<CacheEntry>);
      } catch (e) {
        toast.error((e as Error).message);
        cacheQuery.refetch();
      }
    },
    [qc, cacheQuery, databaseLimit],
  );

  const isFetching = cacheQuery.isFetching;
  const error = cacheQuery.error as Error | null;

  // Bucket entries
  const buckets = useMemo(() => {
    const b: Record<"new" | "forwarded" | "not_found" | "wrong", CacheEntry[]> = {
      new: [],
      forwarded: [],
      not_found: [],
      wrong: [],
    };
    for (const e of entries) {
      const cat = e.category;
      if (cat === "forwarded") b.forwarded.push(e);
      else if (cat === "not_found") b.not_found.push(e);
      else if (cat === "wrong") b.wrong.push(e);
      else b.new.push(e);
    }
    return b;
  }, [entries]);

  const areaOptions = useMemo(() => {
    const areas = new Set<string>();
    for (const e of entries) {
      const area = e.data["Account Area"]?.trim() || e.data["Sub Area / Neighborhood"]?.trim();
      if (area) areas.add(area);
    }
    return Array.from(areas).sort();
  }, [entries]);

  const visible = useMemo(() => {
    let list = buckets[tab];
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((e) =>
        [
          e.data["Account Name"],
          e.data["Sub Area / Neighborhood"],
          e.data["Post Text"],
          e.data["Account Area"],
          e.data.Lead,
        ].some((v) => (v ?? "").toString().toLowerCase().includes(q)),
      );
    }
    if (leadFilter !== "all") {
      list = list.filter((e) => effectiveLead(e.data, actions[e.row_key]) === leadFilter);
    }
    if (areaFilter !== "all") {
      list = list.filter(
        (e) =>
          e.data["Account Area"] === areaFilter || e.data["Sub Area / Neighborhood"] === areaFilter,
      );
    }
    return list;
  }, [actions, areaFilter, buckets, leadFilter, query, tab]);

  const shownRows = visible.slice(0, visibleLimit);
  // Only feed AI rows that haven't been classified yet (no sheet Lead value
  // AND no user/AI override), so each click marches through the next 50.
  const aiTargets = visible
    .filter(
      (entry) =>
        entry.data["Post Text"]?.trim() && effectiveLead(entry.data, actions[entry.row_key]) === "",
    )
    .slice(0, 50);


  function exportRows() {
    downloadCsv(
      "raw-leads.csv",
      ["Row", "Account", "Sub Area", "Posted", "Lead", "Phone", "Area", "Incog Account", "Link"],
      visible.map((entry) => [
        entry.sheet_row ?? "",
        entry.data["Account Name"] ?? "",
        entry.data["Sub Area / Neighborhood"] ?? "",
        entry.data["Posted Date & Time"] ?? "",
        effectiveLead(entry.data, actions[entry.row_key]) || "",
        formatPhone(entry.phone),
        entry.data["Account Area"] ?? "",
        entry.data["Incog Account"] ?? "",
        entry.data["Lead Link"] ?? "",
      ]),
    );
    toast.success(`Exported ${visible.length} raw lead${visible.length === 1 ? "" : "s"}`);
  }

  function handleRefresh() {
    cacheQuery.refetch();
  }

  async function runAiLeadCheck() {
    const prompt = aiPrompt.trim();
    if (!prompt) {
      toast.error("Write a prompt first.");
      return;
    }
    if (aiTargets.length === 0) {
      toast.info("No visible raw leads with post text to analyze.");
      return;
    }

    setAiRunning(true);
    try {
      const result = await analyzeWithAi({
        data: {
          prompt,
          rowKeys: aiTargets.map((entry) => entry.row_key),
        },
      });
      const leadByKey = new Map(result.results.map((item) => [item.row_key, item.lead]));
      qc.setQueryData<CacheEntry[]>(["raw-lead-cache", databaseLimit], (prev) =>
        (prev ?? []).map((entry) => {
          const lead = leadByKey.get(entry.row_key);
          return lead ? { ...entry, lead } : entry;
        }),
      );
      toast.success(`AI checked ${result.analyzed}: ${result.yes} Yes, ${result.no} No`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAiRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Tabs + search bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-surface border border-border">
          {(
            [
              ["new", "New", buckets.new.length],
              ["forwarded", "Forwarded", buckets.forwarded.length],
              ["not_found", "Number not found", buckets.not_found.length],
              ["wrong", "Wrong posts", buckets.wrong.length],
            ] as const
          ).map(([k, label, n]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={cn(
                "px-3 h-8 text-[12px] font-medium rounded-md transition-all",
                tab === k
                  ? "bg-card text-foreground shadow-sm ring-1 ring-border-strong"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
              <span className="ml-1.5 text-[10.5px] text-muted-foreground tabular-nums">{n}</span>
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="h-9 pl-9"
          />
        </div>

        <Select value={leadFilter} onValueChange={setLeadFilter}>
          <SelectTrigger className="h-9 w-[118px] text-[12px]">
            <SelectValue placeholder="Lead" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All leads</SelectItem>
            <SelectItem value="yes">Lead yes</SelectItem>
            <SelectItem value="no">Lead no</SelectItem>
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

        {tab === "new" && (
          <Button
            size="sm"
            variant="outline"
            className="h-9"
            onClick={async () => {
              const targets = buckets.new.filter(
                (e) => effectiveLead(e.data, actions[e.row_key]) === "no",
              );
              if (targets.length === 0) {
                toast.info("No 'No' leads to move.");
                return;
              }
              const keys = targets.map((e) => e.row_key);
              qc.setQueryData<CacheEntry[]>(["raw-lead-cache", databaseLimit], (prev) =>
                (prev ?? []).map((e) =>
                  keys.includes(e.row_key) ? { ...e, category: "wrong" } : e,
                ),
              );
              try {
                // row_keys are full Nextdoor URLs — batch to avoid
                // exceeding the request URL length limit (which surfaces
                // as a browser-level "TypeError: Failed to fetch").
                const CHUNK = 25;
                for (let i = 0; i < keys.length; i += CHUNK) {
                  const slice = keys.slice(i, i + CHUNK);
                  const { error } = await supabase
                    .from(TABLE)
                    .update({ category: "wrong" })
                    .in("row_key", slice);
                  if (error) throw error;
                }
                toast.success(
                  `Moved ${targets.length} "No" lead${targets.length === 1 ? "" : "s"} to Wrong posts`,
                );
              } catch (e) {
                toast.error((e as Error).message);
                cacheQuery.refetch();
              }
            }}
          >
            <PhoneOff className="h-3.5 w-3.5 mr-1.5" />
            Move "No" → Wrong posts
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-9"
            onClick={() => setSettingsOpen(true)}
            title="Web App URL"
          >
            <Gear className="h-3.5 w-3.5 mr-1.5" /> Source
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-9"
            onClick={handleRefresh}
            disabled={isFetching}
          >
            {isFetching ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            )}
            Refresh
          </Button>
          <Button size="sm" variant="outline" className="h-9" onClick={exportRows}>
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Export
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-2 items-start">
        <Textarea
          value={aiPrompt}
          onChange={(e) => setAiPrompt(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Prompt for AI lead checking..."
          className="min-h-[56px] text-[12.5px]"
        />
        <Button
          className="h-14 lg:w-[190px]"
          onClick={runAiLeadCheck}
          disabled={aiRunning || aiTargets.length === 0}
          title={`Analyze the next ${aiTargets.length} visible raw lead${aiTargets.length === 1 ? "" : "s"} with post text`}
        >
          {aiRunning ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4 mr-2" />
          )}
          Check {aiTargets.length || 50} Lead{aiTargets.length === 1 ? "" : "s"}
        </Button>
      </div>

      {error && (
        <div className="text-[12.5px] text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
          {(error as Error).message}
        </div>
      )}

      {cacheQuery.isLoading && (
        <div className="text-[12.5px] text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading from database…
        </div>
      )}

      {/* Table */}
      <div className="glass-card overflow-hidden">
        <div className="max-h-[calc(100vh-340px)] overflow-auto">
          <table
            className="text-[12px] border-separate border-spacing-0 table-fixed w-full"
            style={{ minWidth: 1240 }}
          >
            <colgroup>
              <col style={{ width: 60 }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 125 }} />
              <col style={{ width: 125 }} />
              <col style={{ width: 230 }} />
              <col style={{ width: 72 }} />
              <col style={{ width: 86 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 96 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 60 }} />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-surface">
              <tr>
                <th className="border-b border-border px-2 py-2 text-left font-medium text-[10.5px] uppercase tracking-wide text-muted-foreground whitespace-normal leading-tight">
                  Row #
                </th>
                {RAW_LEAD_COLUMNS.map((h) => (
                  <th
                    key={h}
                    className="border-b border-border px-2 py-2 text-left font-medium text-[10.5px] uppercase tracking-wide text-muted-foreground whitespace-normal leading-tight"
                  >
                    {h}
                  </th>
                ))}
                <th className="border-b border-border px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {!cacheQuery.isLoading && visible.length === 0 && !error && (
                <tr>
                  <td colSpan={12} className="text-center py-12 text-muted-foreground">
                    {tab === "new"
                      ? "No leads yet. Run your scraper extension to push leads here."
                      : "Nothing here yet."}
                  </td>
                </tr>
              )}
              {shownRows.map((e) => {
                const r = e.data;
                const k = e.row_key;
                const a = actions[k] || {};
                const lv = effectiveLead(r, a);
                return (
                  <tr
                    key={k}
                    className="transition-colors align-top hover:bg-accent/40 cursor-pointer"
                    onClick={() => setDetailFor(e)}
                  >
                    <td className="border-b border-border px-2.5 py-2 text-[11.5px] font-mono text-muted-foreground tabular-nums">
                      {e.sheet_row ?? "—"}
                    </td>
                    <td className="border-b border-border px-2.5 py-2">
                      <div className="font-medium truncate" title={r["Account Name"]}>
                        {r["Account Name"] || "—"}
                      </div>
                    </td>
                    <td
                      className="border-b border-border px-2.5 py-2 truncate"
                      title={r["Sub Area / Neighborhood"]}
                    >
                      {r["Sub Area / Neighborhood"] || (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td
                      className="border-b border-border px-2.5 py-2 text-[11.5px] text-muted-foreground truncate"
                      title={r["Posted Date & Time"]}
                    >
                      {r["Posted Date & Time"] || "—"}
                    </td>
                    <td className="border-b border-border px-2.5 py-2">
                      <div className="line-clamp-3 whitespace-pre-wrap" title={r["Post Text"]}>
                        {r["Post Text"] || "—"}
                      </div>
                    </td>
                    <td
                      className="border-b border-border px-2.5 py-2"
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      <Select
                        value={lv || ""}
                        onValueChange={(v) => updateAction(k, { lead: v as "yes" | "no" })}
                      >
                        <SelectTrigger
                          className={cn(
                            "h-7 text-[11px]",
                            lv === "yes" && "bg-success/15 text-success border-success/30",
                            lv === "no" &&
                              "bg-destructive/15 text-destructive border-destructive/30",
                          )}
                        >
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="yes">Yes</SelectItem>
                          <SelectItem value="no">No</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td
                      className="border-b border-border px-2.5 py-2"
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      {r["Lead Link"] ? (
                        <a
                          href={r["Lead Link"]}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline text-[11px]"
                        >
                          <ExternalLink className="h-3 w-3" /> Open
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="border-b border-border px-2.5 py-2 text-[11.5px] text-muted-foreground whitespace-nowrap">
                      {r["Captured Date (UTC)"] || "—"}
                    </td>
                    <td className="border-b border-border px-2.5 py-2 text-[11.5px] text-muted-foreground whitespace-nowrap">
                      {r["Captured Time (UTC)"] || "—"}
                    </td>
                    <td
                      className="border-b border-border px-2.5 py-2 text-[11.5px] truncate"
                      title={r["Account Area"]}
                    >
                      {r["Account Area"] || <span className="text-muted-foreground">—</span>}
                    </td>
                    <td
                      className="border-b border-border px-2.5 py-2 text-[11.5px] truncate"
                      title={r["Incog Account"]}
                    >
                      {r["Incog Account"] || <span className="text-muted-foreground">—</span>}
                    </td>
                    <td
                      className="border-b border-border px-2 py-2 text-center"
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={() => setDetailFor(e)}
                        title="Open lead"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {visible.length > shownRows.length && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => setVisibleLimit((n) => n + 80)}>
            Load more ({visible.length - shownRows.length} remaining)
          </Button>
        </div>
      )}

      {visible.length === shownRows.length && entries.length >= databaseLimit && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => {
              setDatabaseLimit((limit) => limit + RAW_LEADS_PAGE_SIZE);
              setVisibleLimit((limit) => limit + 80);
            }}
            disabled={isFetching}
          >
            {isFetching && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
            Load more from database
          </Button>
        </div>
      )}

      <div className="text-[11.5px] text-muted-foreground">
        {shownRows.length} of {visible.length} {visible.length === 1 ? "row" : "rows"} shown ·{" "}
        {entries.length} loaded from the latest {databaseLimit}
      </div>

      {/* Ingest endpoint info */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Extension ingest endpoint</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-[12.5px]">
            <p className="text-muted-foreground">
              Paste this URL into the Nextdoor scraper extension webhook field. The extension keeps
              scraped leads in its local retry queue until this CRM endpoint accepts or dedupes
              them.
            </p>
            <div className="flex items-center gap-2">
              <Input value={nextdoorWebhookUrl} readOnly className="font-mono text-[12px]" />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(nextdoorWebhookUrl);
                  toast.success("Endpoint URL copied");
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="text-muted-foreground">
              Raw Leads does not use live realtime reloads for this table, which keeps Supabase
              usage lighter. Use Refresh or Load more to pull the latest accepted rows from the
              database. Duplicate Nextdoor post IDs or links are reported back to the extension as
              skipped.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setSettingsOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lead detail dialog */}
      {detailFor && (
        <LeadDetailDialog
          entry={detailFor}
          onClose={() => setDetailFor(null)}
          onLeadChange={async (lead) => {
            await updateAction(detailFor.row_key, { lead });
            toast.success(`Marked as ${lead === "yes" ? "Yes" : "No"}`);
          }}
          onNotFound={async () => {
            await updateAction(detailFor.row_key, { category: "not_found" });
            setDetailFor(null);
            toast.success("Moved to Number not found");
          }}
          onWrong={async () => {
            await updateAction(detailFor.row_key, { category: "wrong" });
            setDetailFor(null);
            toast.success("Marked as wrong post");
          }}
          onForward={async (phone) => {
            await updateAction(detailFor.row_key, { phone });
            setQualifyFor({ ...detailFor, phone });
            setDetailFor(null);
          }}
        />
      )}

      {qualifyFor && (
        <QualifyDialog
          entry={qualifyFor}
          actorId={auth.user?.id ?? null}
          onClose={() => setQualifyFor(null)}
          onSent={async () => {
            await updateAction(qualifyFor.row_key, { category: "forwarded" });
            setQualifyFor(null);
            toast.success("Forwarded to CS");
          }}
        />
      )}
    </div>
  );
}

// ── Lead detail dialog ────────────────────────────────────────────────────────
function LeadDetailDialog({
  entry,
  onClose,
  onNotFound,
  onWrong,
  onForward,
  onLeadChange,
}: {
  entry: CacheEntry;
  onClose: () => void;
  onNotFound: () => void | Promise<void>;
  onWrong: () => void | Promise<void>;
  onForward: (phone: string) => void | Promise<void>;
  onLeadChange: (lead: "yes" | "no") => void | Promise<void>;
}) {
  const r = entry.data;
  const [phone, setPhone] = useState(entry.phone ?? "");
  const [busy, setBusy] = useState(false);

  async function handleNotFound() {
    setBusy(true);
    try {
      await onNotFound();
    } finally {
      setBusy(false);
    }
  }
  async function handleWrong() {
    setBusy(true);
    try {
      await onWrong();
    } finally {
      setBusy(false);
    }
  }
  async function handleForward() {
    const p = phone.trim();
    if (!p) {
      toast.error("Enter a phone number — or click Number not found.");
      return;
    }
    setBusy(true);
    try {
      await onForward(p);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Lead Details</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-[12.5px]">
          <div className="grid grid-cols-2 gap-3">
            <DetailField label="Account Name" value={r["Account Name"]} />
            <DetailField label="Sub Area" value={r["Sub Area / Neighborhood"]} />
            <DetailField label="Account Area" value={r["Account Area"]} />
            <DetailField label="Incog Account" value={r["Incog Account"]} />
            <DetailField label="Posted" value={r["Posted Date & Time"]} />
            <DetailField
              label="Captured (UTC)"
              value={`${r["Captured Date (UTC)"] ?? ""} ${r["Captured Time (UTC)"] ?? ""}`.trim()}
            />
          </div>

          <div>
            <Label className="block mb-1 text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
              Post Text
            </Label>
            <div className="rounded-md border bg-muted/30 px-3 py-2 max-h-48 overflow-auto whitespace-pre-wrap">
              {r["Post Text"] || "—"}
            </div>
          </div>

          {r["Lead Link"] && (
            <a
              href={r["Lead Link"]}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-primary hover:underline text-[12px]"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open original post
            </a>
          )}

          <div className="pt-2 border-t grid grid-cols-2 gap-3">
            <div>
              <Label className="block mb-1 text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                Lead Status
              </Label>
              <Select
                value={effectiveLead(r, { lead: entry.lead }) || ""}
                onValueChange={(v) => onLeadChange(v as "yes" | "no")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Set Yes / No" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="block mb-1 text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                Phone Number
              </Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Phone from post / comments"
                autoFocus
              />
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-between gap-2">
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleNotFound} disabled={busy}>
              <PhoneOff className="h-4 w-4 mr-2" />
              Number not found
            </Button>
            <Button variant="ghost" onClick={handleWrong} disabled={busy}>
              Wrong post
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Close
            </Button>
            <Button onClick={handleForward} disabled={busy}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Forward
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailField({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <Label className="block mb-1 text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
        {label}
      </Label>
      <div className="text-foreground truncate" title={value}>
        {value || <span className="text-muted-foreground">—</span>}
      </div>
    </div>
  );
}

// ── Forward to CS dialog ──────────────────────────────────────────────────────
function QualifyDialog({
  entry,
  actorId,
  onClose,
  onSent,
}: {
  entry: CacheEntry;
  actorId: string | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const row = entry.data;
  const [customerName, setCustomerName] = useState(row["Account Name"] ?? "");
  const [customerNumber, setCustomerNumber] = useState(entry.phone ?? "");
  const [postText, setPostText] = useState(row["Post Text"] ?? "");
  const [context, setContext] = useState("");
  const [passItTo, setPassItTo] = useState("");
  const [subArea, setSubArea] = useState(row["Sub Area / Neighborhood"] ?? "");
  const [isImportant, setIsImportant] = useState(false);
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!customerName.trim() || !customerNumber.trim()) {
      toast.error("Customer name and number are required");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.from("qualified_leads").insert({
        customer_name: customerName.trim(),
        customer_number: formatPhone(customerNumber.trim()) || customerNumber.trim(),
        post_text: postText.trim() || null,
        context: context.trim() || null,
        pass_it_to: passItTo.trim() || null,
        sub_area: subArea.trim() || null,
        main_area: row["Account Area"]?.trim() || null,
        original_lead_link: row["Lead Link"] || null,
        assigned_by: actorId,
        created_by: actorId,
        is_important: isImportant,
      } as never);
      if (error) throw error;
      onSent();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Forward to CS</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Customer Name">
            <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          </Field>
          <Field label="Customer Number">
            <Input
              value={customerNumber}
              onChange={(e) => setCustomerNumber(e.target.value)}
              placeholder="Multiple? separate with comma"
            />
          </Field>
          <Field label="Sub Area">
            <Input value={subArea} onChange={(e) => setSubArea(e.target.value)} />
          </Field>
          <Field label="Pass it to">
            <Input
              value={passItTo}
              onChange={(e) => setPassItTo(e.target.value)}
              placeholder="CS rep / team"
            />
          </Field>
          <div className="col-span-2">
            <Field label="Post Text (auto-filled from original post)">
              <Textarea rows={4} value={postText} onChange={(e) => setPostText(e.target.value)} />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="Context (your notes for CS)">
              <Textarea
                rows={3}
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="Add any extra context for CS — e.g. urgency, special instructions…"
              />
            </Field>
          </div>
          <div className="col-span-2">
            <label className="flex items-start gap-2.5 rounded-md border border-border bg-surface/60 px-3 py-2.5 cursor-pointer hover:border-warning/60 transition-colors">
              <input
                type="checkbox"
                checked={isImportant}
                onChange={(e) => setIsImportant(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-warning cursor-pointer"
              />
              <div className="text-[12.5px]">
                <div className="font-medium text-foreground">
                  Mark as important / urgent job
                </div>
                <div className="text-[11.5px] text-muted-foreground">
                  Pins this lead to the top of the CS pipeline so it gets called first.
                </div>
              </div>
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={send} disabled={busy}>
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="block mb-1 text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
        {label}
      </Label>
      {children}
    </div>
  );
}
