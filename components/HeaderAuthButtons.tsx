// components/HeaderAuthButtons.tsx
"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);

export default function HeaderAuthButtons() {
  const [user, setUser] = useState<null | { id: string }>(null);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  // Keep header in sync with Supabase session
  useEffect(() => {
    let mounted = true;

    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      setUser(data.user ? { id: data.user.id } : null);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setUser(session?.user ? { id: session.user.id } : null);
    });

    return () => {
      sub.subscription?.unsubscribe?.();
      mounted = false;
    };
  }, []);

  const handleSignOut = () => {
    startTransition(async () => {
      try {
        // 1) Clear server cookies (RLS / API routes rely on these)
        await fetch("/auth/signout", { method: "POST" });

        // 2) Clear client session (in-memory / localStorage)
        await supabase.auth.signOut();
      } finally {
        // 3) Hard refresh so every part of the app sees signed-out state
        window.location.replace("/");
      }
    });
  };

  if (loading) {
    // small placeholder to avoid layout shift
    return <div className="h-9" />;
  }

  if (user) {
    return (
      <div className="flex items-center gap-2">
        <Link
          href="/me/playlists"
          className="inline-flex items-center rounded-2xl border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50"
        >
          My Playlists
        </Link>
        <button
          onClick={handleSignOut}
          disabled={isPending}
          className="inline-flex items-center rounded-2xl border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
        >
          {isPending ? "Signing out…" : "Sign out"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Link
        href="/signin"
        className="inline-flex items-center rounded-2xl border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50"
      >
        Sign in
      </Link>
    </div>
  );
}
