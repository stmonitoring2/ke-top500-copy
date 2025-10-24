// lib/supabase-browser.ts
import { createBrowserClient } from "@supabase/ssr";

/** Preferred name */
export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

/** Back-compat alias so existing code `import { createClient } ...` still works */
export const createClient = supabaseBrowser;

/** Optional default export (also back-compat) */
export default supabaseBrowser;
