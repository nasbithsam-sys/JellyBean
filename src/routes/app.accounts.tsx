import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus, Pencil, Trash2, Download, CheckCircle2, AlertCircle, MinusCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/accounts")({ component: Page });

type Account = {
  id: string; name: string; area: string | null;
  latitude: number | null; longitude: number | null;
  notes: string | null; last_opened_at: string | null;
  incogniton_profile_id: string | null;
  profile_group: string | null;
  imported_at: string | null;
  status: string;
};

function Page() {
  const auth = useAuth();
  return (
    <div>
      <PageHeader title="Accounts" description="Sources where we capture leads from (Incogniton profiles / groups / pages)." />
      <PageBody>
        <RoleGate allow={["admin", "marketing"]} current={auth.primaryRole}>
          <Inner />
        </RoleGate>
      </PageBody>
    </div>
  );
}

function Inner() {
  const qc = useQueryClient();
  const auth = useAuth();
  const [editing, setEditing] = useState<Account | null>(null);
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const list = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("accounts").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as unknown as Account[];
    },
  });

  async function remove(id: string) {
    if (!confirm("Delete this account?")) return;
    const { error } = await supabase.from("accounts").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    qc.invalidateQueries({ queryKey: ["accounts"] });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => setImportOpen(true)}>
          <Download className="h-4 w-4 mr-1.5" /> Import from Incogniton
        </Button>
        <Button onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" /> New account
        </Button>
      </div>
      <div className="bg-card border rounded-lg overflow-hidden">
        <table className="crm-table">
          <thead>
            <tr>
              <th>Name</th><th>Profile ID</th><th>Group</th><th>Area</th>
              <th>Coordinates</th><th>Status</th><th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && <tr><td colSpan={7} className="text-center py-6 text-muted-foreground">Loading…</td></tr>}
            {list.data?.length === 0 && <tr><td colSpan={7} className="text-center py-6 text-muted-foreground">No accounts yet — import from Incogniton or add one manually.</td></tr>}
            {list.data?.map((a) => (
              <tr key={a.id}>
                <td className="font-medium">{a.name}</td>
                <td className="font-mono text-[11px] text-muted-foreground">{a.incogniton_profile_id ?? "—"}</td>
                <td className="text-[12.5px]">{a.profile_group ?? "—"}</td>
                <td>{a.area ?? <span className="text-muted-foreground/70">unset</span>}</td>
                <td className="font-mono text-xs">
                  {a.latitude !== null && a.longitude !== null
                    ? `${a.latitude.toFixed(4)}, ${a.longitude.toFixed(4)}`
                    : <span className="text-muted-foreground/70">unset</span>}
                </td>
                <td>
                  <span className={cn(
                    "text-[10.5px] px-2 py-0.5 rounded-full border capitalize",
                    a.status === "active" ? "bg-success/10 text-success border-success/30" : "bg-muted text-muted-foreground border-border"
                  )}>{a.status}</span>
                </td>
                <td className="text-right space-x-2 whitespace-nowrap">
                  <Button size="sm" variant="outline" onClick={() => { setEditing(a); setOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
                  {auth.primaryRole === "admin" && (
                    <Button size="sm" variant="outline" onClick={() => remove(a.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && <AccountDialog account={editing} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["accounts"] }); }} />}
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} onDone={() => qc.invalidateQueries({ queryKey: ["accounts"] })} />}
    </div>
  );
}

