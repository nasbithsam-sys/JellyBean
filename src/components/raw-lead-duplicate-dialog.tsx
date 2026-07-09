import { CacheEntry } from "@/lib/raw-leads.functions";
import { FrontendDuplicateMatch } from "@/lib/raw-lead-duplicate-detector";
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
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface RawLeadDuplicateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentLead: CacheEntry | null;
  matches: FrontendDuplicateMatch[];
  onSendToDuplicateFilter: () => Promise<void>;
}

export function RawLeadDuplicateDialog({
  open,
  onOpenChange,
  currentLead,
  matches,
  onSendToDuplicateFilter,
}: RawLeadDuplicateDialogProps) {
  const [isBusy, setIsBusy] = useState(false);

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
            This lead matches other visible Raw Leads by exact details or high similarity.
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
              <h4 className="text-sm font-semibold text-foreground">Matched Leads ({matches.length})</h4>
              {matches.map((match, idx) => (
                <div key={match.matchedLeadId || idx} className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                          match.matchType === "Exact Match" 
                            ? "bg-destructive/15 text-destructive"
                            : "bg-warning/20 text-warning-foreground" // Use generic warning colors if available, or just orange
                        )} style={{ 
                          backgroundColor: match.matchType === "Exact Match" ? "" : "rgba(249, 115, 22, 0.15)",
                          color: match.matchType === "Exact Match" ? "" : "rgb(234, 88, 12)"
                        }}>
                          {match.matchType}
                        </span>
                        {match.matchType === "90% Similar" && (
                          <span className="text-xs font-semibold text-muted-foreground">
                            {match.similarityScore}% Similar
                          </span>
                        )}
                      </div>
                      <div className="text-[11.5px] text-muted-foreground flex flex-wrap gap-x-2 gap-y-1 mt-1">
                        {match.reasons.map((r, i) => (
                          <span key={i} className="flex items-center gap-1">
                            <span className="w-1 h-1 rounded-full bg-muted-foreground/50" />
                            {r}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-[12px] bg-muted/20 p-3 rounded-md">
                    <div>
                      <span className="text-muted-foreground block mb-0.5 text-[10px] uppercase">Account</span>
                      <span className="font-medium truncate block" title={match.matchedLead.data["Account Name"]}>
                        {match.matchedLead.data["Account Name"] || "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block mb-0.5 text-[10px] uppercase">Phone</span>
                      <span className="font-medium truncate block">
                        {formatPhone(match.matchedLead.phone)}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-muted-foreground block mb-0.5 text-[10px] uppercase">Snippet</span>
                      <span className="line-clamp-2 text-muted-foreground/80 italic">
                        {match.matchedLead.data["Post Text"] || "—"}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
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
