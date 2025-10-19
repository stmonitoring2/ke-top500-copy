"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

type SessUser = { id: string; email?: string | null };

export default function HeaderAuth() {
  const supabase = createClient();
  const router = useRouter();
  const [user, setUser] = useState<SessUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setUser(data.session?.user ?? null);
      setLoading(false);
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      router.refresh();
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [router, supabase]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  if (loading) return <div className="text-sm text-neutral-500">…</div>;

  if (!user) {
    return (
      <div className="flex items-center gap-3">
        <Link className="text-sm underline" href="/signin">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <Link className="text-sm underline" href="/me/playlists">
        My Playlists
      </Link>
      <button type="button" onClick={handleSignOut} className="text-sm underline">
        Sign out
      </button>
    </div>
  );
}
