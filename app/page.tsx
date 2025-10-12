"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2, Video, ExternalLink, Search, Plus } from "lucide-react";

import Toast from "./components/Toast";
import SaveToPlaylist from "@/components/SaveToPlaylist";

/* -------------------------------------------------------
   Small UI primitives
------------------------------------------------------- */
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  className?: string;
  children?: React.ReactNode;
};
const Button: React.FC<ButtonProps> = ({ className = "", children, ...props }) => (
  <button
    className={`inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm shadow-sm hover:shadow-md border border-neutral-200 bg-white hover:bg-neutral-50 transition ${className}`}
    {...props}
  >
    {children}
  </button>
);

type DivProps = React.HTMLAttributes<HTMLDivElement> & {
  className?: string;
  children?: React.ReactNode;
};
const Card: React.FC<DivProps> = ({ className = "", children, ...props }) => (
  <div className={`rounded-2xl bg-white border border-neutral-200 shadow-sm ${className}`} {...props}>
    {children}
  </div>
);
const CardContent: React.FC<DivProps> = ({ className = "", children, ...props }) => (
  <div className={`p-3 sm:p-4 ${className}`} {...props}>
    {children}
  </div>
);

/* -------------------------------------------------------
   YouTube embed
------------------------------------------------------- */
type YTEmbedProps = {
  videoId?: string;
  title?: string;
  allowFullscreen?: boolean;
};
const YTEmbed: React.FC<YTEmbedProps> = ({ videoId, title, allowFullscreen = true }) => {
  const src = videoId ? `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0` : "";
  return (
    <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black">
      {videoId ? (
        <iframe
          className="absolute inset-0 w-full h-full"
          src={src}
          title={title || "YouTube video"}
          frameBorder={0}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen={allowFullscreen}
        />
      ) : (
        <div className="flex items-center justify-center h-full text-neutral-400">No video selected</div>
      )}
    </div>
  );
};

/* -------------------------------------------------------
   Helpers (filters + utilities)
------------------------------------------------------- */
const MIN_DURATION_SEC = 660; // 11 minutes
const MAX_VIDEO_AGE_DAYS = 365;
const MIN_SUBSCRIBERS = 0;

const SHORTS_RE = /(^|\W)(shorts?|#shorts)(\W|$)/i;
const SPORTS_RE =
  /\b(highlights?|extended\s*highlights|FT|full\s*time|full\s*match|goal|matchday)\b|\b(\d+\s*-\s*\d+)\b/i;
const SENSATIONAL_RE =
  /(catch(ing)?|expos(e|ing)|confront(ing)?|loyalty\s*test|loyalty\s*challenge|pop\s*the\s*balloon)/i;
const MIX_RE =
  /\b(dj\s*mix|dj\s*set|mix\s*tape|mixtape|mixshow|party\s*mix|afrobeat\s*mix|bongo\s*mix|kenyan\s*mix|live\s*mix)\b/i;

const TAG_BLOCKS = new Set<string>([
  "#sportshighlights",
  "#sports",
  "#highlights",
  "#shorts",
  "#short",
  "sportshighlights",
  "sports",
  "highlights",
  "shorts",
  "short",
]);

type Item = {
  rank?: number;
  channel_id?: string;
  channel_name?: string;
  channel_url?: string;
  subscribers?: number;
  latest_video_id?: string;
  latest_video_title?: string;
  latest_video_thumbnail?: string;
  latest_video_published_at?: string;
  latest_video_duration_sec?: number | string | null;
  tags?: string[];
};

type Selected = {
  videoId: string;
  title: string;
  channel_name?: string;
  channel_url?: string;
} | null;

const blockedByTextOrTags = (title = "", desc = "", tags: string[] = []) => {
  if (SHORTS_RE.test(title) || SHORTS_RE.test(desc)) return true;
  if (SPORTS_RE.test(title) || SPORTS_RE.test(desc)) return true;
  if (SENSATIONAL_RE.test(title) || SENSATIONAL_RE.test(desc)) return true;
  if (MIX_RE.test(title) || MIX_RE.test(desc)) return true;
  for (const t of tags) {
    const tl = (t || "").toLowerCase().trim();
    if (TAG_BLOCKS.has(tl)) return true;
    for (const bad of TAG_BLOCKS) if (tl.includes(bad)) return true;
  }
  return false;
};

function parseDurationSec(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }
  const m = /^(\d+):([0-5]?\d)(?::([0-5]?\d))?$/.exec(s);
  if (m) {
    const h = m[3] ? parseInt(m[1], 10) : 0;
    const mm = m[3] ? parseInt(m[2], 10) : parseInt(m[1], 10);
    const sec = m[3] ? parseInt(m[3], 10) : parseInt(m[2], 10);
    return h * 3600 + mm * 60 + sec;
  }
  return null;
}

