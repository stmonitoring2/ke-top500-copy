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
    (async () => {
      // Exchange the auth code in the URL for a session (client-side)
      const { error } = await supabase.auth.exchangeCodeForSession(
        typeof window !== "undefined" ? window.location.href : ""
      );

      if (error) {
        // If the code is missing/invalid, bounce to sign-in (this was your error=callback case)
        router.replace("/signin?error=callback");
        return;
      }

      // Then continue to your desired page (defaults to / if not provided)
      const next = search.get("next") || "/me/playlists";
      router.replace(next);
    })();
  }, [router, search, supabase]);

  return (
    <div className="mx-auto max-w-md p-6 text-sm">
      Signing you in…
    </div>
  );
}
