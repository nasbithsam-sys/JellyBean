import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { friendlyError } from "@/lib/error-messages";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Loader2,
  Plus,
  KeyRound,
  Power,
  Settings as SettingsIcon,
  Users as UsersIcon,
  Trash2,
  CheckCircle2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { adminCreateUser, adminResetPassword, adminSetActive } from "@/lib/admin-users.functions";
import { adminDeleteUser } from "@/lib/login-otp.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/settings")({ component: Page });

const ADMIN_UPDATE_CHECKLIST_KEY = "admin_update_checklist";

type AdminUpdateItem = {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
  updatedAt: string;
};

type AdminUpdateValue = {
  items?: AdminUpdateItem[];
};

function readAdminUpdateItems(value: Json | null | undefined): AdminUpdateItem[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const items = (value as AdminUpdateValue).items;
  if (!Array.isArray(items)) return [];
  return items.filter(
    (item): item is AdminUpdateItem =>
      !!item &&
      typeof item.id === "string" &&
      typeof item.text === "string" &&
      typeof item.done === "boolean",
  );
}

function Page() {
  const auth = useAuth();
  const [tab, setTab] = useState<"general" | "updates" | "users">("general");
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
              active={tab === "updates"}
              onClick={() => setTab("updates")}
              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
            >
              Updates
            </TabBtn>
            <TabBtn
              active={tab === "users"}
              onClick={() => setTab("users")}
              icon={<UsersIcon className="h-3.5 w-3.5" />}
            >
              Users
            </TabBtn>
          </div>
          {tab === "general" && <GeneralTab />}
          {tab === "updates" && <UpdatesTab />}
          {tab === "users" && <UsersTab />}
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
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="bg-card border rounded-lg p-5">
        <h3 className="text-sm font-semibold mb-1">Authentication</h3>
        <p className="text-xs text-muted-foreground">
          Login codes and OTP prompts are disabled for every role. Users sign in with their
          provisioned username or email and password only.
        </p>
      </div>
    </div>
  );
}

function UpdatesTab() {
  const auth = useAuth();
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const updatesQuery = useQuery({
    queryKey: ["shared_state", ADMIN_UPDATE_CHECKLIST_KEY],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shared_state")
        .select("value")
        .eq("key", ADMIN_UPDATE_CHECKLIST_KEY)
        .maybeSingle();
      if (error) throw error;
      return readAdminUpdateItems(data?.value);
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("admin-update-checklist-sync")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "shared_state",
          filter: `key=eq.${ADMIN_UPDATE_CHECKLIST_KEY}`,
        },
        () => qc.invalidateQueries({ queryKey: ["shared_state", ADMIN_UPDATE_CHECKLIST_KEY] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  async function saveItems(items: AdminUpdateItem[]) {
    const { error } = await supabase.from("shared_state").upsert({
      key: ADMIN_UPDATE_CHECKLIST_KEY,
      value: { items },
      updated_by: auth.user?.id ?? null,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    await qc.invalidateQueries({ queryKey: ["shared_state", ADMIN_UPDATE_CHECKLIST_KEY] });
  }

  async function addItem() {
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const item: AdminUpdateItem = {
        id: crypto.randomUUID(),
        text,
        done: false,
        createdAt: now,
        updatedAt: now,
      };
      await saveItems([item, ...(updatesQuery.data ?? [])]);
      setDraft("");
      toast.success("Update note added");
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleItem(id: string, done: boolean) {
    setBusy(true);
    try {
      const now = new Date().toISOString();
      await saveItems(
        (updatesQuery.data ?? []).map((item) =>
          item.id === id ? { ...item, done, updatedAt: now } : item,
        ),
      );
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(id: string) {
    setBusy(true);
    try {
      await saveItems((updatesQuery.data ?? []).filter((item) => item.id !== id));
      toast.success("Update note removed");
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const items = updatesQuery.data ?? [];

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="bg-card border rounded-lg p-5">
        <h3 className="text-sm font-semibold mb-1">Update checklist</h3>
        <p className="text-xs text-muted-foreground">
          Add what needs to be updated, then tick it when the update is confirmed.
        </p>
        <div className="mt-4 space-y-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder="Write update note..."
          />
          <div className="flex justify-end">
            <Button onClick={addItem} disabled={busy || !draft.trim()}>
              Add update note
            </Button>
          </div>
        </div>
      </div>

      <div className="bg-card border rounded-lg overflow-hidden">
        {updatesQuery.isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading updates...</div>
        ) : items.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No update notes yet.</div>
        ) : (
          <div className="divide-y divide-border">
            {items.map((item) => (
              <div key={item.id} className="flex items-start gap-3 p-4">
                <Checkbox
                  checked={item.done}
                  onCheckedChange={(checked) => toggleItem(item.id, checked === true)}
                  className="mt-0.5"
                  disabled={busy}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-sm whitespace-pre-wrap leading-relaxed",
                      item.done && "text-muted-foreground line-through",
                    )}
                  >
                    {item.text}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {item.done ? "Updated" : "Pending"}
                    {" - "}
                    {new Date(item.updatedAt || item.createdAt).toLocaleString()}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeItem(item.id)}
                  disabled={busy}
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="sr-only">Remove update note</span>
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type UserRow = {
  user_id: string;
  full_name: string;
  username: string | null;
  email: string;
  is_active: boolean;
  role: string | null;
};

function roleLabel(role: string | null) {
  if (!role) return "-";
  if (role === "sub_admin") return "Sub-admin";
  return role.replace(/_/g, " ");
}

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
              <th>Status</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {usersQuery.isLoading && (
              <tr>
                <td colSpan={6} className="text-center text-muted-foreground py-6">
                  Loading...
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
                <td colSpan={6} className="text-center text-muted-foreground py-6">
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
  const [busy, setBusy] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  async function toggleActive() {
    setBusy(true);
    try {
      await setActive({ data: { userId: user.user_id, isActive: !user.is_active } });
      toast.success(user.is_active ? "Deactivated" : "Activated");
      onChange();
    } catch (e) {
      toast.error(friendlyError(e));
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
      toast.error(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteUser({ data: { userId: user.user_id } });
      toast.success("User deleted");
      onChange();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td className="font-medium">{user.full_name || "-"}</td>
      <td className="font-mono text-xs">{user.username ?? "-"}</td>
      <td>{user.email}</td>
      <td className="capitalize">{roleLabel(user.role)}</td>
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
          onClick={() => setShowDeleteConfirm(true)}
          disabled={busy}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
        </Button>

        <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete user</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete {user.full_name || user.email}. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  setShowDeleteConfirm(false);
                  remove();
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
    role: "scraping" as
      | "admin"
      | "sub_admin"
      | "scraping"
      | "maturing"
      | "cs"
      | "acc_handler"
      | "facebook"
      | "seo",
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
      toast.error(friendlyError(e));
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
                <SelectItem value="sub_admin">Sub-admin</SelectItem>
                <SelectItem value="scraping">Scraping</SelectItem>
                <SelectItem value="maturing">Maturing</SelectItem>
                <SelectItem value="cs">CS</SelectItem>
                <SelectItem value="acc_handler">Acc Handler</SelectItem>
                <SelectItem value="facebook">Facebook</SelectItem>
                <SelectItem value="seo">SEO</SelectItem>
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
