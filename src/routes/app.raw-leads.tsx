import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  ExternalLink,
  RefreshCw,
  Search,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/raw-leads")({ component: Page });

const API_URL =
  "https://script.google.com/macros/s/AKfycbykybYjjrkdOMEC5M-mgFWIngGTY-g_jPdNL9mksND0jaoJ-ht8wspYAj88MCla8r2F2g/exec";

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

const COLUMNS: { key: keyof Row; label: string; width?: string; wrap?: boolean }[] = [
  { key: "Account Name", label: "Account Name", width: "160px" },
  { key: "Sub Area / Neighborhood", label: "Sub Area / Neighborhood", width: "200px" },
  { key: "Posted Date & Time", label: "Posted Date & Time", width: "150px" },
  { key: "Post Text", label: "Post Text", width: "420px", wrap: true },
  { key: "Lead", label: "Lead", width: "120px" },
  { key: "Lead Link", label: "Lead Link", width: "180px" },
  { key: "Captured Date (UTC)", label: "Captured Date (UTC)", width: "170px" },
  { key: "Captured Time (UTC)", label: "Captured Time (UTC)", width: "140px" },
  { key: "Account Area", label: "Account Area", width: "140px" },
  { key: "Incog Account", label: "Incog Account", width: "150px" },
];

function Page() {
  const auth = useAuth();
  return (
    <div>
      <PageHeader
        title="Raw Leads"
        description="Live feed from the marketing capture sheet. Only leads captured after this session's sync start are shown."
      />
      <PageBody className="!pt-5">
        <RoleGate allow={["admin", "marketing"]} current={auth.primaryRole}>
          <Inner />
        </RoleGate>
      </PageBody>
    </div>
  );
}

function parseCapturedAt(r: Row): number {
  const d = r["Captured Date (UTC)"];
  if (!d) return 0;
  const t = Date.parse(d);
  return Number.isNaN(t) ? 0 : t;
}

function Inner() {
  // Sync start: first time the dashboard opens this session.
  const syncStartRef = useRef<number>(Date.now());
  const [query, setQuery] = useState("");
  const [areaFilter, setAreaFilter] = useState<string>("__all__");
  const [incogFilter, setIncogFilter] = useState<string>("__all__");
  const [sortKey, setSortKey] = useState<keyof Row>("Captured Date (UTC)");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["raw-leads-api"],
    queryFn: async () => {
      const res = await fetch(API_URL, { method: "GET" });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const json = (await res.json()) as { rows?: Row[] };
      return Array.isArray(json.rows) ? json.rows : [];
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
  });

  // Only rows captured at/after sync start.
  const fresh = useMemo(() => {
    const start = syncStartRef.current;
    return (data ?? []).filter((r) => parseCapturedAt(r) >= start);
  }, [data]);

  const areaOptions = useMemo(
    () =>
      Array.from(
        new Set(fresh.map((r) => r["Account Area"]).filter((v): v is string => !!v && v.trim() !== "")),
      ).sort(),
    [fresh],
  );
  const incogOptions = useMemo(
    () =>
      Array.from(
        new Set(fresh.map((r) => r["Incog Account"]).filter((v): v is string => !!v && v.trim() !== "")),
      ).sort(),
    [fresh],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return fresh.filter((r) => {
      if (areaFilter !== "__all__" && (r["Account Area"] ?? "") !== areaFilter) return false;
      if (incogFilter !== "__all__" && (r["Incog Account"] ?? "") !== incogFilter) return false;
      if (!q) return true;
      return COLUMNS.some((c) => (r[c.key] ?? "").toString().toLowerCase().includes(q));
    });
  }, [fresh, query, areaFilter, incogFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      if (sortKey === "Captured Date (UTC)") {
        return (parseCapturedAt(a) - parseCapturedAt(b)) * (sortDir === "asc" ? 1 : -1);
      }
      const av = (a[sortKey] ?? "").toString().toLowerCase();
      const bv = (b[sortKey] ?? "").toString().toLowerCase();
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  useEffect(() => {
    setPage(1);
  }, [query, areaFilter, incogFilter, pageSize]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize);

  function toggleSort(k: keyof Row) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search any column…"
            className="h-9 pl-9"
          />
        </div>

        <Select value={areaFilter} onValueChange={setAreaFilter}>
          <SelectTrigger className="h-9 w-[170px]">
            <SelectValue placeholder="Account Area" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All areas</SelectItem>
            {areaOptions.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={incogFilter} onValueChange={setIncogFilter}>
          <SelectTrigger className="h-9 w-[170px]">
            <SelectValue placeholder="Incog Account" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All incog</SelectItem>
            {incogOptions.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          <div className="text-[12px] text-muted-foreground tabular-nums">
            {sorted.length} new {sorted.length === 1 ? "lead" : "leads"}
          </div>
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

      {/* Spreadsheet */}
      <div className="glass-card overflow-hidden">
        <div className="max-h-[calc(100vh-300px)] overflow-auto">
          <table className="crm-table w-max min-w-full border-separate border-spacing-0 text-[12.5px]">
            <thead className="sticky top-0 z-10">
              <tr>
                {COLUMNS.map((c) => (
                  <th
                    key={String(c.key)}
                    style={{ width: c.width, minWidth: c.width }}
                    className="border-b border-r border-border bg-surface px-3 py-2 text-left font-medium text-[11.5px] uppercase tracking-wide text-muted-foreground select-none"
                  >
                    <button
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort(c.key)}
                    >
                      {c.label}
                      {sortKey === c.key ? (
                        sortDir === "asc" ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowDown className="h-3 w-3" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3 w-3 opacity-40" />
                      )}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={COLUMNS.length} className="text-center text-muted-foreground py-12">
                    <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading leads…
                  </td>
                </tr>
              )}
              {!isLoading && pageRows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="text-center py-12 text-muted-foreground">
                    No new leads since sync start.
                  </td>
                </tr>
              )}
              {pageRows.map((r, i) => (
                <tr
                  key={i}
                  className={cn(
                    "hover:bg-accent/40 transition-colors",
                    i % 2 === 0 ? "bg-transparent" : "bg-surface/40",
                  )}
                >
                  {COLUMNS.map((c) => {
                    const v = r[c.key] ?? "";
                    const isLink = c.key === "Lead Link" && v;
                    return (
                      <td
                        key={String(c.key)}
                        style={{ width: c.width, minWidth: c.width }}
                        className={cn(
                          "border-b border-r border-border px-3 py-2 align-top text-foreground/90",
                          c.wrap ? "whitespace-normal" : "whitespace-nowrap truncate",
                        )}
                        title={typeof v === "string" ? v : undefined}
                      >
                        {isLink ? (
                          <a
                            href={v}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Open
                          </a>
                        ) : (
                          v || <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          Rows per page
          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
            <SelectTrigger className="h-8 w-[80px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[25, 50, 100, 200].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            Previous
          </Button>
          <div className="text-[12px] text-muted-foreground tabular-nums">
            Page {page} of {totalPages}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
