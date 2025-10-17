// lib/supabase-browser.ts
"use client";

import { createBrowserClient } from "@supabase/ssr";

// Single source of truth for the browser client.
// IMPORTANT: Same storageKey used on *both* signin and callback pages.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        flowType: "pkce",
        persistSession: true,
        storageKey: "ke-top500-auth",
      },
    }
  );
}
