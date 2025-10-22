// app/api/top500/route.ts
import { NextResponse } from "next/server";

type Item = {
  rank?: number;
  channel_id?: string;
  channel_name?: string;
  channel_url?: string;
  subscribers?: number;
  latest_video_id?: string;
  latest_video_title?: string;
  latest_video_thumbnail?: string;
  latest_video_published_at?: string;
  latest_video_duration_sec?: number | string | null;
  tags?: string[];
};

function csvToItems(text: string): Item[] {
  // simple CSV parser for the header set your page expects
  const rows = text.replace(/\r\n/g, "\n").split("\n").filter(Boolean);
  if (!rows.length) return [];
  const header = rows[0].split(",").map(s => s.trim());
  const idx = (name: string) => header.indexOf(name);

  const get = (cols: string[], name: string) => {
    const i = idx(name);
    return i >= 0 ? cols[i] ?? "" : "";
  };

  const items: Item[] = rows.slice(1).map((ln) => {
    const cols = ln.split(",");
    return {
      rank: Number(get(cols, "rank") || 9999),
      channel_id: get(cols, "channel_id"),
      channel_url: get(cols, "channel_url"),
      channel_name: get(cols, "channel_name"),
      subscribers: get(cols, "subscribers") ? Number(get(cols, "subscribers")) : undefined,
      latest_video_id: get(cols, "latest_video_id") || "",
      latest_video_title: get(cols, "latest_video_title") || "",
      latest_video_thumbnail: get(cols, "latest_video_thumbnail") || "",
      latest_video_published_at: get(cols, "latest_video_published_at") || "",
      latest_video_duration_sec: get(cols, "latest_video_duration_sec"),
    };
  });

  return items;
}

export async function GET(req: Request) {
  try {
    // figure out which file to read based on ?range=
    const { searchParams, origin } = new URL(req.url);
    const range = (searchParams.get("range") || "daily") as "daily" | "7d" | "30d";

    // 1) weekly/monthly rollups come from /public/data/top500_7d.json or /public/data/top500_30d.json
    if (range === "7d" || range === "30d") {
      const fileUrl = `${origin}/data/top500_${range}.json`;
      const res = await fetch(fileUrl, { cache: "no-store" });
      if (!res.ok) {
        return NextResponse.json(
          { error: `Missing file: public/data/top500_${range}.json` },
          { status: 404 }
        );
      }
      const json = await res.json();
      // Expected shape: { generated_at_utc: string|null, items: Item[] }
      return NextResponse.json(json, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    // 2) daily: prefer /public/data/top500.json, else fallback to /public/top500_ranked.csv
    {
      const jsonDaily = await fetch(`${origin}/data/top500.json`, { cache: "no-store" });
      if (jsonDaily.ok) {
        const json = await jsonDaily.json();
        return NextResponse.json(json, {
          headers: { "Cache-Control": "no-store" },
        });
      }

      const csvDaily = await fetch(`${origin}/top500_ranked.csv`, { cache: "no-store" });
      if (csvDaily.ok) {
        const text = await csvDaily.text();
        const items = csvToItems(text);
        return NextResponse.json(
          { generated_at_utc: null, items },
          { headers: { "Cache-Control": "no-store" } }
        );
      }

      // Neither JSON nor CSV exists → match the toast wording in the UI
      return NextResponse.json(
        { error: "Daily CSV/JSON missing. Ensure public/top500_ranked.csv or public/data/top500.json exists." },
        { status: 404 }
      );
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
