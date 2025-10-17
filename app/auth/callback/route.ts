// app/auth/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export async function GET(req: NextRequest) {
  // Where to go after we set the session (allow ?next=/foo)
  const url = new URL(req.url);
  const next = url.searchParams.get("next") || "/";

  // Prepare a mutable response so Supabase helper can set cookies
  const res = NextResponse.redirect(new URL(next, req.url));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          // write cookies to the outgoing response
          res.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          res.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  // IMPORTANT: pass the full callback URL so PKCE can be exchanged
  const { error } = await supabase.auth.exchangeCodeForSession(req.url);

  if (error) {
    // If the code is missing/invalid, send them to /signin
    return NextResponse.redirect(new URL("/signin?error=callback", req.url));
  }

  // success -> redirect to "next" (e.g. /me/playlists)
  return res;
}
