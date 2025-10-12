// app/api/top500/route.ts
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const revalidate = 0;

/* -------------------------------------------------------
   Env: Supabase public object base (no keys needed)
------------------------------------------------------- */
const SUPABASE_PUBLIC_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? `${process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/object/public`
  : null;

/* -------------------------------------------------------
   URL helpers (robust for Vercel / proxies)
------------------------------------------------------- */
function pickHostFromHeaders(h: Headers): { host: string; proto: string } {
  const xfHost = h.get("x-forwarded-host");
  const xfProto = h.get("x-forwarded-proto");
  const host = (xfHost || h.get("host") || "").trim();
  const proto = (xfProto || "https").trim();
  return { host, proto };
}

function absoluteUrl(req: Request, relPath: string): string {
  const hdrs = (req as any).headers as Headers | undefined;
  if (hdrs) {
    const { host, proto } = pickHostFromHeaders(hdrs);
    if (host) {
      return `${proto}://${host}${relPath.startsWith("/") ? relPath : `/${relPath}`}`;
    }
  }
  const vurl = process.env.VERCEL_URL;
  if (vurl) return `https://${vurl}${relPath.startsWith("/") ? relPath : `/${relPath}`}`;
  const u = new URL(req.url);
  return `${u.origin}${relPath.startsWith("/") ? relPath : `/${relPath}`}`;
}

/* -------------------------------------------------------
   CSV parsing + normalization
------------------------------------------------------- */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let i = 0, field = "", row: string[] = [];
  let inQuotes = false;

  const pushField = () => { row.push(field.trim()); field = ""; };
  const pushRow = () => { if (row.some((c) => c !== "")) rows.push(row); row = []; };

  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ",") { pushField(); i++; continue; }
    if (ch === "\n") { pushField(); pushRow(); i++; continue; }
    field += ch; i++;
  }
  if (field.length || row.length) { pushField(); pushRow(); }
  return rows;
}

function csvToObjects(csv: string): Record<string, string>[] {
  const rows = parseCsv(csv);
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cols) => {
    const o: Record<string, string> = {};
    headers.forEach((h, idx) => (o[h] = (cols[idx] ?? "").trim()));
    return o;
  });
}

function toInt(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeFromCsv(r: Record<string, string>) {
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const v = r[k];
      if (v != null && v !== "") return v;
    }
    return "";
  };
  return {
    rank: toInt(get("rank", "Rank")) ?? 9999,
    channel_id: get("channel_id", "channelId", "channelID"),
    channel_name: get("channel_name", "channelName"),
    channel_url: get("channel_url", "channelUrl"),

    latest_video_id: get("latest_video_id", "video_id", "latestVideoId"),
    latest_video_title: get("latest_video_title", "video_title", "latestVideoTitle"),
    latest_video_thumbnail: get("latest_video_thumbnail", "thumbnail", "latestVideoThumbnail"),
    latest_video_published_at:
      get("latest_video_published_at", "video_published_at", "published_at", "latestVideoPublishedAt"),

    latest_video_duration_sec: toInt(get("latest_video_duration_sec", "duration_sec")),

    subscribers: toInt(get("subscribers", "subscriberCount")),
    video_count: toInt(get("video_count", "videoCount")),
    country: get("country"),
    classification: get("classification"),
  };
}

function normalizeFromJson(r: any) {
  return {
    rank: toInt(r?.rank) ?? 9999,
    channel_id: r?.channel_id ?? r?.channelId ?? "",
    channel_name: r?.channel_name ?? r?.channelName ?? "",
    channel_url: r?.channel_url ?? r?.channelUrl ?? "",

    latest_video_id: r?.latest_video_id ?? r?.video_id ?? r?.latestVideoId ?? "",
    latest_video_title: r?.latest_video_title ?? r?.video_title ?? r?.latestVideoTitle ?? "",
    latest_video_thumbnail: r?.latest_video_thumbnail ?? r?.thumbnail ?? r?.latestVideoThumbnail ?? "",
    latest_video_published_at:
      r?.latest_video_published_at ?? r?.video_published_at ?? r?.published_at ?? r?.latestVideoPublishedAt ?? "",

    latest_video_duration_sec: toInt(r?.latest_video_duration_sec) ?? toInt(r?.duration_sec),

    subscribers: toInt(r?.subscribers ?? r?.subscriberCount),
    video_count: toInt(r?.video_count ?? r?.videoCount),
    country: r?.country ?? "",
    classification: r?.classification ?? "",
  };
}

