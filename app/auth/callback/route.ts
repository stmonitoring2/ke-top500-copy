// app/auth/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const next = url.searchParams.get("next") || "/me/playlists";

  // Prepare redirect response
  const res = NextResponse.redirect(new URL(next, req.url));

  // ✅ Use cookies() directly — no manual get/set/remove needed
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies, // <--- uses Next.js's native cookies() helper
    }
  );

  // Exchange the `code` for a session and set cookies
  const { error } = await supabase.auth.exchangeCodeForSession();

  if (error) {
    console.error("Auth callback error:", error.message);
    return NextResponse.redirect(new URL("/signin?error=callback", req.url));
  }

  return res;
}
