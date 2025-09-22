import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

/** Where your CSV lives after the build step */
const CSV_PATH = process.env.TOP500_CSV_PATH || path.join(process.cwd(), "top500_ranked.csv");
/** Where your blocklist lives (one UC… ID per line, comments allowed with #) */
const BLOCKLIST_PATH = process.env.BLOCKLIST_PATH || path.join(process.cwd(), "blocked_channel_ids.txt");

/** Very small CSV parser that handles commas inside quotes reasonably well */
function parseCsv(input: string): Record<string, string>[] {
  const lines = input.replace(/\r\n/g, "\n").split("\n").filter(Boolean);
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = cols[i] ?? ""));
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Load blocklist as a Set of UC IDs */
function loadBlocklist(filePath: string): Set<string> {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return new Set(
      raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"))
    );
  } catch {
    return new Set();
  }
}

/** Heuristics to weed out unwanted channels (sports highlights, “loyalty test”, etc.) */
function isUnwanted(item: any): boolean {
  const text = [
    item.channel_name || "",
    item.latest_video_title || "",
    item.description || "",
  ]
    .join(" ")
    .toLowerCase();

  // Sports / highlights heuristics
  const sports = [
    "highlights",
    "vs ",
    " vs",
    "matchday",
    "goal ",
    " goals",
    "epl",
    "premier league",
    "laliga",
    "serie a",
    "bundesliga",
    "uefa",
    "fifa",
    "afcon",
    "caf",
    "champions league",
    "kpl",
    "harambee stars",
  ];

  // “Cheaters / loyalty test” style
  const cheaters = [
    "loyalty test",
    "catch a cheater",
    "cheater",
    "went through your phone",
    "checking phone",
    "exposed",
    "caught cheating",
  ];

  const has = (arr: string[]) => arr.some((kw) => text.includes(kw));
  return has(sports) || has(cheaters);
}

/** Convert parsed CSV rows to the JSON shape your page expects */
function csvRowToItem(row: Record<string, string>) {
  return {
    rank: Number(row.rank || row.Rank || row.index || 0),
    channel_id: row.channel_id || row.channelId || row.id || "",
    channel_name: row.channel_name || row.channelTitle || "",
    channel_url: row.channel_url || (row.channel_id ? `https://www.youtube.com/channel/${row.channel_id}` : ""),
    latest_video_id: row.latest_video_id || row.videoId || "",
    latest_video_title: row.latest_video_title || row.videoTitle || "",
    latest_video_thumbnail: row.latest_video_thumbnail || row.thumbnail || "",
    latest_video_published_at: row.latest_video_published_at || row.publishedAt || "",
    description: row.description || "",
    classification: row.classification || "",
  };
}

export const dynamic = "force-dynamic"; // don’t let Next pre-render/cache this
export const revalidate = 0;

export async function GET() {
  try {
    const csv = fs.readFileSync(CSV_PATH, "utf8");
    const rows = parseCsv(csv);
    const items = rows.map(csvRowToItem);

    const blocked = loadBlocklist(BLOCKLIST_PATH);
    const filtered = items
      .filter((x) => x.channel_id && !blocked.has(x.channel_id))
      .filter((x) => !isUnwanted(x));

    const payload = {
      generated_at_utc: new Date().toISOString(),
      items: filtered.sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999)),
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to load CSV", detail: e?.message || String(e) },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
