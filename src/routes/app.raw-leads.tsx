import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState, useEffect } from "react";
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
  BookmarkCheck,
  Eye,
  PhoneOff,
  Download,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";
import { downloadCsv, formatPhone } from "@/lib/crm-lite";

export const Route = createFileRoute("/app/raw-leads")({ component: Page });

// ── Storage keys (device-local preferences only) ──────────────────────────────
const DEFAULT_API_URL =
  "https://script.google.com/macros/s/AKfycbykybYjjrkdOMEC5M-mgFWIngGTY-g_jPdNL9mksND0jaoJ-ht8wspYAj88MCla8r2F2g/exec";
const API_URL_KEY = "rawleads.apiUrl";
const SHARED_START_ROW_KEY = "raw_leads.start_row";

const TABLE = "raw_lead_cache";
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
};
const EMPTY_CACHE_ENTRIES: CacheEntry[] = [];

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

// ── Shared start-row state (synced across all users via Supabase) ─────────────
async function loadSharedStartRow(): Promise<number> {
  const { data, error } = await supabase
    .from("shared_state")
    .select("value")
    .eq("key", SHARED_START_ROW_KEY)
    .maybeSingle();
  if (error) throw error;
  const value = data?.value;
  const n = value && typeof value === "object" && !Array.isArray(value) ? value.row : undefined;
  return typeof n === "number" && n > 0 ? n : 1;
}

async function saveSharedStartRow(row: number, userId: string | null): Promise<void> {
  const { error } = await supabase.from("shared_state").upsert(
    {
      key: SHARED_START_ROW_KEY,
      value: { row },
      updated_at: new Date().toISOString(),
      updated_by: userId,
    },
    { onConflict: "key" },
  );
  if (error) throw error;
}

// ── Google Sheets fetch ───────────────────────────────────────────────────────
async function fetchSheetRows(
  apiUrl: string,
  startRow: number,
): Promise<{ rows: Row[]; nextRow: number }> {
  const url = `${apiUrl}${apiUrl.includes("?") ? "&" : "?"}startRow=${startRow}`;
  let res: Response;
  try {
    res = await fetch(url, { method: "GET", redirect: "follow" });
  } catch (e) {
    throw new Error(
      `Network error — could not reach Apps Script. Original: ${(e as Error).message}`,
    );
  }
  if (!res.ok) {
    throw new Error(`Apps Script returned HTTP ${res.status}.`);
  }
  const json = (await res.json()) as { rows?: Row[]; nextRow?: number };
  const allRows = Array.isArray(json.rows) ? json.rows : [];
  // Only take contiguous rows from the start whose "Lead" column (E) is filled.
  // Stop at the first empty Lead cell — even if later rows have data, we wait
  // until the gap is filled before advancing the shared cursor.
  let cutoff = allRows.length;
  for (let i = 0; i < allRows.length; i++) {
    if (!(allRows[i].Lead ?? "").trim()) {
      cutoff = i;
      break;
    }
  }
  const rows = allRows.slice(0, cutoff);
  const nextRow = startRow + rows.length;
  return { rows, nextRow };
}

// ── Supabase cache helpers ────────────────────────────────────────────────────
async function loadCache(): Promise<CacheEntry[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("row_key, data, lead, phone, category, captured_at, lead_link, sheet_row")
    .order("captured_at", { ascending: false, nullsFirst: false })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as CacheEntry[];
}

async function upsertNewRows(rows: Row[], startRow: number) {
  if (!rows.length) return;
  const payload = rows.map((r, i) => ({
    row_key: keyFor(r),
    data: r as Json,
    lead: leadValueFromRow(r),
    captured_at: capturedIsoFromRow(r),
    lead_link: r["Lead Link"] || null,
    sheet_row: startRow + i,
  }));
  // Insert only fresh keys; ignore conflicts on row_key to preserve existing edits.
  const { error } = await supabase.from(TABLE).upsert(payload, {
    onConflict: "row_key",
    ignoreDuplicates: true,
  });
  if (error) throw error;
}

async function patchEntry(row_key: string, patch: Partial<CacheEntry>) {
  const { error } = await supabase
    .from(TABLE)
    .update(patch as RawLeadCacheUpdate)
    .eq("row_key", row_key);
  if (error) throw error;
}

// ── Page ──────────────────────────────────────────────────────────────────────
function Page() {
  const auth = useAuth();
  return (
    <div>
      <PageHeader
        title="Raw Leads"
        description="Live feed from your Google Sheets scraper. Stored in Supabase — shared across all your devices."
      />
      <PageBody className="!pt-5">
        <RoleGate allow={["admin", "scraping", "processor"]} current={auth.primaryRole}>
          <Inner />
        </RoleGate>
      </PageBody>
    </div>
  );
}

