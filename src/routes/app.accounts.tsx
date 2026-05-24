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
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/app/accounts")({ component: Page });

type Account = {
  id: string; name: string; area: string;
  latitude: number; longitude: number;
  notes: string | null; last_opened_at: string | null;
};

function Page() {
  const auth = useAuth();
  return (
    <div>
      <PageHeader title="Accounts" description="Sources where we capture leads from (groups, pages, areas)." />
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

  const list = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("accounts").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as Account[];
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
      <div className="flex justify-end">
        <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus className="h-4 w-4 mr-1" />New account</Button>
      </div>
      <div className="bg-card border rounded-lg overflow-hidden">
        <table className="crm-table">
          <thead>
            <tr><th>Name</th><th>Area</th><th>Coordinates</th><th>Notes</th><th className="text-right">Actions</th></tr>
          </thead>
          <tbody>
            {list.isLoading && <tr><td colSpan={5} className="text-center py-6 text-muted-foreground">Loading…</td></tr>}
            {list.data?.length === 0 && <tr><td colSpan={5} className="text-center py-6 text-muted-foreground">No accounts yet.</td></tr>}
            {list.data?.map((a) => (
              <tr key={a.id}>
                <td className="font-medium">{a.name}</td>
                <td>{a.area}</td>
                <td className="font-mono text-xs">{a.latitude.toFixed(4)}, {a.longitude.toFixed(4)}</td>
                <td className="max-w-sm"><div className="line-clamp-2 text-sm text-muted-foreground">{a.notes ?? "—"}</div></td>
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
      const payload = {
        name: form.name, area: form.area,
        latitude: Number(form.latitude), longitude: Number(form.longitude),
        notes: form.notes || null,
      };
      if (Number.isNaN(payload.latitude) || Number.isNaN(payload.longitude)) throw new Error("Invalid coordinates");
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
          <div><Label className="block mb-1.5">Area</Label><Input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} required /></div>
          <div className="flex gap-3">
            <div className="flex-1"><Label className="block mb-1.5">Latitude</Label><Input value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} required /></div>
            <div className="flex-1"><Label className="block mb-1.5">Longitude</Label><Input value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} required /></div>
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
