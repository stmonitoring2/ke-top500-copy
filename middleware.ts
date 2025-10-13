// middleware.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function middleware(_req: NextRequest) {
  const res = NextResponse.next();

  // Strong no-cache for auth-sensitive routes
  res.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  res.headers.set("Surrogate-Control", "no-store");

  return res;
}

// Only run this on pages where auth state must never be cached
export const config = {
  matcher: [
    "/me/:path*",
    "/playlist/:path*",
    "/signin",
    "/auth/:path*",
  ],
};
