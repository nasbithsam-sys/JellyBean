import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { supabase, supabaseKey, supabaseUrl } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userEmail?: string | null;
};

type VisibilityState = {
  current: boolean;
  next: boolean;
  confirm: boolean;
};

const initialVisibility: VisibilityState = {
  current: false,
  next: false,
  confirm: false,
};

export function ChangePasswordDialog({ open, onOpenChange, userEmail }: Props) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [show, setShow] = useState<VisibilityState>(initialVisibility);

  const verifyClient = useMemo(
    () =>
      createClient<Database>(supabaseUrl, supabaseKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }),
    [],
  );

  function clearForm() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShow(initialVisibility);
  }

  useEffect(() => {
    if (!open) {
      clearForm();
      setSaving(false);
    }
  }, [open]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!userEmail) {
      toast.error("Could not verify your account. Please sign in again.");
      return;
    }
    if (!currentPassword) {
      toast.error("Current password is required.");
      return;
    }
    if (!newPassword) {
      toast.error("New password is required.");
      return;
    }
    if (!confirmPassword) {
      toast.error("Please confirm your new password.");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("New password and confirmation do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      toast.error("New password must be different from your current password.");
      return;
    }

    setSaving(true);
    try {
      const { error: verifyError } = await verifyClient.auth.signInWithPassword({
        email: userEmail,
        password: currentPassword,
      });

      if (verifyError) {
        const invalidCredentials =
          verifyError.message.toLowerCase().includes("invalid login credentials") ||
          verifyError.message.toLowerCase().includes("invalid credentials");
        toast.error(
          invalidCredentials
            ? "Current password is incorrect."
            : "Could not verify your current password. Please try again.",
        );
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        toast.error("Could not update password. Please try again.");
        return;
      }

      toast.success("Password updated successfully.");
      clearForm();
      onOpenChange(false);
    } catch {
      toast.error("Could not update password. Please try again.");
    } finally {
      setSaving(false);
      void verifyClient.auth.signOut();
    }
  }

  function toggleVisibility(key: keyof VisibilityState) {
    setShow((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleOpenChange(nextOpen: boolean) {
    if (saving) return;
    if (!nextOpen) clearForm();
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md rounded-[24px] border-[#c8c1e6] bg-linear-to-br from-white via-[#f8f7fc] to-[#f1eef9] p-0 shadow-[0_28px_70px_-40px_rgba(80,70,155,0.46)]">
        <form onSubmit={handleSubmit} className="overflow-hidden rounded-[24px]">
          <div className="border-b border-[#d8d1eb] bg-linear-to-r from-[#ece8f8] via-[#f5f2fb] to-white px-6 py-5">
            <DialogHeader className="space-y-1 text-left">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-linear-to-br from-[#50469B] via-[#5b52a7] to-[#6b61b6] text-white shadow-[0_14px_26px_-18px_rgba(80,70,155,0.82)]">
                <KeyRound className="h-4.5 w-4.5" />
              </div>
              <DialogTitle className="pt-3 text-[20px] font-bold tracking-[-0.02em] text-slate-900">
                Change Password
              </DialogTitle>
              <DialogDescription className="text-[13px] leading-5 text-slate-600">
                Verify your current password, then set a new password for your own account.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="space-y-4 px-6 py-5">
            <PasswordField
              id="current-password"
              label="Current Password"
              value={currentPassword}
              onChange={setCurrentPassword}
              visible={show.current}
              onToggle={() => toggleVisibility("current")}
              autoComplete="current-password"
            />
            <PasswordField
              id="new-password"
              label="New Password"
              value={newPassword}
              onChange={setNewPassword}
              visible={show.next}
              onToggle={() => toggleVisibility("next")}
              autoComplete="new-password"
              hint="Use at least 8 characters."
            />
            <PasswordField
              id="confirm-password"
              label="Confirm New Password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              visible={show.confirm}
              onToggle={() => toggleVisibility("confirm")}
              autoComplete="new-password"
            />
          </div>

          <DialogFooter className="border-t border-[#ded9ee] bg-white/70 px-6 py-4 sm:justify-between sm:space-x-0">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Update Password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  visible,
  onToggle,
  autoComplete,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  autoComplete: string;
  hint?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-[13px] font-semibold text-slate-800">
          {label}
        </Label>
        {hint && <span className="text-[11.5px] font-medium text-slate-500">{hint}</span>}
      </div>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          className="h-11 rounded-2xl border-[#cfc9e5] bg-white/90 pr-11 text-[13px]"
        />
        <button
          type="button"
          onClick={onToggle}
          className="crm-motion absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-500 hover:bg-[#ece8f8] hover:text-[#50469B]"
          aria-label={visible ? `Hide ${label}` : `Show ${label}`}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
