import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Plus,
  KeyRound,
  Power,
  Settings as SettingsIcon,
  Users as UsersIcon,
  Trash2,
  RefreshCw,
  Copy,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { adminCreateUser, adminResetPassword, adminSetActive } from "@/lib/admin-users.functions";
import { adminDeleteUser, adminRotateLoginOtp, adminGetLoginOtp } from "@/lib/login-otp.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/settings")({ component: Page });

function Page() {
  const auth = useAuth();
  const [tab, setTab] = useState<"general" | "users">("general");
  return (
    <div>
      <PageHeader title="Settings" description="System-wide preferences and team management." />
      <PageBody>
        <RoleGate allow={["admin"]} current={auth.primaryRole}>
          <div className="flex gap-1 p-1 rounded-lg bg-surface border border-border inline-flex mb-5">
            <TabBtn
              active={tab === "general"}
              onClick={() => setTab("general")}
              icon={<SettingsIcon className="h-3.5 w-3.5" />}
            >
              General
            </TabBtn>
            <TabBtn
              active={tab === "users"}
              onClick={() => setTab("users")}
              icon={<UsersIcon className="h-3.5 w-3.5" />}
            >
              Users
            </TabBtn>
          </div>
          {tab === "general" ? <GeneralTab /> : <UsersTab />}
        </RoleGate>
      </PageBody>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-8 px-3 rounded-md text-[12.5px] font-medium flex items-center gap-1.5 transition-all",
        active
          ? "bg-card text-foreground shadow-sm ring-1 ring-border-strong"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon} {children}
    </button>
  );
}

function GeneralTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [adminOtp, setAdminOtp] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("admin_otp_required")
        .maybeSingle();
      if (!error && data) setAdminOtp(data.admin_otp_required);
      setLoading(false);
    })();
  }, []);

  async function save(next: boolean) {
    setSaving(true);
    setAdminOtp(next);
    const { error } = await supabase
      .from("app_settings")
      .update({ admin_otp_required: next, updated_at: new Date().toISOString() })
      .eq("id", true);
    if (error) {
      toast.error(error.message);
      setAdminOtp(!next);
    } else toast.success("Saved");
    setSaving(false);
  }

  if (loading)
    return (
      <div className="h-40 grid place-items-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="bg-card border rounded-lg p-5">
        <h3 className="text-sm font-semibold mb-1">Authentication</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Marketing and CS roles always require an admin-issued login code. You can additionally
          require it for admins.
        </p>
        <div className="flex items-center justify-between">
          <Label htmlFor="otp" className="text-sm font-medium">
            Require login code for admins
          </Label>
          <Switch id="otp" checked={adminOtp} disabled={saving} onCheckedChange={save} />
        </div>
      </div>
    </div>
  );
}

// ---------------- Users tab ----------------

type UserRow = {
  user_id: string;
  full_name: string;
  username: string | null;
  email: string;
  is_active: boolean;
  role: string | null;
};

function UsersTab() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);

  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: async (): Promise<UserRow[]> => {
      const [{ data: profiles, error: pErr }, { data: roles, error: rErr }] = await Promise.all([
        supabase
          .from("profiles")
          .select("user_id, full_name, username, email, is_active")
          .order("created_at", { ascending: false }),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (pErr) throw pErr;
      if (rErr) throw rErr;
      const roleMap = new Map<string, string>();
      (roles ?? []).forEach((r) => roleMap.set(r.user_id, r.role));
      return (profiles ?? []).map((p) => ({
        user_id: p.user_id,
        full_name: p.full_name,
        username: p.username,
        email: p.email,
        is_active: p.is_active,
        role: roleMap.get(p.user_id) ?? null,
      }));
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4 mr-1" /> New user
        </Button>
      </div>
      <div className="bg-card border rounded-lg overflow-hidden">
        <table className="crm-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Username</th>
              <th>Email</th>
              <th>Role</th>
              <th>Login code</th>
              <th>Status</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {usersQuery.isLoading && (
              <tr>
                <td colSpan={7} className="text-center text-muted-foreground py-6">
                  Loading…
                </td>
              </tr>
            )}
            {usersQuery.data?.map((u) => (
              <UserRowItem
                key={u.user_id}
                user={u}
                onChange={() => qc.invalidateQueries({ queryKey: ["admin-users"] })}
              />
            ))}
            {usersQuery.data?.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-muted-foreground py-6">
                  No users yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {creating && (
        <CreateUserDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            qc.invalidateQueries({ queryKey: ["admin-users"] });
          }}
        />
      )}
    </div>
  );
}

