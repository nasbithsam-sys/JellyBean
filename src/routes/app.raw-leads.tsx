import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  X,
  Check,
  AlertTriangle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/raw-leads")({ component: Page });

const DEFAULT_API_URL =
  "https://script.google.com/macros/s/AKfycbykybYjjrkdOMEC5M-mgFWIngGTY-g_jPdNL9mksND0jaoJ-ht8wspYAj88MCla8r2F2g/exec";
const API_URL_KEY = "rawleads.apiUrl";
const ACTIONS_KEY = "rawleads.actions.v2";

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

function Page() {
  const auth = useAuth();
  return (
    <div>
      <PageHeader
        title="Raw Leads"
        description="Live feed from the marketing capture sheet. Newest first."
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
  const syncStartRef = useRef<number>(Date.now());

  const [apiUrl, setApiUrl] = useState<string>(() => {
    if (typeof window === "undefined") return DEFAULT_API_URL;
    return localStorage.getItem(API_URL_KEY) || DEFAULT_API_URL;
  });
  const [apiUrlDraft, setApiUrlDraft] = useState(apiUrl);
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["raw-leads-api", apiUrl],
    queryFn: async () => {
      const res = await fetch(apiUrl, { method: "GET" });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const json = (await res.json()) as { rows?: Row[] };
      return Array.isArray(json.rows) ? json.rows : [];
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
  });

  // Show only rows captured at or after this session's sync start, like before.
  const fresh = useMemo(() => {
    const start = syncStartRef.current;
    return (data ?? []).filter((r) => parseCapturedAt(r) >= start);
  }, [data]);

  // Bucket by category (action.category overrides; otherwise it's "new")
  const buckets = useMemo(() => {
    const b: Record<"new" | "forwarded" | "not_found" | "wrong", Row[]> = {
      new: [],
      forwarded: [],
      not_found: [],
      wrong: [],
    };
    for (const r of fresh) {
      const k = keyFor(r);
      const a = actions[k];
      const cat = a?.category;
      if (cat) b[cat].push(r);
      else b.new.push(r);
    }
    // newest first
    for (const k of Object.keys(b) as Array<keyof typeof b>) {
      b[k].sort((a, c) => parseCapturedAt(c) - parseCapturedAt(a));
    }
    return b;
  }, [fresh, actions]);

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

  return (
    <div className="space-y-4">
      {/* Tabs */}
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
            onClick={() => refetch()}
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

      {error && (
        <div className="text-[12.5px] text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
          Failed to fetch: {(error as Error).message}
        </div>
      )}

      {/* Table — exact raw sheet columns, compact scroll */}
      <div className="glass-card overflow-hidden">
        <div className="max-h-[calc(100vh-280px)] overflow-auto">
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
              {!isLoading && visible.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center py-12 text-muted-foreground">
                    {tab === "new" ? "No new leads in this view." : "Nothing here yet."}
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
        {visible.length} {visible.length === 1 ? "row" : "rows"} · source:{" "}
        <span className="font-mono">{new URL(apiUrl).host}</span>
      </div>

      {/* Settings (Web App URL) */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Web App URL (source)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label className="text-[12px] text-muted-foreground">
              Google Apps Script Web App URL that returns {`{ rows: [...] }`}.
            </Label>
            <Input
              value={apiUrlDraft}
              onChange={(e) => setApiUrlDraft(e.target.value)}
              placeholder="https://script.google.com/macros/s/.../exec"
            />
            <p className="text-[11px] text-muted-foreground">
              Saved per browser. New extractions appear at the top automatically — newest first.
            </p>
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

      {/* Qualify popup */}
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

  useEffect(() => {
    setCustomerNumber(phone);
  }, [phone]);

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
