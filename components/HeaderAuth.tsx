"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

type SessUser = { id: string; email?: string | null };

export default function HeaderAuth() {
  const [user, setUser] = useState<SessUser | null>(null);
  const router = useRouter();

  useEffect(() => {
    const supabase = supabaseBrowser();

    // initial load
    supabase.auth.getUser().then(({ data }) => setUser(data.user as any ?? null));

    // listen to auth changes too (optional but handy)
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user as any ?? null);
    });

    return () => { sub?.subscription.unsubscribe(); };
  }, []);

  if (!user) {
    return (
      <a href="/signin" className="rounded-md border px-3 py-2 text-sm">
        Sign in
      </a>
    );
  }

  return (
    <form
      action={async () => {
        const supabase = supabaseBrowser();
        await supabase.auth.signOut();
        router.refresh();
      }}
    >
      <button className="rounded-md border px-3 py-2 text-sm">
        Sign out
      </button>
    </form>
  );
}
