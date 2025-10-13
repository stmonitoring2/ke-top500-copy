// app/auth/signout/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

/**
 * POST: sign out (AJAX from the client)
 */
export async function POST(request: NextRequest) {
  // We’ll return JSON so the client can decide what to do next
  const response = NextResponse.json({ ok: true });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          response.cookies.set(name, value, options);
        },
        remove(name: string, options: CookieOptions) {
          response.cookies.set(name, "", { ...options, maxAge: 0 });
        },
      },
    }
  );

  await supabase.auth.signOut();
  return response;
}

/**
 * GET: sign out then redirect home (for direct link usage)
 */
export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/", request.url));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          response.cookies.set(name, value, options);
        },
        remove(name: string, options: CookieOptions) {
          response.cookies.set(name, "", { ...options, maxAge: 0 });
        },
      },
    }
  );

  await supabase.auth.signOut();
  return response;
}
