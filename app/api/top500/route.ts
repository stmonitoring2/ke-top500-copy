// app/api/top500/route.ts
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const revalidate = 0;

/** Pick file based on ?range= */
function fileForRange(range: string | null): { kind: "csv" | "json"; relPath: string } {
  if (!range) return { kind: "csv", relPath: "public/top500_ranked.csv" }; // daily, CSV
  const r = range.toLowerCase();
  if (r === "7d" || r === "weekly") return { kind: "json", relPath: "public/data/top500_7d.json" };
  if (r === "30d" || r === "monthly") return { kind: "json", relPath: "public/data/top500_30d.json" };
  return { kind: "csv", relPath: "public/top500_ranked.csv" };
}

/** Robust-enough CSV parsing (quotes, commas, newlines) */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let i = 0, field = "", row: string[] = [];
  let inQuotes = false;

  const pushField = () => { row.push(field.trim()); field = ""; };
  const pushRow = () => { if (row.some((c) => c !== "")) rows.push(row); row = []; };

  while (i < s.length) {
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
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cols) => {
    const o: Record<string, string> = {};
    headers.forEach((h, idx) => (o[h] = (cols[idx] ?? "").trim()));
    return o;
  });
}

function normalizeFromCsv(r: Record<string, string>) {
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
    latest_video_thumbnail: get("latest_video_thumbnail", "thumbnail", "latestVideoThumbnail"),
    latest_video_published_at: get(
      "latest_video_published_at",
      "video_published_at",
      "published_at",
      "latestVideoPublishedAt"
    ),

    latest_video_duration_sec: toInt(get("latest_video_duration_sec", "duration_sec")),
    subscribers: toInt(get("subscribers", "subscriberCount")),
    video_count: toInt(get("video_count", "videoCount")),
    country: get("country"),
    classification: get("classification"),
  };
}

function normalizeFromJson(r: any) {
  const toInt = (x: any) => (Number.isFinite(Number(x)) ? Number(x) : undefined);
  return {
    rank: toInt(r.rank) ?? 9999,
    channel_id: r.channel_id ?? r.channelId ?? "",
    channel_name: r.channel_name ?? r.channelName ?? "",
    channel_url: r.channel_url ?? r.channelUrl ?? "",

    latest_video_id: r.latest_video_id ?? r.video_id ?? r.latestVideoId ?? "",
    latest_video_title: r.latest_video_title ?? r.video_title ?? r.latestVideoTitle ?? "",
    latest_video_thumbnail: r.latest_video_thumbnail ?? r.thumbnail ?? r.latestVideoThumbnail ?? "",
    latest_video_published_at:
      r.latest_video_published_at ?? r.video_published_at ?? r.published_at ?? r.latestVideoPublishedAt ?? "",

    latest_video_duration_sec:
      toInt(r.latest_video_duration_sec) ?? toInt(r.duration_sec),

    subscribers: toInt(r.subscribers ?? r.subscriberCount),
    video_count: toInt(r.video_count ?? r.videoCount),
    country: r.country ?? "",
    classification: r.classification ?? "",
  };
}

async function loadDailyCsvPreferPublic(): Promise<{ generated_at_utc: string | null; items: any[] } | null> {
  const candidates = [
    path.join(process.cwd(), "public", "top500_ranked.csv"),
    path.join(process.cwd(), "top500_ranked.csv"), // legacy root fallback
  ];
  for (const abs of candidates) {
    try {
      const csv = await fs.readFile(abs, "utf8");
      const rows = csvToObjects(csv);
      const items = rows.map(normalizeFromCsv).sort((a: any, b: any) => {
        const ar = a.rank ?? 9999;
        const br = b.rank ?? 9999;
        return ar - br;
      });
      let generated_at_utc: string | null = null;
      try {
        const st = await fs.stat(abs);
        generated_at_utc = new Date(st.mtimeMs).toISOString();
      } catch { /* ignore */ }
      return { generated_at_utc, items };
    } catch {
      // try next candidate
    }
  }
  return null;
}

async function loadRollupJson(abs: string) {
  const raw = await fs.readFile(abs, "utf8");
  const json = JSON.parse(raw);
  const rawItems = Array.isArray(json.items) ? json.items : [];
  const items = rawItems.map((r: any) => normalizeFromJson(r)).sort((a: any, b: any) => {
    const ar = a.rank ?? 9999;
    const br = b.rank ?? 9999;
    return ar - br;
  });
  return {
    generated_at_utc: json.generated_at_utc ?? null,
    items,
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const range = searchParams.get("range"); // null | "7d" | "30d"

    if (!range) {
      // DAILY: prefer CSV; if missing, fall back to JSON used by the UI anyway
      const csvPayload = await loadDailyCsvPreferPublic();
      if (csvPayload) {
        return NextResponse.json(csvPayload, {
          status: 200,
          headers: { "Cache-Control": "no-store, max-age=0" },
        });
      }
      // Final fallback to daily JSON
      try {
        const jsonAbs = path.join(process.cwd(), "public", "data", "top500.json");
        const jsonRaw = await fs.readFile(jsonAbs, "utf8");
        const json = JSON.parse(jsonRaw);
        const items = (Array.isArray(json.items) ? json.items : []).map((r: any) => normalizeFromJson(r)).sort((a: any, b: any) => {
          const ar = a.rank ?? 9999;
          const br = b.rank ?? 9999;
          return ar - br;
        });
        return NextResponse.json(
          { generated_at_utc: json.generated_at_utc ?? null, items },
          { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } }
        );
      } catch (e) {
        // If even JSON is missing, surface a gentle error with 200 so UI can show toast.
        return NextResponse.json(
          { error: "daily_csv_missing_and_no_json", items: [] },
          { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } }
        );
      }
    }

    // WEEKLY / MONTHLY (7d / 30d)
    const { relPath } = fileForRange(range);
    const abs = path.join(process.cwd(), relPath);
    const payload = await loadRollupJson(abs);
    return NextResponse.json(payload, {
      status: 200,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err: any) {
    const msg = process.env.NODE_ENV === "development"
      ? `Failed to load: ${err?.message || err}`
      : "Not available";
    return NextResponse.json({ error: msg, items: [] }, { status: 200 });
  }
}
