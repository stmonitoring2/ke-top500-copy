// app/signin/page.tsx
"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useMemo, useState } from "react";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");

  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      ),
    []
  );

  async function send() {
    const e = email.trim();
    if (!e) return;

    setState("sending");
    setMsg("");

    const emailRedirectTo =
      typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : undefined;

    const { error } = await supabase.auth.signInWithOtp({
      email: e,
      options: { emailRedirectTo },
    });

    if (error) {
      setState("error");
      setMsg(error.message || "Could not send magic link");
      return;
    }
    setState("sent");
  }

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-2xl font-semibold mb-4">Sign in</h1>

      <label className="block text-sm mb-1">Email address</label>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="w-full rounded-md border px-3 py-2 mb-3"
      />

      <button
        className="rounded-md border px-4 py-2"
        onClick={send}
        disabled={!email || state === "sending"}
      >
        {state === "sending" ? "Sending…" : "Send magic link"}
      </button>

      {state === "sent" && <p className="mt-3 text-sm text-green-600">Check your inbox.</p>}
      {state === "error" && <p className="mt-3 text-sm text-red-600">{msg}</p>}
    </main>
  );
}
