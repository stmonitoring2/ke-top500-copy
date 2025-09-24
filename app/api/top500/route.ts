// app/api/top500/route.ts
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const revalidate = 0;

/** -------- helpers: choose file by range ---------- */
function fileForRange(range: string | null): { type: "csv" | "json"; relPath: string } {
  if (!range) return { type: "csv", relPath: "public/top500_ranked.csv" }; // DAILY (CSV)
  const r = range.toLowerCase();
  if (r === "7d" || r === "weekly") return { type: "json", relPath: "public/data/top500_7d.json" };
  if (r === "30d" || r === "monthly") return { type: "json", relPath: "public/data/top500_30d.json" };
  return { type: "csv", relPath: "public/top500_ranked.csv" };
}

/** -------- robust-enough CSV parsing (quoted fields, commas, newlines) ---------- */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n"); // normalize
  const len = s.length;

  const eof = () => i >= len;
  const peek = () => (i < len ? s[i] : "");
  const next = () => (i < len ? s[i++] : "");

  const readField = (): string => {
    let out = "";
    let c = peek();

    if (c === '"') {
      // quoted
      next(); // consume opening "
      while (!eof()) {
        c = next();
        if (c === '"') {
          // possible escaped quote
          if (peek() === '"') {
            out += '"';
            next(); // consume second "
          } else {
            // end quote
            break;
          }
        } else {
          out += c;
        }
      }
      return out;
    }

    // unquoted
    while (!eof()) {
      c = peek();
      if (c === "," || c === "\n") break;
      out += c;
      next();
    }
    return out.trim();
  };

  while (!eof()) {
    const row: string[] = [];
    // read first field in row
    row.push(readField());
    // consume fields separated by commas
    while (!eof() && peek() === ",") {
      next(); // comma
      row.push(readField());
    }
    // consume newlines between rows
    if (peek() === "\n") {
      next();
      // allow \n\ n (blank line) – we’ll just skip fully empty rows later
    }
    // avoid pushing fully empty rows (e.g. trailing newline)
    if (row.some((c) => c !== "")) rows.push(row);
  }

  return rows;
}

function csvToObjects(csv: string): Record<string, string>[] {
  const rows = parseCsv(csv);
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cols) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (cols[idx] ?? "").trim();
    });
    return obj;
  });
}

/** Map CSV row (various header names) into the shape the UI expects */
function normalizeItem(r: Record<string, string>) {
  const get = (...keys: string[]) => {
    for (const k of keys) {
      if (r[k] != null && r[k] !== "") return r[k];
    }
    return "";
  };

  // try to coerce integers; missing/invalid => undefined
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

    // optional extras (if present in CSV)
    subscribers: toInt(get("subscribers", "subscriberCount")),
    video_count: toInt(get("video_count", "videoCount")),
    country: get("country"),
    classification: get("classification"),

    // duration gate (if you included it in the CSV)
    latest_video_duration_sec: toInt(get("latest_video_duration_sec", "duration_sec")),
  };
}

/** CSV -> JSON payload for daily mode */
async function loadDailyFromCsv(abs: string) {
  const csv = await fs.readFile(abs, "utf8");
  const rows = csvToObjects(csv);
  const items = rows.map(normalizeItem).sort((a, b) => (a.rank || 9999) - (b.rank || 9999));

  // try to lift generated_at_utc if present in CSV header/rows; else use file mtime
  let generated_at_utc: string | null = null;
  const maybeHeader = rows[0] || {};
  const hdrGen = maybeHeader["generated_at_utc"] || maybeHeader["Generated_At_UTC"];
  if (hdrGen) {
    generated_at_utc = String(hdrGen);
  } else {
    try {
      const st = await fs.stat(abs);
      generated_at_utc = new Date(st.mtimeMs).toISOString();
    } catch {
      generated_at_utc = null;
    }
  }

  return { generated_at_utc, items };
}

/** JSON rollup loader (for 7d / 30d) */
async function loadRollupFromJson(abs: string) {
  const raw = await fs.readFile(abs, "utf8");
  const json = JSON.parse(raw);
  // Ensure `items` exists as array
  const items = Array.isArray(json.items) ? json.items : [];
  return {
    generated_at_utc: json.generated_at_utc ?? null,
    items,
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const range = searchParams.get("range"); // null | "7d" | "30d" | "weekly" | "monthly"

    const { type, relPath } = fileForRange(range);
    const abs = path.join(process.cwd(), relPath);

    let payload: { generated_at_utc: string | null; items: any[] };

    if (type === "csv") {
      payload = await loadDailyFromCsv(abs);
    } else {
      payload = await loadRollupFromJson(abs);
    }

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
