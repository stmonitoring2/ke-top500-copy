// app/auth/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

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
        get: (name) => req.cookies.get(name)?.value,
        set: (name, value, options) => res.cookies.set(name, value, options),
        remove: (name, options) => res.cookies.set(name, "", { ...options, maxAge: 0 }),
      },
    }
  );

  // This reads the `code` from the URL and sets the auth cookies
  const { error } = await supabase.auth.exchangeCodeForSession();
  if (error) {
    // If the code is missing/invalid, just send them to /signin
    return NextResponse.redirect(new URL("/signin?error=callback", req.url));
  }

  return res;
}
