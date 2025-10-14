// components/HeaderAuth.tsx
import { createClient } from "@/lib/supabase-server";
import HeaderAuthButtons from "@/components/HeaderAuthButtons";

/**
 * Server component: reads the session from Supabase cookies
 * and passes a minimal user object down to the client header as initial state.
 */
export default async function HeaderAuth() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const user = session?.user ? { id: session.user.id } : null;

  return <HeaderAuthButtons initialUser={user} />;
}
