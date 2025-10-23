import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";

export default async function AuthCallbackPage({
  searchParams,
}: {
  searchParams?: { code?: string };
}) {
  const code = searchParams?.code ?? null;
  if (!code) redirect("/signin");

  const supabase = createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) redirect("/signin?error=auth");
  redirect("/");
}
