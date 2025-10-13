// components/HeaderAuthButtons.tsx
"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

type Props = { initialUser?: { id: string } | null }; // <- optional now

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
  const [user, setUser] = useState<null | { id: string }>(initialUser);
  const [loading, setLoading] = useState(!initialUser);
  const [isPending, startTransition] = useTransition();
  const pathname = usePathname();
  const bfDirty = useRef(false);

  const refreshUser = async () => {
    const { data } = await supabase.auth.getSession();
    setUser(data.session?.user ? { id: data.session.user.id } : null);
  };

  useEffect(() => {
    let mounted = true;

    if (!initialUser) {
      (async () => {
        await refreshUser();
        if (mounted) setLoading(false);
      })();
    } else {
      setLoading(false);
    }

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setUser(session?.user ? { id: session.user.id } : null);
    });

    const onPageShow = (e: PageTransitionEvent) => {
      if ((e as any).persisted || bfDirty.current) {
        bfDirty.current = false;
        refreshUser();
      }
    };
    const onPageHide = () => { bfDirty.current = true; };
    const onVisibility = () => { if (document.visibilityState === "visible") refreshUser(); };
    const onPopState = () => refreshUser();

    window.addEventListener("pageshow", onPageShow as any);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("popstate", onPopState);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      sub.subscription?.unsubscribe?.();
      window.removeEventListener("pageshow", onPageShow as any);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("popstate", onPopState);
      document.removeEventListener("visibilitychange", onVisibility);
      mounted = false;
    };
  }, [initialUser]);

  useEffect(() => {
    // refresh on client route changes (e.g., back to /me/playlists)
    refreshUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const handleSignOut = () => {
    startTransition(async () => {
      try {
        await fetch("/auth/signout", { method: "POST" }); // clear server cookies
        await supabase.auth.signOut();                    // clear client session
      } finally {
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
