// app/auth/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const next = url.searchParams.get("next") || "/me/playlists";

  const res = NextResponse.redirect(new URL(next, req.url));

  // ✅ Pass the `cookies()` function directly
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies }
  );

  // ✅ New SDK requires request URL here
  const { error } = await supabase.auth.exchangeCodeForSession(req.url);

  if (error) {
    console.error("Supabase auth callback error:", error.message);
    return NextResponse.redirect(new URL("/signin?error=callback", req.url));
  }

  return res;
}
