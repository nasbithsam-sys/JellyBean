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
import { Loader2, Download, Rocket, Trash2, Search, Globe, Plus, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { launchIncognitonProfile } from "@/lib/incogniton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export const Route = createFileRoute("/app/browser-profiles")({ component: Page });

type LaunchHistoryEntry = { at: string; by: string | null };

type Profile = {
  id: string;
  profile_name: string;
  incogniton_profile_id: string;
  group_name: string | null;
  last_launched_at: string | null;
  launched_by_name: string | null;
  launched_by_email: string | null;
  created_at: string;
  latitude: number | null;
  longitude: number | null;
  account_area: string | null;
  launch_history: LaunchHistoryEntry[] | null;
};

function Page() {
  const auth = useAuth();
  return (
    <div>
      <PageHeader
        title="Browser Profiles"
        description="Add your Incogniton profile IDs here and launch them with one click."
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
  const [addOpen, setAddOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [linkOpenFor, setLinkOpenFor] = useState<Profile | null>(null);
  const [howToOpen, setHowToOpen] = useState(false);

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
      if (!q) return true;
      return (
        p.profile_name.toLowerCase().includes(q) ||
        p.incogniton_profile_id.toLowerCase().includes(q) ||
        (p.platform ?? "").toLowerCase().includes(q)
      );
    });
  }, [profiles.data, query]);

  async function launch(p: Profile) {
    toast.loading("Launching profile…", { id: "launch" });
    try {
      await launchIncognitonProfile(p.incogniton_profile_id);
      // Update last launched timestamp + who launched it (best-effort)
      const user = auth.user;
      supabase
        .from("incogniton_profiles")
        .update({
          last_launched_at: new Date().toISOString(),
          launched_by_name: user?.user_metadata?.full_name ?? user?.email?.split("@")[0] ?? "Unknown",
          launched_by_email: user?.email ?? null,
        })
        .eq("id", p.id)
        .then(() => qc.invalidateQueries({ queryKey: ["incog_profiles"] }));
      // Launch command was sent — Incogniton should open the profile now.
      // (We can't confirm it opened because the browser blocks reading localhost responses from HTTPS,
      //  but the request IS sent and Incogniton processes it.)
      toast.success("Launch command sent ✓ — Incogniton should open the profile now.", { id: "launch" });
    } catch (e) {
      toast.error(
        "Could not launch. Make sure: (1) Incogniton is open, (2) the Bridge is installed on this PC. See README.txt in the bridge folder.",
        { id: "launch", duration: 6000 },
      );
    }
  }

  async function remove(p: Profile) {
    if (!confirm(`Delete profile "${p.profile_name}"? This only removes it from this CRM.`)) return;
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
      {/* How launch works — info banner */}
      <div className="text-[12px] bg-primary/5 border border-primary/20 rounded-lg px-4 py-3 flex items-start gap-2">
        <Info className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
        <div>
          <span className="font-medium">How launching works:</span> Click <strong>Add Profile</strong> below to save
          your Incogniton profile ID and name. Then hit <strong>Launch</strong> — it sends the open command directly to
          Incogniton on your PC. Make sure Incogniton is running. Not sure of your profile ID?{" "}
          <button className="underline text-primary" onClick={() => setHowToOpen(true)}>
            See how to find it.
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search profile name or ID…"
            className="h-9 pl-9"
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" onClick={() => setExportOpen(true)}>
            <Download className="h-3.5 w-3.5 mr-1.5" /> Export
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Profile
          </Button>
        </div>
      </div>

      <div className="bg-card border rounded-lg overflow-hidden">
        <table className="crm-table">
          <thead>
            <tr>
              <th>Profile Name</th>
              <th>Profile ID</th>
              <th>Group</th>
              <th>Platform</th>
              <th>Linked Lead</th>
              <th>Last Launched</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {profiles.isLoading && (
              <tr>
                <td colSpan={7} className="text-center py-6 text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {!profiles.isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-10 text-muted-foreground">
                  <Globe className="h-5 w-5 inline mr-2 opacity-50" />
                  No profiles yet. Click <strong>Add Profile</strong> to add your first one.
                </td>
              </tr>
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
                    {p.linked_lead_id
                      ? (leadMap.get(p.linked_lead_id) ?? (
                          <span className="text-muted-foreground/70 font-mono text-[11px]">
                            {p.linked_lead_id.slice(0, 8)}…
                          </span>
                        ))
                      : "—"}
                  </td>
                  <td>
                    {p.last_launched_at ? (
                      <div className="flex flex-col gap-0.5">
                        <span
                          className={cn(
                            "text-[10.5px] px-2 py-0.5 rounded-full border w-fit",
                            status === "Active"
                              ? "bg-success/10 text-success border-success/30"
                              : "bg-muted text-muted-foreground border-border",
                          )}
                        >
                          {status}
                        </span>
                        <span className="text-[11px] font-medium text-foreground pl-0.5">
                          {p.launched_by_name ?? p.launched_by_email ?? "Unknown"}
                        </span>
                        <span className="text-[10px] text-muted-foreground pl-0.5">
                          {new Date(p.last_launched_at).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    ) : (
                      <span className="text-[11px] text-muted-foreground/50 italic">Never launched</span>
                    )}
                  </td>
                  <td className="text-right space-x-1.5 whitespace-nowrap">
                    <Button size="sm" variant="default" onClick={() => launch(p)} title="Launch in Incogniton">
                      <Rocket className="h-3.5 w-3.5 mr-1" /> Launch
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

      {addOpen && (
        <AddProfileDialog
          userId={auth.user?.id ?? null}
          onClose={() => setAddOpen(false)}
          onSaved={() => {
            setAddOpen(false);
            qc.invalidateQueries({ queryKey: ["incog_profiles"] });
          }}
        />
      )}
      {exportOpen && (
        <ExportDialog profiles={profiles.data ?? []} groups={groups} onClose={() => setExportOpen(false)} />
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

      {/* How to find profile ID */}
      <Dialog open={howToOpen} onOpenChange={setHowToOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>How to find your Incogniton Profile ID</DialogTitle>
            <DialogDescription>
              The Profile ID is the unique identifier Incogniton uses to open a profile.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-[13px]">
            <div className="space-y-2">
              <div className="font-medium">Method 1 — From the Incogniton app (easiest)</div>
              <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
                <li>Open the Incogniton desktop app.</li>
                <li>
                  Right-click any profile → <strong>Profile Info</strong> or <strong>Edit</strong>.
                </li>
                <li>Copy the ID shown at the top (looks like a long number or UUID).</li>
              </ol>
            </div>
            <div className="space-y-2">
              <div className="font-medium">Method 2 — From the local API</div>
              <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
                <li>Make sure Incogniton is running.</li>
                <li>
                  Open this URL in your browser tab:{" "}
                  <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">
                    http://localhost:35000/profile/all
                  </code>
                </li>
                <li>
                  You'll see a JSON list. Find your profile and copy the{" "}
                  <code className="font-mono text-[11px]">profile_browser_id</code> field.
                </li>
              </ol>
            </div>
            <div className="bg-muted/40 rounded p-3 text-[12px] text-muted-foreground">
              <strong>Tip:</strong> The profile name is just a label for your CRM — it doesn't need to match the name in
              Incogniton exactly, but keeping them the same avoids confusion.
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Add Profile Dialog (manual entry — works 100% without CORS/extensions) ───

function AddProfileDialog({
  userId,
  onClose,
  onSaved,
}: {
  userId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [profileId, setProfileId] = useState("");
  const [profileName, setProfileName] = useState("");
  const [groupName, setGroupName] = useState("");
  const [platform, setPlatform] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const id = profileId.trim();
    const name = profileName.trim();
    if (!id) {
      toast.error("Profile ID is required");
      return;
    }
    if (!name) {
      toast.error("Profile name is required");
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("incogniton_profiles").upsert(
      {
        incogniton_profile_id: id,
        profile_name: name,
        group_name: groupName.trim() || null,
        platform: platform.trim() || null,
        created_by: userId,
      },
      { onConflict: "incogniton_profile_id", ignoreDuplicates: false },
    );
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Profile saved ✓");
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-card w-full max-w-md rounded-lg border p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 className="text-lg font-semibold">Add Incogniton Profile</h2>
          <p className="text-[12px] text-muted-foreground mt-1">
            Enter the profile details manually. Not sure of the ID?{" "}
            <span className="text-primary">Open Incogniton → right-click profile → Profile Info.</span>
          </p>
        </div>

        <div className="space-y-3">
          <Field label="Profile ID *">
            <Input
              value={profileId}
              onChange={(e) => setProfileId(e.target.value)}
              placeholder="e.g. 1234567890 or abc-def-123"
              autoFocus
            />
          </Field>
          <Field label="Profile Name *">
            <Input
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              placeholder="e.g. Account A – Facebook"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Group (optional)">
              <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="e.g. testing" />
            </Field>
            <Field label="Platform (optional)">
              <Input value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="e.g. Facebook" />
            </Field>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Save Profile
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Export Dialog ─────────────────────────────────────────────────────────────

function ExportDialog({ profiles, groups, onClose }: { profiles: Profile[]; groups: string[]; onClose: () => void }) {
  const [group, setGroup] = useState(groups[0] ?? "__all__");
  const [format, setFormat] = useState<"csv" | "json">("csv");

  function download() {
    const rows = group === "__all__" ? profiles : profiles.filter((p) => (p.group_name ?? "") === group);
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
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} profile${rows.length === 1 ? "" : "s"}`);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-card w-full max-w-md rounded-lg border p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4">Export Profiles</h2>
        <div className="space-y-4">
          <div>
            <Label className="block mb-1.5">Group</Label>
            <Select value={group} onValueChange={setGroup}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All profiles</SelectItem>
                {groups.map((g) => (
                  <SelectItem key={g} value={g}>
                    {g}
                  </SelectItem>
                ))}
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
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={download}>Export</Button>
        </div>
      </div>
    </div>
  );
}

// ── Link Lead Dialog ──────────────────────────────────────────────────────────

function LinkLeadDialog({
  profile,
  leads,
  onClose,
  onSaved,
}: {
  profile: Profile;
  leads: Lead[];
  onClose: () => void;
  onSaved: () => void;
}) {
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
        <p className="text-[12.5px] text-muted-foreground mt-1">
          Pick a qualified lead to associate this browser profile with.
        </p>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search leads…"
          className="mt-4"
          autoFocus
        />
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
            <Button variant="outline" onClick={() => save(null)} disabled={busy}>
              Unlink
            </Button>
          )}
          <Button variant="outline" onClick={onClose} className="ml-auto">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="block mb-1.5 text-[12px]">{label}</Label>
      {children}
    </div>
  );
}
