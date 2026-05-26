import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
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
  Check,
  BookmarkCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/raw-leads")({ component: Page });

// ── Storage keys ──────────────────────────────────────────────────────────────
const DEFAULT_API_URL =
  "https://script.google.com/macros/s/AKfycbykybYjjrkdOMEC5M-mgFWIngGTY-g_jPdNL9mksND0jaoJ-ht8wspYAj88MCla8r2F2g/exec";
const API_URL_KEY = "rawleads.apiUrl";
const ACTIONS_KEY = "rawleads.actions.v2";
const START_ROW_KEY = "rawleads.startRow"; // manually set floor
const NEXT_ROW_KEY = "rawleads.nextRow"; // auto-advancing cursor
const ROWS_KEY = "rawleads.rows.v1"; // accumulated rows cache

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
type Action = { category?: Category; lead?: "yes" | "no"; phone?: string };
type Actions = Record<string, Action>;

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

// ── Local storage helpers ─────────────────────────────────────────────────────
function loadActions(): Actions {
  try {
    return JSON.parse(localStorage.getItem(ACTIONS_KEY) || "{}");
  } catch {
    return {};
  }
}
function saveActions(a: Actions) {
  localStorage.setItem(ACTIONS_KEY, JSON.stringify(a));
}

/** The row number to send to Apps Script on the next fetch.
 *  Priority: nextRow (auto cursor) >= startRow (manual floor), minimum 1. */
function getEffectiveStartRow(): number {
  const manual = parseInt(localStorage.getItem(START_ROW_KEY) || "1", 10) || 1;
  const cursor = parseInt(localStorage.getItem(NEXT_ROW_KEY) || "0", 10) || 0;
  return Math.max(manual, cursor, 1);
}

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

function leadValue(r: Row, a?: Action): "yes" | "no" | "" {
  const raw = (r.Lead ?? "").trim().toLowerCase();
  if (raw === "yes" || raw === "y" || raw === "true") return "yes";
  if (raw === "no" || raw === "n" || raw === "false") return "no";
  if (a?.lead === "yes" || a?.lead === "no") return a.lead;
  return "";
}

// ── Google Sheets fetch ───────────────────────────────────────────────────────
// Your Apps Script should accept ?startRow=N and return:
//   { rows: [...], nextRow: N }
// If nextRow is missing, we advance by rows.length automatically.
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
      `Network error — could not reach Apps Script. Make sure the script is deployed as a Web App with access = "Anyone". Original: ${(e as Error).message}`,
    );
  }
  if (!res.ok) {
    throw new Error(
      `Apps Script returned HTTP ${res.status}. Make sure access is set to "Anyone" (not "Anyone with Google account").`,
    );
  }
  let json: { rows?: Row[]; nextRow?: number };
  try {
    json = (await res.json()) as { rows?: Row[]; nextRow?: number };
  } catch {
    throw new Error(
      `Apps Script did not return valid JSON. Make sure your doGet() function returns ContentService.createTextOutput(JSON.stringify({rows:[...]})).setMimeType(ContentService.MimeType.JSON).`,
    );
  }
  const rows = Array.isArray(json.rows) ? json.rows : [];
  // If Apps Script tells us the next row, use it; otherwise advance ourselves
  const nextRow =
    typeof json.nextRow === "number" && json.nextRow > 0 ? json.nextRow : startRow + rows.length;
  return { rows, nextRow };
}

// ── Page ──────────────────────────────────────────────────────────────────────
function Page() {
  const auth = useAuth();
  return (
    <div>
      <PageHeader
        title="Raw Leads"
        description="Live feed from your Google Sheets scraper. Loads from where it last left off."
      />
      <PageBody className="!pt-5">
        <RoleGate allow={["admin", "marketing"]} current={auth.primaryRole}>
          <Inner />
        </RoleGate>
      </PageBody>
    </div>
  );
}

