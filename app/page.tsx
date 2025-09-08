"use client";
import React, { useEffect, useMemo, useState } from "react";
import { Maximize2, Minimize2, RefreshCw, Clock, Video, ExternalLink, Search } from "lucide-react";

/** Button props = normal <button> props + optional className + children */
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

/** Card & CardContent = normal <div> props + optional className + children */
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

/** YTEmbed props */
type YTEmbedProps = {
  videoId?: string;
  title?: string;
  allowFullscreen?: boolean;
};
const YTEmbed: React.FC<YTEmbedProps> = ({ videoId, title, allowFullscreen = true }) => {
  const src = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;
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

const formatAgo = (iso?: string) => {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const s = Math.max(1, Math.floor((now - then) / 1000));
  const units: [number, string][] = [
    [60, "second"], [60, "minute"], [24, "hour"],
    [7, "day"], [4.345, "week"], [12, "month"], [Infinity, "year"],
  ];
  let i = 0, v = s;
  while (i < units.length - 1 && v >= units[i][0]) { v = Math.floor(v / units[i][0]); i++; }
  const label = units[i][1] + (v > 1 ? "s" : "");
  return `${v} ${label} ago`;
};

const searchFilter = (items: any[], q: string) => {
  if (!q) return items;
  const t = q.toLowerCase();
  return items.filter(x =>
    x.channel_name?.toLowerCase().includes(t) || (x.latest_video_title || "").toLowerCase().includes(t)
  );
};

export default function App() {
  const [data, setData] = useState<any>({ generated_at_utc: null, items: [] });
  const [selected, setSelected] = useState<any>(null);
  const [query, setQuery] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);

  const fetchData = async () => {
    const res = await fetch(`/api/top500?cb=${Date.now()}`);
    if (!res.ok) return;
    const json = await res.json();
    json.items = (json.items || []).sort((a: any, b: any) => (a.rank || 9999) - (b.rank || 9999));
    setData(json);
    if (!selected && json.items?.length) {
      const top = json.items[0];
      setSelected({
        videoId: top.latest_video_id,
        title: top.latest_video_title,
        channel_name: top.channel_name,
        channel_url: top.channel_url
      });
    }
  };

  useEffect(() => { fetchData(); /* eslint-disable-next-line */ }, []);

  const filtered = useMemo(() => searchFilter(data.items || [], query), [data, query]);
  const top20 = filtered.slice(0, 20);
  const rest = filtered.slice(20);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!filtered.length || !selected) return;
      const idx = filtered.findIndex((x: any) => x.latest_video_id === selected?.videoId);
      if (e.key === "ArrowRight") {
        const next = filtered[(idx + 1 + filtered.length) % filtered.length];
        setSelected({ videoId: next.latest_video_id, title: next.latest_video_title, channel_name: next.channel_name, channel_url: next.channel_url });
      } else if (e.key === "ArrowLeft") {
        const prev = filtered[(idx - 1 + filtered.length) % filtered.length];
        setSelected({ videoId: prev.latest_video_id, title: prev.latest_video_title, channel_name: prev.channel_name, channel_url: prev.channel_url });
      } else if (e.key.toLowerCase() === "f") {
        setIsFullscreen(v => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, selected]);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="sticky top-0 z-40 backdrop-blur bg-white/80 border-b border-neutral-200">
        <div className="mx-auto max-w-7xl px-3 sm:px-4 py-2 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Video className="w-6 h-6"/>
            <h1 className="text-lg sm:text-xl font-semibold">KE Top 500 – Podcasts & Interviews</h1>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2 text-xs text-neutral-600">
              <Clock className="w-4 h-4"/><span>Daily refresh (EAT)</span>
            </div>
            <Button onClick={fetchData} title="Refresh"><RefreshCw className="w-4 h-4"/> Refresh</Button>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-3 sm:px-4 pb-3">
          <div className="relative">
            <input
              className="w-full rounded-2xl border border-neutral-300 bg-white px-11 py-2 text-sm focus:ring-2 focus:ring-neutral-200"
              placeholder="Search channels or video titles…"
              value={query} onChange={(e)=>setQuery(e.target.value)}
            />
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"/>
          </div>
          <p className="text-xs text-neutral-500 mt-1">
            Generated: {data.generated_at_utc ? new Date(data.generated_at_utc).toLocaleString() : "—"}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-3 sm:px-4 py-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
        <section className="lg:col-span-8 flex flex-col gap-4">
          <Card>
            <CardContent>
              <div className="flex items-center justify-between mb-2">
                <div className="min-w-0">
                  <h2 className="text-base sm:text-lg font-semibold truncate">{selected?.title || "Most recent video (Rank #1)"}</h2>
                  {selected?.channel_name && (
                    <a href={selected.channel_url} target="_blank" rel="noreferrer"
                       className="text-sm text-neutral-600 hover:underline inline-flex items-center gap-1">
                      {selected.channel_name} <ExternalLink className="w-3 h-3"/>
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button onClick={()=> setIsFullscreen(v=>!v)} title="Toggle fullscreen (F)">
                    {isFullscreen ? <Minimize2 className="w-4 h-4"/> : <Maximize2 className="w-4 h-4"/>}
                    <span className="hidden sm:inline">{isFullscreen ? "Exit" : "Fullscreen"}</span>
                  </Button>
                </div>
              </div>
              <YTEmbed videoId={selected?.videoId} title={selected?.title} allowFullscreen/>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <h3 className="font-semibold mb-2">Top 20 (click to play)</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {top20.map((item: any) => (
                  <button key={item.channel_id}
                          className={`text-left group rounded-xl overflow-hidden border ${selected?.videoId===item.latest_video_id ? 'border-black' : 'border-neutral-200'} bg-white hover:shadow`}
                          onClick={()=> setSelected({
                            videoId: item.latest_video_id, title: item.latest_video_title,
                            channel_name: item.channel_name, channel_url: item.channel_url
                          })}
                          title={item.latest_video_title}>
                    <div className="relative aspect-video bg-neutral-200">
                      {item.latest_video_thumbnail && (
                        <img src={item.latest_video_thumbnail} alt="thumb" className="w-full h-full object-cover"/>
                      )}
                      <span className="absolute left-2 top-2 inline-flex items-center text-[11px] bg-black/70 text-white px-1.5 py-0.5 rounded">
                        #{item.rank}
                      </span>
                    </div>
                    <div className="p-2">
                      <p className="text-xs font-semibold line-clamp-2 group-hover:underline">{item.latest_video_title}</p>
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
                  <button key={item.channel_id}
                          className="w-full text-left py-2 flex items-start gap-2 hover:bg-neutral-50"
                          onClick={()=> setSelected({
                            videoId: item.latest_video_id, title: item.latest_video_title,
                            channel_name: item.channel_name, channel_url: item.channel_url
                          })}
                          title={item.latest_video_title}>
                    <div className="relative w-28 shrink-0 aspect-video rounded overflow-hidden bg-neutral-200">
                      {item.latest_video_thumbnail && (
                        <img src={item.latest_video_thumbnail} alt="thumb" className="w-full h-full object-cover"/>
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
              <Button className="bg-white" onClick={()=>setIsFullscreen(false)}><Minimize2 className="w-4 h-4"/> Exit</Button>
            </div>
            <div className="aspect-video">
              <YTEmbed videoId={selected?.videoId} title={selected?.title} allowFullscreen/>
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
