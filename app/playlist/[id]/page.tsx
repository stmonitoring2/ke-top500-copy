"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

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
        added_at: it.added_at
      }))
    };
  }
  if (payload.data) return normalize(payload.data);
  if (Array.isArray(payload) && payload.length) return normalize(payload[0]);
  return null;
}

export default function PlaylistPage() {
  const params = useParams();
  const router = useRouter();
  const playlistId = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : "";

  const [data, setData] = useState<Playlist | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const items: PlaylistItem[] = useMemo(
    () => (data?.items && Array.isArray(data.items) ? data.items : []),
    [data]
  );

  const [current, setCurrent] = useState<PlaylistItem | null>(null);
  useEffect(() => {
    if (items.length && !current) setCurrent(items[0]);
  }, [items, current]);

  useEffect(() => {
    if (!playlistId) { setErr("Missing playlist id"); setLoading(false); return; }
    let ignore = false;
    const ctrl = new AbortController();
    (async () => {
      try {
        setLoading(true); setErr(null);
        const res = await fetch(`/api/playlists/${playlistId}`, { cache: "no-store", signal: ctrl.signal });
        if (res.status === 401) { router.push("/signin"); return; }
        if (!res.ok) throw new Error(`Failed to load playlist (${res.status})`);
        const json = await res.json();
        const normalized = normalize(json);
        if (!ignore) setData(normalized);
      } catch (e: any) {
        if (!ignore && e?.name !== "AbortError") setErr(e?.message || "Failed to load");
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => { ignore = true; ctrl.abort(); };
  }, [playlistId, router]);

  async function handleRemove(itemId: string) {
    if (!playlistId) return;
    try {
      setRemovingId(itemId);
      const res = await fetch(`/api/playlists/${playlistId}/items/${itemId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to remove item");
      setData(prev => prev ? { ...prev, items: prev.items.filter(i => i.id !== itemId) } : prev);
      if (current?.id === itemId) setCurrent(null);
    } catch (e: any) {
      alert(e?.message || "Could not remove item");
    } finally {
      setRemovingId(null);
    }
  }

  if (loading) return <div className="p-4 text-sm text-neutral-600">Loading playlist…</div>;
  if (err) return <div className="p-4 text-sm text-red-600">Error: {err}</div>;
  if (!data) return <div className="p-4 text-sm">Playlist not found.</div>;

  return (
    <div className="mx-auto max-w-5xl p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{data.name}</h1>
        <div className="flex gap-3">
          <a className="text-sm underline" href="/me/playlists">← Back to My Playlists</a>
          <a className="text-sm underline" href="/">Home</a>
        </div>
      </div>

      {/* Player */}
      {current ? (
        <div className="rounded-xl overflow-hidden bg-black mb-4">
          <div className="relative w-full aspect-video">
            <iframe
              className="absolute inset-0 w-full h-full"
              src={`https://www.youtube.com/embed/${current.videoId}?autoplay=1&rel=0`}
              title={current.title || "YouTube video"}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
          <div className="p-3 bg-white border-t">
            <p className="text-sm font-medium">{current.title || current.videoId}</p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-neutral-600 mb-4">No video selected.</p>
      )}

      {/* Thumbnails */}
      {items.length === 0 ? (
        <p className="text-sm text-neutral-600">This playlist is empty.</p>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {items.map((it) => (
            <li key={it.id} className="border rounded-xl overflow-hidden bg-white">
              <button
                className="block w-full text-left"
                onClick={() => setCurrent(it)}
                title={it.title || it.videoId}
              >
                <div className="relative aspect-video bg-neutral-200">
                  {it.thumbnail ? (
                    <img src={it.thumbnail} alt={it.title || it.videoId} className="w-full h-full object-cover" />
                  ) : null}
                </div>
                <div className="p-2">
                  <p className="text-xs font-medium line-clamp-2">{it.title || it.videoId}</p>
                </div>
              </button>
              <div className="p-2 border-t flex justify-end">
                <button
                  onClick={() => handleRemove(it.id)}
                  disabled={removingId === it.id}
                  className="text-xs px-2 py-1 rounded border hover:bg-neutral-50 disabled:opacity-60"
                >
                  {removingId === it.id ? "Removing…" : "Remove"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
