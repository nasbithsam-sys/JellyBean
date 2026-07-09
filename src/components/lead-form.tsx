import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ImagePlus, Loader2, Star, Upload, X, Plus, AlertTriangle, Video, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { formatPhone, normalizePhone } from "@/lib/crm-lite";
import { checkDuplicatePhone } from "@/lib/raw-leads.functions";
import { compressVideoInBrowser, MAX_VIDEO_BYTES, ALLOWED_VIDEO_MIME_TYPES, getVideoDimensions } from "@/lib/video-compressor";

const BUCKET = "lead-attachments";
const MAX_IMAGES = 20;
const MAX_BYTES = 10 * 1024 * 1024;

export type LeadReferenceMode = "manual-dropdown" | "auto-scraping" | "auto-fb" | "manual-text";

export type LeadFormValues = {
  customerName: string;
  customerNumber: string;
  area: string;
  service: string;
  context: string;
  exactCustomerText: string;
  reference: string;
  isImportant: boolean;
  files: File[];
  existingImages?: string[];
  extraNumbers?: string[];
  originalLeadLink?: string | null;
};

type LeadFormInitialValues = {
  customerName?: string;
  customerNumber?: string;
  area?: string;
  service?: string;
  context?: string;
  exactCustomerText?: string;
  reference?: string;
  isImportant?: boolean;
  extraNumbers?: string[];
  images?: string[];
  id?: string;
  originalLeadLink?: string | null;
};

export function formatPhoneInput(value: string): string {
  const digits = normalizePhone(value);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

export function uploadLeadImages({
  files,
  userId,
  supabase,
}: {
  files: File[];
  userId: string;
  supabase: {
    storage: {
      from: (bucket: string) => {
        upload: (
          path: string,
          file: File,
          options: { cacheControl: string; upsert: boolean; contentType: string },
        ) => Promise<{ error: { message: string } | null }>;
        getPublicUrl: (path: string) => { data: { publicUrl: string } };
      };
    };
  };
}) {
  return Promise.all(
    files.map(async (file) => {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type,
      });
      if (error) throw new Error(`Upload failed: ${error.message}`);
      return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    }),
  );
}

