import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

const supabaseUrl = "https://fjscqsatzsmfivpczaud.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqc2Nxc2F0enNtZml2cGN6YXVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2MTkzOTUsImV4cCI6MjA5NTE5NTM5NX0.9i3t27pIB1ztOimJJhQIlPS9HiM3nCSPa2HoMVC5Bgg";

const isBrowser = typeof window !== "undefined";
const serverStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

function createRealClient(): SupabaseClient<Database> {
  if (!supabaseUrl) {
    throw new Error("Missing required environment variable: VITE_SUPABASE_URL");
  }
  if (!supabaseKey) {
    throw new Error("Missing required environment variable: VITE_SUPABASE_PUBLISHABLE_KEY");
  }
  return createClient<Database>(supabaseUrl, supabaseKey, {
    auth: {
      storage: isBrowser ? window.localStorage : serverStorage,
      persistSession: isBrowser,
      autoRefreshToken: isBrowser,
      detectSessionInUrl: isBrowser,
    },
  });
}

// Lazy: do not throw at module-init. If VITE_* env vars are missing during a
// production SSR build, this previously killed every route with HTTP 500.
// The error now surfaces only when something actually uses the client.
let _client: SupabaseClient<Database> | undefined;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";
export const supabase = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop, receiver) {
    if (!_client) _client = createRealClient();
    return Reflect.get(_client, prop, receiver);
  },
}) as SupabaseClient<Database>;
