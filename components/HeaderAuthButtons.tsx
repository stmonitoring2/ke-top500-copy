// components/HeaderAuthButtons.tsx
"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

type Props = {
  /** Pre-hydration user from the server; prevents "Sign in" flicker on SSR pages */
  initialUser?: { id: string } | null;
};

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

export default function HeaderAuthButtons({ initialUser = null }: Props) {
  // Seed with server user so first paint is correct on SSR pages
  const [user, setUser] = useState<null | { id: string }>(initialUser);
  const [loading, setLoading] = useState(initialUser === null); // skip loading UI if we already know
  const [isPending, startTransition] = useTransition();
  const pathname = usePathname();

  async function refreshUser() {
    const { data } = await supabase.auth.getSession();
    setUser(data.session?.user ? { id: data.session.user.id } : null);
  }

  // Initial sync (only fetch if we didn't get a server user)
  useEffect(() => {
    let alive = true;
    (async () => {
      if (initialUser === null) {
        await refreshUser();
      }
      if (alive) setLoading(false);
    })();

    // Keep in sync with auth events
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setUser(session?.user ? { id: session.user.id } : null);
    });

    // Also refresh when the tab becomes visible or on bfcache restore
    const onPageShow = () => refreshUser();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshUser();
    };
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      sub.subscription?.unsubscribe?.();
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibility);
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-check on client route changes (e.g., /playlist/[id] → back to /me/playlists)
  useEffect(() => {
    refreshUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const handleSignOut = () => {
    startTransition(async () => {
      try {
        // Clear server cookies first (your /auth/signout route should accept POST)
        await fetch("/auth/signout", { method: "POST" }).catch(() => {});
        // Clear client session
        await supabase.auth.signOut();
      } finally {
        // Hard reload so SSR + CSR both reflect signed-out state everywhere
        window.location.replace("/");
      }
    });
  };

  if (loading) {
    // minimal placeholder to avoid layout shift
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
