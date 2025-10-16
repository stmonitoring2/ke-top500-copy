// components/HeaderAuth.tsx
import HeaderAuthButtons from "@/components/HeaderAuthButtons";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HeaderAuth() {
  const supabase = createClient();

  // Try to read a session, but HeaderAuthButtons now handles client-side hydration.
  await supabase.auth.getSession();

  return <HeaderAuthButtons />;
}
