// app/auth/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const next = url.searchParams.get("next") || "/me/playlists";

  const res = NextResponse.redirect(new URL(next, req.url));

  // ✅ Correct for both older and newer @supabase/ssr versions
  const cookieStore = cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name) {
          return cookieStore.get(name)?.value;
        },
        set(name, value, options) {
          try {
            res.cookies.set(name, value, options);
          } catch {
            // Some environments (like Edge) need silent try/catch
          }
        },
        remove(name, options) {
          try {
            res.cookies.set(name, "", { ...options, maxAge: 0 });
          } catch {}
        },
      },
    }
  );

  // Exchange the auth code from the magic link for a session
  const { error } = await supabase.auth.exchangeCodeForSession();

  if (error) {
    console.error("Supabase auth callback error:", error.message);
    return NextResponse.redirect(new URL("/signin?error=callback", req.url));
  }

  return res;
}
