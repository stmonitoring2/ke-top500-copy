// components/HeaderAuth.tsx
import HeaderAuthButtons from "./HeaderAuthButtons";
import { createClient } from "@/lib/supabase-server";

/**
 * Server wrapper: reads the session from cookies and seeds the client header.
 * This prevents "Sign in" flashing on SSR pages like /me/playlists.
 */
export default async function HeaderAuth() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const user = session?.user ? { id: session.user.id } : null;
  return <HeaderAuthButtons initialUser={user} />;
}
