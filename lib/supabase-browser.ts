// lib/supabase-browser.ts
"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

/**
 * A single Supabase browser client for the whole app.
 * Avoid creating multiple instances (which causes the GoTrue warning).
 */
export function getSupabaseBrowser(): SupabaseClient {
  if (_client) return _client;

  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: true,
        detectSessionInUrl: true,
        flowType: "pkce",
        // Use a stable, project-specific storage key:
        storageKey: "ke-top500-auth",
      },
    }
  );

  return _client;
}
