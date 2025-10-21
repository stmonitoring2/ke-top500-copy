"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = false;

function SigninInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    const error = searchParams.get("error");
    if (error) {
      console.warn("Auth error:", error);
    }
  }, [searchParams]);

  async function signInWithGoogle() {
    try {
      setBusy(true);
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
      // The browser will redirect; nothing else to do here
    } catch (err) {
      console.error(err);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-xl font-semibold mb-6">Sign in</h1>
      <button
        onClick={signInWithGoogle}
        disabled={busy}
        className="rounded bg-black text-white px-4 py-2 disabled:opacity-60"
      >
        {busy ? "Redirecting…" : "Continue with Google"}
      </button>
    </main>
  );
}

export default function SigninPage() {
  // Wrap anything using useSearchParams in Suspense (best practice, avoids flicker)
  return (
    <Suspense>
      <SigninInner />
    </Suspense>
  );
}
