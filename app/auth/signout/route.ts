import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

async function doSignOut(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => req.cookies.get(name)?.value,
        set: (name: string, value: string, options: any) => res.cookies.set(name, value, options),
        remove: (name: string, options: any) => res.cookies.set(name, "", { ...options, maxAge: 0 }),
      },
    }
  );
  await supabase.auth.signOut();
  return res;
}

export async function POST(req: NextRequest) {
  return doSignOut(req);
}

export async function GET(req: NextRequest) {
  // Fallback for any GET usage
  const res = NextResponse.redirect(new URL("/", req.url));
  const sres = await doSignOut(req);
  // copy cleared cookies onto redirect response
  sres.cookies.getAll().forEach((c) => res.cookies.set(c));
  return res;
}
