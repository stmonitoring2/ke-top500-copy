// components/HeaderAuth.tsx
import HeaderAuthButtons from "./HeaderAuthButtons";
import { createClient } from "@/lib/supabase-server";

export default async function HeaderAuth() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();

  // Pass only a boolean to the client component (no Supabase client)
  return <HeaderAuthButtons isAuthed={!!session} />;
}
