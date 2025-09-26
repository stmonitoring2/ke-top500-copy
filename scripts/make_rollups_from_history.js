// ESM version: builds 7d/30d rollups from history.jsonl
import { promises as fsp } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "public", "data");
const HISTORY_PATH = path.join(DATA_DIR, "history.jsonl");

function parseLineSafe(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function median(arr) {
  if (!arr.length) return undefined;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
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
  const daysArg = process.argv[2];
  const outArg = process.argv[3];
  if (!daysArg || !outArg) {
    console.error("Usage: node scripts/make_rollups_from_history.js <days> <out.json>");
    process.exit(2);
  }
  const days = Number(daysArg);
  if (!Number.isFinite(days) || days <= 0) {
    console.error("Invalid <days> argument.");
    process.exit(2);
  }
  const outPath = path.isAbsolute(outArg) ? outArg : path.join(process.cwd(), outArg);

  // Read history
  let txt = "";
  try {
    txt = await fsp.readFile(HISTORY_PATH, "utf8");
  } catch (e) {
    console.error(`[rollup] Cannot read ${HISTORY_PATH}:`, e?.message || e);
    // produce an empty rollup so the API/UI won't crash
    await fsp.writeFile(outPath, JSON.stringify({ generated_at_utc: new Date().toISOString(), items: [] }, null, 2));
    return;
  }

  const lines = txt.split("\n").filter(Boolean);
  const snapshots = lines
    .map(parseLineSafe)
    .filter((x) => x && Array.isArray(x.items) && x.date);

  if (!snapshots.length) {
    await fsp.writeFile(outPath, JSON.stringify({ generated_at_utc: new Date().toISOString(), items: [] }, null, 2));
    console.log("[rollup] No snapshots found; wrote empty rollup.");
    return;
  }

  const cutoff = Date.now() - days * 24 * 3600 * 1000;

  // Keep snapshots within the window
  const windowSnaps = snapshots.filter((s) => {
    const t = Date.parse(s.date);
    return Number.isFinite(t) && t >= cutoff;
  });

  if (!windowSnaps.length) {
    await fsp.writeFile(outPath, JSON.stringify({ generated_at_utc: new Date().toISOString(), items: [] }, null, 2));
    console.log("[rollup] No snapshots within window; wrote empty rollup.");
    return;
  }

  // Aggregate by channel across the window
  // score = median rank across the window (lower is better)
  // data = from the most-recent appearance for that channel
  const perChannel = new Map();

  for (const snap of windowSnaps) {
    for (const raw of snap.items) {
      const it = normalizeItem(raw);
      if (!it.channel_id) continue;

      const prev = perChannel.get(it.channel_id) || {
        ranks: [],
        latest: null,
        latestTime: 0,
      };
      if (it.rank !== undefined) prev.ranks.push(it.rank);

      const pubT = Date.parse(it.latest_video_published_at || "") || 0;
      if (pubT >= prev.latestTime) {
        prev.latest = it;
        prev.latestTime = pubT;
      }
      perChannel.set(it.channel_id, prev);
    }
  }

  // Build ranked list
  const scored = [];
  for (const [cid, agg] of perChannel.entries()) {
    const m = median(agg.ranks) ?? 9999;
    const item = agg.latest || { channel_id: cid, rank: m };
    // Ensure rank in item reflects the score used
    const outItem = { ...item, rank: m };
    scored.push(outItem);
  }

  scored.sort((a, b) => {
    const ar = Number(a.rank ?? 9999);
    const br = Number(b.rank ?? 9999);
    return ar - br;
  });

  // Keep top 500 to mirror daily
  const items = scored.slice(0, 500);

  const payload = {
    generated_at_utc: new Date().toISOString(),
    items,
  };

  await fsp.writeFile(outPath, JSON.stringify(payload, null, 2));
  console.log(`[rollup] Wrote ${items.length} items -> ${outPath}`);
}

main().catch((err) => {
  console.error("[rollup] ERROR:", err?.message || err);
  process.exit(1);
});
