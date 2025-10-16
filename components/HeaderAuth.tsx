import HeaderAuthButtons from "@/components/HeaderAuthButtons";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HeaderAuth() {
  const supabase = createClient();
  await supabase.auth.getSession(); // optional, ensures cookies are fresh
  return <HeaderAuthButtons />;
}
