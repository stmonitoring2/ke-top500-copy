// app/auth/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const next = url.searchParams.get("next") || "/me/playlists";
  const code = url.searchParams.get("code") || url.searchParams.get("token") || null;

  // Prepare a response we can mutate cookies on
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
      } as any, // keep TypeScript happy
    }
  );

  try {
    if (!code) throw new Error("Missing auth code");

    // ✅ The PKCE flow sends `token=pkce_xxx` which must be exchanged for a session
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
  } catch (err) {
    console.error("Supabase auth callback error:", err);
    return NextResponse.redirect(
      new URL("/signin?error=callback", req.url)
    );
  }

  return res;
}
