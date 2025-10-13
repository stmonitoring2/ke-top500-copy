"use client";

import { useEffect, useRef } from "react";

type Props = {
  videoId: string;
  onEnded?: () => void;
};

export default function YTPlayer({ videoId, onEnded }: Props) {
  // This is the *visual* box (has the aspect ratio)
  const boxRef = useRef<HTMLDivElement | null>(null);
  // YouTube replaces this element with its own wrapper + iframe
  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);
  const observerRef = useRef<MutationObserver | null>(null);

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

  // Force fill for both the wrapper YT adds and the <iframe/>
  const forceFill = () => {
    const box = boxRef.current;
    if (!box) return;
    // YouTube injects a wrapper DIV inside "mountRef"
    const wrapper = box.querySelector<HTMLDivElement>("#ytp-wrapper, .html5-video-player, div > iframe, div > div");
    // but selectors can change; just brute-force everything under the box
    const iframes = box.querySelectorAll("iframe");
    const children = box.querySelectorAll(":scope > div");

    children.forEach((el) => {
      (el as HTMLElement).style.position = "absolute";
      (el as HTMLElement).style.inset = "0";
      (el as HTMLElement).style.width = "100%";
      (el as HTMLElement).style.height = "100%";
      (el as HTMLElement).style.display = "block";
    });

    iframes.forEach((el) => {
      el.style.position = "absolute";
      el.style.inset = "0";
      el.style.width = "100%";
      el.style.height = "100%";
      el.style.display = "block";
    });
  };

  // Create / destroy the player
  useEffect(() => {
    function create() {
      if (!mountRef.current || !(window as any).YT?.Player) return;

      try { playerRef.current?.destroy?.(); } catch {}

      playerRef.current = new (window as any).YT.Player(mountRef.current, {
        width: "100%", // we’ll override anyway
        height: "100%",
        videoId,
        playerVars: {
          rel: 0,
          playsinline: 1,
          autoplay: 1,
        },
        events: {
          onReady: () => {
            forceFill();
          },
          onStateChange: (e: any) => {
            // 0 = ended
            if (e?.data === 0 && onEnded) onEnded();
          },
        },
      });

      // Make sure late DOM changes still fill the box
      setTimeout(forceFill, 50);
      setTimeout(forceFill, 250);

      // Watch for YT replacing nodes and re-apply fill
      observerRef.current?.disconnect();
      if (boxRef.current) {
        observerRef.current = new MutationObserver(() => forceFill());
        observerRef.current.observe(boxRef.current, {
          childList: true,
          subtree: true,
          attributes: true,
        });
      }
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

    const onResize = () => forceFill();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      observerRef.current?.disconnect();
      try { playerRef.current?.destroy?.(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onEnded]);

  // When the ID changes, load and re-force fill
  useEffect(() => {
    const p = playerRef.current;
    if (p && videoId) {
      try {
        p.loadVideoById(videoId);
        setTimeout(forceFill, 50);
      } catch {
        /* ignore */
      }
    }
  }, [videoId]);

  return (
    <div ref={boxRef} className="relative w-full aspect-video rounded-xl overflow-hidden bg-black">
      <div ref={mountRef} className="absolute inset-0" />
    </div>
  );
}
