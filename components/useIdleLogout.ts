"use client";

import { useCallback, useEffect, useRef } from "react";
import { onActivity, reportActivity } from "@/lib/idle-bus";

type Options = {
  // default 30 minutes; can override with NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES
  timeoutMs?: number;
  onTimeout: () => Promise<void> | void;
};

function minutesToMs(m: number) { return Math.max(1, m) * 60_000; }

export function useIdleLogout({ timeoutMs, onTimeout }: Options) {
  const ms =
    typeof timeoutMs === "number"
      ? timeoutMs
      : minutesToMs(Number(process.env.NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES ?? 30));

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      // Only sign out if tab is not actively visible OR we truly saw no activity.
      // (Visibility is just an extra guard; the real gate is lack of activity events.)
      onTimeout();
    }, ms);
  }, [ms, onTimeout]);

  useEffect(() => {
    // Kick it once on mount
    reset();

    // Browser/user activity listeners
    const bump = () => reset();
    const opts: AddEventListenerOptions = { passive: true };

    window.addEventListener("mousemove", bump, opts);
    window.addEventListener("mousedown", bump, opts);
    window.addEventListener("keydown", bump, opts);
    window.addEventListener("scroll", bump, opts);
    window.addEventListener("touchstart", bump, opts);
    window.addEventListener("focus", bump, opts);
    document.addEventListener("visibilitychange", bump, opts);

    // Listen to our cross-component activity bus (e.g. video start)
    const offBus = onActivity(() => reset());

    // Safety: ping once when we mount (counts as activity)
    reportActivity("mount");

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener("mousemove", bump);
      window.removeEventListener("mousedown", bump);
      window.removeEventListener("keydown", bump);
      window.removeEventListener("scroll", bump);
      window.removeEventListener("touchstart", bump);
      window.removeEventListener("focus", bump);
      document.removeEventListener("visibilitychange", bump);
      offBus();
    };
  }, [reset]);
}
