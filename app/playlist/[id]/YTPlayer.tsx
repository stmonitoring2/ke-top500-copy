// app/playlist/[id]/YTPlayer.tsx
"use client";

import { useEffect, useRef } from "react";

type Props = { videoId: string; onEnded?: () => void };

export default function YTPlayer({ videoId, onEnded }: Props) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);

  // Ensure IFrame API exists (once)
  useEffect(() => {
    const id = "yt-iframe-api";
    if (!document.getElementById(id)) {
      const s = document.createElement("script");
      s.id = id;
      s.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(s);
    }
  }, []);

  // Create the player when API is ready
  useEffect(() => {
    const ensureIframeFills = () => {
      const host = hostRef.current;
      if (!host) return;
      const iframe = host.querySelector("iframe") as HTMLIFrameElement | null;
      if (!iframe) return;
      // force fill
      iframe.style.position = "absolute";
      iframe.style.inset = "0";
      iframe.style.width = "100%";
      iframe.style.height = "100%";
    };

    const sizeToWrapper = () => {
      if (!playerRef.current || !wrapperRef.current) return;
      const r = wrapperRef.current.getBoundingClientRect();
      try {
        playerRef.current.setSize(Math.max(1, r.width), Math.max(1, r.height));
      } catch {}
      ensureIframeFills();
    };

    const buildPlayer = () => {
      if (!hostRef.current || !(window as any).YT?.Player) return;

      try { playerRef.current?.destroy?.(); } catch {}

      playerRef.current = new (window as any).YT.Player(hostRef.current, {
        height: "390",
        width: "640",
        videoId,
        playerVars: { rel: 0, playsinline: 1, autoplay: 1 },
        events: {
          onReady: () => {
            ensureIframeFills();
            sizeToWrapper();
          },
          onStateChange: (e: any) => {
            // 0 = ended
            if (e?.data === 0 && onEnded) onEnded();
          },
        },
      });

      // If YouTube swaps the iframe later, keep forcing the styles
      const mo = new MutationObserver(() => ensureIframeFills());
      mo.observe(hostRef.current, { childList: true, subtree: true });
      // store on player so we can disconnect on unmount
      (playerRef.current as any).__mo = mo;
    };

    // Hook window resize
    const onResize = () => sizeToWrapper();
    window.addEventListener("resize", onResize);

    if ((window as any).YT?.Player) {
      buildPlayer();
    } else {
      const prev = (window as any).onYouTubeIframeAPIReady;
      (window as any).onYouTubeIframeAPIReady = () => {
        prev?.();
        buildPlayer();
      };
    }

    return () => {
      window.removeEventListener("resize", onResize);
      try {
        (playerRef.current as any)?.__mo?.disconnect?.();
        playerRef.current?.destroy?.();
      } catch {}
    };
  }, [onEnded, videoId]);

  // Load a new id when it changes
  useEffect(() => {
    const p = playerRef.current;
    if (p && videoId) {
      try {
        p.loadVideoById(videoId);
      } catch {}
    }
  }, [videoId]);

  return (
    <div ref={wrapperRef} className="relative w-full aspect-video rounded-xl overflow-hidden bg-black">
      {/* YouTube injects the iframe into this absolutely filled host */}
      <div ref={hostRef} className="absolute inset-0" />
    </div>
  );
}
