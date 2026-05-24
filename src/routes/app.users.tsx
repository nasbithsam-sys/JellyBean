import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { adminCreateUser, adminResetPassword, adminSetActive } from "@/lib/admin-users.functions";
import { Loader2, Plus, KeyRound, Power } from "lucide-react";

export const Route = createFileRoute("/app/users")({ component: UsersPage });

type UserRow = {
  user_id: string;
  full_name: string;
  username: string | null;
  email: string;
  is_active: boolean;
  role: string | null;
};

function UsersPage() {
  const auth = useAuth();
  return (
    <div>
      <PageHeader title="Users" description="Create and manage team members" />
      <PageBody>
        <RoleGate allow={["admin"]} current={auth.primaryRole}>
          <UsersInner />
        </RoleGate>
      </PageBody>
    </div>
  );
}

function UsersInner() {
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
    <div className="space-y-6">
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
              <tr><td colSpan={6} className="text-center text-muted-foreground py-6">Loading…</td></tr>
            )}
            {usersQuery.data?.map((u) => (
              <UserRowItem key={u.user_id} user={u} onChange={() => qc.invalidateQueries({ queryKey: ["admin-users"] })} />
            ))}
            {usersQuery.data?.length === 0 && (
              <tr><td colSpan={6} className="text-center text-muted-foreground py-6">No users yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {creating && <CreateUserDialog onClose={() => setCreating(false)} onCreated={() => { setCreating(false); qc.invalidateQueries({ queryKey: ["admin-users"] }); }} />}
    </div>
  );
}

function UserRowItem({ user, onChange }: { user: UserRow; onChange: () => void }) {
  const setActive = useServerFn(adminSetActive);
  const resetPw = useServerFn(adminResetPassword);
  const [busy, setBusy] = useState(false);

  async function toggleActive() {
    setBusy(true);
    try {
      await setActive({ data: { userId: user.user_id, isActive: !user.is_active } });
      toast.success(user.is_active ? "Deactivated" : "Activated");
      onChange();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }
  async function reset() {
    const pw = window.prompt(`New password for ${user.full_name}`);
    if (!pw || pw.length < 8) { if (pw) toast.error("Password must be 8+ chars"); return; }
    setBusy(true);
    try {
      await resetPw({ data: { userId: user.user_id, newPassword: pw } });
      toast.success("Password updated");
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <tr>
      <td className="font-medium">{user.full_name || "—"}</td>
      <td className="font-mono text-xs">{user.username ?? "—"}</td>
      <td>{user.email}</td>
      <td className="capitalize">{user.role ?? "—"}</td>
      <td>
        <span className={user.is_active ? "text-success" : "text-muted-foreground"}>
          {user.is_active ? "Active" : "Inactive"}
        </span>
      </td>
      <td className="text-right space-x-2 whitespace-nowrap">
        <Button size="sm" variant="outline" onClick={reset} disabled={busy}><KeyRound className="h-3.5 w-3.5 mr-1" /> Reset PW</Button>
        <Button size="sm" variant={user.is_active ? "outline" : "default"} onClick={toggleActive} disabled={busy}>
          <Power className="h-3.5 w-3.5 mr-1" /> {user.is_active ? "Deactivate" : "Activate"}
        </Button>
      </td>
    </tr>
  );
}

function CreateUserDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const createUser = useServerFn(adminCreateUser);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    fullName: "", email: "", username: "", password: "",
    role: "marketing" as "admin" | "marketing" | "cs", isActive: true,
  });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await createUser({ data: form });
      toast.success("User created");
      onCreated();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSubmitting(false); }
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-card w-full max-w-md rounded-lg border p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4">Create user</h2>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Full name"><Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required /></Field>
          <Field label="Username"><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></Field>
          <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></Field>
          <Field label="Password"><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} /></Field>
          <Field label="Role">
            <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as typeof form.role })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="marketing">Marketing</SelectItem>
                <SelectItem value="cs">CS</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
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
