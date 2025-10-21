// app/auth/callback/page.tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = false;

export default async function AuthCallbackPage({
  searchParams,
}: {
  searchParams?: { code?: string };
}) {
  const code = searchParams?.code ?? null;

  // If user landed here manually or without a code, push to /signin
  if (!code) {
    redirect("/signin");
  }

  const supabase = createClient();

  // Exchange the code for a session; Supabase will set auth cookies via our adapter
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    redirect("/signin?error=auth");
  }

  // On success, go home (or wherever you prefer)
  redirect("/");
}
