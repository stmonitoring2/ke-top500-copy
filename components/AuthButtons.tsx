// components/AuthButtons.tsx
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: true, autoRefreshToken: true } }
);

export default function AuthButtons() {
  const [user, setUser] = useState<any>(null);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setUser(s?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    // ensure server & client are in sync
    router.refresh();
  };

  if (!user) {
    return (
      <a
        href="/signin"
        className="rounded-full border px-3 py-1.5 text-sm hover:bg-neutral-50"
      >
        Sign in
      </a>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <a
        href="/me/playlists"
        className="rounded-full border px-3 py-1.5 text-sm hover:bg-neutral-50"
      >
        My Playlists
      </a>
      <button
        onClick={handleSignOut}
        className="rounded-full border px-3 py-1.5 text-sm hover:bg-neutral-50"
      >
        Sign out
      </button>
    </div>
  );
}
