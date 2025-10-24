// app/auth/callback/page.tsx
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0; // <- must be number or false

export default async function AuthCallbackPage({
  searchParams,
}: {
  searchParams?: { code?: string };
}) {
  const code = searchParams?.code ?? null;
  if (!code) {
    // If Supabase sends "error=access_denied" etc., you can also inspect searchParams here
    redirect("/signin?error=missing_code");
  }

  // This writes the session cookies via our adapter
  const supabase = supabaseServer();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    redirect("/signin?error=exchange_failed");
  }

  redirect("/"); // success → homepage (now signed in)
}
