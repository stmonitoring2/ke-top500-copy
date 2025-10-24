// lib/supabase-server.ts
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export function supabaseServer() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(key) {
          return cookieStore.get(key)?.value;
        },
        set(key, value, options) {
          try {
            cookieStore.set(key, value, {
              ...options,
              // helps on Vercel custom domains / previews
              httpOnly: true,
              sameSite: "lax",
              secure: true,
            } as any);
          } catch {
            // ignore during build
          }
        },
        remove(key, options) {
          try {
            cookieStore.set(key, "", {
              ...options,
              httpOnly: true,
              sameSite: "lax",
              secure: true,
              maxAge: 0,
            } as any);
          } catch {}
        },
      },
    }
  );
}
