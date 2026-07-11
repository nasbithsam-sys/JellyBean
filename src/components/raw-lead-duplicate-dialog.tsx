import { CacheEntry } from "@/lib/raw-leads.functions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";

interface RawLeadDuplicateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentLead: CacheEntry | null;
  onSendToDuplicateFilter: () => Promise<void>;
}

type RawMatch = {
  type: "raw";
  data: {
    id: string;
    category: string | null;
    assigned_myself_at: string | null;
    assigned_to: string | null;
    phone: string | null;
    captured_at: string | null;
    data: Record<string, string>;
  };
  location: string;
};

type QualifiedMatch = {
  type: "qualified";
  data: {
    id: string;
    customer_name: string | null;
    customer_number: string | null;
    sub_area: string | null;
    post_text: string | null;
    cs_status: string | null;
    assigned_to: string | null;
    assigned_at: string | null;
    created_at: string | null;
  };
  assignee: { name: string | null; email: string | null } | null;
};

type MatchState = RawMatch | QualifiedMatch;

function rawCategoryLocation(row: RawMatch["data"]): string {
  const c = (row.category || "").toLowerCase();
  if (c === "forwarded") return "Forwarded";
  if (c === "wrong") return "Wrong Post";
  if (c === "not_found") return "Number Not Found";
  if (c === "duplicate") return "Duplicate";
  if (!c) return row.assigned_myself_at ? "Assigned Myself" : "New";
  return c;
}

function currentLeadLocation(row: CacheEntry): string {
  const c = (row.category || "").toLowerCase();
  if (c === "forwarded") return "Forwarded";
  if (c === "wrong") return "Wrong Post";
  if (c === "not_found") return "Number Not Found";
  if (c === "duplicate") return "Duplicate";
  if (!c) return row.assigned_myself_at ? "Assigned Myself" : "New";
  return c;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  try {
    return new Date(parsed).toLocaleString();
  } catch {
    return value;
  }
}

