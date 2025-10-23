"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useCallback, useMemo, useState } from "react";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = false;

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle"|"sending"|"sent"|"error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const supabase = useMemo(() => {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }, []);

  const sendMagicLink = useCallback(async () => {
    const e = email.trim();
    if (!e) return;

    setStatus("sending");
    setErrorMsg("");

    const { error } = await supabase.auth.signInWithOtp({
      email: e,
      options: {
        emailRedirectTo:
          typeof window !== "undefined"
            ? `${window.location.origin}/auth/callback`
            : undefined,
      },
    });

    if (error) {
      setStatus("error");
      setErrorMsg(error.message || "Could not send magic link");
      return;
    }

    setStatus("sent");
  }, [email, supabase]);

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-2xl font-semibold mb-6">Sign in</h1>

      <label className="block text-sm mb-1">Email</label>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="w-full rounded-md border px-3 py-2 mb-3"
      />

      <button
        onClick={sendMagicLink}
        disabled={status === "sending" || !email}
        className="rounded-md border px-4 py-2"
      >
        {status === "sending" ? "Sending..." : "Send magic link"}
      </button>

      {status === "sent" && (
        <p className="text-sm text-green-600 mt-3">Check your inbox for the link.</p>
      )}
      {status === "error" && (
        <p className="text-sm text-red-600 mt-3">{errorMsg}</p>
      )}
    </main>
  );
}
