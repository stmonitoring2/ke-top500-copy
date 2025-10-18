"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

// prevent prerendering / caching for this route
export const dynamic = "force-dynamic";
export const revalidate = 0;

function CallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const supabase = createClient();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Full URL so supabase-js can read code/state & find local storage entries
      const url = typeof window !== "undefined" ? window.location.href : "";

      const { error } = await supabase.auth.exchangeCodeForSession(url);

      if (cancelled) return;

      if (error) {
        setErr(error.message || "Callback failed");
        router.replace("/signin?error=callback");
        return;
      }

      const next = params.get("next") || "/me/playlists";
      router.replace(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [router, params, supabase]);

  return (
    <div className="mx-auto max-w-md p-6">
      <p className="text-sm">Finishing sign-in…</p>
      {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-md p-6 text-sm">Loading…</div>}>
      <CallbackInner />
    </Suspense>
  );
}
