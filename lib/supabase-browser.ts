// lib/supabase-browser.ts
"use client";

import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

/**
 * Singleton Supabase browser client.
 * Avoid multiple instances (prevents "Multiple GoTrueClient" warnings).
 */
export function getSupabaseBrowser(): SupabaseClient {
  if (_client) return _client;

  _client = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: true,
        detectSessionInUrl: true,
        flowType: "pkce",
        // Stable storage key so only one GoTrue client uses it
        storageKey: "ke-top500-auth",
      },
    }
  );

  return _client;
}

/**
 * Back-compat export for files that import:
 *   import { createClient } from "@/lib/supabase-browser";
 * It simply returns the singleton above.
 */
export function createClient(): SupabaseClient {
  return getSupabaseBrowser();
}
