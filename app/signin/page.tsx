"use client";

import { FormEvent, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0; // number, not an object

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle"|"sending"|"sent"|"error">("idle");
  const [msg, setMsg] = useState<string>("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setMsg("");
    try {
      const supabase = supabaseBrowser();
      // IMPORTANT: send user back to our callback route
      const redirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/auth/callback`
          : undefined;

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      });

      if (error) throw error;
      setStatus("sent");
      setMsg("Check your email for a login link.");
    } catch (err: any) {
      setStatus("error");
      setMsg(err?.message || "Could not send magic link.");
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-2xl font-semibold mb-6">Log in</h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <input
          type="email"
          required
          value={email}
          onChange={(e)=>setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-md border px-3 py-2"
        />
        <button
          type="submit"
          disabled={status==="sending" || !email}
          className="rounded-md border px-4 py-2"
        >
          {status==="sending" ? "Sending…" : "Send magic link"}
        </button>
        {msg && (
          <p className={`text-sm ${status==="error" ? "text-red-600" : "text-neutral-600"}`}>{msg}</p>
        )}
      </form>
    </main>
  );
}
