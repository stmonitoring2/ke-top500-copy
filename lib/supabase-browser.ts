// lib/supabase-browser.ts
"use client";

import { createBrowserClient } from "@supabase/ssr";

// TypeScript: use the actual return type of createBrowserClient
type BrowserSupabaseClient = ReturnType<typeof createBrowserClient>;

let _client: BrowserSupabaseClient | null = null;

export function createClient() {
  if (_client) return _client;
  _client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  return _client;
}
