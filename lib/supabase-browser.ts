"use client";

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function createClient(): SupabaseClient {
  if (client) return client;
  client = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        flowType: "pkce",
        persistSession: true,
        // IMPORTANT: let the server route do the exchange; avoid the client double-exchanging
        detectSessionInUrl: false,
        autoRefreshToken: true,
      },
    }
  );
  return client;
}
