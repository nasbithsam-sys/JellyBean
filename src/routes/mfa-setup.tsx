import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/mfa-setup")({
  component: MfaSetup,
});

function MfaSetup() {
  const navigate = useNavigate();
  const [enrolling, setEnrolling] = useState(true);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        navigate({ to: "/login" });
        return;
      }
      // Reuse pending unverified factor if one exists, else enroll a new one
      const { data: factors } = await supabase.auth.mfa.listFactors();
      let factor = factors?.totp?.find((f) => (f.status as string) !== "verified");
      if (!factor) {
        const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
        if (error) {
          toast.error(error.message);
          setEnrolling(false);
          return;
        }
        const dataUrl = await QRCode.toDataURL(data.totp.uri);
        setFactorId(data.id);
        setQr(dataUrl);
        setSecret(data.totp.secret);
        setEnrolling(false);
        return;
      }
      // Re-render QR from the otpauth uri we can't get back; fall back to secret only
      setFactorId(factor.id);
      setEnrolling(false);
    })();
  }, [navigate]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setVerifying(true);
    try {
      const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
      if (chErr || !ch) {
        toast.error(chErr?.message ?? "Challenge failed");
        return;
      }
      const { error } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: ch.id,
        code: code.trim(),
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Two-factor auth enabled");
      navigate({ to: "/app" });
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md bg-card border rounded-lg p-6">
        <h1 className="text-xl font-semibold">Set up two-factor auth</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Required for your role. Scan with Google Authenticator (or any TOTP app).
        </p>

        {enrolling ? (
          <div className="py-10 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {qr && (
              <div className="flex justify-center">
                <img src={qr} alt="TOTP QR code" className="w-48 h-48 border rounded" />
              </div>
            )}
            {secret && (
              <div className="text-xs text-center">
                <span className="text-muted-foreground">Or enter secret: </span>
                <code className="font-mono bg-muted px-2 py-1 rounded">{secret}</code>
              </div>
            )}
            <form onSubmit={handleVerify} className="space-y-3 pt-2">
              <div>
                <Label htmlFor="code">Enter 6-digit code</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  className="mt-1.5 tracking-widest text-center text-lg"
                />
              </div>
              <Button type="submit" className="w-full" disabled={verifying}>
                {verifying && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Verify and continue
              </Button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
