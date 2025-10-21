"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useCallback } from "react";

export default function SignInClient() {
  const signInWithGoogle = useCallback(async () => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo:
          typeof window !== "undefined"
            ? `${window.location.origin}/auth/callback`
            : undefined,
      },
    });
  }, []);

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-2xl font-semibold mb-6">Sign in</h1>
      <button
        onClick={signInWithGoogle}
        className="rounded-md border px-4 py-2"
      >
        Continue with Google
      </button>
    </main>
  );
}
