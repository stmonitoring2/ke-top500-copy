// components/HeaderAuth.tsx
import HeaderAuthButtons from "@/components/HeaderAuthButtons";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HeaderAuth() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  // Pass the server-known user to the client buttons so they render correctly instantly
  return <HeaderAuthButtons initialUser={session?.user ? { id: session.user.id } : null} />;
}
