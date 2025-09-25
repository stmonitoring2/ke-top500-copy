// app/api/top500/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const revalidate = 0;

// ---------- helpers ----------
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
    rank: toInt(r.rank) ?? 9999,
    channel_id: r.channel_id ?? r.channelId ?? "",
    channel_name: r.channel_name ?? r.channelName ?? "",
    channel_url: r.channel_url ?? r.channelUrl ?? "",

    latest_video_id: r.latest_video_id ?? r.video_id ?? r.latestVideoId ?? "",
    latest_video_title: r.latest_video_title ?? r.video_title ?? r.latestVideoTitle ?? "",
    latest_video_thumbnail: r.latest_video_thumbnail ?? r.thumbnail ?? r.latestVideoThumbnail ?? "",
    latest_video_published_at:
      r.latest_video_published_at ?? r.video_published_at ?? r.published_at ?? r.latestVideoPublishedAt ?? "",

    latest_video_duration_sec:
      toInt(r.latest_video_duration_sec) ?? toInt(r.duration_sec),

    subscribers: toInt(r.subscribers ?? r.subscriberCount),
    video_count: toInt(r.video_count ?? r.videoCount),
    country: r.country ?? "",
    classification: r.classification ?? "",
  };
}

function sortByRank(items: any[]) {
  items.sort((a: any, b: any) => {
    const ar = (a?.rank ?? 9999) as number;
    const br = (b?.rank ?? 9999) as number;
    return ar - br;
  });
  return items;
}

async function loadDailyCsvOverHttp(req: Request) {
  const url = new URL("/top500_ranked.csv", req.url);
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);
  const text = await res.text();
  const items = sortByRank(csvToObjects(text).map(normalizeFromCsv));
  // we don’t have generated_at_utc inside CSV reliably; leave null
  return { generated_at_utc: null as string | null, items };
}

async function loadJsonOverHttp(req: Request, rel: string) {
  const url = new URL(rel, req.url);
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`JSON fetch failed: ${res.status} (${rel})`);
  const json = await res.json();
  const rawItems = Array.isArray(json.items) ? json.items : [];
  const items = sortByRank(rawItems.map((r: any) => normalizeFromJson(r)));
  return { generated_at_utc: json.generated_at_utc ?? null, items };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const range = (searchParams.get("range") || "").toLowerCase();

    if (!range || range === "daily") {
      // Try CSV via HTTP first
      try {
        const payload = await loadDailyCsvOverHttp(req);
        return NextResponse.json(payload, {
          status: 200,
          headers: { "Cache-Control": "no-store, max-age=0" },
        });
      } catch {
        // Fallback to JSON the daily job updates
        try {
          const payload = await loadJsonOverHttp(req, "/data/top500.json");
          return NextResponse.json(payload, {
            status: 200,
            headers: { "Cache-Control": "no-store, max-age=0" },
          });
        } catch {
          return NextResponse.json(
            { error: "daily_csv_missing_and_no_json", items: [] },
            { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } }
          );
        }
      }
    }

    // Weekly / Monthly
    if (range === "7d" || range === "weekly") {
      const payload = await loadJsonOverHttp(req, "/data/top500_7d.json");
      return NextResponse.json(payload, {
        status: 200,
        headers: { "Cache-Control": "no-store, max-age=0" },
      });
    }
    if (range === "30d" || range === "monthly") {
      const payload = await loadJsonOverHttp(req, "/data/top500_30d.json");
      return NextResponse.json(payload, {
        status: 200,
        headers: { "Cache-Control": "no-store, max-age=0" },
      });
    }

    // Unknown range -> default daily flow
    const payload = await loadDailyCsvOverHttp(req);
    return NextResponse.json(payload, {
      status: 200,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err: any) {
    const msg =
      process.env.NODE_ENV === "development"
        ? `Failed to load data: ${err?.message || err}`
        : "Not available";
    return NextResponse.json({ error: msg, items: [] }, { status: 200 });
  }
}
