// app/api/top500/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const revalidate = 0;

type Item = {
  rank: number;
  channel_id: string;
  channel_name: string;
  channel_url: string;
  latest_video_id: string;
  latest_video_title: string;
  latest_video_thumbnail: string;
  latest_video_published_at: string;
  latest_video_duration_sec?: number;
  subscribers?: number;
  video_count?: number;
  country?: string;
  classification?: string;
};

function fileForRange(range: string | null): { type: "csv" | "json"; rel: string } {
  if (!range) return { type: "csv", rel: "/top500_ranked.csv" };        // daily
  const r = range.toLowerCase();
  if (r === "7d" || r === "weekly") return { type: "json", rel: "/data/top500_7d.json" };
  if (r === "30d" || r === "monthly") return { type: "json", rel: "/data/top500_30d.json" };
  return { type: "csv", rel: "/top500_ranked.csv" };
}

function parseCsv(text: string): string[][] {
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let field = "", row: string[] = [];
  let i = 0, q = false;
  while (i < s.length) {
    const ch = s[i];
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { q = true; i++; continue; }
    if (ch === ",") { row.push(field.trim()); field = ""; i++; continue; }
    if (ch === "\n") { row.push(field.trim()); rows.push(row); row = []; field = ""; i++; continue; }
    field += ch; i++;
  }
  if (field.length || row.length) { row.push(field.trim()); rows.push(row); }
  return rows;
}

function csvToObjects(csv: string): Record<string, string>[] {
  const rows = parseCsv(csv);
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cols) => {
    const o: Record<string, string> = {};
    headers.forEach((h, idx) => { o[h] = (cols[idx] ?? "").trim(); });
    return o;
  });
}

function normRecord(r: Record<string, string>): Item {
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const v = r[k];
      if (v != null && v !== "") return v;
    }
    return "";
  };
  const toInt = (v: string | undefined) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    rank: toInt(get("rank", "Rank")) ?? 9999,
    channel_id: get("channel_id", "channelId", "channelID"),
    channel_name: get("channel_name", "channelName"),
    channel_url: get("channel_url", "channelUrl"),
    latest_video_id: get("latest_video_id", "video_id", "latestVideoId"),
    latest_video_title: get("latest_video_title", "video_title", "latestVideoTitle"),
    latest_video_thumbnail: get("latest_video_thumbnail", "thumbnail", "latestVideoThumbnail"),
    latest_video_published_at: get(
      "latest_video_published_at",
      "video_published_at",
      "published_at",
      "latestVideoPublishedAt"
    ),
    latest_video_duration_sec: toInt(get("latest_video_duration_sec", "duration_sec")),
    subscribers: toInt(get("subscribers", "subscriberCount")),
    video_count: toInt(get("video_count", "videoCount")),
    country: get("country"),
    classification: get("classification"),
  };
}

function normJson(r: any): Item {
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const v = r?.[k];
      if (v != null && v !== "") return v;
    }
    return "";
  };
  const toInt = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    rank: toInt(get("rank", "Rank")) ?? 9999,
    channel_id: get("channel_id", "channelId", "channelID"),
    channel_name: get("channel_name", "channelName"),
    channel_url: get("channel_url", "channelUrl"),
    latest_video_id: get("latest_video_id", "video_id", "latestVideoId", "videoId"),
    latest_video_title: get("latest_video_title", "video_title", "latestVideoTitle", "title"),
    latest_video_thumbnail: get("latest_video_thumbnail", "thumbnail", "latestVideoThumbnail", "thumb"),
    latest_video_published_at: get(
      "latest_video_published_at",
      "video_published_at",
      "published_at",
      "latestVideoPublishedAt",
      "publishedAt"
    ),
    latest_video_duration_sec: toInt(get("latest_video_duration_sec", "duration_sec", "durationSec")),
    subscribers: toInt(get("subscribers", "subscriberCount")),
    video_count: toInt(get("video_count", "videoCount")),
    country: get("country"),
    classification: get("classification"),
  };
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}
async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json() as Promise<T>;
}

function detectBasePath(pathname: string): string {
  // pathname will look like: /<basePath>/api/top500 or /api/top500
  const i = pathname.indexOf("/api/top500");
  if (i === -1) return "";
  const base = pathname.slice(0, i);
  return base === "/" ? "" : base;
}

async function loadDaily(origin: string, basePath: string) {
  const csvUrl = `${origin}${basePath}/top500_ranked.csv`;
  try {
    const csv = await fetchText(csvUrl);
    const rows = csvToObjects(csv);
    const items = rows.map(normRecord).sort((a: Item, b: Item) => (a.rank ?? 9999) - (b.rank ?? 9999));
    const generated_at_utc =
      (rows[0] && (rows[0]["generated_at_utc"] || rows[0]["Generated_At_UTC"])) || null;
    return { generated_at_utc, items };
  } catch (e) {
    // Fallback to JSON produced by daily job, if present
    const jsonUrl = `${origin}${basePath}/data/top500.json`;
    const json: any = await fetchJson<any>(jsonUrl);
    const raw: any[] = Array.isArray(json.items) ? json.items : [];
    const items = raw.map(normJson).sort((a: Item, b: Item) => (a.rank ?? 9999) - (b.rank ?? 9999));
    return { generated_at_utc: json.generated_at_utc ?? null, items };
  }
}

async function loadRollup(origin: string, basePath: string, rel: string) {
  const url = `${origin}${basePath}${rel}`;
  const json: any = await fetchJson<any>(url);
  const raw: any[] = Array.isArray(json.items) ? json.items : [];
  const items = raw.map(normJson).sort((a: Item, b: Item) => (a.rank ?? 9999) - (b.rank ?? 9999));
  return { generated_at_utc: json.generated_at_utc ?? null, items };
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const range = u.searchParams.get("range"); // null | 7d | 30d | weekly | monthly
    const basePath = detectBasePath(u.pathname);

    const pick = fileForRange(range);
    const payload = pick.type === "csv"
      ? await loadDaily(u.origin, basePath)
      : await loadRollup(u.origin, basePath, pick.rel);

    return NextResponse.json(payload, { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (err: any) {
    const msg = process.env.NODE_ENV === "development"
      ? `Failed to load data: ${err?.message || err}`
      : "Not available";
    return NextResponse.json({ error: msg, items: [] }, { status: 200 });
  }
}