function AccountDialog({ account, onClose, onSaved }: { account: Account | null; onClose: () => void; onSaved: () => void }) {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: account?.name ?? "",
    area: account?.area ?? "",
    latitude: account?.latitude?.toString() ?? "",
    longitude: account?.longitude?.toString() ?? "",
    notes: account?.notes ?? "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const lat = form.latitude.trim() ? Number(form.latitude) : null;
      const lng = form.longitude.trim() ? Number(form.longitude) : null;
      if ((lat !== null && Number.isNaN(lat)) || (lng !== null && Number.isNaN(lng))) throw new Error("Invalid coordinates");
      const payload = {
        name: form.name,
        area: form.area || null,
        latitude: lat,
        longitude: lng,
        notes: form.notes || null,
      };
      if (account) {
        const { error } = await supabase.from("accounts").update(payload).eq("id", account.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("accounts").insert({ ...payload, created_by: auth.user?.id });
        if (error) throw error;
      }
      toast.success(account ? "Updated" : "Created");
      onSaved();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-card w-full max-w-md rounded-lg border p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4">{account ? "Edit account" : "New account"}</h2>
        <form onSubmit={submit} className="space-y-3">
          <div><Label className="block mb-1.5">Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          <div><Label className="block mb-1.5">Area</Label><Input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} placeholder="e.g. Brooklyn / 11201" /></div>
          <div className="flex gap-3">
            <div className="flex-1"><Label className="block mb-1.5">Latitude</Label><Input value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} placeholder="40.6782" /></div>
            <div className="flex-1"><Label className="block mb-1.5">Longitude</Label><Input value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} placeholder="-73.9442" /></div>
          </div>
          <div><Label className="block mb-1.5">Notes</Label><Textarea rows={3} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}{account ? "Save" : "Create"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

type ImportResult = { id: string; status: "imported" | "exists" | "failed"; reason?: string; name?: string };

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const auth = useAuth();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ImportResult[]>([]);

  async function run() {
    const ids = Array.from(new Set(text.split(/\s+/).map((s) => s.trim()).filter(Boolean)));
    if (ids.length === 0) {
      toast.error("Paste at least one Incogniton Profile ID");
      return;
    }
    setBusy(true);
    setResults([]);
    const out: ImportResult[] = [];

    // Check existing
    const { data: existing } = await supabase
      .from("accounts")
      .select("incogniton_profile_id")
      .in("incogniton_profile_id", ids);
    const existingSet = new Set((existing ?? []).map((r) => r.incogniton_profile_id));

    for (const id of ids) {
      if (existingSet.has(id)) {
        out.push({ id, status: "exists" });
        setResults([...out]);
        continue;
      }
      try {
        // Incogniton local API — fetch only selected profile
        const res = await fetch(`http://localhost:35000/profile/get?profileID=${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = await res.json();
        // The API returns the profile data; handle both shapes defensively
        const profile = payload?.data ?? payload?.profile ?? payload;
        const name: string = profile?.profileName || profile?.profile_name || profile?.name || `Profile ${id.slice(0, 6)}`;
        const group: string | null = profile?.profileGroup || profile?.profile_group || profile?.group || null;

        const { error } = await supabase.from("accounts").insert({
          name,
          area: null,
          latitude: null,
          longitude: null,
          incogniton_profile_id: id,
          profile_group: group,
          imported_at: new Date().toISOString(),
          status: "active",
          created_by: auth.user?.id,
        });
        if (error) throw error;
        out.push({ id, status: "imported", name });
      } catch (e) {
        const msg = (e as Error).message;
        const hint = msg.includes("Failed to fetch")
          ? "Incogniton not reachable on localhost:35000"
          : msg;
        out.push({ id, status: "failed", reason: hint });
      }
      setResults([...out]);
    }
    setBusy(false);
    const importedCount = out.filter((r) => r.status === "imported").length;
    if (importedCount > 0) {
      toast.success(`Imported ${importedCount} account${importedCount === 1 ? "" : "s"}`);
      onDone();
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-card w-full max-w-lg rounded-lg border p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">Import from Incogniton</h2>
        <p className="text-[12.5px] text-muted-foreground mt-1">
          Open Incogniton, select the profiles you want to monitor, copy their Profile IDs, and paste them below — one per line.
          Only these IDs will be fetched from <span className="font-mono">localhost:35000</span>.
        </p>

        <div className="mt-4">
          <Label className="block mb-1.5">Incogniton Profile IDs</Label>
          <Textarea
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"abc123\nxyz456\npqr789"}
            className="font-mono text-[12.5px]"
            disabled={busy}
          />
        </div>

        {results.length > 0 && (
          <div className="mt-4 border border-border rounded-md max-h-56 overflow-y-auto divide-y divide-border">
            {results.map((r) => (
              <div key={r.id} className="flex items-center gap-2 px-3 py-2 text-[12.5px]">
                {r.status === "imported" && <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />}
                {r.status === "exists" && <MinusCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                {r.status === "failed" && <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                <span className="font-mono text-[11.5px] text-muted-foreground truncate">{r.id}</span>
                <span className="ml-auto text-[11.5px]">
                  {r.status === "imported" && <span className="text-success">Imported{r.name ? ` · ${r.name}` : ""}</span>}
                  {r.status === "exists" && <span className="text-muted-foreground">Already imported</span>}
                  {r.status === "failed" && <span className="text-destructive truncate max-w-[200px] inline-block align-middle">{r.reason}</span>}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {results.length > 0 ? "Close" : "Cancel"}
          </Button>
          <Button onClick={run} disabled={busy || !text.trim()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {busy ? "Importing…" : "Import"}
          </Button>
        </div>
      </div>
    </div>
  );
}
