// app/api/top500/route.ts
import { NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";

export const dynamic = "force-dynamic";

type Item = {
  rank?: number;
  channel_id?: string;
  channel_name?: string;
  channel_url?: string;
  latest_video_id?: string;
  latest_video_title?: string;
  latest_video_thumbnail?: string;
  latest_video_published_at?: string;
};

async function fileExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function parseCsv(text: string): Item[] {
  // Simple CSV parser (comma-separated, header on first line)
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  const out: Item[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => (row[h] = (cols[idx] ?? "").trim()));

    out.push({
      rank: Number(row["rank"] ?? row["Rank"] ?? ""),
      channel_id: row["channel_id"] ?? row["Channel ID"],
      channel_name: row["channel_name"] ?? row["Channel Name"],
      channel_url:
        row["channel_url"] ??
        (row["channel_id"] ? `https://www.youtube.com/channel/${row["channel_id"]}` : undefined),
      latest_video_id: row["latest_video_id"],
      latest_video_title: row["latest_video_title"],
      latest_video_thumbnail: row["latest_video_thumbnail"],
      latest_video_published_at: row["latest_video_published_at"],
    });
  }
  return out;
}

export async function GET() {
  try {
    const pubDir = path.join(process.cwd(), "public");
    const jsonPath = path.join(pubDir, "top500_ranked.json");
    const csvPath = path.join(pubDir, "top500_ranked.csv");

    let items: Item[] = [];

    if (await fileExists(jsonPath)) {
      const raw = await fs.readFile(jsonPath, "utf8");
      const data = JSON.parse(raw);
      // Supports two common shapes:
      //  - { items: [...] }
      //  - [...] directly
      items = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [];
    } else if (await fileExists(csvPath)) {
      const raw = await fs.readFile(csvPath, "utf8");
      items = parseCsv(raw);
    } else {
      return NextResponse.json(
        { error: "No data file found in public/ (top500_ranked.json or top500_ranked.csv)" },
        { status: 404 }
      );
    }

    // Normalize + sort
    items = (items || [])
      .map((x) => ({
        rank:
          typeof x.rank === "number"
            ? x.rank
            : Number((x as any).Rank ?? (x as any).rank ?? 9999),
        channel_id: x.channel_id,
        channel_name: x.channel_name,
        channel_url:
          x.channel_url ??
          (x.channel_id ? `https://www.youtube.com/channel/${x.channel_id}` : undefined),
        latest_video_id: x.latest_video_id,
        latest_video_title: x.latest_video_title,
        latest_video_thumbnail: x.latest_video_thumbnail,
        latest_video_published_at: x.latest_video_published_at,
      }))
      .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));

    return NextResponse.json({
      generated_at_utc: new Date().toISOString(),
      items,
    });
  } catch (err) {
    console.error("[/api/top500] error:", err);
    return NextResponse.json(
      { error: "Failed to load data." },
      { status: 500 }
    );
  }
}
