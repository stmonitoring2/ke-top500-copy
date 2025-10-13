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

  // Make the inserted <iframe> fill the container
  const fitIframe = () => {
    const el = containerRef.current?.querySelector("iframe") as HTMLIFrameElement | null;
    if (!el) return;
    el.style.position = "absolute";
    el.style.inset = "0";
    el.style.width = "100%";
    el.style.height = "100%";
  };

  useEffect(() => {
    const id = "yt-iframe-api";
    if (!document.getElementById(id)) {
      const s = document.createElement("script");
      s.id = id;
      s.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(s);
    }
  }, []);

  useEffect(() => {
    function create() {
      if (!containerRef.current || !(window as any).YT?.Player) return;

      try { playerRef.current?.destroy?.(); } catch {}

      playerRef.current = new (window as any).YT.Player(containerRef.current, {
        // Numbers are required here; we’ll override by CSS + ResizeObserver
        width: 640,
        height: 390,
        videoId,
        playerVars: {
          rel: 0,
          playsinline: 1,
          autoplay: 1,
          modestbranding: 1,
        },
        events: {
          onReady: () => {
            fitIframe();
            // Keep pixel size synced (prevents some artifacts on Safari)
            const c = containerRef.current;
            if (c && playerRef.current?.setSize) {
              const set = () => {
                playerRef.current.setSize(c.clientWidth, c.clientHeight);
                fitIframe();
              };
              roRef.current?.disconnect();
              roRef.current = new ResizeObserver(set);
              roRef.current.observe(c);
              set();
            }
          },
          onStateChange: (e: any) => {
            // 0 = ended
            if (e?.data === 0 && onEnded) onEnded();
          },
        },
      });
    }

    if ((window as any).YT?.Player) {
      create();
    } else {
      const prev = (window as any).onYouTubeIframeAPIReady;
      (window as any).onYouTubeIframeAPIReady = () => {
        prev?.();
        create();
      };
    }

    return () => {
      try { playerRef.current?.destroy?.(); } catch {}
      roRef.current?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onEnded]);

  useEffect(() => {
    const p = playerRef.current;
    if (p && videoId) {
      try {
        p.loadVideoById(videoId);
      } catch {}
    }
  }, [videoId]);

  return (
    <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black">
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}
