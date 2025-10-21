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

  if (!code) {
    redirect("/signin");
  }

  const supabase = createClient();

  // This will set/refresh auth cookies via the cookies adapter we provide in lib/supabase-server.ts
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    redirect("/signin?error=auth");
  }

  redirect("/");
}
