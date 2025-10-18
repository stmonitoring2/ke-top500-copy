// lib/supabase-browser.ts
"use client";

import { createBrowserClient } from "@supabase/ssr";

// Let TS infer the exact client type from the factory
type BrowserSupabaseClient = ReturnType<typeof createBrowserClient>;

let _client: BrowserSupabaseClient | null = null;

export function createClient() {
  if (_client) return _client;

  _client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        // <-- Important: avoid PKCE so magic links work across contexts
        flowType: "implicit",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    }
  );

  return _client;
}
