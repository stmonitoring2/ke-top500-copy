// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ✅ Never touch auth callback (or other auth routes)
  if (pathname.startsWith("/auth")) {
    return NextResponse.next();
  }

  // Only run Supabase for protected areas
  if (!pathname.startsWith("/me")) {
    return NextResponse.next();
  }

  // Create a mutable response so Supabase can set/refresh cookies
  const res = NextResponse.next();

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
            // Ensure proper deletion
            res.cookies.set({ name, value: "", ...options, maxAge: 0 });
          } catch (err) {
            console.warn("Cookie remove error:", err);
          }
        },
      },
    }
  );

  // Check session (this may refresh cookies if needed)
  const {
    data: { session },
  } = await supabase.auth.getSession();

  // ✅ Gate /me routes
  if (!session) {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = "/signin";
    // Preserve intended destination (full path incl. query)
    redirectUrl.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(redirectUrl);
  }

  return res;
}

// ✅ Only apply middleware to the protected area
export const config = {
  matcher: ["/me/:path*"],
};
