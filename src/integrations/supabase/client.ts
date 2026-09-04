import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { brokeredPreviewStorage } from "./previewAuthStorage";

// These are intentionally public browser values. Keep service-role and other
// private keys out of VITE_* variables because Vite includes them in the app.
function runtimeEnv(key: string): string | undefined {
  const bag =
    (globalThis as { __env__?: Record<string, unknown> }).__env__ ??
    (typeof process !== "undefined" ? (process.env as Record<string, unknown>) : undefined);
  const value = bag?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL?.trim() ||
  runtimeEnv("VITE_SUPABASE_URL") ||
  runtimeEnv("SUPABASE_URL");
const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  runtimeEnv("VITE_SUPABASE_PUBLISHABLE_KEY") ||
  runtimeEnv("SUPABASE_PUBLISHABLE_KEY") ||
  runtimeEnv("VITE_SUPABASE_ANON_KEY");

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error(
    "Supabase browser configuration is missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.",
  );
}

export const supabaseUrl = SUPABASE_URL;
export const supabaseKey = SUPABASE_PUBLISHABLE_KEY;


// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: brokeredPreviewStorage(),
    persistSession: true,
    autoRefreshToken: true,
  },
});
