// app/auth/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * This route:
 *  1) Receives Supabase's magic-link redirect
 *  2) Exchanges the ?code for a session AND writes HttpOnly cookies
 *  3) Redirects to ?next=... (default /)
 */
export async function GET(req: NextRequest) {
  const requestUrl = new URL(req.url);
  const next = requestUrl.searchParams.get("next") || "/";

  // We'll mutate cookies on this response object so Supabase can set the session.
  const res = NextResponse.redirect(new URL(next, requestUrl.origin));

  // ⚠️ TypeScript versions of @supabase/ssr vary; the object below is correct
  // for the current v2 helpers, but if your project types mismatch, we cast to any
  // to keep builds green while still providing the proper methods.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => req.cookies.get(name)?.value,
        set: (name: string, value: string, options: any) =>
          res.cookies.set(name, value, options),
        remove: (name: string, options: any) =>
          res.cookies.set(name, "", { ...options, maxAge: 0 }),
      } as any, // <-- keeps TS happy across helper versions
    }
  );

  // ✅ NEW: pass the full request URL so the helper can read code+verifier
  const { error } = await supabase.auth.exchangeCodeForSession(req.url);

  if (error) {
    // If code was missing/invalid/expired, send back to sign-in
    return NextResponse.redirect(new URL("/signin?error=callback", requestUrl.origin));
  }

  return res;
}
