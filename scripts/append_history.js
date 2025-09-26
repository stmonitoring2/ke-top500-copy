// scripts/append_history.js
// Append today's snapshot into public/data/history.jsonl from public/data/top500.json
// Usage: node scripts/append_history.js

const fs = require("fs");
const path = require("path");

const TOP500_JSON = path.join("public", "data", "top500.json");
const HISTORY_JSONL = path.join("public", "data", "history.jsonl");

function toInt(x) {
  if (x === null || x === undefined) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

// Try a few field names in case your fetch script uses different keys
function pickViewCount(it) {
  return (
    toInt(it.latest_video_view_count) ??
    toInt(it.view_count) ??
    toInt(it.latestVideoViewCount) ??
    null
  );
}

function nowUtcIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function ensureDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

function main() {
  if (!fs.existsSync(TOP500_JSON)) {
    console.error(`[history] Missing ${TOP500_JSON}. Nothing to append.`);
    process.exit(0); // do not fail the job; just skip
  }

  const raw = fs.readFileSync(TOP500_JSON, "utf8");
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    console.error("[history] Invalid JSON in top500.json");
    process.exit(1);
  }

  const items = Array.isArray(json.items) ? json.items : [];
  if (!items.length) {
    console.error("[history] top500.json has no items; skipping append.");
    process.exit(0);
  }

  ensureDir(HISTORY_JSONL);
  const fd = fs.openSync(HISTORY_JSONL, "a");

  const ts = nowUtcIso();
  let appended = 0;

  for (const it of items) {
    const line = {
      // when the snapshot was taken
      snapshot_at_utc: ts,

      // identity
      channel_id: it.channel_id || it.channelId || "",
      channel_name: it.channel_name || it.channelName || "",
      channel_url: it.channel_url || it.channelUrl || "",

      // latest video identity
      latest_video_id:
        it.latest_video_id || it.video_id || it.latestVideoId || "",
      latest_video_title:
        it.latest_video_title ||
        it.video_title ||
        it.latestVideoTitle ||
        "",
      latest_video_thumbnail:
        it.latest_video_thumbnail ||
        it.thumbnail ||
        it.latestVideoThumbnail ||
        "",
      latest_video_published_at:
        it.latest_video_published_at ||
        it.video_published_at ||
        it.published_at ||
        it.latestVideoPublishedAt ||
        "",

      // optional stats for growth
      latest_video_view_count: pickViewCount(it),

      // useful extras if available
      subscribers:
        toInt(it.subscribers ?? it.subscriberCount) ?? null,
      video_count: toInt(it.video_count ?? it.videoCount) ?? null,
      latest_video_duration_sec:
        toInt(it.latest_video_duration_sec ?? it.duration_sec) ?? null,

      // whatever rank you had today (not used for growth but handy)
      rank: toInt(it.rank) ?? null,
    };

    // Only append if we have a channel and a video id (minimum useful data)
    if (line.channel_id && line.latest_video_id) {
      fs.writeSync(fd, JSON.stringify(line) + "\n");
      appended++;
    }
  }

  fs.closeSync(fd);
  console.log(`[history] Appended ${appended} snapshot rows to ${HISTORY_JSONL}`);
}

main();