function Inner() {
  const auth = useAuth();

  const [apiUrl, setApiUrl] = useState<string>(() =>
    typeof window === "undefined"
      ? DEFAULT_API_URL
      : localStorage.getItem(API_URL_KEY) || DEFAULT_API_URL,
  );
  const [apiUrlDraft, setApiUrlDraft] = useState(apiUrl);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Row offset state — what row to fetch from next
  const [startRow, setStartRow] = useState<number>(() =>
    typeof window === "undefined" ? 1 : getEffectiveStartRow(),
  );
  const [startRowDraft, setStartRowDraft] = useState<string>(String(startRow));
  // Track the nextRow returned by the last successful fetch so Refresh advances it
  const nextRowRef = useRef<number>(startRow);

  const [actions, setActions] = useState<Actions>(() =>
    typeof window === "undefined" ? {} : loadActions(),
  );
  const updateAction = useCallback((k: string, patch: Partial<Action>) => {
    setActions((prev) => {
      const next = { ...prev, [k]: { ...prev[k], ...patch } };
      saveActions(next);
      return next;
    });
  }, []);

  const [tab, setTab] = useState<"new" | "forwarded" | "not_found" | "wrong">("new");
  const [yesOnly, setYesOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [qualifyFor, setQualifyFor] = useState<Row | null>(null);

  // Accumulated rows across refreshes (kept in memory for the session)
  const [allRows, setAllRows] = useState<Row[]>([]);

  const { isLoading, isFetching, refetch, error, data } = useQuery({
    queryKey: ["raw-leads-api", apiUrl, startRow],
    queryFn: () => fetchSheetRows(apiUrl, startRow),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
  });

  // When new data arrives, append new rows and advance the cursor
  useEffect(() => {
    if (!data) return;
    if (data.rows.length > 0) {
      setAllRows((prev) => {
        // Deduplicate by keyFor
        const existing = new Set(prev.map(keyFor));
        const fresh = data.rows.filter((r) => !existing.has(keyFor(r)));
        return [...prev, ...fresh];
      });
    }
    // Save the next row so next manual Refresh or page load continues from here
    nextRowRef.current = data.nextRow;
    localStorage.setItem(NEXT_ROW_KEY, String(data.nextRow));
  }, [data]);

  // Bucket rows
  const buckets = useMemo(() => {
    const b: Record<"new" | "forwarded" | "not_found" | "wrong", Row[]> = {
      new: [],
      forwarded: [],
      not_found: [],
      wrong: [],
    };
    for (const r of allRows) {
      const k = keyFor(r);
      const cat = actions[k]?.category;
      if (cat) b[cat].push(r);
      else b.new.push(r);
    }
    for (const k of Object.keys(b) as Array<keyof typeof b>) {
      b[k].sort((a, c) => parseCapturedAt(c) - parseCapturedAt(a));
    }
    return b;
  }, [allRows, actions]);

  const visible = useMemo(() => {
    let rows = buckets[tab];
    if (tab === "new" && yesOnly) {
      rows = rows.filter((r) => leadValue(r, actions[keyFor(r)]) === "yes");
    }
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) =>
        [
          r["Account Name"],
          r["Sub Area / Neighborhood"],
          r["Post Text"],
          r["Account Area"],
          r.Lead,
        ].some((v) => (v ?? "").toString().toLowerCase().includes(q)),
      );
    }
    return rows;
  }, [buckets, tab, yesOnly, query, actions]);

  function saveApiUrl() {
    const v = apiUrlDraft.trim();
    if (!v) return;
    localStorage.setItem(API_URL_KEY, v);
    setApiUrl(v);
    setSettingsOpen(false);
    toast.success("Web App URL saved");
  }

  function applyManualStartRow() {
    const n = parseInt(startRowDraft, 10);
    if (isNaN(n) || n < 1) {
      toast.error("Enter a valid row number (1 or above)");
      return;
    }
    localStorage.setItem(START_ROW_KEY, String(n));
    // Clear the auto-cursor so the manual value takes effect
    localStorage.removeItem(NEXT_ROW_KEY);
    setAllRows([]); // clear displayed rows since we're starting fresh
    setStartRow(n);
    nextRowRef.current = n;
    toast.success(`Will load from row ${n} on next refresh`);
    setTimeout(() => refetch(), 100);
  }

  function handleRefresh() {
    // On manual refresh, advance to where last fetch ended
    const next = nextRowRef.current;
    if (next !== startRow) {
      setStartRow(next);
    } else {
      refetch();
    }
  }

  function markCurrentPosition() {
    const next = nextRowRef.current;
    localStorage.setItem(START_ROW_KEY, String(next));
    localStorage.removeItem(NEXT_ROW_KEY);
    toast.success(`Bookmark saved at row ${next}. Next session will start from here.`);
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
          Current session loaded from row <strong>{startRow}</strong>.
          {data && data.nextRow > startRow && (
            <>
              {" "}
              Next refresh will continue from row <strong>{data.nextRow}</strong>.
            </>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-[12px] ml-auto"
          onClick={markCurrentPosition}
          title="Save current position so next session starts from here"
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

        {tab === "new" && (
          <Button
            size="sm"
            variant={yesOnly ? "default" : "outline"}
            className="h-9"
            onClick={() => setYesOnly((v) => !v)}
          >
            <Check className="h-3.5 w-3.5 mr-1.5" />
            Yes only
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
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="text-[12.5px] text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2 space-y-1">
          <div className="font-medium">Failed to load data from Google Sheets</div>
          <div>{(error as Error).message}</div>
          <div className="text-muted-foreground mt-1 text-[11.5px]">
            <strong>Quick fix checklist:</strong>
            <ol className="list-decimal pl-4 mt-0.5 space-y-0.5">
              <li>In Apps Script → Deploy → Manage deployments → pencil icon</li>
              <li>
                Set <strong>"Who has access"</strong> to <strong>"Anyone"</strong> (not "Anyone with
                Google account")
              </li>
              <li>
                Copy the new deployment URL and paste it in the Source settings (gear icon above)
              </li>
            </ol>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="glass-card overflow-hidden">
        <div className="max-h-[calc(100vh-340px)] overflow-auto">
          <table
            className="text-[12px] border-separate border-spacing-0 table-fixed w-full"
            style={{ minWidth: 1180 }}
          >
            <colgroup>
              <col style={{ width: 140 }} />
              <col style={{ width: 125 }} />
              <col style={{ width: 125 }} />
              <col style={{ width: 230 }} />
              <col style={{ width: 72 }} />
              <col style={{ width: 86 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 96 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 140 }} />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-surface">
              <tr>
                {RAW_LEAD_COLUMNS.map((h) => (
                  <th
                    key={h}
                    className="border-b border-border px-2 py-2 text-left font-medium text-[10.5px] uppercase tracking-wide text-muted-foreground whitespace-normal leading-tight"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={10} className="text-center text-muted-foreground py-12">
                    <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…
                  </td>
                </tr>
              )}
              {!isLoading && visible.length === 0 && !error && (
                <tr>
                  <td colSpan={10} className="text-center py-12 text-muted-foreground">
                    {tab === "new" ? "No leads in this view." : "Nothing here yet."}
                  </td>
                </tr>
              )}
              {visible.map((r) => {
                const k = keyFor(r);
                const a = actions[k] || {};
                const lv = leadValue(r, a);
                return (
                  <tr key={k} className="hover:bg-accent/40 transition-colors align-top">
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
                    <td className="border-b border-border px-2.5 py-2">
                      {lv === "yes" || lv === "no" ? (
                        <span
                          className={cn(
                            "inline-flex px-2 py-0.5 rounded-full border text-[10.5px] font-medium",
                            lv === "yes"
                              ? "bg-success/15 text-success border-success/30"
                              : "bg-destructive/15 text-destructive border-destructive/30",
                          )}
                        >
                          {lv === "yes" ? "Yes" : "No"}
                        </span>
                      ) : (
                        <Select
                          value=""
                          onValueChange={(v) => updateAction(k, { lead: v as "yes" | "no" })}
                        >
                          <SelectTrigger className="h-7 text-[11px]">
                            <SelectValue placeholder="—" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="yes">Yes</SelectItem>
                            <SelectItem value="no">No</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </td>
                    <td className="border-b border-border px-2.5 py-2">
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-[11.5px] text-muted-foreground">
        {visible.length} {visible.length === 1 ? "row" : "rows"} shown · {allRows.length} loaded
        this session · rows {startRow}–
        {nextRowRef.current - 1 > startRow ? nextRowRef.current - 1 : "?"} from sheet
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
            <div className="text-[11px] text-muted-foreground space-y-1 bg-muted/40 rounded p-3">
              <div className="font-medium text-foreground">
                Required Apps Script doGet() format:
              </div>
              <pre className="text-[10px] overflow-x-auto whitespace-pre-wrap">{`function doGet(e) {
  var startRow = parseInt(e.parameter.startRow) || 1;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var lastRow = sheet.getLastRow();
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var rows = [];
  for (var i = startRow; i <= lastRow; i++) {
    var rowData = sheet.getRange(i, 1, 1, headers.length).getValues()[0];
    var obj = {};
    headers.forEach(function(h, idx) { obj[h] = rowData[idx] || ""; });
    rows.push(obj);
  }
  return ContentService
    .createTextOutput(JSON.stringify({ rows: rows, nextRow: lastRow + 1 }))
    .setMimeType(ContentService.MimeType.JSON);
}`}</pre>
              <div className="font-medium text-foreground mt-2">Deploy settings:</div>
              <ol className="list-decimal pl-4 space-y-0.5">
                <li>
                  Deploy → New deployment → Type: <strong>Web App</strong>
                </li>
                <li>
                  Execute as: <strong>Me</strong>
                </li>
                <li>
                  Who has access: <strong>Anyone</strong>
                </li>
              </ol>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setApiUrlDraft(DEFAULT_API_URL);
              }}
            >
              Reset
            </Button>
            <Button onClick={saveApiUrl}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {qualifyFor && (
        <QualifyDialog
          row={qualifyFor}
          phone={actions[keyFor(qualifyFor)]?.phone ?? ""}
          actorId={auth.user?.id ?? null}
          onClose={() => setQualifyFor(null)}
          onSent={() => {
            const k = keyFor(qualifyFor);
            updateAction(k, { category: "forwarded" });
            setQualifyFor(null);
            toast.success("Forwarded to CS");
          }}
        />
      )}
    </div>
  );
}

function QualifyDialog({
  row,
  phone,
  actorId,
  onClose,
  onSent,
}: {
  row: Row;
  phone: string;
  actorId: string | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const [customerName, setCustomerName] = useState(row["Account Name"] ?? "");
  const [customerNumber, setCustomerNumber] = useState(phone);
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
        customer_number: customerNumber.trim(),
        context: context.trim() || null,
        pass_it_to: passItTo.trim() || null,
        sub_area: subArea.trim() || null,
        main_area: row["Account Area"]?.trim() || null,
        original_lead_link: row["Lead Link"] || null,
        assigned_by: actorId,
      });
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
