"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Maximize2, Minimize2, Clock, Video, ExternalLink, Search } from "lucide-react";

import { ReloadButton } from "./components/ReloadButton";
import Toast from "./components/Toast";

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
   Filters & helpers
------------------------------------------------------- */
const MIN_DURATION_SEC = 660; // 11 minutes

// Regexes mirror backend filters
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
    for (const bad of TAG_BLOCKS) {
      if (tl.includes(bad)) return true;
    }
  }
  return false;
};

// Parse "seconds" that may arrive as number, "55", "0:55", "12:34", "1:02:03"
function parseDurationSec(value: unknown): number | null {
  if (value == null) return null;

  if (typeof value === "number" && Number.isFinite(value)) return value;

  const s = String(value).trim();
  if (!s) return null;

  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }

  const hms = /^(\d+):([0-5]?\d)(?::([0-5]?\d))?$/.exec(s);
  if (hms) {
    const h = hms[3] ? parseInt(hms[1], 10) : 0;
    const m = hms[3] ? parseInt(hms[2], 10) : parseInt(hms[1], 10);
    const sec = hms[3] ? parseInt(hms[3], 10) : parseInt(hms[2], 10);
    return h * 3600 + m * 60 + sec;
  }

  return null;
}

function looksLikeShortTitle(title?: string): boolean {
  if (!title) return false;
  return SHORTS_RE.test(title);
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

// Simple CSV fallback (daily-only)
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(cur);
        cur = "";
      } else if (ch === "\n") {
        row.push(cur);
        rows.push(row);
        row = [];
        cur = "";
      } else if (ch !== "\r") {
        cur += ch;
      }
    }
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  if (!rows.length) return [];

  const header = rows[0];
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    header.forEach((h, idx) => {
      o[h] = r[idx];
    });
    return o;
  });
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

  // Normalize + guard: keep items with a videoId, reject <11min, shorts, sports, sensational, DJ mix, tag blocks
  const normalizeAndGuard = (raw: { generated_at_utc: string | null; items: Item[] }) => {
    const items = (raw.items || []).filter((it: Item) => {
      if (!it.latest_video_id) return false;

      const durSec = parseDurationSec(it.latest_video_duration_sec as any);
      if (durSec !== null && durSec > 0 && durSec < MIN_DURATION_SEC) return false;

      if ((durSec === null || durSec <= 0) && looksLikeShortTitle(it.latest_video_title)) return false;

      const tags = Array.isArray(it.tags) ? it.tags : [];
      if (blockedByTextOrTags(it.latest_video_title || "", "", tags)) return false;

      return true;
    });

    items.sort((a, b) => (Number(a.rank ?? 9999) - Number(b.rank ?? 9999)));
    return { ...raw, items };
  };

  // Fetch based on active range
  const fetchData = async (): Promise<{ ok: boolean; status?: number }> => {
    try {
      const url =
        range === "daily"
          ? `/api/top500?cb=${Date.now()}`
          : `/api/top500?range=${range}&cb=${Date.now()}`;

      const apiRes = await fetch(url, { cache: "no-store" });
      if (apiRes.ok) {
        const json = await apiRes.json();
        const normalized = normalizeAndGuard(json);
        setData(normalized);

        // pick first playable if none selected
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
              "Data loaded, but entries looked like Shorts (<11 min) or had missing video IDs.",
            variant: "info",
            id: Date.now(),
          });
        }

        return { ok: true };
      }

      // Last-resort fallback only for daily: read CSV directly from /public
      if (range === "daily") {
        const csvRes = await fetch(`/top500_ranked.csv?cb=${Date.now()}`, { cache: "no-store" });
        if (!csvRes.ok) return { ok: false, status: apiRes.status };

        const text = await csvRes.text();
        const rows = parseCsv(text);
        const items: Item[] = rows.map((r) => ({
          rank: Number(r.rank ?? 9999),
          channel_id: r.channel_id,
          channel_url: r.channel_url,
          channel_name: r.channel_name,
          latest_video_id: r.latest_video_id || "",
          latest_video_title: r.latest_video_title || "",
          latest_video_thumbnail: r.latest_video_thumbnail || "",
          latest_video_published_at: r.latest_video_published_at || "",
          latest_video_duration_sec: r.latest_video_duration_sec,
        }));

        const generated_at_utc =
          rows.length && (rows[0] as any).generated_at_utc ? (rows[0] as any).generated_at_utc : null;

        const normalized = normalizeAndGuard({ items, generated_at_utc });
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
            description:
              "CSV loaded from /public, but items looked like Shorts or had missing IDs/durations.",
            variant: "info",
            id: Date.now(),
          });
        }

        return { ok: true };
      }

      return { ok: false, status: apiRes.status };
    } catch {
      return { ok: false };
    }
  };

  // initial + range changes
  useEffect(() => {
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
      } else {
        // Reset selection to first playable when switching ranges (if none selected)
        setSelected((prev) => {
          if (prev) return prev;
          const playable = (data.items || []).find((it) => it.latest_video_id);
          return playable
            ? {
                videoId: playable.latest_video_id!,
                title: playable.latest_video_title || "",
                channel_name: playable.channel_name,
                channel_url: playable.channel_url,
              }
            : null;
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  // filtering
  const filtered = useMemo(() => searchFilter(data.items || [], query), [data, query]);
  const top20 = filtered.slice(0, 20);
  const rest = filtered.slice(20);

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
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2 text-xs text-neutral-600">
              <Clock className="w-4 h-4" />
              <span>Daily refresh (EAT)</span>
            </div>
            <ReloadButton onRefresh={handleRefresh} />
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
                  <Button onClick={() => setIsFullscreen((v) => !v)} title="Toggle fullscreen (F)">
                    {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                    <span className="hidden sm:inline">{isFullscreen ? "Exit" : "Fullscreen"}</span>
                  </Button>
                </div>
              </div>
              <YTEmbed videoId={selected?.videoId} title={selected?.title} allowFullscreen />
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <h3 className="font-semibold mb-2">Top 20 (click to play)</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {top20.map((it) => (
                  <button
                    key={it.channel_id}
                    disabled={!it.latest_video_id}
                    className={`text-left group rounded-xl overflow-hidden border ${
                      selected?.videoId === it.latest_video_id ? "border-black" : "border-neutral-200"
                    } bg-white hover:shadow ${!it.latest_video_id ? "opacity-50 cursor-not-allowed" : ""}`}
                    onClick={() =>
                      it.latest_video_id &&
                      setSelected({
                        videoId: it.latest_video_id,
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
                  <button
                    key={it.channel_id}
                    disabled={!it.latest_video_id}
                    className={`w-full flex items-center gap-3 p-2 text-left group rounded-xl overflow-hidden border ${
                      selected?.videoId === it.latest_video_id ? "border-black" : "border-neutral-200"
                    } bg-white hover:shadow ${!it.latest_video_id ? "opacity-50 cursor-not-allowed" : ""}`}
                    onClick={() =>
                      it.latest_video_id &&
                      setSelected({
                        videoId: it.latest_video_id,
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
          </div>
        </div>
      )}

      <footer className="mx-auto max-w-7xl px-3 sm:px-4 py-8 text-center text-xs text-neutral-500">
        Data updates daily at 03:15 EAT. Rankings may change as new videos drop.
      </footer>
    </div>
  );
}
