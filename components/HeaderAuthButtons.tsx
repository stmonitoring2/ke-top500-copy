// components/HeaderAuthButtons.tsx
"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

type Props = {
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
  // Start with the server-provided session to avoid "Sign in" flicker
  const [user, setUser] = useState<null | { id: string }>(initialUser);
  const [isPending, startTransition] = useTransition();
  const pathname = usePathname();

  async function refreshUser() {
    const { data } = await supabase.auth.getSession();
    setUser(data.session?.user ? { id: data.session.user.id } : null);
  }

  // Keep in sync with Supabase auth events
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setUser(session?.user ? { id: session.user.id } : null);
    });
    return () => sub.subscription?.unsubscribe?.();
  }, []);

  // Refresh when the tab becomes visible or on bfcache restore
  useEffect(() => {
    const onPageShow = () => refreshUser();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshUser();
    };
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Also refresh on **client route** changes (e.g., /playlist/[id] -> /me/playlists)
  useEffect(() => {
    refreshUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const handleSignOut = () => {
    startTransition(async () => {
      try {
        // clear server cookies
        await fetch("/auth/signout", { method: "POST" });
        // clear client session
        await supabase.auth.signOut();
      } finally {
        // reload so SSR & client agree
        window.location.replace("/");
      }
    });
  };

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
