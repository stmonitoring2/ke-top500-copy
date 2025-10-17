// components/HeaderAuth.tsx
import HeaderAuthButtons from "./HeaderAuthButtons";
import { createClient } from "@/lib/supabase-server";

export default async function HeaderAuth() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const isAuthed = !!session?.user?.id;

  return <HeaderAuthButtons isAuthed={isAuthed} />;
}
