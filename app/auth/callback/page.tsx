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
      // Do NOT change URL before this call — it must read the current URL (with code & state)
      const { error } = await supabase.auth.exchangeCodeForSession(
        typeof window !== "undefined" ? window.location.href : ""
      );

      if (error) {
        console.error("PKCE exchange error:", error.message);
        router.replace("/signin?error=callback");
        return;
      }

      const next = search.get("next") || "/me/playlists";
      router.replace(next);
    })();
  }, [router, search, supabase]);

  return <div className="mx-auto max-w-md p-6 text-sm">Signing you in…</div>;
}
