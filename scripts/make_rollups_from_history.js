// scripts/make_rollups_from_history.js
// Build 7d / 30d rollups ranked by "best growth" from public/data/history.jsonl
//
// Usage:
//   node scripts/make_rollups_from_history.js 7 public/data/top500_7d.json
//   node scripts/make_rollups_from_history.js 30 public/data/top500_30d.json

const fs = require("fs");
const path = require("path");

function nowUtcIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function parseLineSafe(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function toInt(x) {
  if (x === null || x === undefined) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function ensureDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

function unixMs(s) {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function buildRollup(windowDays, outPath) {
  const HISTORY = path.join("public", "data", "history.jsonl");
  if (!fs.existsSync(HISTORY)) {
    console.error(`[rollup] No history file at ${HISTORY}. Nothing to roll up.`);
    // create an empty rollup so UI doesn't fail
    ensureDir(outPath);
    fs.writeFileSync(outPath, JSON.stringify({ generated_at_utc: nowUtcIso(), items: [] }, null, 2));
    process.exit(0);
  }

  const cutoffMs = Date.now() - windowDays * 24 * 3600 * 1000;
  const lines = fs.readFileSync(HISTORY, "utf8").split(/\n+/).filter(Boolean);

  // group by channel -> by video_id
  /** @type {Map<string, Map<string, any[]>>} */
  const byChannelVideo = new Map();

  for (const line of lines) {
    const row = parseLineSafe(line);
    if (!row) continue;

    const t = unixMs(row.snapshot_at_utc);
    if (t === null || t < cutoffMs) continue; // keep only window

    const channelId = row.channel_id || "";
    const vid = row.latest_video_id || "";
    if (!channelId || !vid) continue;

    if (!byChannelVideo.has(channelId)) byChannelVideo.set(channelId, new Map());
    const inner = byChannelVideo.get(channelId);
    if (!inner.has(vid)) inner.set(vid, []);
    inner.get(vid).push(row);
  }

  // For each channel, compute the best growth (max delta views) among its videos in the window.
  /** @type {Array<{score: number, recent: any, channel_id: string}>} */
  const scored = [];

  for (const [channelId, videosMap] of byChannelVideo.entries()) {
    let bestScore = -1;
    let bestRecent = null;

    for (const [vid, rows] of videosMap.entries()) {
      // sort by snapshot time
      rows.sort((a, b) => {
        const ta = unixMs(a.snapshot_at_utc) ?? 0;
        const tb = unixMs(b.snapshot_at_utc) ?? 0;
        return ta - tb;
      });

      // find first & last view counts in the window
      const first = rows[0];
      const last = rows[rows.length - 1];

      const v0 = toInt(first.latest_video_view_count);
      const v1 = toInt(last.latest_video_view_count);

      let delta = null;
      if (v0 !== null && v1 !== null) {
        delta = Math.max(0, v1 - v0);
      }

      // If we have no views at all for this video, fallback to appearances count
      const fallbackAppearances = rows.length;

      const score = delta !== null ? delta : fallbackAppearances;

      if (score > bestScore) {
        bestScore = score;
        bestRecent = last; // carry most recent row for fields (title/thumb/published_at)
      }
    }

    if (bestRecent) {
      scored.push({
        score: bestScore,
        recent: bestRecent,
        channel_id: channelId,
      });
    }
  }

  // Sort by score desc, keep top 500
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 500);

  // Map to the item shape your UI/API expects
  const items = top.map((s, i) => {
    const r = s.recent;
    return {
      rank: i + 1,
      channel_id: r.channel_id || "",
      channel_name: r.channel_name || "",
      channel_url: r.channel_url || "",

      latest_video_id: r.latest_video_id || "",
      latest_video_title: r.latest_video_title || "",
      latest_video_thumbnail: r.latest_video_thumbnail || "",
      latest_video_published_at: r.latest_video_published_at || "",

      latest_video_duration_sec: toInt(r.latest_video_duration_sec),

      // optional extras
      subscribers: toInt(r.subscribers),
      video_count: toInt(r.video_count),

      // nice to keep for debugging (not used by UI)
      _score: s.score,
    };
  });

  const out = { generated_at_utc: nowUtcIso(), items };
  ensureDir(outPath);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`[rollup] Built ${items.length} items for ${windowDays}d → ${outPath}`);
}

function main() {
  const daysArg = process.argv[2];
  const outPath = process.argv[3];

  if (!daysArg || !outPath) {
    console.error("Usage: node scripts/make_rollups_from_history.js <days> <out_json_path>");
    process.exit(1);
  }

  const days = Number(daysArg);
  if (!Number.isFinite(days) || days <= 0) {
    console.error("`days` must be a positive number (e.g., 7 or 30).");
    process.exit(1);
  }

  buildRollup(days, outPath);
}

main();
