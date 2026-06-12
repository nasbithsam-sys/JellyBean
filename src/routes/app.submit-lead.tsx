import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Loader2, Upload, X, ImagePlus, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/app/submit-lead")({ component: Page });

const BUCKET = "lead-attachments";
const MAX_IMAGES = 5;
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per image

function Page() {
  const auth = useAuth();
  return (
    <RoleGate allow={["facebook", "seo", "admin"]} current={auth.primaryRole}>
      <SubmitLead />
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

function SubmitLead() {
  const auth = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState("");
  const [service, setService] = useState("");
  const [area, setArea] = useState("");
  const [number, setNumber] = useState("");
  const [context, setContext] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const role = auth.primaryRole ?? "submitter";

  const recent = useQuery({
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
        .limit(25);
      if (error) throw error;
      return (data ?? []) as unknown as LeadRow[];
    },
  });

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
    if (!name.trim() || !number.trim()) {
      toast.error("Name and number are required");
      return;
    }
    setSubmitting(true);
    try {
      const imageUrls = await uploadImages();
      const { error } = await supabase.from("qualified_leads").insert({
        customer_name: name.trim(),
        customer_number: number.trim(),
        service: service.trim() || null,
        main_area: area.trim() || null,
        context: context.trim() || null,
        images: imageUrls,
        submitted_by_role: role,
        created_by: auth.user.id,
        assigned_by: auth.user.id,
        cs_status: "new",
      });
      if (error) throw error;
      toast.success("Lead sent to CS");
      setName("");
      setService("");
      setArea("");
      setNumber("");
      setContext("");
      setFiles([]);
      qc.invalidateQueries({ queryKey: ["my-submitted-leads"] });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Submit a lead"
        description={`Send a lead directly to the CS team${role === "facebook" || role === "seo" ? ` as ${role.toUpperCase()}` : ""}.`}
      />
      <PageBody className="space-y-6 max-w-3xl">
        <form onSubmit={submit} className="glass-card p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="mb-1.5 block">Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Customer name"
                required
                maxLength={120}
              />
            </div>
            <div>
              <Label className="mb-1.5 block">Service</Label>
              <Input
                value={service}
                onChange={(e) => setService(e.target.value)}
                placeholder="e.g. Plumbing, AC repair"
                maxLength={120}
              />
            </div>
            <div>
              <Label className="mb-1.5 block">Area</Label>
              <Input
                value={area}
                onChange={(e) => setArea(e.target.value)}
                placeholder="City / neighborhood"
                maxLength={160}
              />
            </div>
            <div>
              <Label className="mb-1.5 block">Number</Label>
              <Input
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="Phone number"
                required
                maxLength={40}
                inputMode="tel"
              />
            </div>
          </div>

          <div>
            <Label className="mb-1.5 block">Context</Label>
            <Textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="Anything CS should know about this lead…"
              rows={4}
              maxLength={2000}
            />
          </div>

          <div>
            <Label className="mb-1.5 block">
              Attachments{" "}
              <span className="text-xs text-muted-foreground font-normal">
                (up to {MAX_IMAGES} images, 10 MB each)
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
                  className="relative h-24 w-24 rounded-md overflow-hidden border border-border bg-muted group"
                >
                  <img
                    src={URL.createObjectURL(f)}
                    alt={f.name}
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeFile(idx)}
                    className="absolute top-1 right-1 h-5 w-5 grid place-items-center rounded-full bg-background/90 text-foreground hover:bg-destructive hover:text-destructive-foreground transition-colors"
                    aria-label="Remove image"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {files.length < MAX_IMAGES && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="h-24 w-24 rounded-md border-2 border-dashed border-border hover:border-primary hover:bg-primary/5 transition-colors grid place-items-center text-muted-foreground hover:text-primary"
                >
                  <div className="flex flex-col items-center gap-1 text-[11px]">
                    <ImagePlus className="h-5 w-5" />
                    Add
                  </div>
                </button>
              )}
            </div>
          </div>

          <div className="flex justify-end pt-2 border-t border-border">
            <Button type="submit" disabled={submitting} size="lg">
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

        <div>
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-success" />
            Your recent submissions
          </h2>
          {recent.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (recent.data ?? []).length === 0 ? (
            <div className="text-sm text-muted-foreground glass-card p-6 text-center">
              No leads submitted yet.
            </div>
          ) : (
            <div className="space-y-2">
              {(recent.data ?? []).map((l) => (
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
