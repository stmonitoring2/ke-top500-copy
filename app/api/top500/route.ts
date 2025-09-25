// app/api/top500/route.ts
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const revalidate = 0;

/* -------------------------- helpers: paths & fallbacks -------------------------- */

function fileForRange(
  range: string | null
): { type: "csv" | "json"; relPath: string } {
  if (!range) return { type: "csv", relPath: "public/top500_ranked.csv" }; // daily
  const r = range.toLowerCase();
  if (r === "7d" || r === "weekly")
    return { type: "json", relPath: "public/data/top500_7d.json" };
  if (r === "30d" || r === "monthly")
    return { type: "json", relPath: "public/data/top500_30d.json" };
  return { type: "csv", relPath: "public/top500_ranked.csv" };
}

async function exists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

/* -------------------------- CSV parsing (quoted/commas/newlines) -------------------------- */

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0,
    field = "",
    row: string[] = [];
  let inQuotes = false;

  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const len = s.length;

  const pushField = () => {
    row.push(field.trim());
    field = "";
  };
  const pushRow = () => {
    if (row.some((c) => c !== "")) rows.push(row);
    row = [];
  };

  while (i < len) {
    const ch = s[i];

    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
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
    if (ch === "\n") {
      pushField();
      pushRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length || row.length) {
    pushField();
    pushRow();
  }
  return rows;
}

function csvToObjects(csv: string): Record<string, string>[] {
  const rows = parseCsv(csv);
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cols) => {
    const o: Record<string, string> = {};
    headers.forEach((h, idx) => {
      o[h] = (cols[idx] ?? "").trim();
    });
    return o;
  });
}

type ItemNormalized = {
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

function normalizeFromRecord(r: Record<string, string>): ItemNormalized {
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
    latest_video_thumbnail: get(
      "latest_video_thumbnail",
      "thumbnail",
      "latestVideoThumbnail"
    ),
    latest_video_published_at: get(
      "latest_video_published_at",
      "video_published_at",
      "published_at",
      "latestVideoPublishedAt"
    ),
    latest_video_duration_sec: toInt(
      get("latest_video_duration_sec", "duration_sec")
    ),
    subscribers: toInt(get("subscribers", "subscriberCount")),
    video_count: toInt(get("video_count", "videoCount")),
    country: get("country"),
    classification: get("classification"),
  };
}

function normalizeFromJson(r: any): ItemNormalized {
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
    latest_video_title: get(
      "latest_video_title",
      "video_title",
      "latestVideoTitle",
      "title"
    ),
    latest_video_thumbnail: get(
      "latest_video_thumbnail",
      "thumbnail",
      "latestVideoThumbnail",
      "thumb"
    ),
    latest_video_published_at: get(
      "latest_video_published_at",
      "video_published_at",
      "published_at",
      "latestVideoPublishedAt",
      "publishedAt"
    ),
    latest_video_duration_sec: toInt(
      get("latest_video_duration_sec", "duration_sec", "durationSec")
    ),
    subscribers: toInt(get("subscribers", "subscriberCount")),
    video_count: toInt(get("video_count", "videoCount")),
    country: get("country"),
    classification: get("classification"),
  };
}

/* -------------------------- loaders -------------------------- */

async function loadDailyWithFallbacks(): Promise<{
  generated_at_utc: string | null;
  items: ItemNormalized[];
}> {
  // Try these in order:
  //   1) public/top500_ranked.csv  (new canonical)
  //   2) top500_ranked.csv         (legacy root)
  //   3) public/data/top500.json   (JSON produced by daily job)
  const candidates = [
    { type: "csv" as const, relPath: "public/top500_ranked.csv" },
    { type: "csv" as const, relPath: "top500_ranked.csv" },
    { type: "json" as const, relPath: "public/data/top500.json" },
  ];

  for (const c of candidates) {
    const abs = path.join(process.cwd(), c.relPath);
    if (!(await exists(abs))) continue;

    try {
      if (c.type === "csv") {
        const csv = await fs.readFile(abs, "utf8");
        const rows = csvToObjects(csv);
        const items = rows
          .map((r) => normalizeFromRecord(r))
          .sort((a: ItemNormalized, b: ItemNormalized) => {
            const ar = a.rank ?? 9999;
            const br = b.rank ?? 9999;
            return ar - br;
          });

        // generated_at_utc: from file mtime if not in CSV
        let generated_at_utc: string | null = null;
        try {
          const st = await fs.stat(abs);
          generated_at_utc = new Date(st.mtimeMs).toISOString();
        } catch {
          generated_at_utc = null;
        }

        if (items.length) return { generated_at_utc, items };
      } else {
        const raw = await fs.readFile(abs, "utf8");
        const json = JSON.parse(raw);
        const rawItems: any[] = Array.isArray(json.items) ? json.items : [];
        const items = rawItems
          .map((r) => normalizeFromJson(r))
          .sort((a: ItemNormalized, b: ItemNormalized) => {
            const ar = a.rank ?? 9999;
            const br = b.rank ?? 9999;
            return ar - br;
          });
        const generated_at_utc =
          typeof json.generated_at_utc === "string" ? json.generated_at_utc : null;

        if (items.length) return { generated_at_utc, items };
      }
    } catch {
      // try next candidate
    }
  }

  // nothing worked
  throw new Error(
    "No daily data found in public/top500_ranked.csv, top500_ranked.csv, or public/data/top500.json"
  );
}

async function loadRollupFromJson(relPath: string): Promise<{
  generated_at_utc: string | null;
  items: ItemNormalized[];
}> {
  const abs = path.join(process.cwd(), relPath);
  const raw = await fs.readFile(abs, "utf8");
  const json = JSON.parse(raw);
  const rawItems: any[] = Array.isArray(json.items) ? json.items : [];
  const items = rawItems
    .map((r) => normalizeFromJson(r))
    .sort((a: ItemNormalized, b: ItemNormalized) => {
      const ar = a.rank ?? 9999;
      const br = b.rank ?? 9999;
      return ar - br;
    });

  return {
    generated_at_utc:
      typeof json.generated_at_utc === "string" ? json.generated_at_utc : null,
    items,
  };
}

/* -------------------------- handler -------------------------- */

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const range = searchParams.get("range"); // null | 7d | 30d etc.
    const pick = fileForRange(range);

    const payload =
      pick.type === "csv"
        ? await loadDailyWithFallbacks()
        : await loadRollupFromJson(pick.relPath);

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
