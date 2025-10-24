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
        get(name: string) {
          try {
            return cookieStore.get(name)?.value;
          } catch {
            return undefined;
          }
        },
        set(name: string, value: string, options?: any) {
          try {
            cookieStore.set(name, value, {
              ...options,
              httpOnly: true,
              sameSite: "lax",
              secure: true,
            } as any);
          } catch {
            // ignored during build or in edge where mutating may be blocked
          }
        },
        remove(name: string, options?: any) {
          try {
            cookieStore.set(name, "", {
              ...options,
              httpOnly: true,
              sameSite: "lax",
              secure: true,
              maxAge: 0,
            } as any);
          } catch {
            // ignored
          }
        },
      },
    }
  );
}

// Back-compat so existing imports keep working:
export const createClient = supabaseServer;

export default supabaseServer;
