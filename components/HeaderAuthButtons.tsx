// components/HeaderAuthButtons.tsx
"use client";
import Link from "next/link";
import { useAuth } from "./AuthProvider";
import { useTransition } from "react";

export default function HeaderAuthButtons() {
  const { user } = useAuth();
  const [isPending, startTransition] = useTransition();

  const handleSignOut = () => {
    startTransition(async () => {
      await fetch("/auth/signout", { method: "POST" });
      window.location.href = "/";
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
