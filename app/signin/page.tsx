// app/signin/page.tsx
export const dynamic = "force-dynamic";
export const revalidate = 0; // <- must be a number or false
export const runtime = "nodejs";

"use client";

import { useState } from "react";
// Use whichever helper you already have for the browser.
// If your helper exports `createClient`, keep that import.
// If it exports `supabaseBrowser`, switch to that line and comment the other.
import { createClient as supabaseBrowser } from "@/lib/supabase-browser";
// import { supabaseBrowser } from "@/lib/supabase-browser";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const supabase = supabaseBrowser();
      const redirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/auth/callback`
          : undefined;

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectTo,
          shouldCreateUser: true,
        },
      });

      if (error) throw error;
      setSent(true);
    } catch (err: any) {
      setError(err?.message ?? "Failed to send magic link");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="max-w-md mx-auto px-6 py-10">
      <h1 className="text-2xl font-semibold mb-6">Sign in</h1>

      {sent ? (
        <p className="rounded bg-green-50 text-green-700 p-3">
          Check your email for the magic link.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="block text-sm font-medium mb-1">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border px-3 py-2"
              placeholder="you@example.com"
            />
          </label>

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="rounded bg-blue-600 text-white px-4 py-2 disabled:opacity-50"
          >
            {loading ? "Sending…" : "Send magic link"}
          </button>
        </form>
      )}
    </main>
  );
}
