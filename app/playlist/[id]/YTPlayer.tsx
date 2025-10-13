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
  const roRef = useRef<ResizeObserver | null>(null);

  // Make sure the player always fits the container (no black gutters)
  const fitToContainer = () => {
    const el = containerRef.current;
    const p = playerRef.current;
    if (!el || !p) return;
    // match the wrapper (which uses aspect-video) exactly
    p.setSize(el.clientWidth, el.clientHeight);
  };

  // Ensure the API script exists once
  useEffect(() => {
    const id = "yt-iframe-api";
    if (!document.getElementById(id)) {
      const s = document.createElement("script");
      s.id = id;
      s.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(s);
    }
  }, []);

  // Create / destroy player
  useEffect(() => {
    const create = () => {
      if (!containerRef.current || !(window as any).YT?.Player) return;

      // Destroy previous just in case
      try { playerRef.current?.destroy?.(); } catch {}

      playerRef.current = new (window as any).YT.Player(containerRef.current, {
        // We’ll override the size via setSize(), so these exact numbers don’t matter
        width: "640",
        height: "390",
        videoId,
        playerVars: {
          rel: 0,
          playsinline: 1,
          autoplay: 1,
        },
        events: {
          onReady: () => {
            fitToContainer();
          },
          onStateChange: (e: any) => {
            // 0 = ended
            if (e?.data === 0 && onEnded) onEnded();
          },
        },
      });

      // Keep the iframe sized perfectly with the wrapper
      if (!roRef.current) {
        roRef.current = new ResizeObserver(() => fitToContainer());
      }
      roRef.current.observe(containerRef.current);
    };

    if ((window as any).YT?.Player) {
      create();
    } else {
      // If the API hasn’t fired yet, chain into the global callback
      const prev = (window as any).onYouTubeIframeAPIReady;
      (window as any).onYouTubeIframeAPIReady = () => {
        prev?.();
        create();
      };
    }

    return () => {
      try { roRef.current?.disconnect(); } catch {}
      try { playerRef.current?.destroy?.(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load a new videoId into the same player instance
  useEffect(() => {
    const p = playerRef.current;
    if (!p || !videoId) return;
    try {
      p.loadVideoById(videoId);
      // ensure fresh sizing (helps when navigating quickly)
      fitToContainer();
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  return (
    <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black">
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}
