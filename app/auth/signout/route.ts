// app/auth/signout/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Shared helper to clear the Supabase server-side cookies.
 * Returns the response you should send back.
 */
async function doServerSignOut(req: NextRequest, res: NextResponse) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          res.cookies.set(name, value, options);
        },
        remove(name: string, options: any) {
          // Expire immediately
          res.cookies.set(name, "", { ...options, maxAge: 0 });
        },
      },
    }
  );

  await supabase.auth.signOut();
  return res;
}

/**
 * POST is ideal for programmatic sign-out from the client.
 * Returns JSON { ok: true } on success.
 */
export async function POST(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  return doServerSignOut(req, res);
}

/**
 * GET allows direct navigation (e.g., visiting /auth/signout in the browser).
 * Redirects home after clearing cookies.
 */
export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/", req.url));
  return doServerSignOut(req, res);
}

/** Optional (CORS/preflight if you ever call from other origins) */
export function OPTIONS() {
  return NextResponse.json({}, { status: 204 });
}
