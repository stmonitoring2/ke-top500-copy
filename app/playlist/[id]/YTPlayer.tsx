// app/playlist/[id]/YTPlayer.tsx
"use client";

import { useEffect, useRef } from "react";

type Props = {
  videoId: string;
  onEnded?: () => void;
};

export default function YTPlayer({ videoId, onEnded }: Props) {
  const frameWrapRef = useRef<HTMLDivElement | null>(null); // absolute fill wrapper
  const mountRef = useRef<HTMLDivElement | null>(null);     // element YT replaces
  const playerRef = useRef<any>(null);

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

  // Make the iframe fill its parent
  const forceFillIframe = () => {
    const wrap = frameWrapRef.current;
    if (!wrap) return;
    const iframe = wrap.querySelector("iframe") as HTMLIFrameElement | null;
    if (iframe) {
      iframe.style.position = "absolute";
      iframe.style.inset = "0";
      iframe.style.width = "100%";
      iframe.style.height = "100%";
      iframe.style.display = "block";
    }
  };

  useEffect(() => {
    function create() {
      if (!mountRef.current || !(window as any).YT?.Player) return;

      // Clean up old player
      try { playerRef.current?.destroy?.(); } catch {}

      playerRef.current = new (window as any).YT.Player(mountRef.current, {
        // Width/height here don’t matter; we’ll force 100% via CSS right after creation
        width: "100%",
        height: "100%",
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
          onReady: () => {
            // Ensure the iframe fills the container once it exists
            forceFillIframe();
          },
        },
      });

      // In case onReady fires before the iframe is attached, retry shortly
      setTimeout(forceFillIframe, 50);
      setTimeout(forceFillIframe, 250);
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

    // Re-apply fill on resizes (mobile rotations, etc.)
    const onResize = () => forceFillIframe();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      try { playerRef.current?.destroy?.(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onEnded]);

  // When the videoId changes, cue the new one and re-apply fill
  useEffect(() => {
    const p = playerRef.current;
    if (p && videoId) {
      try {
        p.loadVideoById(videoId);
        // After a new video loads, YT sometimes re-injects the iframe — enforce fill again.
        setTimeout(() => forceFillIframe(), 50);
      } catch {
        /* ignore */
      }
    }
  }, [videoId]);

  return (
    <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black">
      {/* absolute fill wrapper – we always fill this box */}
      <div ref={frameWrapRef} className="absolute inset-0">
        {/* YT will replace this div with an iframe */}
        <div ref={mountRef} className="absolute inset-0" />
      </div>
    </div>
  );
}