export function RawLeadDuplicateDialog({
  open,
  onOpenChange,
  currentLead,
  onSendToDuplicateFilter,
}: RawLeadDuplicateDialogProps) {
  const [isBusy, setIsBusy] = useState(false);
  const [isLoadingMatch, setIsLoadingMatch] = useState(false);
  const [matchData, setMatchData] = useState<MatchState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !currentLead) {
      setMatchData(null);
      setLoadError(null);
      return;
    }

    const hasRef = !!(currentLead.duplicate_of_qualified_lead_id || currentLead.duplicate_of_raw_lead_id);
    if (!hasRef || !currentLead.id) {
      setMatchData(null);
      return;
    }
    const currentId = currentLead.id;

    async function fetchMatch() {
      setIsLoadingMatch(true);
      setLoadError(null);
      try {
        const { data, error } = await supabase.rpc(
          "get_raw_lead_duplicate_match_preview" as never,
          { _current_raw_lead_id: currentId } as never,
        );
        if (error) throw error;
        const payload = data as { type: string | null; data?: unknown; assignee?: unknown } | null;
        if (!payload || !payload.type || !payload.data) {
          setMatchData(null);
          return;
        }
        if (payload.type === "qualified") {
          setMatchData({
            type: "qualified",
            data: payload.data as QualifiedMatch["data"],
            assignee: (payload.assignee as QualifiedMatch["assignee"]) ?? null,
          });
        } else if (payload.type === "raw") {
          const raw = payload.data as RawMatch["data"];
          setMatchData({ type: "raw", data: raw, location: rawCategoryLocation(raw) });
        }
      } catch (err) {
        if (import.meta.env.DEV) {
          console.error("Failed to fetch duplicate match details", err);
        }
        setLoadError("Previous lead details could not be loaded.");
      } finally {
        setIsLoadingMatch(false);
      }
    }

    fetchMatch();
  }, [open, currentLead]);

  if (!currentLead) return null;

  async function handleSendToDuplicate() {
    setIsBusy(true);
    try {
      await onSendToDuplicateFilter();
    } finally {
      setIsBusy(false);
    }
  }

  const curName = currentLead.data["Account Name"] || "—";
  const curArea = currentLead.data["Sub Area / Neighborhood"] || "—";
  const curPosted = currentLead.data["Posted Date & Time"] || "—";
  const curText = currentLead.data["Post Text"] || "—";
  const curLoc = currentLeadLocation(currentLead);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!isBusy) onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="p-6 pb-4">
          <DialogTitle className="text-xl text-destructive">Duplicate Lead Detected</DialogTitle>
          <DialogDescription>
            This incoming lead matched an existing record during import.
            {currentLead.duplicate_match_type && (
              <span className="ml-1">
                Match type:{" "}
                <span className="font-medium text-foreground">{currentLead.duplicate_match_type}</span>
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 px-6 pb-2">
          <div className="space-y-6">
            {/* NEW / CURRENT LEAD */}
            <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-destructive">
                  New Duplicate Lead
                </h4>
                <span className="text-[11px] rounded-full bg-destructive/15 text-destructive px-2 py-0.5 font-medium">
                  {curLoc}
                </span>
              </div>
              <DetailGrid
                items={[
                  { label: "Account Name", value: curName },
                  { label: "Sub Area / Neighborhood", value: curArea },
                  { label: "Posted Date & Time", value: curPosted },
                  { label: "Phone", value: currentLead.phone || "—" },
                ]}
              />
              <div className="mt-3">
                <span className="text-muted-foreground block mb-0.5 text-[10px] uppercase">Post Text</span>
                <p className="text-[12px] whitespace-pre-wrap text-foreground/90">{curText}</p>
              </div>
            </section>

            {/* PREVIOUS MATCHED LEAD */}
            <section className="rounded-lg border p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Previous Matched Lead
                </h4>
                {matchData?.type === "qualified" ? (
                  <span className="text-[11px] rounded-full bg-primary/15 text-primary px-2 py-0.5 font-medium">
                    Forwarded to CS
                    {matchData.data.cs_status ? ` · ${matchData.data.cs_status}` : ""}
                  </span>
                ) : matchData?.type === "raw" ? (
                  <span className="text-[11px] rounded-full bg-muted text-foreground/80 px-2 py-0.5 font-medium">
                    {matchData.location}
                  </span>
                ) : null}
              </div>

              {isLoadingMatch && (
                <div className="flex items-center justify-center p-6 text-muted-foreground text-[12px]">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Loading match details…
                </div>
              )}

              {!isLoadingMatch && !matchData && (
                <p className="text-[12px] text-muted-foreground italic">
                  {loadError || currentLead.duplicate_reason || "Previous lead details could not be loaded."}
                </p>
              )}

              {matchData?.type === "raw" && (
                <>
                  <DetailGrid
                    items={[
                      { label: "Account Name", value: matchData.data.data?.["Account Name"] || "—" },
                      {
                        label: "Sub Area / Neighborhood",
                        value: matchData.data.data?.["Sub Area / Neighborhood"] || "—",
                      },
                      {
                        label: "Posted Date & Time",
                        value: matchData.data.data?.["Posted Date & Time"] || "—",
                      },
                      { label: "Phone", value: matchData.data.phone || "—" },
                    ]}
                  />
                  <div className="mt-3">
                    <span className="text-muted-foreground block mb-0.5 text-[10px] uppercase">Post Text</span>
                    <p className="text-[12px] whitespace-pre-wrap text-foreground/90">
                      {matchData.data.data?.["Post Text"] || "—"}
                    </p>
                  </div>
                </>
              )}

              {matchData?.type === "qualified" && (
                <>
                  <DetailGrid
                    items={[
                      { label: "Customer Name", value: matchData.data.customer_name || "—" },
                      { label: "Sub Area / Neighborhood", value: matchData.data.sub_area || "—" },
                      { label: "Forwarded / Assigned At", value: formatDateTime(matchData.data.assigned_at || matchData.data.created_at) },
                      { label: "Phone", value: matchData.data.customer_number || "—" },
                      { label: "CS Status", value: matchData.data.cs_status || "—" },
                      {
                        label: "Assigned CS",
                        value:
                          matchData.assignee?.name ||
                          matchData.assignee?.email ||
                          (matchData.data.assigned_to ? "Assigned" : "Unassigned"),
                      },
                    ]}
                  />
                  <div className="mt-3">
                    <span className="text-muted-foreground block mb-0.5 text-[10px] uppercase">Post Text</span>
                    <p className="text-[12px] whitespace-pre-wrap text-foreground/90">
                      {matchData.data.post_text || "—"}
                    </p>
                  </div>
                </>
              )}
            </section>

            {currentLead.duplicate_reason && (
              <p className="text-[11.5px] text-muted-foreground">
                <span className="font-medium text-foreground/80">Reason: </span>
                {currentLead.duplicate_reason}
                {currentLead.duplicate_key ? ` · key: ${currentLead.duplicate_key}` : ""}
              </p>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="p-6 pt-4 bg-background border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isBusy}>
            Continue
          </Button>
          <Button variant="destructive" onClick={handleSendToDuplicate} disabled={isBusy}>
            {isBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send to Duplicate Filter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailGrid({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-[12px]">
      {items.map((item) => (
        <div key={item.label}>
          <span className="text-muted-foreground block mb-0.5 text-[10px] uppercase">{item.label}</span>
          <span className="font-medium truncate block" title={item.value}>
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}
