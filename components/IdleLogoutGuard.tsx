"use client";

import { useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import { useIdleLogout } from "./useIdleLogout";

// If you already have a browser Supabase client helper, import and use that instead.
// This lightweight client works with NEXT_PUBLIC_* keys.
const supabase =
  typeof window !== "undefined"
    ? createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL as string,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
      )
    : (null as any);

export default function IdleLogoutGuard() {
  const onTimeout = useCallback(async () => {
    try {
      // Optional: only sign out if user is logged in
      const { data } = await supabase.auth.getSession();
      if (data?.session) {
        await supabase.auth.signOut();
        // Hard redirect so UI state is clean
        window.location.href = "/signin?reason=idle";
      }
    } catch {
      // ignore
    }
  }, []);

  useIdleLogout({ onTimeout });

  return null; // nothing to render
}
