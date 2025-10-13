"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
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
  const pathname = usePathname();

  const refreshUser = async () => {
    const { data } = await supabase.auth.getSession();
    setUser(data.session?.user ? { id: data.session.user.id } : null);
  };

  useEffect(() => {
    let mounted = true;

    (async () => {
      await refreshUser();
      if (mounted) setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setUser(session?.user ? { id: session.user.id } : null);
    });

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
      mounted = false;
    };
  }, []);

  // Also refresh on client route changes (e.g., back to /me/playlists)
  useEffect(() => {
    refreshUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const handleSignOut = () => {
    startTransition(async () => {
      try {
        // Clear server cookies first
        await fetch("/auth/signout", { method: "POST" });
        // Clear client session
        await supabase.auth.signOut();
      } finally {
        // Full reload so every layer (SSR/CSR) sees signed-out
        window.location.replace("/");
      }
    });
  };

  if (loading) return <div className="h-9" />;

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
