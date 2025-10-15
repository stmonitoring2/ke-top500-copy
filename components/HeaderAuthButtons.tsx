// components/HeaderAuthButtons.tsx
"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

type Props = { initialUser: { id: string } | null };

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);

export default function HeaderAuthButtons({ initialUser }: Props) {
  const [user, setUser] = useState<{ id: string } | null>(initialUser);
  const [isPending, startTransition] = useTransition();
  const pathname = usePathname();

  // Keep client in sync after hydration
  useEffect(() => {
    let mounted = true;

    const refresh = async () => {
      const { data } = await supabase.auth.getSession();
      if (mounted) setUser(data.session?.user ? { id: data.session.user.id } : null);
    };

    // Initial confirm
    refresh();

    // Auth changes
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ? { id: session.user.id } : null);
    });

    // When navigating between pages
    // (server header should already be right, this just keeps client fully current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { sub.subscription?.unsubscribe?.(); mounted = false; };
  }, []);

  // Also reconfirm on route change (covers “back to My Playlists”)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ? { id: data.session.user.id } : null);
    });
  }, [pathname]);

  const handleSignOut = () => {
    startTransition(async () => {
      try {
        await fetch("/auth/signout", { method: "POST" });
        await supabase.auth.signOut();
      } finally {
        // Hard reload -> server & client aligned everywhere
        window.location.replace("/");
      }
    });
  };

  if (!user) {
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
