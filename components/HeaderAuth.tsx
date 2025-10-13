// components/HeaderAuth.tsx
import HeaderAuthButtons from "./HeaderAuthButtons";
import { createClient } from "@/lib/supabase-server";

export default async function HeaderAuth() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user ? { id: session.user.id } : null;

  // Pass the server-known session to the client header
  return <HeaderAuthButtons initialUser={user} />;
}
