// app/auth/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  // Where to go after we set the session (allow ?next=/foo)
  const next = url.searchParams.get("next") || "/me/playlists";

  // Prepare a mutable response so Supabase helper can set cookies
  const res = NextResponse.redirect(new URL(next, req.url));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name) => req.cookies.get(name)?.value,
        set: (name, value, options) => res.cookies.set(name, value, options),
        remove: (name, options) =>
          res.cookies.set(name, "", { ...options, maxAge: 0 }),
      },
    }
  );

  // Reads the `code` from the URL and sets the auth cookies
  const { error } = await supabase.auth.exchangeCodeForSession();

  if (error) {
    // If the code is missing/invalid, send to sign-in
    return NextResponse.redirect(new URL("/signin?error=callback", req.url));
  }

  return res;
}
