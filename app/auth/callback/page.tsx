// app/auth/callback/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

export default function AuthCallbackPage() {
  const supabase = createClient();
  const router = useRouter();
  const params = useSearchParams();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      // Try PKCE exchange if the URL has code/state (safe no-op for implicit).
      // If it fails (400/422) we ignore; implicit flow will have set the session from the hash.
      try {
        if (typeof window !== "undefined") {
          await supabase.auth.exchangeCodeForSession(window.location.href);
        }
      } catch {
        // ignore — implicit flow doesn’t need exchange
      }

      // Now read the session (works for both PKCE and implicit)
      const { data, error } = await supabase.auth.getSession();

      if (!alive) return;

      if (error || !data.session) {
        setErr(error?.message || "Callback failed");
        router.replace("/signin?error=callback");
        return;
      }

      const next = params.get("next") || "/me/playlists";
      router.replace(next);
    })();

    return () => {
      alive = false;
    };
  }, [router, params, supabase]);

  return (
    <div className="mx-auto max-w-md p-6">
      <p className="text-sm">Finishing sign-in…</p>
      {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
    </div>
  );
}
