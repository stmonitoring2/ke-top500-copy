import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export const dynamic = "force-dynamic"; // avoid caching callback responses

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const next = url.searchParams.get("next") || "/me/playlists";

  // Mutable response so we can set cookies before redirecting
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

  // Let the server perform the PKCE exchange using the full callback URL (?code & ?state)
  const { error } = await supabase.auth.exchangeCodeForSession(req.url);
  if (error) {
    console.error("Supabase PKCE exchange error:", error.message);
    return NextResponse.redirect(new URL("/signin?error=callback", req.url));
  }

  return res;
}