function sortByRank<T extends { rank?: number }>(items: T[]) {
  items.sort((a: T, b: T) => {
    const ar = (a?.rank ?? 9999) as number;
    const br = (b?.rank ?? 9999) as number;
    return ar - br;
  });
  return items;
}

/* -------------------------------------------------------
   Fetch helpers
------------------------------------------------------- */
const noStore = { cache: "no-store" as const, headers: { "Cache-Control": "no-store, max-age=0" } };

type Payload = { generated_at_utc: string | null; items: any[] };

async function fetchJson(url: string): Promise<Payload> {
  const res = await fetch(`${url}${url.includes("?") ? "" : `?cb=${Date.now()}`}`, noStore);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  const json = await res.json();
  const rawItems: any[] = Array.isArray(json.items) ? json.items : [];
  const items = sortByRank(rawItems.map((r) => normalizeFromJson(r)));
  return { generated_at_utc: json.generated_at_utc ?? null, items };
}

/* 1) Supabase Storage public objects (preferred) */
async function loadFromSupabaseStorage(range: "daily" | "7d" | "30d"): Promise<Payload> {
  if (!SUPABASE_PUBLIC_URL) throw new Error("no_supabase_public_url");
  const path =
    range === "7d"
      ? `${SUPABASE_PUBLIC_URL}/data/top500_7d.json`
      : range === "30d"
      ? `${SUPABASE_PUBLIC_URL}/data/top500_30d.json`
      : `${SUPABASE_PUBLIC_URL}/data/top500.json`;
  return fetchJson(path);
}

/* 2) Your own /data/*.json served by Next (if present) */
async function loadRollupJsonHTTP(req: Request, rel: "/data/top500.json" | "/data/top500_7d.json" | "/data/top500_30d.json") {
  const url = absoluteUrl(req, rel);
  return fetchJson(url);
}

/* 3) CSV (HTTP) */
async function loadDailyCsvHTTP(req: Request): Promise<Payload> {
  const url = absoluteUrl(req, "/top500_ranked.csv");
  const res = await fetch(`${url}?cb=${Date.now()}`, noStore);
  if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);
  const text = await res.text();
  const items = sortByRank(csvToObjects(text).map(normalizeFromCsv));
  return { generated_at_utc: null, items };
}

/* 4) CSV (local FS) */
async function loadDailyCsvFS(): Promise<Payload> {
  const abs = path.join(process.cwd(), "public", "top500_ranked.csv");
  const text = await fs.readFile(abs, "utf8");
  const items = sortByRank(csvToObjects(text).map(normalizeFromCsv));
  return { generated_at_utc: null, items };
}

/* -------------------------------------------------------
   Handler
------------------------------------------------------- */
export async function GET(req: Request) {
  const headers = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache", Expires: "0" };

  try {
    const p = new URL(req.url).searchParams;
    const rangeRaw = (p.get("range") || "").toLowerCase();
    const range: "daily" | "7d" | "30d" =
      rangeRaw === "7d" || rangeRaw === "weekly" ? "7d" :
      rangeRaw === "30d" || rangeRaw === "monthly" ? "30d" :
      "daily";

    // Try in this order:
    // A) Supabase Storage (public)
    try {
      const payload = await loadFromSupabaseStorage(range);
      return NextResponse.json(payload, { status: 200, headers });
    } catch {
      // B) Your own /data JSON files (if you also ship them in /public)
      try {
        const rel =
          range === "7d" ? "/data/top500_7d.json" :
          range === "30d" ? "/data/top500_30d.json" :
          "/data/top500.json";
        const payload = await loadRollupJsonHTTP(req, rel);
        return NextResponse.json(payload, { status: 200, headers });
      } catch {
        // C) For daily only, try CSV HTTP and FS
        if (range === "daily") {
          try {
            const payload = await loadDailyCsvHTTP(req);
            return NextResponse.json(payload, { status: 200, headers });
          } catch {
            try {
              const payload = await loadDailyCsvFS();
              return NextResponse.json(payload, { status: 200, headers });
            } catch {
              // fall through to error response
            }
          }
        }
      }
    }

    // If all failed:
    return NextResponse.json(
      { error: `${range}_unavailable`, items: [] },
      { status: 200, headers }
    );
  } catch (err: any) {
    const msg =
      process.env.NODE_ENV === "development"
        ? `Failed to load data: ${err?.message || err}`
        : "Not available";
    return NextResponse.json({ error: msg, items: [] }, { status: 200, headers });
  }
}
