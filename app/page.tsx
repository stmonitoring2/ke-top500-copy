"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Maximize2, Minimize2, Clock, Video, ExternalLink, Search } from "lucide-react";

import { ReloadButton } from "./components/ReloadButton";
import Toast from "./components/Toast";

/* -------------------------------------------------------
   Small UI primitives (kept local to the page)
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
          frameBorder="0"
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
   Helpers
------------------------------------------------------- */
const MIN_DURATION_SEC = 660; // 11 minutes — align with builder

// Parse "seconds" that may arrive as number, "55", "0:55", "12:34", "1:02:03"
function parseDurationSec(value: unknown): number | null {
  if (value == null) return null;

  if (typeof value === "number" && Number.isFinite(value)) return value;

  const s = String(value).trim();
  if (!s) return null;

  // plain number in string
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }

  // H:MM:SS or MM:SS
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
  return /(^|\W)(shorts?|#shorts)(\W|$)/i.test(title);
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

const searchFilter = (items: any[], q: string) => {
  if (!q) return items;
  const t = q.toLowerCase();
  return items.filter(
    (x) =>
      x.channel_name?.toLowerCase().includes(t) ||
      (x.latest_video_title || "").toLowerCase().includes(t)
  );
};

// Light CSV parser (only used if you want a hard fallback; daily path should be via /api/top500)
function parseCsv(text: string): any[] {
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
      } else if (ch === "\r") {
        // ignore
      } else {
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
  const out = rows.slice(1).map((r) => {
    const o: any = {};
    header.forEach((h, idx) => {
      o[h] = r[idx];
    });
    return o;
  });
  return out;
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
  const [data, setData] = useState<any>({ generated_at_utc: null, items: [] });
  const [selected, setSelected] = useState<any>(null);
  const [query, setQuery] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [range, setRange] = useState<RangeKey>("daily");

  const [toast, setToast] = useState<{
    title?: string;
    description?: string;
    variant?: "success" | "error" | "info";
    id?: number;
  } | null>(null);

  // Normalize + guard: keep items with a videoId, reject explicit <11min; allow unknown durations unless they look like Shorts
  const normalizeAndGuard = (raw: any) => {
    const items = (raw.items || []).filter((x: any) => {
      if (!x.latest_video_id) return false;

      const durSec = parseDurationSec(x.latest_video_duration_sec);

      // Reject only if we KNOW it's shorter than threshold
      if (durSec !== null && durSec > 0 && durSec < MIN_DURATION_SEC) return false;

      // If duration unknown/0: use title heuristic for Shorts
      if ((durSec === null || durSec <= 0) && looksLikeShortTitle(x.latest_video_title)) {
        return false;
      }

      return true;
    });

    items.sort((a: any, b: any) => (a.rank || 9999) - (b.rank || 9999));
    return { ...raw, items };
  };

  // Fetch based on active range
  const fetchData = async (): Promise<{ ok: boolean; status?: number }> => {
    try {
      const q = range === "daily" ? "" : `?range=${range}&cb=${Date.now()}`;
      const cb = range === "daily" ? `?cb=${Date.now()}` : "";
      const url = `/api/top500${q || cb}`;

      const apiRes = await fetch(url, { cache: "no-store" });
      if (apiRes.ok) {
        const json = await apiRes.json();
        const normalized = normalizeAndGuard(json);
        setData(normalized);

        // Always reset selection to the first playable item after data load
        const firstPlayable = (normalized.items || []).find((x: any) => x.latest_video_id);
        setSelected(
          firstPlayable
            ? {
                videoId: firstPlayable.latest_video_id,
                title: firstPlayable.latest_video_title,
                channel_name: firstPlayable.channel_name,
                channel_url: firstPlayable.channel_url,
              }
            : null
        );

        if ((!normalized.items || !normalized.items.length) && json?.error) {
          setToast({
            title: `${RANGE_LABEL[range]} data unavailable`,
            description:
              range === "daily"
                ? "Daily CSV missing. Ensure public/top500_ranked.csv exists."
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

      // As a last-resort fallback, only for daily: try public CSV directly
      if (range === "daily") {
        const csvRes = await fetch(`/top500_ranked.csv?cb=${Date.now()}`, { cache: "no-store" });
        if (!csvRes.ok) return { ok: false, status: apiRes.status };

        const text = await csvRes.text();
        const rows = parseCsv(text);
        const items = rows.map((r: any) => ({
          rank: Number(r.rank ?? 9999),
          channel_id: r.channel_id,
          channel_url: r.channel_url,
          channel_name: r.channel_name,
          channel_description: r.channel_description,
          subscribers: Number(r.subscribers ?? 0),
          video_count: Number(r.video_count ?? 0),
          views_total: Number(r.views_total ?? 0),
          country: r.country || "KE",
          latest_video_id: r.latest_video_id || "",
          latest_video_title: r.latest_video_title || "",
          latest_video_thumbnail: r.latest_video_thumbnail || "",
          latest_video_published_at: r.latest_video_published_at || "",
          latest_video_duration_sec: r.latest_video_duration_sec,
          discovered_via: r.discovered_via || "",
        }));

        const generated_at_utc =
          rows.length && rows[0].generated_at_utc ? rows[0].generated_at_utc : null;

        const normalized = normalizeAndGuard({ items, generated_at_utc });
        setData(normalized);

        const firstPlayable = (normalized.items || []).find((x: any) => x.latest_video_id);
        setSelected(
          firstPlayable
            ? {
                videoId: firstPlayable.latest_video_id,
                title: firstPlayable.latest_video_title,
                channel_name: firstPlayable.channel_name,
                channel_url: firstPlayable.channel_url,
              }
            : null
        );

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

  // initial load + whenever range changes
  useEffect(() => {
    (async () => {
      const r = await fetchData();
      if (!r.ok) {
        setToast({
          title: "Couldn’t load data",
          description:
            range === "daily"
              ? "Please try again in a moment. Ensure /public/top500_ranked.csv exists for fallback."
              : `Please ensure public/data/top500_${range}.json exists.`,
          variant: "error",
          id: Date.now(),
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]); // refetch when range tab changes

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
          description: r.ok
            ? "Latest ranking + thumbnails loaded."
            : "Please try again in a moment.",
          variant: r.ok ? "success" : "error",
          id: Date.now(),
        });
        return;
      }

      if (!filtered.length || !selected) return;
      const idx = filtered.findIndex((x: any) => x.latest_video_id === selected?.videoId);
      if (e.key === "ArrowRight") {
        const next = filtered[(idx + 1 + filtered.length) % filtered.length];
        setSelected({
          videoId: next.latest_video_id,
          title: next.latest_video_title,
          channel_name: next.channel_name,
          channel_url: next.channel_url,
        });
      } else if (e.key === "ArrowLeft") {
        const prev = filtered[(idx - 1 + filtered.length) % filtered.length];
        setSelected({
          videoId: prev.latest_video_id,
          title: prev.latest_video_title,
          channel_name: prev.channel_name,
          channel_url: prev.channel_url,
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, selected]);

  const handleRefresh = async () => {
    const r = await fetchData();
    setToast({
      title: r.ok ? "Refreshed" : "Refresh failed",
      description: r.ok
        ? "Latest ranking + thumbnails loaded."
        : "Please try again in a moment.",
      variant: r.ok ? "success" : "error",
      id: Date.now(),
    });
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      {/* toasts (top-right) */}
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
            View: <span className="font-medium">{RANGE_LABEL[range]}</span>{" "}
            · Generated:{" "}
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
                {top20.map((item: any) => (
                  <button
                    key={item.channel_id}
                    disabled={!item.latest_video_id}
                    className={`text-left group rounded-xl overflow-hidden border ${
                      selected?.videoId === item.latest_video_id ? "border-black" : "border-neutral-200"
                    } bg-white hover:shadow ${!item.latest_video_id ? "opacity-50 cursor-not-allowed" : ""}`}
                    onClick={() =>
                      item.latest_video_id &&
                      setSelected({
                        videoId: item.latest_video_id,
                        title: item.latest_video_title,
                        channel_name: item.channel_name,
                        channel_url: item.channel_url,
                      })
                    }
                    title={item.latest_video_title}
                  >
                    <div className="relative aspect-video bg-neutral-200">
                      {item.latest_video_thumbnail && (
                        <img src={item.latest_video_thumbnail} alt="thumb" className="w-full h-full object-cover" />
                      )}
                      <span className="absolute left-2 top-2 inline-flex items-center text-[11px] bg-black/70 text-white px-1.5 py-0.5 rounded">
                        #{item.rank}
                      </span>
                    </div>
                    <div className="p-2">
                      <p className="text-xs font-semibold line-clamp-2 group-hover:underline">
                        {item.latest_video_title}
                      </p>
                      <p className="text-[11px] text-neutral-500 mt-1">{item.channel_name}</p>
                      <p className="text-[11px] text-neutral-400">{formatAgo(item.latest_video_published_at)}</p>
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
                {rest.map((item: any) => (
                  <button
                    key={item.channel_id}
                    disabled={!item.latest_video_id}
                    className={`w-full flex items-center gap-3 p-2 text-left group rounded-xl overflow-hidden border ${
                      selected?.videoId === item.latest_video_id ? "border-black" : "border-neutral-200"
                    } bg-white hover:shadow ${!item.latest_video_id ? "opacity-50 cursor-not-allowed" : ""}`}
                    onClick={() =>
                      item.latest_video_id &&
                      setSelected({
                        videoId: item.latest_video_id,
                        title: item.latest_video_title,
                        channel_name: item.channel_name,
                        channel_url: item.channel_url,
                      })
                    }
                    title={item.latest_video_title}
                  >
                    <div className="relative w-28 shrink-0 aspect-video rounded overflow-hidden bg-neutral-200">
                      {item.latest_video_thumbnail && (
                        <img src={item.latest_video_thumbnail} alt="thumb" className="w-full h-full object-cover" />
                      )}
                      <span className="absolute left-1 top-1 text-[10px] bg-black/70 text-white px-1 py-0.5 rounded">
                        #{item.rank}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium line-clamp-2">{item.latest_video_title}</p>
                      <p className="text-xs text-neutral-600">{item.channel_name}</p>
                      <p className="text-[11px] text-neutral-400">{formatAgo(item.latest_video_published_at)}</p>
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
