"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useAuth } from "./AuthProvider";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);

export default function HeaderAuthButtons() {
  const { user } = useAuth();
  const [isPending, startTransition] = useTransition();

  const handleSignOut = () => {
    startTransition(async () => {
      try {
        // Clear server cookies (so SSR matches immediately)
        await fetch("/auth/signout", { method: "POST" });
      } finally {
        // Clear client session and fully reload so everything is consistent
        await supabase.auth.signOut();
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
