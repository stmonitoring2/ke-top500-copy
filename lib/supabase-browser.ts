// lib/supabase-browser.ts
"use client";

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function createClient(): SupabaseClient {
  if (_client) return _client;

  _client = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: true,
        detectSessionInUrl: true,
        flowType: "pkce",
        // IMPORTANT: use the default storage key. Do NOT set a custom storageKey.
        // storageKey: "custom"  // <-- remove any custom key you had before
      },
    }
  );

  return _client;
}
