"use client";

import { Suspense, useState, FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

// prevent prerendering / caching for this route
export const dynamic = "force-dynamic";
export const revalidate = 0;

function SignInInner() {
  const supabase = createClient();
  const params = useSearchParams();

  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const origin =
      typeof window !== "undefined"
        ? window.location.origin
        : process.env.NEXT_PUBLIC_SITE_URL!;

    const next = params.get("next") || "/me/playlists";

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // send users back to our client callback page, not the API route
        emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <div className="mx-auto max-w-md p-6">
      <h1 className="text-xl font-semibold mb-3">Sign in</h1>
      {sent ? (
        <p className="text-sm">Check your email for a magic link.</p>
      ) : (
        <form onSubmit={onSubmit} className="flex gap-2">
          <input
            type="email"
            required
            placeholder="you@example.com"
            className="flex-1 rounded-xl border border-neutral-300 px-3 py-2 text-sm"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button className="rounded-xl border px-3 py-2 text-sm hover:bg-neutral-50">
            Send link
          </button>
        </form>
      )}
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-md p-6 text-sm">Loading…</div>}>
      <SignInInner />
    </Suspense>
  );
}
