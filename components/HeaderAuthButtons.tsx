// components/HeaderAuthButtons.tsx
"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

type MinimalUser = { id: string };
type Props = {
  /** Optional server-hydrated user to avoid the initial "Sign in" flicker */
  initialUser?: MinimalUser | null;
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
  const [user, setUser] = useState<MinimalUser | null>(initialUser);
  const [loading, setLoading] = useState(!initialUser);
  const [isPending, startTransition] = useTransition();
  const pathname = usePathname();

  const refreshUser = async () => {
    const { data } = await supabase.auth.getSession();
    setUser(data.session?.user ? { id: data.session.user.id } : null);
  };

  useEffect(() => {
    let mounted = true;

    // If we didn't receive initialUser from the server, fetch it once on mount.
    (async () => {
      if (!initialUser) {
        await refreshUser();
      }
      if (mounted) setLoading(false);
    })();

    // Keep in sync with auth changes (sign-in/out, token refresh)
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setUser(session?.user ? { id: session.user.id } : null);
    });

    // Also refresh when the tab becomes visible again
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshUser();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      sub.subscription?.unsubscribe?.();
      document.removeEventListener("visibilitychange", onVisibility);
      mounted = false;
    };
  }, [initialUser]);

  // Refresh on client route changes so the header stays correct on /me/playlists <-> /playlist/[id]
  useEffect(() => {
    refreshUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const handleSignOut = () => {
    startTransition(async () => {
      try {
        // Clear server cookies first (your signout route should accept POST)
        await fetch("/auth/signout", { method: "POST" });
        // Clear client session
        await supabase.auth.signOut();
      } finally {
        // Hard reload so every layer (SSR/CSR) sees signed-out state
        window.location.replace("/");
      }
    });
  };

  if (loading) {
    // Small placeholder to avoid layout shift
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
