// app/api/top500/route.ts
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const revalidate = 0;

/** Small, robust CSV parser supporting quotes, commas, and newlines */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0, field = "", row: string[] = [];
  let inQuotes = false;

  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { rows.push(row); row = []; };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        // Escaped quote?
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    // Not in quotes
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      pushField();
      i++;
      continue;
    }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") {
      pushField();
      pushRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // trailing field/row
  if (field.length > 0 || row.length > 0) {
    pushField();
    pushRow();
  }
  // drop empty trailing lines
  return rows.filter(r => r.some(c => c !== ""));
}

/** Convert CSV (first row is headers) -> array of objects */
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

/** Normalize headers from various scripts to the fields the UI expects */
function normalizeItem(r: Record<string, string>) {
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const v = r[k];
      if (v != null && v !== "") return v;
    }
    return "";
  };

  return {
    rank: Number(get("rank", "Rank")) || 9999,
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
    // IMPORTANT: keep duration so the client can filter out shorts
    latest_video_duration_sec: get("latest_video_duration_sec", "duration_sec", "video_duration_sec"),
  };
}

async function readCsvFromKnownLocations(): Promise<string> {
  const primary = path.join(process.cwd(), "public", "top500_ranked.csv");
  try {
    return await fs.readFile(primary, "utf8");
  } catch {
    // fallback to legacy root location if present
    const legacy = path.join(process.cwd(), "top500_ranked.csv");
    return await fs.readFile(legacy, "utf8");
  }
}

export async function GET() {
  try {
    const csv = await readCsvFromKnownLocations();
    const rows = csvToObjects(csv);
    if (!rows.length) {
      return NextResponse.json({ error: "CSV empty", items: [] }, { status: 200 });
    }

    // If the CSV carries generated_at_utc (our Python writer does), keep the latest
    const generated_at_utc =
      rows[0]["generated_at_utc"] && rows[0]["generated_at_utc"].length
        ? rows[0]["generated_at_utc"]
        : null;

    const items = rows.map(normalizeItem).sort((a, b) => (a.rank || 9999) - (b.rank || 9999));

    return NextResponse.json(
      { generated_at_utc, items },
      { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err: any) {
    const msg =
      process.env.NODE_ENV === "development"
        ? `Failed to read/parse CSV: ${err?.message || err}`
        : "Not available";
    return NextResponse.json({ error: msg, items: [] }, { status: 500 });
  }
}
