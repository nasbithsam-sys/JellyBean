import { useEffect, useState, useCallback } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "marketing" | "cs";

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

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  const loadProfileAndRoles = useCallback(async (uid: string | undefined) => {
    if (!uid) {
      setProfile(null);
      setRoles([]);
      return;
    }
    const [{ data: prof }, { data: rolesData }] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", uid).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", uid),
    ]);
    setProfile((prof as AuthProfile | null) ?? null);
    setRoles(((rolesData as { role: AppRole }[] | null) ?? []).map((r) => r.role));
  }, []);

  useEffect(() => {
    // Set up listener FIRST
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      // Defer to avoid deadlock
      setTimeout(() => {
        void loadProfileAndRoles(sess?.user?.id);
      }, 0);
    });
    // Then check current session
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      void loadProfileAndRoles(data.session?.user?.id).finally(() => setLoading(false));
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfileAndRoles]);

  const refresh = useCallback(async () => {
    await loadProfileAndRoles(user?.id);
  }, [user?.id, loadProfileAndRoles]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const primaryRole: AppRole | null = roles.includes("admin")
    ? "admin"
    : roles.includes("marketing")
      ? "marketing"
      : roles.includes("cs")
        ? "cs"
        : null;

  return { loading, session, user, profile, roles, primaryRole, refresh, signOut };
}
