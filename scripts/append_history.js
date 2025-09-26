// ESM version: appends a daily snapshot of public/data/top500.json
import fs from "fs";
import { promises as fsp } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "public", "data");
const INPUT_JSON = path.join(DATA_DIR, "top500.json");
const HISTORY_PATH = path.join(DATA_DIR, "history.jsonl");

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

function normalizeItem(r = {}) {
  const toInt = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    rank: toInt(r.rank) ?? 9999,
    channel_id: r.channel_id ?? r.channelId ?? "",
    channel_name: r.channel_name ?? r.channelName ?? "",
    channel_url: r.channel_url ?? r.channelUrl ?? "",
    latest_video_id: r.latest_video_id ?? r.video_id ?? r.latestVideoId ?? "",
    latest_video_title: r.latest_video_title ?? r.video_title ?? r.latestVideoTitle ?? "",
    latest_video_thumbnail:
      r.latest_video_thumbnail ?? r.thumbnail ?? r.latestVideoThumbnail ?? "",
    latest_video_published_at:
      r.latest_video_published_at ??
      r.video_published_at ??
      r.published_at ??
      r.latestVideoPublishedAt ??
      "",
    latest_video_duration_sec:
      toInt(r.latest_video_duration_sec) ?? toInt(r.duration_sec),
    subscribers: toInt(r.subscribers ?? r.subscriberCount),
    video_count: toInt(r.video_count ?? r.videoCount),
    country: r.country ?? "",
    classification: r.classification ?? "",
  };
}

async function main() {
  await ensureDir(DATA_DIR);

  // Read today's list (written by daily refresher)
  const raw = await fsp.readFile(INPUT_JSON, "utf8");
  const json = JSON.parse(raw);
  const items = Array.isArray(json.items) ? json.items.map(normalizeItem) : [];

  // Minimal guard: only append if we actually have items
  if (!items.length) {
    console.log("[history] Skipping append: top500.json has 0 items.");
    return;
  }

  const snapshot = {
    date: new Date().toISOString(),
    items, // keep normalized fields the UI needs
  };

  // Append one JSON line
  const line = JSON.stringify(snapshot) + "\n";
  await ensureDir(path.dirname(HISTORY_PATH));
  await fsp.appendFile(HISTORY_PATH, line, "utf8");
  console.log(`[history] Appended snapshot with ${items.length} items -> ${HISTORY_PATH}`);
}

main().catch((err) => {
  console.error("[history] ERROR:", err?.message || err);
  process.exit(1);
});
