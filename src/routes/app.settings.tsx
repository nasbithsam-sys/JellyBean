import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, PageBody, RoleGate } from "@/components/page";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/app/settings")({ component: Page });

function Page() {
  const auth = useAuth();
  return (
    <div>
      <PageHeader title="Settings" description="System-wide preferences." />
      <PageBody>
        <RoleGate allow={["admin"]} current={auth.primaryRole}>
          <Inner />
        </RoleGate>
      </PageBody>
    </div>
  );
}

function Inner() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [adminOtp, setAdminOtp] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase.from("app_settings").select("admin_otp_required").maybeSingle();
      if (!error && data) setAdminOtp(data.admin_otp_required);
      setLoading(false);
    })();
  }, []);

  async function save(next: boolean) {
    setSaving(true);
    setAdminOtp(next);
    const { error } = await supabase.from("app_settings").update({ admin_otp_required: next, updated_at: new Date().toISOString() }).eq("id", true);
    if (error) { toast.error(error.message); setAdminOtp(!next); }
    else toast.success("Saved");
    setSaving(false);
  }

  if (loading) return <div className="h-40 grid place-items-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="bg-card border rounded-lg p-5">
        <h3 className="text-sm font-semibold mb-1">Authentication</h3>
        <p className="text-xs text-muted-foreground mb-4">Marketing and CS roles always require TOTP. You can additionally require it for admins.</p>
        <div className="flex items-center justify-between">
          <Label htmlFor="otp" className="text-sm font-medium">Require 2FA for admins</Label>
          <Switch id="otp" checked={adminOtp} disabled={saving} onCheckedChange={save} />
        </div>
      </div>
    </div>
  );
}
