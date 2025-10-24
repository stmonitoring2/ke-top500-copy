// lib/supabase-browser.ts
import { createBrowserClient } from "@supabase/ssr";

export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// Back-compat for places still importing { createClient }
export const createClient = supabaseBrowser;
export default supabaseBrowser;
