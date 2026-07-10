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

export function RawLeadDuplicateDialog({
  open,
  onOpenChange,
  currentLead,
  onSendToDuplicateFilter,
}: RawLeadDuplicateDialogProps) {
  const [isBusy, setIsBusy] = useState(false);
  const [isLoadingMatch, setIsLoadingMatch] = useState(false);
  const [matchData, setMatchData] = useState<any | null>(null);

  useEffect(() => {
    if (!open || !currentLead) {
      setMatchData(null);
      return;
    }

    async function fetchMatch() {
      setIsLoadingMatch(true);
      try {
        if (currentLead?.duplicate_of_qualified_lead_id) {
          const { data } = await supabase
            .from("qualified_leads")
            .select("*")
            .eq("id", currentLead.duplicate_of_qualified_lead_id)
            .single();
          if (data) setMatchData({ type: "qualified", data });
        } else if (currentLead?.duplicate_of_raw_lead_id) {
          const { data } = await supabase
            .from("raw_lead_cache")
            .select("*")
            .eq("id", currentLead.duplicate_of_raw_lead_id)
            .single();
          if (data) setMatchData({ type: "raw", data });
        }
      } catch (err) {
        console.error("Failed to fetch match details", err);
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

  function formatPhone(p: string | null | undefined) {
    if (!p) return "—";
    return p;
  }

  return (
    <Dialog open={open} onOpenChange={(o) => {
      if (!isBusy) onOpenChange(o);
    }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="p-6 pb-4">
          <DialogTitle className="text-xl text-destructive flex items-center gap-2">
            Duplicate Lead Detected
          </DialogTitle>
          <DialogDescription>
            This lead matched an existing record during import.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 px-6 pb-2">
          <div className="space-y-6">
            {/* Current Lead Summary */}
            <div className="rounded-lg border bg-muted/30 p-4">
              <h4 className="text-sm font-semibold mb-2 text-foreground">Current Lead</h4>
              <div className="grid grid-cols-2 gap-4 text-[12px]">
                <div>
                  <span className="text-muted-foreground block mb-1">Account / Name</span>
                  <span className="font-medium">{currentLead.data["Account Name"] || "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block mb-1">Phone</span>
                  <span className="font-medium">{formatPhone(currentLead.phone)}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground block mb-1">Lead Snippet</span>
                  <span className="line-clamp-2 text-muted-foreground/80 italic">
                    {currentLead.data["Post Text"] || "—"}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-foreground">Matched Database Record</h4>
              
              {isLoadingMatch && (
                <div className="flex items-center justify-center p-8 text-muted-foreground">
                  <Loader2 className="w-6 h-6 animate-spin mr-2" />
                  Loading match details...
                </div>
              )}

              {!isLoadingMatch && currentLead.duplicate_reason && (
                <div className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-destructive/15 text-destructive">
                          Exact Match
                        </span>
                      </div>
                      <div className="text-[11.5px] text-muted-foreground flex flex-wrap gap-x-2 gap-y-1 mt-1">
                        <span className="flex items-center gap-1">
                          <span className="w-1 h-1 rounded-full bg-muted-foreground/50" />
                          {currentLead.duplicate_reason}
                        </span>
                        {currentLead.duplicate_match_type && (
                          <span className="flex items-center gap-1">
                            <span className="w-1 h-1 rounded-full bg-muted-foreground/50" />
                            {currentLead.duplicate_match_type}: {currentLead.duplicate_key}
                          </span>
                        )}
                        {matchData?.type === "qualified" && (
                          <span className="flex items-center gap-1 text-primary font-medium">
                            <span className="w-1 h-1 rounded-full bg-primary/50" />
                            Already Forwarded to CS
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {matchData && matchData.type === "raw" && (
                    <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-[12px] bg-muted/20 p-3 rounded-md">
                      <div>
                        <span className="text-muted-foreground block mb-0.5 text-[10px] uppercase">Account</span>
                        <span className="font-medium truncate block" title={matchData.data.data["Account Name"]}>
                          {matchData.data.data["Account Name"] || "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block mb-0.5 text-[10px] uppercase">Phone</span>
                        <span className="font-medium truncate block">
                          {formatPhone(matchData.data.phone)}
                        </span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-muted-foreground block mb-0.5 text-[10px] uppercase">Snippet</span>
                        <span className="line-clamp-2 text-muted-foreground/80 italic">
                          {matchData.data.data["Post Text"] || "—"}
                        </span>
                      </div>
                    </div>
                  )}

                  {matchData && matchData.type === "qualified" && (
                    <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-[12px] bg-muted/20 p-3 rounded-md">
                      <div>
                        <span className="text-muted-foreground block mb-0.5 text-[10px] uppercase">Customer Name</span>
                        <span className="font-medium truncate block">
                          {matchData.data.customer_name || "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block mb-0.5 text-[10px] uppercase">Phone</span>
                        <span className="font-medium truncate block">
                          {formatPhone(matchData.data.customer_number)}
                        </span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-muted-foreground block mb-0.5 text-[10px] uppercase">Snippet / Text</span>
                        <span className="line-clamp-2 text-muted-foreground/80 italic">
                          {matchData.data.post_text || "—"}
                        </span>
                      </div>
                    </div>
                  )}

                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="p-6 pt-4 bg-background border-t">
          <Button 
            variant="outline" 
            onClick={() => onOpenChange(false)}
            disabled={isBusy}
          >
            Continue
          </Button>
          <Button 
            variant="destructive" 
            onClick={handleSendToDuplicate}
            disabled={isBusy}
          >
            {isBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send to Duplicate Filter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
