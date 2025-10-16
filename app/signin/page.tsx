"use client";

import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

export default function SignInPage() {
  const supabase = createClient();
  const params = useSearchParams();

  // Let callers configure where to land after auth (e.g., /me/playlists)
  const nextParam = params.get("next") || "/me/playlists";

  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSending(true);

    // Works in Preview and Prod
    const origin =
      typeof window !== "undefined"
        ? window.location.origin
        : process.env.NEXT_PUBLIC_SITE_URL!;

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // ✅ This is the correct callback. The server route will exchange the code
        // and then redirect to ?next=...
        emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(
          nextParam
        )}`,
      },
    });

    if (error) {
      setError(error.message);
      setSending(false);
      return;
    }

    setSent(true);
    setSending(false);
  }

  return (
    <div className="mx-auto max-w-md p-6">
      <h1 className="text-xl font-semibold mb-3">Sign in</h1>

      {sent ? (
        <p className="text-sm">
          Check <span className="font-medium">{email}</span> for a magic link.
        </p>
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
          <button
            disabled={sending}
            className="rounded-xl border px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send link"}
          </button>
        </form>
      )}

      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

      {/* Optional hint for deep-linking */}
      <p className="text-xs text-neutral-500 mt-4">
        You’ll be redirected to <code>{nextParam}</code> after logging in.
      </p>
    </div>
  );
}
