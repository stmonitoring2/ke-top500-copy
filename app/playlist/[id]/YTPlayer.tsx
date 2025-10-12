// app/playlist/[id]/YTPlayer.tsx
"use client";

import { useEffect, useRef } from "react";
import { reportActivity } from "@/lib/idle-bus"; // Add this line

type Props = {
  videoId: string;
  onEnded?: () => void;
};

export default function YTPlayer({ videoId, onEnded }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);

  useEffect(() => {
    // Ensure the API script exists once
    const id = "yt-iframe-api";
    if (!document.getElementById(id)) {
      const s = document.createElement("script");
      s.id = id;
      s.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(s);
    }

    // Wait for API to load, then create the player
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
            /**
             * YT.PlayerState constants:
             * -1 (unstarted)
             *  0 (ended)
             *  1 (playing)
             *  2 (paused)
             *  3 (buffering)
             *  5 (video cued)
             */

            // Report user activity when playback starts/resumes
            if (e?.data === 1) {
              reportActivity("video-playing");
            }

            // When video ends, trigger parent handler
            if (e?.data === 0 && onEnded) {
              onEnded();
            }
          },
        },
      });
    };

    return () => {
      try {
        playerRef.current?.destroy?.();
      } catch {
        // ignore cleanup errors
      }
    };
  }, []); // only run once

  // When videoId changes, load the new video if ready
  useEffect(() => {
    if (playerRef.current && videoId) {
      try {
        playerRef.current.loadVideoById(videoId);
      } catch {
        // player may not be ready yet
      }
    }
  }, [videoId]);

  return (
    <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black">
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}
