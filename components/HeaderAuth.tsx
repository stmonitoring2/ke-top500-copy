// components/HeaderAuth.tsx
import HeaderAuthButtons from "./HeaderAuthButtons";
import { createClient } from "@/lib/supabase-server";

export default async function HeaderAuth() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user ? { id: session.user.id } : null;
  return <HeaderAuthButtons initialUser={user} />;
}
