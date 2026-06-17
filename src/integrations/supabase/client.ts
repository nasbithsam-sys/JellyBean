import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  (typeof process !== "undefined" ? process.env?.SUPABASE_URL : undefined);
const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  (typeof process !== "undefined" ? process.env?.SUPABASE_PUBLISHABLE_KEY : undefined);

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
