// app/auth/callback/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

export default function AuthCallbackPage() {
  const supabase = createClient();
  const router = useRouter();
  const search = useSearchParams();

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      // Supabase adds ?code=... for PKCE magic link
      const code = search.get("code");
      const next = search.get("next") || "/me/playlists";

      if (!code) {
        if (!cancelled) router.replace("/signin?error=callback");
        return;
      }

      // On the browser, the PKCE code_verifier is in localStorage under the same storageKey.
      // This call reads code & verifier from the URL/localStorage and sets the session cookies.
      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (error) {
        console.error("PKCE exchange error:", error.message);
        if (!cancelled) router.replace("/signin?error=callback");
        return;
      }

      if (!cancelled) router.replace(next);
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [router, search, supabase]);

  return (
    <div className="mx-auto max-w-md p-6">
      <p className="text-sm">Signing you in…</p>
    </div>
  );
}
