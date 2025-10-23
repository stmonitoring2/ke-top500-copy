// app/api/top500/route.ts
import { NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";

export const runtime = "nodejs";

function csvToItems(csv: string) {
  const rows = csv.replace(/\r\n/g, "\n").split("\n").filter(Boolean);
  if (rows.length < 2) return [];
  const header = rows[0].split(",");
  return rows.slice(1).map((ln) => {
    const cols = ln.split(",");
    const get = (name: string) => cols[header.indexOf(name)] ?? "";
    return {
      rank: Number(get("rank") || 9999),
      channel_id: get("channel_id"),
      channel_url: get("channel_url"),
      channel_name: get("channel_name"),
      subscribers: get("subscribers") ? Number(get("subscribers")) : undefined,
      latest_video_id: get("latest_video_id") || "",
      latest_video_title: get("latest_video_title") || "",
      latest_video_thumbnail: get("latest_video_thumbnail") || "",
      latest_video_published_at: get("latest_video_published_at") || "",
      latest_video_duration_sec: get("latest_video_duration_sec"),
      // convenience aliases used by your UI
      video_id: get("latest_video_id") || "",
      title: get("latest_video_title") || "",
      thumbnail: get("latest_video_thumbnail") || "",
      published_at: get("latest_video_published_at") || "",
      duration_sec: get("latest_video_duration_sec"),
    };
  });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const range = searchParams.get("range") || "daily";

  const root = process.cwd();
  const jsonPath =
    range === "daily"
      ? path.join(root, "public", "data", "top500.json")
      : path.join(root, "public", "data", `top500_${range}.json`);

  try {
    const jsonText = await fs.readFile(jsonPath, "utf8");
    const data = JSON.parse(jsonText);
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    // For daily, fall back to CSV
    if (range === "daily") {
      try {
        const csvPath = path.join(root, "public", "top500_ranked.csv");
        const csv = await fs.readFile(csvPath, "utf8");
        const items = csvToItems(csv);
        return NextResponse.json({ generated_at_utc: null, items }, { status: 200 });
      } catch {
        return NextResponse.json(
          { error: "Daily CSV/JSON missing. Ensure public/top500_ranked.csv or public/data/top500.json exists." },
          { status: 404 }
        );
      }
    }
    return NextResponse.json(
      { error: `No ${range} rollup found. Ensure public/data/top500_${range}.json exists.` },
      { status: 404 }
    );
  }
}
