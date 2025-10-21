// app/auth/callback/page.tsx
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = false;

export default async function AuthCallbackPage() {
  const h = headers();
  const code = h.get("x-supabase-code") ?? null;

  // If user landed here manually or without a code, push to /signin
  if (!code) {
    redirect("/signin");
  }

  const supabase = createClient();
  const cookieStore = cookies();

  // Exchange code for session on the server
  const {
    data: { session },
    error,
  } = await supabase.auth.exchangeCodeForSession(code);

  // Persist cookies set by supabase auth helpers
  for (const { name, value, options } of supabase.auth.getAllCookies()) {
    cookieStore.set(name, value, options);
  }

  // If we have a session, go home. Otherwise back to signin.
  if (session && !error) {
    redirect("/");
  } else {
    redirect("/signin?error=auth");
  }
}