export function LeadForm({
  title = "Lead form",
  submitLabel = "Save",
  forwardedBy,
  showAttachments,
  areaRequired,
  referenceMode,
  initialValues,
  submitting,
  onDirtyChange,
  onCancel,
  onSubmit,
  disableDuplicateCheck = false,
}: {
  title?: string;
  submitLabel?: string;
  forwardedBy: string;
  showAttachments: boolean;
  areaRequired: boolean;
  referenceMode: LeadReferenceMode;
  initialValues?: LeadFormInitialValues;
  submitting?: boolean;
  onDirtyChange?: (isDirty: boolean) => void;
  onCancel: () => void;
  onSubmit: (values: LeadFormValues) => Promise<void>;
  disableDuplicateCheck?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const videoFileRef = useRef<HTMLInputElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const toastIdRef = useRef<string | number | null>(null);

  const [customerName, setCustomerName] = useState(initialValues?.customerName ?? "");
  const [customerNumber, setCustomerNumber] = useState(initialValues?.customerNumber ?? "");
  const [extraNumbers, setExtraNumbers] = useState<string[]>(initialValues?.extraNumbers ?? []);
  const [area, setArea] = useState(initialValues?.area ?? "");
  const [service, setService] = useState(initialValues?.service ?? "");
  const [context, setContext] = useState(initialValues?.context ?? "");
  const [exactCustomerText, setExactCustomerText] = useState(
    initialValues?.exactCustomerText ?? "",
  );
  const [reference, setReference] = useState(
    resolveInitialReference(referenceMode, initialValues?.reference),
  );
  const [importantValue, setImportantValue] = useState(
    (initialValues?.isImportant ?? false) ? "yes" : "no",
  );
  const [existingImages, setExistingImages] = useState<string[]>(initialValues?.images ?? []);
  const [files, setFiles] = useState<File[]>([]);
  const originalLeadLink = initialValues?.originalLeadLink ?? null;
  const [isCompressing, setIsCompressing] = useState(false);
  const [compressionProgress, setCompressionProgress] = useState(0);

  useEffect(() => {
    return () => {
      // Cleanup on unmount (if dialog closes)
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (toastIdRef.current) {
        toast.dismiss(toastIdRef.current);
      }
    };
  }, []);

  const checkDuplicate = useServerFn(checkDuplicatePhone);
  const phoneDigits = useMemo(
    () =>
      [customerNumber, ...extraNumbers]
        .map((p) => normalizePhone(p ?? ""))
        .filter((d) => d.length >= 7),
    [customerNumber, extraNumbers],
  );
  type DupMatch = {
    id: string;
    customer_name: string;
    customer_number: string;
    customer_number_2: string | null;
    assigned_at: string;
  };
  const duplicateQuery = useQuery({
    queryKey: ["lead-form-duplicate-phone", phoneDigits.join(",")],
    enabled: !disableDuplicateCheck && phoneDigits.length > 0,
    queryFn: async () => {
      const results = await Promise.all(
        phoneDigits.map((digits) => checkDuplicate({ data: { phone: digits } })),
      );
      return results.flatMap((r) => (r.matches ?? []) as DupMatch[]);
    },
    staleTime: 15_000,
  });
  const seenDup = new Set<string>();
  if (initialValues?.id) {
    seenDup.add(initialValues.id);
  }
  const uniqueDuplicates = disableDuplicateCheck
    ? []
    : (duplicateQuery.data ?? []).filter((m) => {
        if (seenDup.has(m.id)) return false;
        seenDup.add(m.id);
        return true;
      });
  const hasDuplicate = uniqueDuplicates.length > 0;

  const isDirty =
    customerName !== (initialValues?.customerName ?? "") ||
    customerNumber !== (initialValues?.customerNumber ?? "") ||
    area !== (initialValues?.area ?? "") ||
    service !== (initialValues?.service ?? "") ||
    context !== (initialValues?.context ?? "") ||
    exactCustomerText !== (initialValues?.exactCustomerText ?? "") ||
    reference !== resolveInitialReference(referenceMode, initialValues?.reference) ||
    importantValue !== ((initialValues?.isImportant ?? false) ? "yes" : "no") ||
    files.length > 0 ||
    existingImages.length !== (initialValues?.images?.length ?? 0) ||
    JSON.stringify(extraNumbers) !== JSON.stringify(initialValues?.extraNumbers ?? []);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  function addFiles(picked: FileList | null) {
    if (!picked) return;
    const incoming = Array.from(picked);
    const valid: File[] = [];
    for (const file of incoming) {
      if (!file.type.startsWith("image/")) {
        toast.error(`${file.name} is not an image`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        toast.error(`${file.name} is larger than 10 MB`);
        continue;
      }
      valid.push(file);
    }
    setFiles((prev) => {
      const merged = [...prev, ...valid];
      const allowedCount = MAX_IMAGES - (existingImages.length + prev.length);
      if (merged.length > allowedCount) {
        toast.error(`Maximum ${MAX_IMAGES} attachments limit reached`);
        return merged.slice(0, allowedCount);
      }
      return merged;
    });
    if (fileRef.current) fileRef.current.value = "";
  }

  async function addVideoFile(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    const file = picked[0];

    if (!ALLOWED_VIDEO_MIME_TYPES.includes(file.type)) {
      toast.error(`Invalid video format. Allowed: mp4, webm, mov.`);
      if (videoFileRef.current) videoFileRef.current.value = "";
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      toast.error(`Video is larger than 50 MB.`);
      if (videoFileRef.current) videoFileRef.current.value = "";
      return;
    }

    if (files.length >= MAX_IMAGES) {
      toast.error(`Maximum 20 attachments total.`);
      if (videoFileRef.current) videoFileRef.current.value = "";
      return;
    }

    // Smart skip compression for small videos (<= 10MB)
    if (file.size <= 10 * 1024 * 1024) {
      try {
        const { height } = await getVideoDimensions(file);
        if (height <= 720) {
          setFiles((prev) => [...prev, file]);
          toast.success("Video added!");
          if (videoFileRef.current) videoFileRef.current.value = "";
          return;
        }
      } catch (err) {
        console.warn("Failed to get video dimensions, falling back to compression", err);
      }
    }

    setIsCompressing(true);
    setCompressionProgress(0);
    const toastId = toast.loading("Compressing video...");
    toastIdRef.current = toastId;

    abortControllerRef.current = new AbortController();

    try {
      const compressedFile = await compressVideoInBrowser(
        file,
        (progress) => {
          setCompressionProgress(progress);
          toast.loading(`Compressing video (${progress}%)...`, { id: toastId });
        },
        abortControllerRef.current.signal
      );

      setFiles((prev) => [...prev, compressedFile]);
      toast.success("Video compressed and added!", { id: toastId });
    } catch (err) {
      if (err instanceof Error && err.message === "AbortError") {
        toast.error("Compression cancelled.", { id: toastId });
        return;
      }
      console.error("Video compression error:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(`Compression failed: ${errorMessage}`, { id: toastId });
    } finally {
      setIsCompressing(false);
      setCompressionProgress(0);
      abortControllerRef.current = null;
      toastIdRef.current = null;
      if (videoFileRef.current) videoFileRef.current.value = "";
    }
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, idx) => idx !== index));
  }

  function handlePaste(event: React.ClipboardEvent) {
    if (!showAttachments) return;
    const items = event.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length === 0) return;
    event.preventDefault();
    const dt = new DataTransfer();
    imageFiles.forEach((file) => dt.items.add(file));
    addFiles(dt.files);
    toast.success(`Pasted ${imageFiles.length} image${imageFiles.length === 1 ? "" : "s"}`);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!customerName.trim() || !customerNumber.trim()) {
      toast.error("Customer name and customer number are required");
      return;
    }
    if (areaRequired && !area.trim()) {
      toast.error("Area is required");
      return;
    }
    if (!service.trim()) {
      toast.error("Service is required");
      return;
    }
    if (!context.trim()) {
      toast.error("Context is required");
      return;
    }
    if (!exactCustomerText.trim()) {
      toast.error("Exact customer text is required");
      return;
    }
    if (!reference.trim()) {
      toast.error("Reference is required");
      return;
    }
    if (hasDuplicate) {
      toast.error("Duplicate phone number detected in the last 48 hours.");
      return;
    }

    await onSubmit({
      customerName: customerName.trim(),
      customerNumber: customerNumber.trim(),
      area: area.trim(),
      service: service.trim(),
      context: context.trim(),
      exactCustomerText: exactCustomerText.trim(),
      reference: reference.trim(),
      isImportant: importantValue === "yes",
      files,
      existingImages,
      extraNumbers: extraNumbers.filter((num) => num.trim() !== ""),
      originalLeadLink: originalLeadLink,
    });
  }

  return (
    <form onSubmit={handleSubmit} onPaste={handlePaste} className="space-y-5">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-[12px] text-muted-foreground">
          This unified form is now used for lead submission and forwarding.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Customer Name" required>
          <Input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            maxLength={120}
          />
        </Field>
        <Field label="Customer Number" required>
          <Input
            value={customerNumber}
            onChange={(e) => setCustomerNumber(formatPhoneInput(e.target.value))}
            maxLength={40}
            inputMode="tel"
          />
        </Field>
        <Field label="Area" required={areaRequired}>
          <Input
            value={area}
            onChange={(e) => setArea(e.target.value)}
            maxLength={160}
            placeholder={areaRequired ? "Required area" : "Optional area"}
          />
        </Field>
        <Field label="Service" required>
          <Input value={service} onChange={(e) => setService(e.target.value)} maxLength={120} />
        </Field>
      </div>

      <div className="space-y-2.5">
        <Label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Additional Numbers (Optional, Max 5)
        </Label>
        {extraNumbers.map((num, index) => (
          <div key={index} className="flex gap-2 items-center">
            <Input
              value={num}
              onChange={(e) => {
                const val = e.target.value;
                setExtraNumbers((prev) => prev.map((n, i) => (i === index ? formatPhoneInput(val) : n)));
              }}
              maxLength={40}
              placeholder={`Additional number ${index + 1}`}
              inputMode="tel"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => {
                setExtraNumbers((prev) => prev.filter((_, i) => i !== index));
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {extraNumbers.length < 5 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => setExtraNumbers((prev) => [...prev, ""])}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add another number
          </Button>
        )}
      </div>

      {originalLeadLink && (
        <div className="min-w-0">
          <Label className="block mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
            Original Post Link
          </Label>
          <a
            href={originalLeadLink}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 text-primary hover:underline text-sm font-medium truncate max-w-full"
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            View Post
          </a>
        </div>
      )}

      <Field label="Context" required>
        <Textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          rows={3}
          maxLength={2000}
        />
      </Field>

      <Field label="Exact Customer Text" required>
        <Textarea
          value={exactCustomerText}
          onChange={(e) => setExactCustomerText(e.target.value)}
          rows={4}
          maxLength={4000}
        />
      </Field>

      <Field label="Reference" required>
        {referenceMode === "manual-dropdown" ? (
          <select
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="ND">ND</option>
            <option value="Had a conversation on Nextdoor">Had a conversation on Nextdoor</option>
          </select>
        ) : referenceMode === "manual-text" ? (
          <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={160} />
        ) : (
          <Input value={reference} readOnly className="bg-muted/50" />
        )}
      </Field>

      <Field label="Forwarded By (Auto)">
        <Input value={forwardedBy} readOnly className="bg-muted/50" />
      </Field>

      <Field label="Mark as important" required>
        <RadioGroup value={importantValue} onValueChange={setImportantValue} className="grid gap-2">
          <label className="flex items-center gap-2 rounded-md border border-border bg-surface/60 px-3 py-2 cursor-pointer">
            <RadioGroupItem value="yes" id="important-yes" />
            <Star
              className={cn(
                "h-3.5 w-3.5",
                importantValue === "yes" ? "fill-warning text-warning" : "text-muted-foreground",
              )}
            />
            <span className="text-sm">Yes, mark as important</span>
          </label>
          <label className="flex items-center gap-2 rounded-md border border-border bg-surface/60 px-3 py-2 cursor-pointer">
            <RadioGroupItem value="no" id="important-no" />
            <span className="text-sm">No</span>
          </label>
        </RadioGroup>
      </Field>

      {showAttachments ? (
        <Field label="Add Attachment">
          <div className="space-y-3">
            <div className="text-[11px] text-muted-foreground flex gap-4">
              <span>Images: Up to 20 total, 10MB each.</span>
              <span>Videos: Up to 50MB (auto-compressed to 720p).</span>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
            <input
              ref={videoFileRef}
              type="file"
              accept="video/mp4,video/webm,video/quicktime"
              className="hidden"
              onChange={(e) => {
                void addVideoFile(e.target.files);
              }}
            />
            <div className="flex flex-wrap gap-3 items-start">
              {/* Existing Images from DB */}
              {existingImages.map((url, idx) => {
                const isVideo = /\.(mp4|webm|mov)(\?.*)?$/i.test(url);
                return (
                  <div
                    key={`existing-${idx}`}
                    className={cn(
                      "relative rounded-md overflow-hidden border border-border bg-muted",
                      isVideo ? "h-32 w-48" : "h-20 w-20"
                    )}
                  >
                    {isVideo ? (
                      <video
                        src={url}
                        className="h-full w-full object-cover"
                        controls
                        controlsList="nodownload"
                        preload="metadata"
                      />
                    ) : (
                      <img
                        src={url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => setExistingImages((prev) => prev.filter((_, i) => i !== idx))}
                      className="absolute top-0.5 right-0.5 h-5 w-5 grid place-items-center rounded-full bg-background/90 hover:bg-destructive hover:text-destructive-foreground transition-colors z-10"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
              
              {/* Newly added files */}
              {files.map((file, index) => {
                const isVideo = file.type.startsWith("video/");
                return (
                  <div
                    key={`${file.name}-${index}`}
                    className={cn(
                      "relative rounded-md overflow-hidden border border-border bg-muted",
                      isVideo ? "h-32 w-48" : "h-20 w-20"
                    )}
                  >
                    {isVideo ? (
                      <video
                        src={URL.createObjectURL(file)}
                        className="h-full w-full object-cover"
                        controls
                        controlsList="nodownload"
                        preload="metadata"
                      />
                    ) : (
                      <img
                        src={URL.createObjectURL(file)}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => removeFile(index)}
                      className="absolute top-0.5 right-0.5 h-5 w-5 grid place-items-center rounded-full bg-background/90 hover:bg-destructive hover:text-destructive-foreground transition-colors z-10"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
              {(files.length + existingImages.length) < MAX_IMAGES && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={isCompressing || submitting}
                    className="h-20 w-20 rounded-md border-2 border-dashed border-border hover:border-primary hover:bg-primary/5 transition-colors grid place-items-center text-muted-foreground hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="flex flex-col items-center gap-1 text-[11px]">
                      <ImagePlus className="h-4 w-4" />
                      Image
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => videoFileRef.current?.click()}
                    disabled={isCompressing || submitting}
                    className="h-20 w-20 rounded-md border-2 border-dashed border-border hover:border-primary hover:bg-primary/5 transition-colors grid place-items-center text-muted-foreground hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="flex flex-col items-center gap-1 text-[11px]">
                      {isCompressing ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {compressionProgress}%
                        </>
                      ) : (
                        <>
                          <Video className="h-4 w-4" />
                          Video
                        </>
                      )}
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>
        </Field>
      ) : null}

      {hasDuplicate ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-[12.5px]">
          <div className="flex items-center gap-2 font-semibold text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Duplicate phone number detected (last 48 hours)
          </div>
          <ul className="mt-2 space-y-1 text-foreground/80">
            {uniqueDuplicates.slice(0, 5).map((m) => (
              <li key={m.id}>
                {m.customer_name} — {formatPhone(m.customer_number)}
                {m.customer_number_2 ? ` / ${formatPhone(m.customer_number_2)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex justify-end gap-2 pt-2 border-t border-border">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (isDirty && !window.confirm("You have unsaved changes. Are you sure you want to close?")) return;
            if (abortControllerRef.current) abortControllerRef.current.abort();
            if (toastIdRef.current) toast.dismiss(toastIdRef.current);
            setIsCompressing(false);
            setCompressionProgress(0);
            onCancel();
          }}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={submitting || isCompressing || hasDuplicate}>
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Saving...
            </>
          ) : (
            <>
              <Upload className="h-4 w-4 mr-2" />
              {submitLabel}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

function resolveInitialReference(mode: LeadReferenceMode, provided?: string) {
  if (provided?.trim()) return provided;
  if (mode === "manual-dropdown") return "ND";
  if (mode === "auto-scraping") return "ND";
  if (mode === "auto-fb") return "Had a conversation on FB";
  return "";
}

function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <Label className="block mb-1.5">
        {label}
        {required ? <span className="text-destructive"> (Required)</span> : null}
      </Label>
      {children}
    </div>
  );
}