function UserRowItem({ user, onChange }: { user: UserRow; onChange: () => void }) {
  const setActive = useServerFn(adminSetActive);
  const resetPw = useServerFn(adminResetPassword);
  const deleteUser = useServerFn(adminDeleteUser);
  const rotateOtp = useServerFn(adminRotateLoginOtp);
  const getOtp = useServerFn(adminGetLoginOtp);
  const [busy, setBusy] = useState(false);
  const [otp, setOtp] = useState<string | null>(null);
  const [otpLoading, setOtpLoading] = useState(false);

  const needsOtp = user.role === "admin" || user.role === "marketing" || user.role === "cs";

  useEffect(() => {
    if (!needsOtp) return;
    void (async () => {
      try {
        const res = await getOtp({ data: { userId: user.user_id } });
        setOtp(res.code);
      } catch {
        /* ignore */
      }
    })();
  }, [needsOtp, user.user_id, getOtp]);

  async function toggleActive() {
    setBusy(true);
    try {
      await setActive({ data: { userId: user.user_id, isActive: !user.is_active } });
      toast.success(user.is_active ? "Deactivated" : "Activated");
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reset() {
    const pw = window.prompt(`New password for ${user.full_name}`);
    if (!pw || pw.length < 8) {
      if (pw) toast.error("Password must be 8+ chars");
      return;
    }
    setBusy(true);
    try {
      await resetPw({ data: { userId: user.user_id, newPassword: pw } });
      toast.success("Password updated");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (
      !window.confirm(`Permanently delete ${user.full_name || user.email}? This cannot be undone.`)
    )
      return;
    setBusy(true);
    try {
      await deleteUser({ data: { userId: user.user_id } });
      toast.success("User deleted");
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function rotate() {
    setOtpLoading(true);
    try {
      const res = await rotateOtp({ data: { userId: user.user_id } });
      setOtp(res.code);
      toast.success("New login code generated");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOtpLoading(false);
    }
  }
  async function copyOtp() {
    if (!otp) return;
    await navigator.clipboard.writeText(otp);
    toast.success("Code copied");
  }

  return (
    <tr>
      <td className="font-medium">{user.full_name || "—"}</td>
      <td className="font-mono text-xs">{user.username ?? "—"}</td>
      <td>{user.email}</td>
      <td className="capitalize">{user.role ?? "—"}</td>
      <td>
        {needsOtp ? (
          <div className="flex items-center gap-1.5">
            <code className="font-mono text-xs px-2 py-0.5 rounded bg-muted">
              {otp ?? "— — — — — —"}
            </code>
            {otp && (
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={copyOtp}
                title="Copy"
              >
                <Copy className="h-3 w-3" />
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={rotate}
              disabled={otpLoading}
              title="Generate new code"
            >
              {otpLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
            </Button>
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </td>
      <td>
        <span className={user.is_active ? "text-success" : "text-muted-foreground"}>
          {user.is_active ? "Active" : "Inactive"}
        </span>
      </td>
      <td className="text-right space-x-2 whitespace-nowrap">
        <Button size="sm" variant="outline" onClick={reset} disabled={busy}>
          <KeyRound className="h-3.5 w-3.5 mr-1" /> Reset PW
        </Button>
        <Button
          size="sm"
          variant={user.is_active ? "outline" : "default"}
          onClick={toggleActive}
          disabled={busy}
        >
          <Power className="h-3.5 w-3.5 mr-1" /> {user.is_active ? "Deactivate" : "Activate"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={remove}
          disabled={busy}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
        </Button>
      </td>
    </tr>
  );
}

function CreateUserDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const createUser = useServerFn(adminCreateUser);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    password: "",
    role: "marketing" as "admin" | "marketing" | "cs",
    isActive: true,
  });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await createUser({ data: form });
      toast.success("User created");
      onCreated();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div
        className="bg-card w-full max-w-md rounded-lg border p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-4">Create user</h2>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Name">
            <Input
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              required
            />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
              minLength={8}
            />
          </Field>
          <Field label="Role">
            <Select
              value={form.role}
              onValueChange={(v) => setForm({ ...form, role: v as typeof form.role })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="marketing">Marketing</SelectItem>
                <SelectItem value="cs">CS</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Create
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="block mb-1.5">{label}</Label>
      {children}
    </div>
  );
}
