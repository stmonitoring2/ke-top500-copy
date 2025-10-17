// components/HeaderAuthButtons.tsx
"use client";

import Link from "next/link";
import { useTransition } from "react";

export default function HeaderAuthButtons({ isAuthed }: { isAuthed: boolean }) {
  const [isPending, start] = useTransition();

  const onSignOut = () => {
    start(async () => {
      await fetch("/auth/signout", { method: "POST" });
      // Hard reload so SSR header sees cleared cookie immediately
      window.location.replace("/");
    });
  };

  if (!isAuthed) {
    return (
      <Link
        href="/signin"
        className="inline-flex items-center rounded-2xl border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50"
      >
        Sign in
      </Link>
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
        onClick={onSignOut}
        disabled={isPending}
        className="inline-flex items-center rounded-2xl border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
      >
        {isPending ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