function Inner() {
  const auth = useAuth();
  const qc = useQueryClient();

  const [apiUrl, setApiUrl] = useState<string>(() =>
    typeof window === "undefined"
      ? DEFAULT_API_URL
      : localStorage.getItem(API_URL_KEY) || DEFAULT_API_URL,
  );
  const [apiUrlDraft, setApiUrlDraft] = useState(apiUrl);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Shared start row — kept in sync across all users via Supabase
  const startRowQuery = useQuery({
    queryKey: ["raw-leads-shared-start-row"],
    queryFn: loadSharedStartRow,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const startRow = startRowQuery.data ?? 1;
  const [startRowDraft, setStartRowDraft] = useState<string>(String(startRow));
  useEffect(() => {
    setStartRowDraft(String(startRow));
  }, [startRow]);

  const [tab, setTab] = useState<"new" | "forwarded" | "not_found" | "wrong">("new");
  const [query, setQuery] = useState("");
  const [leadFilter, setLeadFilter] = useState("all");
  const [areaFilter, setAreaFilter] = useState("all");
  const [visibleLimit, setVisibleLimit] = useState(80);
  const [detailFor, setDetailFor] = useState<CacheEntry | null>(null);
  const [qualifyFor, setQualifyFor] = useState<CacheEntry | null>(null);

  // ── Persistent cache from Supabase ─────────────────────────────────────────
  const cacheQuery = useQuery({
    queryKey: ["raw-lead-cache"],
    queryFn: loadCache,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
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
      qc.setQueryData<CacheEntry[]>(["raw-lead-cache"], (prev) =>
        (prev ?? []).map((e) => (e.row_key === k ? { ...e, ...patch } : e)),
      );
      try {
        await patchEntry(k, patch as Partial<CacheEntry>);
      } catch (e) {
        toast.error((e as Error).message);
        cacheQuery.refetch();
      }
    },
    [qc, cacheQuery],
  );

  // ── Sheet sync ─────────────────────────────────────────────────────────────
  const { isFetching, refetch, error, data } = useQuery({
    queryKey: ["raw-leads-api", apiUrl, startRow],
    queryFn: () => fetchSheetRows(apiUrl, startRow),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
    enabled: false, // only run on explicit Refresh
  });

  useEffect(() => {
    if (!data) return;
    if (data.rows.length > 0) {
      upsertNewRows(data.rows, startRow)
        .then(() => cacheQuery.refetch())
        .catch((e) => toast.error(`Save failed: ${(e as Error).message}`));
    }
    // Persist the advancing cursor to the shared row so every user picks up from here.
    saveSharedStartRow(data.nextRow, auth.user?.id ?? null)
      .then(() => startRowQuery.refetch())
      .catch((e) => toast.error(`Could not sync row cursor: ${(e as Error).message}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

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

  function saveApiUrl() {
    const v = apiUrlDraft.trim();
    if (!v) return;
    localStorage.setItem(API_URL_KEY, v);
    setApiUrl(v);
    setSettingsOpen(false);
    toast.success("Web App URL saved");
  }

  async function applyManualStartRow() {
    const n = parseInt(startRowDraft, 10);
    if (isNaN(n) || n < 1) {
      toast.error("Enter a valid row number (1 or above)");
      return;
    }
    try {
      await saveSharedStartRow(n, auth.user?.id ?? null);
      await startRowQuery.refetch();
      toast.success(`Will load from row ${n} on next refresh (synced for all users)`);
      setTimeout(() => refetch(), 100);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function handleRefresh() {
    refetch();
  }

  async function markCurrentPosition() {
    try {
      await saveSharedStartRow(startRow, auth.user?.id ?? null);
      toast.success(`Bookmark saved at row ${startRow} for all users.`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      {/* Row offset control */}
      <div className="bg-card border rounded-lg px-4 py-3 flex flex-wrap items-center gap-3 text-[12.5px]">
        <div className="flex items-center gap-2">
          <Label className="text-muted-foreground whitespace-nowrap">Start from row:</Label>
          <Input
            type="number"
            min={1}
            value={startRowDraft}
            onChange={(e) => setStartRowDraft(e.target.value)}
            className="h-8 w-24 text-[12.5px]"
          />
          <Button size="sm" className="h-8 text-[12px]" onClick={applyManualStartRow}>
            Apply &amp; Reload
          </Button>
        </div>
        <div className="text-muted-foreground">
          Next refresh will load from row <strong>{startRow}</strong>.
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-[12px] ml-auto"
          onClick={markCurrentPosition}
        >
          <BookmarkCheck className="h-3.5 w-3.5 mr-1.5" />
          Bookmark position
        </Button>
      </div>

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
              qc.setQueryData<CacheEntry[]>(["raw-lead-cache"], (prev) =>
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
                      ? "No leads in this view. Click Refresh to pull from sheet."
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

      <div className="text-[11.5px] text-muted-foreground">
        {shownRows.length} of {visible.length} {visible.length === 1 ? "row" : "rows"} shown ·{" "}
        {entries.length} loaded from database
      </div>

      {/* Source settings */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Web App URL (source)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label className="text-[12px] text-muted-foreground">
              Google Apps Script Web App URL. Must return{" "}
              <code>{`{ rows: [...], nextRow: N }`}</code>.
            </Label>
            <Input
              value={apiUrlDraft}
              onChange={(e) => setApiUrlDraft(e.target.value)}
              placeholder="https://script.google.com/macros/s/.../exec"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApiUrlDraft(DEFAULT_API_URL)}>
              Reset
            </Button>
            <Button onClick={saveApiUrl}>Save</Button>
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
  const [context, setContext] = useState(row["Post Text"] ?? "");
  const [passItTo, setPassItTo] = useState("");
  const [subArea, setSubArea] = useState(row["Sub Area / Neighborhood"] ?? "");
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
        context: context.trim() || null,
        pass_it_to: passItTo.trim() || null,
        sub_area: subArea.trim() || null,
        main_area: row["Account Area"]?.trim() || null,
        original_lead_link: row["Lead Link"] || null,
        assigned_by: actorId,
        // Track who forwarded the lead so scraping/processor can see status
        // updates of their own forwarded leads in the Forwarded Leads tab.
        created_by: actorId,
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
            <Field label="Context">
              <Textarea rows={4} value={context} onChange={(e) => setContext(e.target.value)} />
            </Field>
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
