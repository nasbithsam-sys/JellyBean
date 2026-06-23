import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Star, Upload, X, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { normalizePhone } from "@/lib/crm-lite";

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
  extraNumbers?: string[];
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
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
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
  const [files, setFiles] = useState<File[]>([]);

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
    extraNumbers.join() !== (initialValues?.extraNumbers ?? []).join();

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
      if (merged.length > MAX_IMAGES) {
        toast.error(`Maximum ${MAX_IMAGES} images`);
        return merged.slice(0, MAX_IMAGES);
      }
      return merged;
    });
    if (fileRef.current) fileRef.current.value = "";
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
      extraNumbers: extraNumbers.filter((num) => num.trim() !== ""),
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
            <option value="Scraping Manually">Scraping Manually</option>
            <option value="Listing">Listing</option>
            <option value="Posting">Posting</option>
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
            <div className="text-[11px] text-muted-foreground">
              Up to {MAX_IMAGES} images, 10 MB each. Paste with Ctrl/Cmd+V if needed.
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
            <div className="flex flex-wrap gap-3 items-start">
              {files.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
                  className="relative h-20 w-20 rounded-md overflow-hidden border border-border bg-muted"
                >
                  <img
                    src={URL.createObjectURL(file)}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeFile(index)}
                    className="absolute top-0.5 right-0.5 h-5 w-5 grid place-items-center rounded-full bg-background/90 hover:bg-destructive hover:text-destructive-foreground transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {files.length < MAX_IMAGES && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="h-20 w-20 rounded-md border-2 border-dashed border-border hover:border-primary hover:bg-primary/5 transition-colors grid place-items-center text-muted-foreground hover:text-primary"
                >
                  <div className="flex flex-col items-center gap-1 text-[11px]">
                    <ImagePlus className="h-4 w-4" />
                    Add
                  </div>
                </button>
              )}
            </div>
          </div>
        </Field>
      ) : null}

      <div className="flex justify-end gap-2 pt-2 border-t border-border">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (isDirty && !window.confirm("You have unsaved changes. Are you sure you want to close?")) return;
            onCancel();
          }}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
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
  if (mode === "manual-dropdown") return "Scraping Manually";
  if (mode === "auto-scraping") return "Scraping";
  if (mode === "auto-fb") return "FB";
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
