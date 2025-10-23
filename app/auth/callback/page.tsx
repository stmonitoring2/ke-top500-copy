// app/auth/callback/page.tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";

export const runtime = "nodejs";        // IMPORTANT: do not run this on Edge
export const dynamic = "force-dynamic"; // never cache the callback

export default async function AuthCallbackPage({
  searchParams,
}: {
  searchParams?: { code?: string; next?: string };
}) {
  const code = searchParams?.code;
  if (!code) {
    redirect("/signin?error=missing_code");
  }

  const supabase = createClient();

  try {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data?.session) {
      // Log to Vercel “Functions” logs for easier debugging
      console.error("[auth/callback] exchangeCodeForSession error:", error);
      redirect("/signin?error=exchange_failed");
    }
  } catch (e: any) {
    console.error("[auth/callback] exception:", e);
    redirect("/signin?error=callback_exception");
  }

  // optional: honor ?next=/some/path
  const dest = searchParams?.next && searchParams.next.startsWith("/") ? searchParams.next : "/";
  redirect(dest);
}
