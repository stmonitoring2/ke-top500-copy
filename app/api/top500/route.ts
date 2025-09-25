// app/api/top500/route.ts
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const revalidate = 0;

/** -------- choose file by range ---------- */
function fileForRange(range: string | null): { type: "csv" | "json"; relPath: string } {
  if (!range) return { type: "csv", relPath: "public/top500_ranked.csv" }; // daily
  const r = range.toLowerCase();
  if (r === "7d" || r === "weekly") return { type: "json", relPath: "public/data/top500_7d.json" };
  if (r === "30d" || r === "monthly") return { type: "json", relPath: "public/data/top500_30d.json" };
  return { type: "csv", relPath: "public/top500_ranked.csv" };
}

/** -------- robust CSV parsing (quotes, commas, newlines) ---------- */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0, field = "", row: string[] = [];
  let inQuotes = false;

  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const len = s.length;

  const pushField = () => { row.push(field.trim()); field = ""; };
  const pushRow = () => { if (row.some(c => c !== "")) rows.push(row); row = []; };

  while (i < len) {
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
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(cols => {
    const o: Record<string, string> = {};
    headers.forEach((h, idx) => { o[h] = (cols[idx] ?? "").trim(); });
    return o;
  });
}

function toInt(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function pick<T extends Record<string, any>>(obj: T, keys: string[]): any {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && v !== "") return v;
  }
  return "";
}

/** Normalize a CSV row object to the UI shape */
function normalizeCsvRow(r: Record<string, string>) {
  return {
    rank: toInt(pick(r, ["rank", "Rank"])) ?? 9999,
    channel_id: pick(r, ["channel_id", "channelId", "channelID"]),
    channel_name: pick(r, ["channel_name", "channelName"]),
    channel_url: pick(r, ["channel_url", "channelUrl"]),

    latest_video_id: pick(r, ["latest_video_id", "video_id", "latestVideoId"]),
    latest_video_title: pick(r, ["latest_video_title", "video_title", "latestVideoTitle"]),
    latest_video_thumbnail: pick(r, ["latest_video_thumbnail", "thumbnail", "latestVideoThumbnail"]),
    latest_video_published_at: pick(r, [
      "latest_video_published_at",
      "video_published_at",
      "published_at",
      "latestVideoPublishedAt",
    ]),

    latest_video_duration_sec: toInt(pick(r, ["latest_video_duration_sec", "duration_sec"])),

    subscribers: toInt(pick(r, ["subscribers", "subscriberCount"])),
    video_count: toInt(pick(r, ["video_count", "videoCount"])),
    country: pick(r, ["country"]),
    classification: pick(r, ["classification"]),
  };
}

/** Normalize a JSON rollup item to the UI shape */
function normalizeJsonItem(r: Record<string, any>) {
  return {
    rank: toInt(pick(r, ["rank"])) ?? 9999,

    channel_id: pick(r, ["channel_id", "channelId", "channelID", "id", "cid"]),
    channel_name: pick(r, ["channel_name", "channelName", "name"]),
    channel_url: pick(r, ["channel_url", "channelUrl", "url"]),

    latest_video_id: pick(r, ["latest_video_id", "video_id", "videoId", "id"]),
    latest_video_title: pick(r, ["latest_video_title", "video_title", "title"]),
    latest_video_thumbnail: pick(r, ["latest_video_thumbnail", "thumbnail", "thumb"]),
    latest_video_published_at: pick(r, [
      "latest_video_published_at",
      "video_published_at",
      "published_at",
      "publishedAt",
    ]),

    latest_video_duration_sec: toInt(pick(r, ["latest_video_duration_sec", "duration_sec", "durationSec"])),

    subscribers: toInt(pick(r, ["subscribers", "subscriberCount"])),
    video_count: toInt(pick(r, ["video_count", "videoCount"])),
    country: pick(r, ["country"]),
    classification: pick(r, ["classification"]),
  };
}

/** CSV -> JSON payload for "daily" */
async function loadDailyFromCsv(abs: string) {
  const csv = await fs.readFile(abs, "utf8");
  const rows = csvToObjects(csv);
  const items = rows
    .map(normalizeCsvRow)
    .sort(
      (a: { rank?: number }, b: { rank?: number }) =>
        (a.rank ?? 9999) - (b.rank ?? 9999)
    );

  // lift generated_at_utc if present; else file mtime
  let generated_at_utc: string | null = null;
  if (rows.length && rows[0]["generated_at_utc"]) {
    generated_at_utc = String(rows[0]["generated_at_utc"]);
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

/** JSON rollup loader for 7d / 30d with normalization */
async function loadRollupFromJson(abs: string) {
  const raw = await fs.readFile(abs, "utf8");
  const json = JSON.parse(raw) as { generated_at_utc?: string; items?: any[] };

  const rawItems: any[] = Array.isArray(json.items) ? json.items : [];
  const items = rawItems
    .map((r: any) => normalizeJsonItem(r))
    .sort(
      (a: { rank?: number }, b: { rank?: number }) =>
        (a.rank ?? 9999) - (b.rank ?? 9999)
    );

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

    const payload =
      type === "csv" ? await loadDailyFromCsv(abs) : await loadRollupFromJson(abs);

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
