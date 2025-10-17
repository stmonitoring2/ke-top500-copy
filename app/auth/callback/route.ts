// app/auth/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const next = url.searchParams.get("next") || "/me/playlists";
  const token_hash = url.searchParams.get("token_hash") || url.searchParams.get("token") || "";
  const type = url.searchParams.get("type") || "";
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
          res.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  try {
    if (type === "magiclink" && token_hash) {
      const { error } = await supabase.auth.verifyOtp({
        type: "magiclink",
        token_hash,
      });
      if (error) throw error;
    } else {
      const { error } = await supabase.auth.exchangeCodeForSession(req.url);
      if (error) throw error;
    }
  } catch (error: any) {
    console.error("Supabase auth callback error:", error.message);
    return NextResponse.redirect(new URL("/signin?error=callback", req.url));
  }

  return res;
}
