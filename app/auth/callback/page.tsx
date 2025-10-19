"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

// Do NOT prerender/cache this page (auth callback must run on the client)
export const dynamic = "force-dynamic";
export const revalidate = false as const;
// Ensure Node runtime (avoid Edge runtime warnings)
export const runtime = "nodejs";

function CallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const supabase = createClient();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
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
