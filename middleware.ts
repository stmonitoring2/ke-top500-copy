// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  // Create an empty response to mutate cookies
  const res = NextResponse.next();

  // ✅ Create Supabase client with manual cookie handling
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            res.cookies.set({ name, value, ...options });
          } catch (err) {
            console.warn("Cookie set error:", err);
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            res.cookies.set({ name, value: "", ...options });
          } catch (err) {
            console.warn("Cookie remove error:", err);
          }
        },
      },
    }
  );

  const {
    data: { session },
  } = await supabase.auth.getSession();

  // ✅ Protect /me routes
  if (!session && req.nextUrl.pathname.startsWith("/me")) {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = "/signin";
    redirectUrl.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  return res;
}

// ✅ Optionally configure which routes run this middleware
export const config = {
  matcher: ["/me/:path*", "/api/:path*"],
};