function looksLikeShortTitle(title?: string): boolean {
  if (!title) return false;
  return SHORTS_RE.test(title);
}

function isTooOld(iso?: string, maxDays = MAX_VIDEO_AGE_DAYS) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000;
  return t < cutoff;
}

const formatAgo = (iso?: string) => {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const s = Math.max(1, Math.floor((now - then) / 1000));
  const units: [number, string][] = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4.345, "week"],
    [12, "month"],
    [Infinity, "year"],
  ];
  let i = 0,
    v = s;
  while (i < units.length - 1 && v >= units[i][0]) {
    v = Math.floor(v / units[i][0]);
    i++;
  }
  const label = units[i][1] + (v > 1 ? "s" : "");
  return `${v} ${label} ago`;
};

const searchFilter = (items: Item[], q: string) => {
  if (!q) return items;
  const t = q.toLowerCase();
  return items.filter(
    (it) =>
      (it.channel_name || "").toLowerCase().includes(t) ||
      (it.latest_video_title || "").toLowerCase().includes(t)
  );
};

// de-dupe by latest_video_id
function dedupeByVideoId(items: Item[]): Item[] {
  const seen = new Set<string>();
  const out: Item[] = [];
  for (const it of items) {
    const id = (it.latest_video_id || "").trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(it);
  }
  return out;
}

/* -------------------------------------------------------
   Small util: extract YouTube video ID from URL or raw ID
------------------------------------------------------- */
function extractYouTubeId(input: string): string {
  const s = (input || "").trim();
  if (!s) return "";
  try {
    const url = new URL(s);
    if (url.hostname.includes("youtu")) {
      const v = url.searchParams.get("v");
      if (v) return v;
      const parts = url.pathname.split("/").filter(Boolean);
      const last = parts[parts.length - 1];
      return last || "";
    }
  } catch {
    return s;
  }
  return s;
}

/* -------------------------------------------------------
   Page
------------------------------------------------------- */
type RangeKey = "daily" | "7d" | "30d";
const RANGE_LABEL: Record<RangeKey, string> = {
  daily: "Daily",
  "7d": "Weekly",
  "30d": "Monthly",
};

