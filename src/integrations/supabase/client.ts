import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

const SUPABASE_URL = "https://fjscqsatzsmfivpczaud.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqc2Nxc2F0enNtZml2cGN6YXVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2MTkzOTUsImV4cCI6MjA5NTE5NTM5NX0.9i3t27pIB1ztOimJJhQIlPS9HiM3nCSPa2HoMVC5Bgg";
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? SUPABASE_PUBLISHABLE_KEY;
const isBrowser = typeof window !== "undefined";
const serverStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
  auth: {
    storage: isBrowser ? window.localStorage : serverStorage,
    persistSession: isBrowser,
    autoRefreshToken: isBrowser,
    detectSessionInUrl: isBrowser,
  },
});
