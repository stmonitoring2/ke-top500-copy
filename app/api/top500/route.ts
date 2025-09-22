// app/api/top500/route.ts
import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

type AnyRec = Record<string, any>;
type Item = {
  rank?: number;
  channel_id?: string;
  channel_name?: string;
  channel_url?: string;
  latest_video_id?: string;
  latest_video_title?: string;
  latest_video_thumbnail?: string;
  latest_video_published_at?: string;
  classification?: string;
  // ... any other fields are passed through
  [k: string]: any;
};

const readFileIfExists = async (p: string) => {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
};

const parseMaybeJSON = (txt: string | null): AnyRec | AnyRec[] | null => {
  if (!txt) return null;
  try {
    const j = JSON.parse(txt);
    return j;
  } catch {
    return null;
  }
};

// very small CSV parser (handles commas, quoted fields, double quotes)
const parseCSV = (csv: string): AnyRec[] => {
  const lines = csv.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(Boolean);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]);
  const out: AnyRec[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const row: AnyRec = {};
    headers.forEach((h, idx) => (row[h] = cols[idx]));
    out.push(row);
  }
  return out;
};

function splitCsvLine(line: string): string[] {
  const res: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQ = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQ = true;
      } else if (ch === ",") {
        res.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
  }
  res.push(cur);
  return res.map((s) => s.trim());
}

// normalize a single row/object into our UI contract
const norm = (x: AnyRec, index: number): Item => {
  const channel_id: string | undefined =
    x.channel_id ?? x.channelId ?? x.id ?? x.channel?.id ?? undefined;

  const channel_name: string | undefined =
    x.channel_name ?? x.channelName ?? x.channel?.title ?? x.title ?? undefined;

  const latest_video_id: string | undefined =
    x.latest_video_id ??
    x.video_id ??
    x.latestVideoId ??
    x.latest_video?.id ??
    x.latestVideo?.id ??
    undefined;

  const latest_video_title: string | undefined =
    x.latest_video_title ??
    x.video_title ??
    x.latestVideoTitle ??
    x.latest_video?.title ??
    x.latestVideo?.title ??
    undefined;

  const latest_video_thumbnail: string | undefined =
    x.latest_video_thumbnail ??
    x.thumbnail_url ??
    x.thumbnail ??
    x.latestVideoThumbnail ??
    x.latest_video?.thumbnail ??
    x.latestVideo?.thumbnail ??
    undefined;

  const latest_video_published_at: string | undefined =
    x.latest_video_published_at ??
    x.published_at ??
    x.latestVideoPublishedAt ??
    x.latest_video?.published_at ??
    x.latestVideo?.published_at ??
    undefined;

  const classification: string | undefined =
    x.classification ?? x.category ?? x.type ?? undefined;

  const rank: number =
    toNumber(x.rank) ?? toNumber(x.position) ?? (index + 1);

  const channel_url: string =
    x.channel_url ??
    x.channelUrl ??
    (channel_id ? `https://www.youtube.com/channel/${channel_id}` : "");

  // pass through all original fields too (so we don’t lose anything)
  return {
    ...x,
    rank,
    channel_id,
    channel_name,
    channel_url,
    latest_video_id,
    latest_video_title,
    latest_video_thumbnail,
    latest_video_published_at,
    classification,
  };
};

const toNumber = (v: any): number | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const loadBlocked = async (): Promise<Set<string>> => {
  const p = path.join(process.cwd(), "public", "blocked_channel_ids.txt");
  const txt = await readFileIfExists(p);
  if (!txt) return new Set();
  const ids = txt
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !s.startsWith("#"));
  return new Set(ids);
};

const fromEnvOrPublic = async (): Promise<{ items: AnyRec[]; generated_at_utc?: string } | null> => {
  // 1) ENV URL (JSON or CSV)
  const envUrl = process.env.TOP500_URL;
  if (envUrl) {
    try {
      const r = await fetch(envUrl, { cache: "no-store" });
      if (r.ok) {
        const ct = r.headers.get("content-type") || "";
        const body = await r.text();
        if (ct.includes("application/json") || body.trim().startsWith("{") || body.trim().startsWith("[")) {
          const j = parseMaybeJSON(body);
          if (Array.isArray(j)) return { items: j as AnyRec[] };
          if (j && Array.isArray((j as AnyRec).items)) {
            return { items: (j as AnyRec).items, generated_at_utc: (j as AnyRec).generated_at_utc };
          }
        }
        // try CSV
        const rows = parseCSV(body);
        return { items: rows };
      }
    } catch {
      // fall through to public
    }
  }

  // 2) public/top500_ranked.json
  const jsonPath = path.join(process.cwd(), "public", "top500_ranked.json");
  const jsonTxt = await readFileIfExists(jsonPath);
  if (jsonTxt) {
    const j = parseMaybeJSON(jsonTxt);
    if (Array.isArray(j)) return { items: j as AnyRec[] };
    if (j && Array.isArray((j as AnyRec).items)) {
      return { items: (j as AnyRec).items, generated_at_utc: (j as AnyRec).generated_at_utc };
    }
  }

  // 3) public/top500_ranked.csv
  const csvPath = path.join(process.cwd(), "public", "top500_ranked.csv");
  const csvTxt = await readFileIfExists(csvPath);
  if (csvTxt) {
    const rows = parseCSV(csvTxt);
    return { items: rows };
  }

  return null;
};

export async function GET() {
  try {
    const source = await fromEnvOrPublic();
    if (!source || !Array.isArray(source.items)) {
      return NextResponse.json(
        { error: "No data available" },
        { status: 503, headers: nocacheHeaders() }
      );
    }

    // normalize & sort by rank (if present)
    let items = source.items.map((x, i) => norm(x, i));
    items.sort((a, b) => (toNumber(a.rank) ?? 9999) - (toNumber(b.rank) ?? 9999));

    // optional: filter out blocked ids if file exists
    const blocked = await loadBlocked();
    if (blocked.size) {
      items = items.filter((x) => x.channel_id && !blocked.has(String(x.channel_id)));
    }

    // return only the fields the UI needs + keep any passthrough keys already included by norm()
    const payload = {
      generated_at_utc: source.generated_at_utc ?? new Date().toISOString(),
      items,
    };

    return NextResponse.json(payload, { headers: nocacheHeaders() });
  } catch (e) {
    return NextResponse.json(
      { error: "Unexpected server error" },
      { status: 500, headers: nocacheHeaders() }
    );
  }
}

const nocacheHeaders = () => ({
  "Cache-Control": "no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
});
