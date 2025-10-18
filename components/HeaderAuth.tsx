// components/HeaderAuth.tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";

export default function HeaderAuth() {
  const supabase = createClient();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user || null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/signin";
  }

  return user ? (
    <button onClick={handleSignOut} className="text-sm underline">Sign out</button>
  ) : (
    <Link href="/signin" className="text-sm underline">Sign in</Link>
  );
}
