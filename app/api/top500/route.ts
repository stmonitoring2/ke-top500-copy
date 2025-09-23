// app/api/top500/route.ts
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
// If you prefer a bit of caching, change to a number (seconds) or remove this export.
// Keeping it fully dynamic so the Reload button always pulls fresh data from the CSV.
export const revalidate = 0;

/** Minimal CSV parser that supports quoted fields and embedded commas/newlines */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0;
  const len = text.length;

  const nextChar = () => (i < len ? text[i] : "");
  const advance = () => (i < len ? text[i++] : "");

  const readField = (): string => {
    let field = "";
    let c = nextChar();

    if (c === '"') {
      // Quoted field
      advance(); // consume opening quote
      while (i < len) {
        c = advance();
        if (c === '"') {
          // possible escaped quote
          if (nextChar() === '"') {
            field += '"';
            advance(); // consume the second quote
          } else {
            // end of quoted field
            break;
          }
        } else {
          field += c;
        }
      }
      // consume until comma or newline
      while (nextChar() && nextChar() !== "," && nextChar() !== "\n" && nextChar() !== "\r") {
        // trim stray spaces after closing quote
        advance();
      }
    } else {
      // Unquoted field
      while (i < len) {
        c = nextChar();
        if (c === "," || c === "\n" || c === "\r") break;
        field += c;
        advance();
      }
      field = field.trim();
    }
    return field;
  };

  const readRow = (): string[] => {
    const cols: string[] = [];
    while (i < len) {
      const field = readField();
      cols.push(field);
      const c = nextChar();
      if (c === ",") {
        advance(); // consume comma, continue to next field
        continue;
      }
      // end of row if newline or EOF
      while (nextChar() === "\r" || nextChar() === "\n") advance();
      break;
    }
    return cols;
  };

  // Normalize newlines to \n to simplify parsing
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  i = 0;
  const original = normalized;
  const L = original.length;

  // Rebind parser to the normalized string
  (function rebind() {
    (text as any) = original;
  })();

  while (i < L) {
    const row = readRow();
    // skip empty trailing line(s)
    if (row.length === 1 && row[0] === "" && i >= L) break;
    // avoid pushing completely empty rows
    if (row.some((c) => c !== "")) rows.push(row);
  }

  return rows;
}

/** Convert CSV (first row headers) into array of objects */
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

/** Normalize various possible header names to the UI's expected keys */
function normalizeItem(r: Record<string, string>) {
  const get = (...keys: string[]) => {
    for (const k of keys) {
      if (r[k] != null && r[k] !== "") return r[k];
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
  };
}

export async function GET() {
  try {
    // Ignore ?cb= cachebuster if present; it doesn’t affect reading from disk
    const filePath = path.join(process.cwd(), "public", "top500_ranked.csv");
    const csv = await fs.readFile(filePath, "utf8");
    const rows = csvToObjects(csv);

    const items = rows.map(normalizeItem).sort((a, b) => (a.rank || 9999) - (b.rank || 9999));

    const payload = {
      generated_at_utc: null, // set to null since CSV typically doesn't include this
      items,
    };

    return NextResponse.json(payload, {
      status: 200,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err: any) {
    const msg =
      process.env.NODE_ENV === "development"
        ? `Failed to read CSV: ${err?.message || err}`
        : "Not available";
    return NextResponse.json({ error: msg, items: [] }, { status: 500 });
  }
}
