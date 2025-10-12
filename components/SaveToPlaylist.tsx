"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";

type ForSavePlaylist = {
  id: string;
  name: string;
  created_at?: string;
  hasVideo?: boolean;
};

export default function SaveToPlaylist(props: {
  videoId: string;
  title?: string;
  thumbnail?: string;
  className?: string;
}) {
  const { videoId, title, thumbnail, className } = props;
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [playlists, setPlaylists] = useState<ForSavePlaylist[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  // If user clicks "Save" while signed out → send to /signin
  async function requireAuthOrRedirect(): Promise<boolean> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/signin?next=${next}`;
      return false;
    }
    return true;
  }

  async function loadPlaylists() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/playlists/for-save?videoId=${encodeURIComponent(videoId)}`, { cache: "no-store" });
      if (res.status === 401) {
        // not signed in
        const ok = await requireAuthOrRedirect();
        if (!ok) return;
      }
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const json = await res.json();
      setPlaylists(json.playlists || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load playlists");
    } finally {
      setLoading(false);
    }
  }

  async function onOpen() {
    const ok = await requireAuthOrRedirect();
    if (!ok) return;
    setOpen(true);
    loadPlaylists();
  }

  async function addToPlaylist(pid: string) {
    setError(null);
    try {
      const res = await fetch(`/api/playlists/${pid}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoId, title, thumbnail }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `Failed to save (${res.status})`);
      }
      // Mark as present to disable duplicate saves
      setPlaylists(ps => ps.map(p => p.id === pid ? { ...p, hasVideo: true } : p));
    } catch (e: any) {
      alert(e?.message || "Could not save");
    }
  }

  async function createPlaylist() {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      // Create playlist (you should have POST /api/playlists)
      const res = await fetch(`/api/playlists`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `Failed to create (${res.status})`);
      }
      const p = await res.json();
      setPlaylists(ps => [{ id: p.id, name: p.name, hasVideo: false }, ...ps]);
      setNewName("");
    } catch (e: any) {
      setError(e?.message || "Could not create playlist");
    } finally {
      setCreating(false);
    }
  }

  // Close when clicking outside
  const overlayRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onClick(e: MouseEvent) {
      if (overlayRef.current && e.target === overlayRef.current) setOpen(false);
    }
    if (open) {
      document.addEventListener("keydown", onKey);
      document.addEventListener("mousedown", onClick);
    }
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <>
      <button
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm hover:bg-neutral-50 ${className || ""}`}
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        Save
      </button>

      {open && (
        // Fullscreen overlay to avoid clipping; high z-index
        <div ref={overlayRef} className="fixed inset-0 z-[9999] bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-semibold">Save to playlist</h3>
              <button className="text-sm underline" onClick={() => setOpen(false)}>Close</button>
            </div>

            <div className="p-4 space-y-3">
              {/* Create new */}
              <div className="flex gap-2">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="New playlist name"
                  className="flex-1 rounded-xl border border-neutral-300 px-3 py-2 text-sm"
                />
                <button
                  onClick={createPlaylist}
                  disabled={creating || !newName.trim()}
                  className="rounded-xl border px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
                >
                  {creating ? "Creating…" : "Create"}
                </button>
              </div>

              <div className="border-t pt-3">
                {loading ? (
                  <p className="text-sm text-neutral-600">Loading…</p>
                ) : error ? (
                  <p className="text-sm text-red-600">Error: {error}</p>
                ) : playlists.length === 0 ? (
                  <p className="text-sm text-neutral-600">No playlists yet — create one above.</p>
                ) : (
                  <ul className="space-y-2 max-h-72 overflow-auto pr-1">
                    {playlists.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-3">
                        <span className="text-sm">{p.name}</span>
                        <button
                          className="text-xs px-2 py-1 rounded border hover:bg-neutral-50 disabled:opacity-50"
                          disabled={!!p.hasVideo}
                          onClick={() => addToPlaylist(p.id)}
                        >
                          {p.hasVideo ? "Saved" : "Save"}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
