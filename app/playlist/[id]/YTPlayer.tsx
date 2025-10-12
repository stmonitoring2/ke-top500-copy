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

  useEffect(() => {
    // ensure the API script exists
    const id = "yt-iframe-api";
    if (!document.getElementById(id)) {
      const s = document.createElement("script");
      s.id = id;
      s.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(s);
    }

    // wait for API to load
    (window as any).onYouTubeIframeAPIReady = () => {
      if (!containerRef.current) return;
      playerRef.current = new (window as any).YT.Player(containerRef.current, {
        height: "390",
        width: "640",
        videoId,
        playerVars: {
          rel: 0,
          playsinline: 1,
          autoplay: 1,
        },
        events: {
          onStateChange: (e: any) => {
            // 0 = ended
            if (e?.data === 0 && onEnded) onEnded();
          },
        },
      });
    };

    return () => {
      try {
        playerRef.current?.destroy?.();
      } catch {}
    };
  }, []);

  // when the videoId changes, cue&play it
  useEffect(() => {
    if (playerRef.current && videoId) {
      try {
        playerRef.current.loadVideoById(videoId);
      } catch {
        // If not ready yet, ignore
      }
    }
  }, [videoId]);

  return (
    <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black">
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}
