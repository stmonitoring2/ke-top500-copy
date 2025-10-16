// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // ✅ Use the new cookies() helper directly (no get/set/remove object)
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies }
  );

  const {
    data: { session },
  } = await supabase.auth.getSession();

  // Protect `/me` routes
  if (!session && req.nextUrl.pathname.startsWith("/me")) {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = "/signin";
    redirectUrl.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  return res;
}