export default function App() {
  const [data, setData] = useState<{ generated_at_utc: string | null; items: Item[] }>({
    generated_at_utc: null,
    items: [],
  });
  const [selected, setSelected] = useState<Selected>(null);
  const [query, setQuery] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [range, setRange] = useState<RangeKey>("daily");

  const [toast, setToast] = useState<{
    title?: string;
    description?: string;
    variant?: "success" | "error" | "info";
    id?: number;
  } | null>(null);

  // For "Add any YouTube URL/ID"
  const [externalInput, setExternalInput] = useState("");
  const [playlists, setPlaylists] = useState<any[] | null>(null);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string>("");

  // AbortControllers per range to cancel in-flight fetches
  const controllersRef = useRef<Record<RangeKey, AbortController | null>>({
    daily: null,
    "7d": null,
    "30d": null,
  });

  // load playlists once (and on focus)
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/playlists", { cache: "no-store" });
        if (!res.ok) {
          setPlaylists([]);
          return;
        }
        const list = await res.json();
        setPlaylists(Array.isArray(list) ? list : []);
        if (Array.isArray(list) && list.length && !selectedPlaylistId) {
          setSelectedPlaylistId(list[0].id);
        }
      } catch {
        setPlaylists([]);
      }
    };
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [selectedPlaylistId]);

  // Normalize + guard + de-dupe
  const normalizeAndGuard = (raw: { generated_at_utc: string | null; items: Item[] }) => {
    const clean = (raw.items || []).filter((it: Item) => {
      if (!it.latest_video_id) return false;

      const durSec = parseDurationSec(it.latest_video_duration_sec as any);
      if (durSec !== null && durSec > 0 && durSec < MIN_DURATION_SEC) return false;
      if ((durSec === null || durSec <= 0) && looksLikeShortTitle(it.latest_video_title)) return false;

      const tags = Array.isArray(it.tags) ? it.tags : [];
      if (blockedByTextOrTags(it.latest_video_title || "", "", tags)) return false;

      if (isTooOld(it.latest_video_published_at)) return false;
      if (typeof it.subscribers === "number" && it.subscribers < MIN_SUBSCRIBERS) return false;

      return true;
    });

    const deduped = dedupeByVideoId(clean);
    deduped.sort((a, b) => Number(a.rank ?? 9999) - Number(b.rank ?? 9999));
    return { ...raw, items: deduped };
  };

  // Fetch helper
  const fetchData = async (): Promise<{ ok: boolean; status?: number }> => {
    try {
      const prev = controllersRef.current[range];
      if (prev) prev.abort();
      const ctrl = new AbortController();
      controllersRef.current[range] = ctrl;

      const url = range === "daily" ? `/api/top500?cb=${Date.now()}` : `/api/top500?range=${range}&cb=${Date.now()}`;

      const apiRes = await fetch(url, { cache: "no-store", signal: ctrl.signal });
      if (apiRes.ok) {
        const json = await apiRes.json();
        const normalized = normalizeAndGuard(json);
        setData(normalized);

        if (!selected && normalized.items?.length) {
          const playable = normalized.items.find((it) => it.latest_video_id);
          if (playable) {
            setSelected({
              videoId: playable.latest_video_id!,
              title: playable.latest_video_title || "",
              channel_name: playable.channel_name,
              channel_url: playable.channel_url,
            });
          }
        }

        if ((!normalized.items || !normalized.items.length) && (json?.error || range !== "daily")) {
          setToast({
            title: `${RANGE_LABEL[range]} data unavailable`,
            description:
              range === "daily"
                ? "Daily CSV/JSON missing. Ensure public/top500_ranked.csv or public/data/top500.json exists."
                : `No ${RANGE_LABEL[range]} rollup found. Ensure public/data/top500_${range}.json exists.`,
            variant: "error",
            id: Date.now(),
          });
        } else if (!normalized.items.length) {
          setToast({
            title: "No playable videos",
            description:
              "Data loaded, but entries looked like Shorts (<11 min), were too old (>1y), or were blocked (sports highlights / mixes / sensational).",
            variant: "info",
            id: Date.now(),
          });
        }

        controllersRef.current[range] = null;
        return { ok: true };
      }

      // fallback only for daily: read CSV from /public
      if (range === "daily") {
        const csvRes = await fetch(`/top500_ranked.csv?cb=${Date.now()}`, {
          cache: "no-store",
          signal: controllersRef.current[range]?.signal,
        });
        if (!csvRes.ok) return { ok: false, status: apiRes.status };

        const text = await csvRes.text();
        const rows = text.replace(/\r\n/g, "\n").split("\n").filter(Boolean);
        const header = rows[0].split(",");
        const items: Item[] = rows.slice(1).map((ln) => {
          const cols = ln.split(",");
          const get = (name: string) => cols[header.indexOf(name)] ?? "";
          return {
            rank: Number(get("rank") || 9999),
            channel_id: get("channel_id"),
            channel_url: get("channel_url"),
            channel_name: get("channel_name"),
            subscribers: get("subscribers") ? Number(get("subscribers")) : undefined,
            latest_video_id: get("latest_video_id") || "",
            latest_video_title: get("latest_video_title") || "",
            latest_video_thumbnail: get("latest_video_thumbnail") || "",
            latest_video_published_at: get("latest_video_published_at") || "",
            latest_video_duration_sec: get("latest_video_duration_sec"),
          };
        });

        const normalized = normalizeAndGuard({ items, generated_at_utc: null });
        setData(normalized);

        if (!selected && normalized.items?.length) {
          const playable = normalized.items.find((it) => it.latest_video_id);
          if (playable) {
            setSelected({
              videoId: playable.latest_video_id!,
              title: playable.latest_video_title || "",
              channel_name: playable.channel_name,
              channel_url: playable.channel_url,
            });
          }
        }

        if (!normalized.items.length) {
          setToast({
            title: "No playable videos (CSV)",
            description: "CSV loaded from /public, but items looked like Shorts/old/sports highlights/mixes.",
            variant: "info",
            id: Date.now(),
          });
        }

        controllersRef.current[range] = null;
        return { ok: true };
      }

      controllersRef.current[range] = null;
      return { ok: false, status: apiRes.status };
    } catch (e: any) {
      if (e?.name === "AbortError") return { ok: false };
      return { ok: false };
    }
  };

  // initial + range changes
  useEffect(() => {
    setData({ generated_at_utc: null, items: [] });
    setSelected(null);
    setQuery("");

    (async () => {
      const r = await fetchData();
      if (!r.ok) {
        setToast({
          title: "Couldn’t load data",
          description:
            range === "daily"
              ? "Please try again. Ensure /public/top500_ranked.csv or /public/data/top500.json exists."
              : `Please ensure public/data/top500_${range}.json exists.`,
          variant: "error",
          id: Date.now(),
        });
      }
    })();

    return () => {
      const c = controllersRef.current[range];
      if (c) c.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  // filtering
  const filtered = useMemo(() => searchFilter(data.items || [], query), [data, query]);
  const top20 = filtered.slice(0, 20);
  const rest = filtered.slice(20);

  // compute thumbnail for selected video
  const selectedThumb = useMemo(
    () =>
      data.items.find((it) => it.latest_video_id === (selected?.videoId || ""))?.latest_video_thumbnail ||
      undefined,
    [data.items, selected?.videoId]
  );

  // keyboard shortcuts
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "f") {
        setIsFullscreen((v) => !v);
        return;
      }
      if (e.key.toLowerCase() === "r" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const r = await fetchData();
        setToast({
          title: r.ok ? "Refreshed" : "Refresh failed",
          description: r.ok ? "Latest ranking + thumbnails loaded." : "Please try again in a moment.",
          variant: r.ok ? "success" : "error",
          id: Date.now(),
        });
        return;
      }

      if (!filtered.length || !selected) return;
      const idx = filtered.findIndex((it) => it.latest_video_id === selected.videoId);
      if (e.key === "ArrowRight") {
        const next = filtered[(idx + 1 + filtered.length) % filtered.length];
        setSelected({
          videoId: next.latest_video_id || "",
          title: next.latest_video_title || "",
          channel_name: next.channel_name,
          channel_url: next.channel_url,
        });
      } else if (e.key === "ArrowLeft") {
        const prev = filtered[(idx - 1 + filtered.length) % filtered.length];
        setSelected({
          videoId: prev.latest_video_id || "",
          title: prev.latest_video_title || "",
          channel_name: prev.channel_name,
          channel_url: prev.channel_url,
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, selected, fetchData]);

  const handleRefresh = async () => {
    const r = await fetchData();
    setToast({
      title: r.ok ? "Refreshed" : "Refresh failed",
      description: r.ok ? "Latest ranking + thumbnails loaded." : "Please try again in a moment.",
      variant: r.ok ? "success" : "error",
      id: Date.now(),
    });
  };

  /* -------------------------------------------------------
     Add any YouTube URL/ID under the player
  ------------------------------------------------------- */
  async function handleCreatePlaylistAndAdd(videoId: string) {
    const name = window.prompt("New playlist name");
    if (!name) return;
    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Could not create playlist");
      }
      const p = await res.json();
      setPlaylists((prev) => (Array.isArray(prev) ? [p, ...prev] : [p]));
      setSelectedPlaylistId(p.id);
      const addRes = await fetch(`/api/playlists/${p.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId }),
      });
      if (!addRes.ok) {
        const j = await addRes.json().catch(() => ({}));
        throw new Error(j.error || "Could not add to playlist");
      }
      setToast({ title: "Added", description: `Added to “${name}”`, variant: "success", id: Date.now() });
    } catch (e: any) {
      setToast({ title: "Error", description: e.message || "Action failed", variant: "error", id: Date.now() });
    }
  }

  async function handleAddExternal() {
    const raw = externalInput.trim();
    if (!raw) {
      setToast({
        title: "Enter a link or ID",
        description: "Paste a YouTube URL or video ID",
        variant: "info",
        id: Date.now(),
      });
      return;
    }
    const vid = extractYouTubeId(raw);
    if (!vid) {
      setToast({
        title: "Invalid",
        description: "Could not parse a YouTube video ID",
        variant: "error",
        id: Date.now(),
      });
      return;
    }

    if (playlists === null) {
      setToast({
        title: "Hold on",
        description: "Loading your playlists…",
        variant: "info",
        id: Date.now(),
      });
      return;
    }
    if (Array.isArray(playlists) && playlists.length === 0) {
      const goSignIn = confirm(
        "You need to sign in (or create your first playlist). Click OK to sign in."
      );
      if (goSignIn) {
        location.href = "/signin";
      }
      return;
    }

    if (!selectedPlaylistId) {
      setToast({
        title: "Select a playlist",
        description: "Choose a playlist or create a new one",
        variant: "info",
        id: Date.now(),
      });
      return;
    }

    try {
      const res = await fetch(`/api/playlists/${selectedPlaylistId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: vid }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Could not add to playlist");
      }
      setToast({ title: "Added", description: "Video added to your playlist", variant: "success", id: Date.now() });
      setExternalInput("");
    } catch (e: any) {
      setToast({ title: "Error", description: e.message || "Action failed", variant: "error", id: Date.now() });
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      {/* toasts */}
      <div className="fixed right-3 top-3 z-50">
        {toast && (
          <Toast
            title={toast.title}
            description={toast.description}
            variant={toast.variant}
            onClose={() => setToast(null)}
          />
        )}
      </div>

      <header className="sticky top-0 z-40 backdrop-blur bg-white/80 border-b border-neutral-200">
        <div className="mx-auto max-w-7xl px-3 sm:px-4 py-2 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Video className="w-6 h-6" />
            <h1 className="text-lg sm:text-xl font-semibold">KE Top 500 – Podcasts & Interviews</h1>
          </div>
        </div>

        {/* Range tabs + search + generated label */}
        <div className="mx-auto max-w-7xl px-3 sm:px-4 pb-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            {(["daily", "7d", "30d"] as RangeKey[]).map((key) => (
              <button
                key={key}
                onClick={() => setRange(key)}
                className={`px-3 py-1.5 text-sm rounded-full border ${
                  range === key
                    ? "bg-black text-white border-black"
                    : "bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50"
                }`}
              >
                {RANGE_LABEL[key]}
              </button>
            ))}
          </div>

          <div className="relative">
            <input
              className="w-full rounded-2xl border border-neutral-300 bg-white px-11 py-2 text-sm focus:ring-2 focus:ring-neutral-200"
              placeholder={`Search (${RANGE_LABEL[range]}) channels or video titles…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
          </div>

          <p className="text-xs text-neutral-500">
            View: <span className="font-medium">{RANGE_LABEL[range]}</span> · Generated:{" "}
            {data.generated_at_utc ? new Date(data.generated_at_utc).toLocaleString() : "—"}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-3 sm:px-4 py-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
        <section className="lg:col-span-8 flex flex-col gap-4">
          <Card>
            <CardContent>
              <div className="flex items-center justify-between mb-2">
                <div className="min-w-0">
                  <h2 className="text-base sm:text-lg font-semibold truncate">
                    {selected?.title || "Most recent video (Rank #1)"}
                  </h2>
                  {selected?.channel_name && (
                    <a
                      href={selected.channel_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-neutral-600 hover:underline inline-flex items-center gap-1"
                    >
                      {selected.channel_name} <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {/* Save the currently playing video, with metadata */}
                  {selected?.videoId && (
                    <SaveToPlaylist
                      videoId={selected.videoId}
                      title={selected.title}
                      thumbnail={selectedThumb}
                    />
                  )}
                  <Button onClick={() => setIsFullscreen((v) => !v)} title="Toggle fullscreen (F)">
                    {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                    <span className="hidden sm:inline">{isFullscreen ? "Exit" : "Fullscreen"}</span>
                  </Button>
                </div>
              </div>

              {/* Player */}
              <YTEmbed videoId={selected?.videoId} title={selected?.title} allowFullscreen />

              {/* Add any YouTube URL/ID to a playlist */}
              <div className="mt-3 border-t border-neutral-200 pt-3">
                <h4 className="text-sm font-semibold mb-2">Add any YouTube URL/ID to your playlist</h4>

                {playlists === null && <p className="text-xs text-neutral-500">Loading your playlists…</p>}

                {Array.isArray(playlists) && playlists.length === 0 && (
                  <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <input
                      value={externalInput}
                      onChange={(e) => setExternalInput(e.target.value)}
                      placeholder="Paste a YouTube link (or video ID)"
                      className="flex-1 rounded-xl border border-neutral-300 px-3 py-2 text-sm"
                    />
                    <a
                      href="/signin"
                      className="inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm border border-neutral-300 hover:bg-neutral-50"
                    >
                      Sign in to save
                    </a>
                  </div>
                )}

                {Array.isArray(playlists) && playlists.length > 0 && (
                  <div className="flex flex-col lg:flex-row gap-2 lg:items-center">
                    <input
                      value={externalInput}
                      onChange={(e) => setExternalInput(e.target.value)}
                      placeholder="Paste a YouTube link (or video ID)"
                      className="flex-1 rounded-xl border border-neutral-300 px-3 py-2 text-sm"
                    />
                    <select
                      value={selectedPlaylistId}
                      onChange={(e) => setSelectedPlaylistId(e.target.value)}
                      className="rounded-xl border border-neutral-300 px-3 py-2 text-sm bg-white"
                    >
                      {playlists.map((p: any) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <Button onClick={handleAddExternal}>
                      <Plus className="w-4 h-4" />
                      Add
                    </Button>
                    <Button
                      onClick={() => {
                        const vid = extractYouTubeId(externalInput.trim());
                        if (!vid) {
                          setToast({
                            title: "Enter a link or ID",
                            description: "Paste a YouTube URL or video ID",
                            variant: "info",
                            id: Date.now(),
                          });
                          return;
                        }
                        handleCreatePlaylistAndAdd(vid);
                      }}
                    >
                      + New playlist…
                    </Button>
                  </div>
                )}

                <p className="text-[11px] text-neutral-500 mt-2">
                  Tip: You can paste full YouTube links like{" "}
                  <code className="bg-neutral-100 px-1 rounded">https://www.youtube.com/watch?v=VIDEOID</code> or
                  short links like <code className="bg-neutral-100 px-1 rounded">https://youtu.be/VIDEOID</code>, or
                  just the raw <code className="bg-neutral-100 px-1 rounded">VIDEOID</code>. Videos you add here are{" "}
                  <span className="font-medium">not filtered</span> by the site’s rules.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <h3 className="font-semibold mb-2">Top 20 (click to play)</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {top20.map((it) => (
                  <button
                    key={it.latest_video_id || it.channel_id}
                    disabled={!it.latest_video_id}
                    className={`text-left group rounded-xl overflow-hidden border ${
                      selected?.videoId === it.latest_video_id ? "border-black" : "border-neutral-200"
                    } bg-white hover:shadow ${!it.latest_video_id ? "opacity-50 cursor-not-allowed" : ""}`}
                    onClick={() =>
                      it.latest_video_id &&
                      setSelected({
                        videoId: it.latest_video_id!,
                        title: it.latest_video_title || "",
                        channel_name: it.channel_name,
                        channel_url: it.channel_url,
                      })
                    }
                    title={it.latest_video_title}
                  >
                    <div className="relative aspect-video bg-neutral-200">
                      {it.latest_video_thumbnail && (
                        <img src={it.latest_video_thumbnail} alt="thumb" className="w-full h-full object-cover" />
                      )}
                      <span className="absolute left-2 top-2 inline-flex items-center text-[11px] bg-black/70 text-white px-1.5 py-0.5 rounded">
                        #{it.rank}
                      </span>
                    </div>
                    <div className="p-2">
                      <p className="text-xs font-semibold line-clamp-2 group-hover:underline">
                        {it.latest_video_title}
                      </p>
                      <p className="text-[11px] text-neutral-500 mt-1">{it.channel_name}</p>
                      <p className="text-[11px] text-neutral-400">{formatAgo(it.latest_video_published_at)}</p>

                      {/* Add to playlist (stop click from selecting the card) */}
                      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                        {it.latest_video_id && (
                          <SaveToPlaylist
                            videoId={it.latest_video_id}
                            title={it.latest_video_title}
                            thumbnail={it.latest_video_thumbnail}
                          />
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>

        <aside className="lg:col-span-4">
          <Card>
            <CardContent>
              <h3 className="font-semibold mb-2">#21–#500</h3>
              <div className="divide-y divide-neutral-200">
                {rest.map((it) => (
                  <div
                    key={it.latest_video_id || it.channel_id}
                    className={`w-full flex items-center gap-3 p-2 text-left group rounded-xl overflow-hidden border ${
                      selected?.videoId === it.latest_video_id ? "border-black" : "border-neutral-200"
                    } bg-white hover:shadow ${!it.latest_video_id ? "opacity-50" : ""}`}
                  >
                    <button
                      disabled={!it.latest_video_id}
                      className="flex items-center gap-3 flex-1 text-left"
                      onClick={() =>
                        it.latest_video_id &&
                        setSelected({
                          videoId: it.latest_video_id!,
                          title: it.latest_video_title || "",
                          channel_name: it.channel_name,
                          channel_url: it.channel_url,
                        })
                      }
                      title={it.latest_video_title}
                    >
                      <div className="relative w-28 shrink-0 aspect-video rounded overflow-hidden bg-neutral-200">
                        {it.latest_video_thumbnail && (
                          <img src={it.latest_video_thumbnail} alt="thumb" className="w-full h-full object-cover" />
                        )}
                        <span className="absolute left-1 top-1 text-[10px] bg-black/70 text-white px-1 py-0.5 rounded">
                          #{it.rank}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium line-clamp-2">{it.latest_video_title}</p>
                        <p className="text-xs text-neutral-600">{it.channel_name}</p>
                        <p className="text-[11px] text-neutral-400">{formatAgo(it.latest_video_published_at)}</p>
                      </div>
                    </button>

                    {/* Add to playlist for rest items (prevent card click) */}
                    <div onClick={(e) => e.stopPropagation()}>
                      {it.latest_video_id && (
                        <SaveToPlaylist
                          videoId={it.latest_video_id}
                          title={it.latest_video_title}
                          thumbnail={it.latest_video_thumbnail}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </aside>
      </main>

      {isFullscreen && (
        <div className="fixed inset-0 z-50 bg-black/90 p-3 sm:p-6">
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-white text-base sm:text-lg font-semibold truncate">{selected?.title}</h2>
              <Button className="bg-white" onClick={() => setIsFullscreen(false)}>
                <Minimize2 className="w-4 h-4" /> Exit
              </Button>
            </div>
            <div className="aspect-video">
              <YTEmbed videoId={selected?.videoId} title={selected?.title} allowFullscreen />
            </div>
            {/* Save inside fullscreen too */}
            <div className="mt-3">
              {selected?.videoId && (
                <SaveToPlaylist
                  videoId={selected.videoId}
                  title={selected.title}
                  thumbnail={selectedThumb}
                />
              )}
            </div>
          </div>
        </div>
      )}

      <footer className="mx-auto max-w-7xl px-3 sm:px-4 py-8 text-center text-xs text-neutral-500">
        Data updates daily at 03:15 EAT. Rankings may change as new videos drop.
      </footer>
    </div>
  );
}
