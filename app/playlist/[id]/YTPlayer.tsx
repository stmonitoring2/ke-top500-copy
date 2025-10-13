// app/playlist/[id]/YTPlayer.tsx
"use client";

import { useEffect, useRef } from "react";

type Props = {
  videoId: string;
  onEnded?: () => void;
};

export default function YTPlayer({ videoId, onEnded }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);
  const apiReadyRef = useRef(false);

  // Ensure the IFrame API exists (only once)
  useEffect(() => {
    const id = "yt-iframe-api";
    if (!document.getElementById(id)) {
      const s = document.createElement("script");
      s.id = id;
      s.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(s);
    }
  }, []);

  // Build the player when API is ready
  useEffect(() => {
    const makePlayer = () => {
      if (!containerRef.current || !(window as any).YT?.Player) return;

      // Clean any previous instance
      try { playerRef.current?.destroy?.(); } catch {}

      const container = containerRef.current;

      playerRef.current = new (window as any).YT.Player(container, {
        // The API wants numbers but we'll override sizing via CSS + setSize
        height: "390",
        width: "640",
        videoId,
        playerVars: {
          rel: 0,
          playsinline: 1,
          autoplay: 1,
        },
        events: {
          onReady: () => {
            // Force the injected iframe to fill the parent
            const iframe = container.querySelector("iframe") as HTMLIFrameElement | null;
            if (iframe) {
              iframe.style.position = "absolute";
              iframe.style.inset = "0";
              iframe.style.width = "100%";
              iframe.style.height = "100%";
            }
            // Also tell the player to match the container size
            sizeToContainer();
          },
          onStateChange: (e: any) => {
            // 0 = ended
            if (e?.data === 0 && onEnded) onEnded();
          },
        },
      });
    };

    // Helper to size the player to the wrapper
    const sizeToContainer = () => {
      if (!playerRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      // Guard against 0x0 while layout settles
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      try {
        playerRef.current.setSize(w, h);
      } catch {}
    };

    // Watch for window resizes to keep it snug
    const onResize = () => sizeToContainer();
    window.addEventListener("resize", onResize);

    // If API is already ready, create immediately; otherwise hook the global
    if ((window as any).YT?.Player) {
      apiReadyRef.current = true;
      makePlayer();
    } else {
      const prev = (window as any).onYouTubeIframeAPIReady;
      (window as any).onYouTubeIframeAPIReady = () => {
        apiReadyRef.current = true;
        prev?.();
        makePlayer();
      };
    }

    return () => {
      window.removeEventListener("resize", onResize);
      try { playerRef.current?.destroy?.(); } catch {}
    };
  }, [onEnded, videoId]);

  // When the videoId changes, load the new video if possible
  useEffect(() => {
    const p = playerRef.current;
    if (p && videoId) {
      try {
        p.loadVideoById(videoId);
      } catch {
        // If not ready yet, it will load on onReady.
      }
    }
  }, [videoId]);

  return (
    <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black">
      {/* The API will inject the <iframe> into this absolutely positioned box */}
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}
