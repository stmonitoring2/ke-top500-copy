"use client";

import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

export default function SignInPage() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const params = useSearchParams();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const origin =
      typeof window !== "undefined"
        ? window.location.origin
        : process.env.NEXT_PUBLIC_SITE_URL!;

    // respect ?next= param if present
    const next = params.get("next") || "/me/playlists";

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // This is where Supabase will send the browser back to (with code+state),
        // and our /auth/callback route will finish the exchange + set cookies:
        emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(
          next
        )}`,
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
