import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, RefreshCw, Download, Rocket, Link2, Trash2, Search, Globe, CheckCircle2, XCircle, HelpCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  launchIncognitonProfile,
  fetchIncognitonProfilesByGroup,
  pingIncogniton,
  INCOG_UNREACHABLE,
} from "@/lib/incogniton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export const Route = createFileRoute("/app/browser-profiles")({ component: Page });

type Profile = {
  id: string;
  profile_name: string;
  incogniton_profile_id: string;
  group_name: string | null;
  platform: string | null;
  linked_lead_id: string | null;
  last_launched_at: string | null;
  created_at: string;
};

type Lead = { id: string; customer_name: string };

function Page() {
  const auth = useAuth();
  return (
    <div>
      <PageHeader
        title="Browser Profiles"
        description="Incogniton anti-detect browser profiles synced from your local PC."
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
  const qc = useQueryClient();
  const auth = useAuth();
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("__all__");
  const [syncing, setSyncing] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [linkOpenFor, setLinkOpenFor] = useState<Profile | null>(null);

  const profiles = useQuery({
    queryKey: ["incog_profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("incogniton_profiles")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Profile[];
    },
  });

  const leads = useQuery({
    queryKey: ["qualified_leads_min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qualified_leads")
        .select("id, customer_name")
        .order("assigned_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Lead[];
    },
  });

  const leadMap = useMemo(() => {
    const m = new Map<string, string>();
    (leads.data ?? []).forEach((l) => m.set(l.id, l.customer_name));
    return m;
  }, [leads.data]);

  const groups = useMemo(
    () => Array.from(new Set((profiles.data ?? []).map((p) => p.group_name).filter((g): g is string => !!g))).sort(),
    [profiles.data],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (profiles.data ?? []).filter((p) => {
      if (groupFilter !== "__all__" && (p.group_name ?? "") !== groupFilter) return false;
      if (!q) return true;
      return (
        p.profile_name.toLowerCase().includes(q) ||
        (p.platform ?? "").toLowerCase().includes(q)
      );
    });
  }, [profiles.data, query, groupFilter]);

  async function sync() {
    setSyncing(true);
    try {
      const list = await fetchAllIncognitonProfiles();
      let upserted = 0;
      for (const p of list) {
        const id = p.profile_browser_id || p.profileID || p.id;
        if (!id) continue;
        const name = p.profileName || p.profile_name || p.name || `Profile ${String(id).slice(0, 6)}`;
        const group = p.profileGroup || p.profile_group || p.group || null;
        const { error } = await supabase
          .from("incogniton_profiles")
          .upsert(
            {
              incogniton_profile_id: String(id),
              profile_name: name,
              group_name: group,
              platform: p.platform ?? null,
              created_by: auth.user?.id,
            },
            { onConflict: "incogniton_profile_id", ignoreDuplicates: false },
          );
        if (!error) upserted++;
      }
      toast.success(`Synced ${upserted} profile${upserted === 1 ? "" : "s"} from Incogniton`);
      qc.invalidateQueries({ queryKey: ["incog_profiles"] });
    } catch (e) {
      const msg = (e as Error).message;
      toast.error(msg === INCOG_UNREACHABLE ? INCOG_UNREACHABLE : `Sync failed: ${msg}`);
    } finally {
      setSyncing(false);
    }
  }

  async function launch(p: Profile) {
    try {
      await launchIncognitonProfile(p.incogniton_profile_id);
      await supabase
        .from("incogniton_profiles")
        .update({ last_launched_at: new Date().toISOString() })
        .eq("id", p.id);
      qc.invalidateQueries({ queryKey: ["incog_profiles"] });
      toast.success("Profile opened in Incogniton");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function remove(p: Profile) {
    if (!confirm(`Delete profile "${p.profile_name}"? This only removes the row from your CRM.`)) return;
    const { error } = await supabase.from("incogniton_profiles").delete().eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    qc.invalidateQueries({ queryKey: ["incog_profiles"] });
  }

  function statusOf(p: Profile) {
    if (!p.last_launched_at) return "Idle";
    return Date.now() - new Date(p.last_launched_at).getTime() < 30 * 60 * 1000 ? "Active" : "Idle";
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search profile name or platform…"
            className="h-9 pl-9"
          />
        </div>
        <Select value={groupFilter} onValueChange={setGroupFilter}>
          <SelectTrigger className="h-9 w-[180px]"><SelectValue placeholder="Group" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All groups</SelectItem>
            {groups.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" onClick={() => setExportOpen(true)}>
            <Download className="h-3.5 w-3.5 mr-1.5" /> Export Group
          </Button>
          <Button onClick={sync} disabled={syncing}>
            {syncing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
            Sync from Incogniton
          </Button>
        </div>
      </div>

      <div className="bg-card border rounded-lg overflow-hidden">
        <table className="crm-table">
          <thead>
            <tr>
              <th>Profile</th><th>Profile ID</th><th>Group</th><th>Platform</th>
              <th>Linked Lead</th><th>Status</th><th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {profiles.isLoading && <tr><td colSpan={7} className="text-center py-6 text-muted-foreground">Loading…</td></tr>}
            {!profiles.isLoading && filtered.length === 0 && (
              <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">
                <Globe className="h-5 w-5 inline mr-2 opacity-50" />
                No profiles yet. Click "Sync from Incogniton" to pull from your local app.
              </td></tr>
            )}
            {filtered.map((p) => {
              const status = statusOf(p);
              return (
                <tr key={p.id}>
                  <td className="font-medium">{p.profile_name}</td>
                  <td className="font-mono text-[11px] text-muted-foreground">{p.incogniton_profile_id}</td>
                  <td className="text-[12.5px]">{p.group_name ?? "—"}</td>
                  <td className="text-[12.5px]">{p.platform ?? "—"}</td>
                  <td className="text-[12.5px]">
                    {p.linked_lead_id ? (leadMap.get(p.linked_lead_id) ?? <span className="text-muted-foreground/70 font-mono text-[11px]">{p.linked_lead_id.slice(0, 8)}…</span>) : "—"}
                  </td>
                  <td>
                    <span className={cn(
                      "text-[10.5px] px-2 py-0.5 rounded-full border",
                      status === "Active" ? "bg-success/10 text-success border-success/30" : "bg-muted text-muted-foreground border-border"
                    )}>{status}</span>
                  </td>
                  <td className="text-right space-x-1.5 whitespace-nowrap">
                    <Button size="sm" variant="outline" onClick={() => launch(p)} title="Launch">
                      <Rocket className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setLinkOpenFor(p)} title="Link to lead">
                      <Link2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => remove(p)} title="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {exportOpen && (
        <ExportDialog
          profiles={profiles.data ?? []}
          groups={groups}
          onClose={() => setExportOpen(false)}
        />
      )}
      {linkOpenFor && (
        <LinkLeadDialog
          profile={linkOpenFor}
          leads={leads.data ?? []}
          onClose={() => setLinkOpenFor(null)}
          onSaved={() => {
            setLinkOpenFor(null);
            qc.invalidateQueries({ queryKey: ["incog_profiles"] });
          }}
        />
      )}
    </div>
  );
}

function ExportDialog({ profiles, groups, onClose }: { profiles: Profile[]; groups: string[]; onClose: () => void }) {
  const [group, setGroup] = useState(groups[0] ?? "");
  const [format, setFormat] = useState<"csv" | "json">("csv");

  function download() {
    const rows = profiles.filter((p) => (p.group_name ?? "") === group);
    if (rows.length === 0) return toast.error("No profiles in this group");
    const fields = ["profile_name", "incogniton_profile_id", "group_name", "platform", "linked_lead_id"] as const;
    let blob: Blob;
    let filename: string;
    if (format === "csv") {
      const escape = (v: string | null) => {
        const s = v ?? "";
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = [fields.join(","), ...rows.map((r) => fields.map((f) => escape(r[f])).join(","))].join("\n");
      blob = new Blob([csv], { type: "text/csv" });
      filename = `incogniton-${group}.csv`;
    } else {
      const json = rows.map((r) => Object.fromEntries(fields.map((f) => [f, r[f] ?? ""])));
      blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
      filename = `incogniton-${group}.json`;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} profile${rows.length === 1 ? "" : "s"}`);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-card w-full max-w-md rounded-lg border p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4">Export Group</h2>
        <div className="space-y-4">
          <div>
            <Label className="block mb-1.5">Group</Label>
            <Select value={group} onValueChange={setGroup}>
              <SelectTrigger><SelectValue placeholder="Select group" /></SelectTrigger>
              <SelectContent>
                {groups.length === 0 && <SelectItem value="__none__" disabled>No groups</SelectItem>}
                {groups.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="block mb-2">Format</Label>
            <div className="flex gap-4 text-sm">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={format === "csv"} onChange={() => setFormat("csv")} /> CSV
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={format === "json"} onChange={() => setFormat("json")} /> JSON
              </label>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-5">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={download} disabled={!group}>Export</Button>
        </div>
      </div>
    </div>
  );
}

function LinkLeadDialog({ profile, leads, onClose, onSaved }: { profile: Profile; leads: Lead[]; onClose: () => void; onSaved: () => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const filtered = useMemo(() => {
    const s = q.toLowerCase().trim();
    if (!s) return leads.slice(0, 50);
    return leads.filter((l) => l.customer_name.toLowerCase().includes(s)).slice(0, 50);
  }, [leads, q]);

  async function save(leadId: string | null) {
    setBusy(true);
    const { error } = await supabase
      .from("incogniton_profiles")
      .update({ linked_lead_id: leadId })
      .eq("id", profile.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(leadId ? "Linked" : "Unlinked");
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-card w-full max-w-md rounded-lg border p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">Link "{profile.profile_name}" to a lead</h2>
        <p className="text-[12.5px] text-muted-foreground mt-1">Pick a qualified lead to associate this browser profile with.</p>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search leads…" className="mt-4" autoFocus />
        <div className="mt-3 max-h-72 overflow-y-auto border border-border rounded-md divide-y divide-border">
          {filtered.length === 0 && <div className="p-3 text-[12.5px] text-muted-foreground">No matches</div>}
          {filtered.map((l) => (
            <button
              key={l.id}
              onClick={() => save(l.id)}
              disabled={busy}
              className={cn(
                "w-full text-left px-3 py-2 text-[13px] hover:bg-accent transition-colors",
                profile.linked_lead_id === l.id && "bg-accent/60",
              )}
            >
              {l.customer_name}
              {profile.linked_lead_id === l.id && <span className="ml-2 text-[11px] text-primary">linked</span>}
            </button>
          ))}
        </div>
        <div className="flex justify-between gap-2 pt-4">
          {profile.linked_lead_id && (
            <Button variant="outline" onClick={() => save(null)} disabled={busy}>Unlink</Button>
          )}
          <Button variant="outline" onClick={onClose} className="ml-auto">Close</Button>
        </div>
      </div>
    </div>
  );
}
