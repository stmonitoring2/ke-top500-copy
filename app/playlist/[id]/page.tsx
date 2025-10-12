"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type PlaylistItem = {
  id: string;
  videoId: string;
  title?: string;
  thumbnail?: string;
  position?: number;
  added_at?: string;
};

type Playlist = {
  id: string;
  name: string;
  items: PlaylistItem[];
  created_at?: string;
};

function toArray<T>(v: unknown, fallback: T[] = []): T[] {
  return Array.isArray(v) ? (v as T[]) : fallback;
}

/** Normalize whatever the API returns into our Playlist shape */
function normalizePlaylist(payload: any): Playlist | null {
  if (!payload) return null;

  // Case A: API already returns { id, name, items: [...] }
  if (payload.id && payload.name) {
    const rawItems =
      payload.items ??
      payload.playlist_items ?? // if API nests under playlist_items
      [];
    const items = toArray<any>(rawItems).map((it: any) => ({
      id: String(it.id ?? it.item_id ?? crypto.randomUUID()),
      videoId: String(it.videoId ?? it.video_id ?? it.videoID ?? ""),
      title: it.title ?? it.video_title ?? undefined,
      thumbnail: it.thumbnail ?? it.thumbnail_url ?? undefined,
      position: typeof it.position === "number" ? it.position : undefined,
      added_at: it.added_at,
    }));
    return {
      id: String(payload.id),
      name: String(payload.name),
      created_at: payload.created_at,
      items,
    };
  }

  // Case B: PostgREST style single-row array: [{ ...playlist fields... }]
  if (Array.isArray(payload) && payload.length > 0) {
    return normalizePlaylist(payload[0]);
  }

  // Case C: { data: {...} } wrapper
  if (payload.data) return normalizePlaylist(payload.data);

  return null;
}

export default function PlaylistPage() {
  const params = useParams();
  const router = useRouter();

  // normalize /playlist/[id] param to a string
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
        if (!res.ok) {
          throw new Error(`Failed to load playlist (${res.status})`);
        }

        const json = await res.json();
        const normalized = normalizePlaylist(json);
        if (!ignore) setData(normalized);
      } catch (e: any) {
        if (!ignore && e?.name !== "AbortError") {
          setErr(e?.message || "Failed to load");
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    })();

    return () => {
      ignore = true;
      ctrl.abort();
    };
  }, [playlistId, router]);

  const items: PlaylistItem[] = useMemo(
    () => (data?.items && Array.isArray(data.items) ? data.items : []),
    [data]
  );

  async function handleRemove(itemId: string) {
    if (!playlistId) return;
    try {
      setRemovingId(itemId);
      const res = await fetch(`/api/playlists/${playlistId}/items/${itemId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to remove item");
      setData((prev) =>
        prev ? { ...prev, items: prev.items.filter((i) => i.id !== itemId) } : prev
      );
    } catch (e: any) {
      alert(e?.message || "Could not remove item");
    } finally {
      setRemovingId(null);
    }
  }

  if (loading) {
    return <div className="p-4 text-sm text-neutral-600">Loading playlist…</div>;
  }
  if (err) {
    return <div className="p-4 text-sm text-red-600">Error: {err}</div>;
  }
  if (!data) {
    return <div className="p-4 text-sm">Playlist not found.</div>;
  }

  return (
    <div className="mx-auto max-w-4xl p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{data.name}</h1>
        <div className="flex gap-3">
          <a className="text-sm underline" href="/me/playlists" aria-label="Back to My Playlists">
            ← Back to My Playlists
          </a>
          <a className="text-sm underline" href="/" aria-label="Home">
            Home
          </a>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-neutral-600">
          This playlist is empty. Use “Save” buttons or paste a YouTube URL under the player to add videos.
        </p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {items.map((it) => (
            <li key={it.id} className="border rounded-xl overflow-hidden bg-white">
              <a
                href={`https://www.youtube.com/watch?v=${it.videoId}`}
                target="_blank"
                rel="noreferrer"
                className="block"
              >
                <div className="aspect-video bg-neutral-200">
                  {it.thumbnail ? (
                    <img
                      src={it.thumbnail}
                      alt={it.title || it.videoId}
                      className="w-full h-full object-cover"
                    />
                  ) : null}
                </div>
                <div className="p-2">
                  <p className="text-sm font-medium line-clamp-2">
                    {it.title || it.videoId}
                  </p>
                </div>
              </a>

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
