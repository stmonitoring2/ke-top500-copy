"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

/* ===========================
   Types & helpers
=========================== */
type PlaylistItem = {
  id: string;
  videoId: string;
  title?: string | null;
  thumbnail?: string | null;
  position?: number;
  added_at?: string;
};

type Playlist = {
  id: string;
  name: string;
  items: PlaylistItem[];
  created_at?: string;
};

function normalize(payload: any): Playlist | null {
  if (!payload) return null;
  if (payload.id && payload.name) {
    const items = Array.isArray(payload.items) ? payload.items : [];
    return {
      id: String(payload.id),
      name: String(payload.name),
      created_at: payload.created_at,
      items: items.map((it: any) => ({
        id: String(it.id),
        videoId: String(it.videoId ?? it.video_id ?? ""),
        title: it.title ?? null,
        thumbnail: it.thumbnail ?? it.thumbnail_url ?? null,
        position: it.position,
        added_at: it.added_at,
      })),
    };
  }
  if (payload.data) return normalize(payload.data);
  if (Array.isArray(payload) && payload.length) return normalize(payload[0]);
  return null;
}

/* Make TS happy about the YouTube IFrame API on window */
declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/* ===========================
   YouTube Player (IFrame API)
=========================== */
function YTPlayer({
  videoId,
  onEnded,
}: {
  videoId: string;
  onEnded?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);

  // Inject API script once
  useEffect(() => {
    const id = "yt-iframe-api";
    if (!document.getElementById(id)) {
      const s = document.createElement("script");
      s.id = id;
      s.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(s);
    }
  }, []);

  // Create player when API is ready
  useEffect(() => {
    function create() {
      if (!containerRef.current || !window.YT || !window.YT.Player) return;
      try {
        playerRef.current?.destroy?.();
      } catch {}
      playerRef.current = new window.YT.Player(containerRef.current, {
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
    }

    if (window.YT && window.YT.Player) {
      create();
    } else {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        create();
      };
    }

    return () => {
      try {
        playerRef.current?.destroy?.();
      } catch {}
    };
    // only depends on onEnded; videoId handled below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onEnded]);

  // Load a new video when videoId changes (if player already exists)
  useEffect(() => {
    const p = playerRef.current;
    if (p && videoId) {
      try {
        p.loadVideoById(videoId);
      } catch {
        // ignore if player not ready yet
      }
    }
  }, [videoId]);

  return (
    <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black">
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}

/* ===========================
   Page
=========================== */
export default function PlaylistPage() {
  const params = useParams();
  const router = useRouter();
  const playlistId =
    typeof params?.id === "string"
      ? params.id
      : Array.isArray(params?.id)
      ? params.id[0]
      : "";

  const [data, setData] = useState<Playlist | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const items: PlaylistItem[] = useMemo(
    () => (data?.items && Array.isArray(data.items) ? data.items : []),
    [data]
  );

  // Which index is currently playing
  const [currentIndex, setCurrentIndex] = useState(0);
  const current: PlaylistItem | null = items.length
    ? items[Math.min(currentIndex, items.length - 1)]
    : null;

  // Keep currentIndex valid when list changes
  useEffect(() => {
    if (items.length === 0) {
      setCurrentIndex(0);
      return;
    }
    if (currentIndex > items.length - 1) {
      setCurrentIndex(items.length - 1);
    }
  }, [items, currentIndex]);

  // Fetch playlist
  useEffect(() => {
    if (!playlistId) {
      setErr("Missing playlist id");
      setLoading(false);
      return;
    }
    let ignore = false;
    const ctrl = new AbortController();
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const res = await fetch(`/api/playlists/${playlistId}`, {
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (res.status === 401) {
          router.push("/signin");
          return;
        }
        if (!res.ok) throw new Error(`Failed to load playlist (${res.status})`);
        const json = await res.json();
        const normalized = normalize(json);
        if (!ignore) {
          setData(normalized);
          if (normalized?.items?.length) setCurrentIndex(0);
        }
      } catch (e: any) {
        if (!ignore && e?.name !== "AbortError")
          setErr(e?.message || "Failed to load");
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
      ctrl.abort();
    };
  }, [playlistId, router]);

  async function handleRemove(itemId: string, idx: number) {
    if (!playlistId) return;
    try {
      setRemovingId(itemId);
      const res = await fetch(`/api/playlists/${playlistId}/items/${itemId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to remove item");
      setData((prev) => {
        if (!prev) return prev;
        const copy = prev.items.filter((i) => i.id !== itemId);
        // Adjust currentIndex if necessary
        let nextIndex = currentIndex;
        if (idx < currentIndex) nextIndex = Math.max(0, currentIndex - 1);
        if (idx === currentIndex) {
          nextIndex = Math.min(nextIndex, Math.max(0, copy.length - 1));
        }
        setCurrentIndex(nextIndex);
        return { ...prev, items: copy };
      });
    } catch (e: any) {
      alert(e?.message || "Could not remove item");
    } finally {
      setRemovingId(null);
    }
  }

  // Move Up/Down (calls PATCH /api/playlists/[id]/items/reorder)
  async function moveItem(
    itemId: string,
    direction: "up" | "down",
    idx: number
  ) {
    if (!playlistId) return;
    try {
      await fetch(`/api/playlists/${playlistId}/items/reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, direction }),
      });
      // Optimistic UI swap
      setData((prev) => {
        if (!prev) return prev;
        const copy = [...prev.items];
        if (direction === "up" && idx > 0) {
          [copy[idx - 1], copy[idx]] = [copy[idx], copy[idx - 1]];
          if (idx === currentIndex) setCurrentIndex(idx - 1);
          else if (idx - 1 === currentIndex) setCurrentIndex(idx);
        } else if (direction === "down" && idx < copy.length - 1) {
          [copy[idx], copy[idx + 1]] = [copy[idx + 1], copy[idx]];
          if (idx === currentIndex) setCurrentIndex(idx + 1);
          else if (idx + 1 === currentIndex) setCurrentIndex(idx);
        }
        return { ...prev, items: copy };
      });
    } catch (e: any) {
      alert(e?.message || "Reorder failed");
    }
  }

  if (loading)
    return <div className="p-4 text-sm text-neutral-600">Loading playlist…</div>;
  if (err)
    return <div className="p-4 text-sm text-red-600">Error: {err}</div>;
  if (!data) return <div className="p-4 text-sm">Playlist not found.</div>;

  const hasItems = items.length > 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{data.name}</h1>
        <div className="flex gap-3">
          <a className="text-sm underline" href="/me/playlists">
            ← Back to My Playlists
          </a>
          <a className="text-sm underline" href="/">
            Home
          </a>
        </div>
      </div>

      {/* Controls */}
      <div className="mb-3 flex items-center gap-2">
        <button
          className="text-sm px-3 py-1.5 rounded border hover:bg-neutral-50 disabled:opacity-50"
          disabled={!hasItems}
          onClick={() => setCurrentIndex(0)}
          aria-label="Play all"
        >
          ▶ Play All
        </button>
        {hasItems && (
          <span className="text-xs text-neutral-600">
            Now playing:{" "}
            <span className="font-medium">
              {current?.title || current?.videoId}
            </span>
          </span>
        )}
      </div>

      {/* Player (auto-advance on end) */}
      {current ? (
        <div className="rounded-xl overflow-hidden bg-black mb-4">
          <YTPlayer
            videoId={current.videoId}
            onEnded={() => {
              setCurrentIndex((i) => (i + 1 < items.length ? i + 1 : i)); // stop at end
            }}
          />
          <div className="p-3 bg-white border-t">
            <p className="text-sm font-medium">
              {current.title || current.videoId}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-neutral-600 mb-4">No video selected.</p>
      )}

      {/* Thumbnails + Reorder + Remove */}
      {items.length === 0 ? (
        <p className="text-sm text-neutral-600">This playlist is empty.</p>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {items.map((it, idx) => {
            const isActive = idx === currentIndex;
            return (
              <li key={it.id} className="border rounded-xl overflow-hidden bg-white">
                <button
                  className="block w-full text-left"
                  onClick={() => setCurrentIndex(idx)}
                  title={it.title || it.videoId}
                >
                  <div className="relative aspect-video bg-neutral-200">
                    {it.thumbnail ? (
                      <img
                        src={it.thumbnail}
                        alt={it.title || it.videoId}
                        className="w-full h-full object-cover"
                      />
                    ) : null}
                    {isActive && (
                      <span className="absolute bottom-1 right-1 text-[10px] bg-black/70 text-white px-1.5 py-0.5 rounded">
                        Now playing
                      </span>
                    )}
                  </div>
                  <div className="p-2">
                    <p className="text-xs font-medium line-clamp-2">
                      {it.title || it.videoId}
                    </p>
                  </div>
                </button>

                <div className="p-2 border-t flex items-center justify-between gap-2">
                  <div className="flex gap-1">
                    <button
                      className="text-xs px-2 py-1 rounded border hover:bg-neutral-50 disabled:opacity-40"
                      disabled={idx === 0}
                      onClick={() => moveItem(it.id, "up", idx)}
                      title="Move up"
                    >
                      ↑ Up
                    </button>
                    <button
                      className="text-xs px-2 py-1 rounded border hover:bg-neutral-50 disabled:opacity-40"
                      disabled={idx === items.length - 1}
                      onClick={() => moveItem(it.id, "down", idx)}
                      title="Move down"
                    >
                      ↓ Down
                    </button>
                  </div>

                  <button
                    onClick={() => handleRemove(it.id, idx)}
                    disabled={removingId === it.id}
                    className="text-xs px-2 py-1 rounded border hover:bg-neutral-50 disabled:opacity-60"
                    title="Remove from playlist"
                  >
                    {removingId === it.id ? "Removing…" : "Remove"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
