import { useEffect, useState, useCallback, useRef } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "scraping" | "processor" | "cs" | "acc_handler";

export interface AuthProfile {
  id: string;
  user_id: string;
  full_name: string;
  username: string | null;
  email: string;
  is_active: boolean;
  otp_required: boolean;
}

export interface AuthState {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: AuthProfile | null;
  roles: AppRole[];
  primaryRole: AppRole | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(resolve, reject).finally(() => window.clearTimeout(timer));
  });
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);
  const latestSessionRef = useRef<Session | null>(null);

  const loadProfileAndRoles = useCallback(async (uid: string | undefined) => {
    if (!uid) {
      setProfile(null);
      setRoles([]);
      return;
    }
    const [{ data: prof, error: profileError }, { data: rolesData, error: rolesError }] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("id, user_id, full_name, username, email, is_active, otp_required")
          .eq("user_id", uid)
          .maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", uid),
      ]);
    if (profileError) throw profileError;
    if (rolesError) throw rolesError;
    setProfile((prof as AuthProfile | null) ?? null);
    setRoles(((rolesData as { role: AppRole }[] | null) ?? []).map((r) => r.role));
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Set up listener FIRST
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      if (cancelled) return;
      latestSessionRef.current = sess;
      setSession(sess);
      setUser(sess?.user ?? null);
      // Defer to avoid deadlock
      setTimeout(() => {
        void loadProfileAndRoles(sess?.user?.id);
      }, 0);
    });
    // Then check current session
    withTimeout(supabase.auth.getSession(), 20000, "Supabase session lookup")
      .then(({ data }) => {
        if (cancelled) return;
        latestSessionRef.current = data.session;
        setSession(data.session);
        setUser(data.session?.user ?? null);
        return withTimeout(
          loadProfileAndRoles(data.session?.user?.id),
          20000,
          "Supabase profile lookup",
        );
      })
      .catch((error) => {
        console.error("[Auth] Could not initialize session", error);
        if (!latestSessionRef.current) {
          setSession(null);
          setUser(null);
          setProfile(null);
          setRoles([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [loadProfileAndRoles]);

  const refresh = useCallback(async () => {
    await loadProfileAndRoles(user?.id);
  }, [user?.id, loadProfileAndRoles]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const primaryRole: AppRole | null = roles.includes("admin")
    ? "admin"
    : roles.includes("scraping")
      ? "scraping"
      : roles.includes("processor")
        ? "processor"
        : roles.includes("cs")
          ? "cs"
          : roles.includes("acc_handler")
            ? "acc_handler"
            : null;

  return { loading, session, user, profile, roles, primaryRole, refresh, signOut };
}
