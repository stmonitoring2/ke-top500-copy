"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type PlaylistItem = {
  id: string;
  videoId: string;
  title?: string;
  thumbnail?: string;
};

type Playlist = {
  id: string;
  name: string;
  items: PlaylistItem[];
};

export default function PlaylistPage() {
  const params = useParams(); // Next types this as Record<string, string | string[]>
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
          // not signed in → send to sign-in page
          router.push("/signin");
          return;
        }
        if (!res.ok) {
          throw new Error(`Failed to load playlist (${res.status})`);
        }

        const json = (await res.json()) as Playlist;
        if (!ignore) setData(json);
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
          <a
            href="/me/playlists"
            className="text-sm underline"
            aria-label="Back to My Playlists"
          >
            ← Back to My Playlists
          </a>
          <a
            href="/"
            className="text-sm underline"
            aria-label="Home"
          >
            Home
          </a>
        </div>
      </div>

      {data.items.length === 0 ? (
        <p className="text-sm text-neutral-600">
          This playlist is empty. Go add videos from the homepage or paste any YouTube URL under the player.
        </p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {data.items.map((it) => (
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
