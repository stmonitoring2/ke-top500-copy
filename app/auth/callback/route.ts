// app/auth/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const next = url.searchParams.get("next") || "/me/playlists";

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
          res.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          res.cookies.set({ name, value: "", ...options, maxAge: 0 });
        },
      },
    }
  );

  // Server does the PKCE exchange using the full callback URL (?code&state...)
  const { error } = await supabase.auth.exchangeCodeForSession(req.url);
  if (error) {
    console.error("Supabase PKCE exchange error:", error.message);
    return NextResponse.redirect(new URL("/signin?error=callback", req.url));
  }

  return res;
}
