// ESM version with filters: builds 7d/30d rollups from history.jsonl
import { promises as fsp } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "public", "data");
const HISTORY_PATH = path.join(DATA_DIR, "history.jsonl");

// ---- filters/heuristics (same as append_history) ----
const MIN_LONGFORM_SEC = 660;
const SHORTS_RE = /(^|\W)(shorts?|#shorts)(\W|$)/i;
const SPORTS_RE = /\b(highlights?|extended\s*highlights|FT|full\s*time|full\s*match|goal|matchday)\b|\b(\d+\s*-\s*\d+)\b/i;
const SENSATIONAL_RE = /(catch(ing)?|expos(e|ing)|confront(ing)?|loyalty\s*test|loyalty\s*challenge|pop\s*the\s*balloon)/i;
const MIX_RE = /\b(dj\s*mix|dj\s*set|mix\s*tape|mixtape|mixshow|party\s*mix|afrobeat\s*mix|bongo\s*mix|kenyan\s*mix|live\s*mix)\b/i;
const TAG_BLOCKS = new Set([
  "#sportshighlights", "#sports", "#highlights", "#shorts", "#short",
  "sportshighlights", "sports", "highlights", "shorts", "short",
]);

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
const median = (arr) => {
  if (!arr.length) return undefined;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const parseLineSafe = (line) => {
  try { return JSON.parse(line); } catch { return null; }
};

function normalizeItem(r = {}) {
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
    tags: Array.isArray(r.tags) ? r.tags : [],
  };
}

function blockedByTextOrTags(title = "", desc = "", tags = []) {
  if (SHORTS_RE.test(title) || SHORTS_RE.test(desc)) return true;
  if (SPORTS_RE.test(title) || SPORTS_RE.test(desc)) return true;
  if (SENSATIONAL_RE.test(title) || SENSATIONAL_RE.test(desc)) return true;
  if (MIX_RE.test(title) || MIX_RE.test(desc)) return true;
  for (const t of tags) {
    const tl = String(t).toLowerCase().trim();
    if (TAG_BLOCKS.has(tl)) return true;
    for (const bad of TAG_BLOCKS) if (tl.includes(bad)) return true;
  }
  return false;
}

function passFilters(it) {
  if (!it.latest_video_id) return false;
  if (it.latest_video_duration_sec != null &&
      it.latest_video_duration_sec > 0 &&
      it.latest_video_duration_sec < MIN_LONGFORM_SEC) return false;
  if (blockedByTextOrTags(it.latest_video_title, "", it.tags)) return false;
  return true;
}

async function main() {
  const days = Number(process.argv[2]);
  const outArg = process.argv[3];
  if (!days || !outArg) {
    console.error("Usage: node scripts/make_rollups_from_history.js <days> <out.json>");
    process.exit(2);
  }
  const outPath = path.isAbsolute(outArg) ? outArg : path.join(process.cwd(), outArg);

  let txt = "";
  try {
    txt = await fsp.readFile(HISTORY_PATH, "utf8");
  } catch (e) {
    await fsp.writeFile(outPath, JSON.stringify({ generated_at_utc: new Date().toISOString(), items: [] }, null, 2));
    console.log(`[rollup] No history file. Wrote empty ${outPath}`);
    return;
  }

  const snapshots = txt.split("\n").filter(Boolean).map(parseLineSafe)
    .filter((s) => s && Array.isArray(s.items) && s.date);

  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const windowSnaps = snapshots.filter((s) => {
    const t = Date.parse(s.date);
    return Number.isFinite(t) && t >= cutoff;
  });

  if (!windowSnaps.length) {
    await fsp.writeFile(outPath, JSON.stringify({ generated_at_utc: new Date().toISOString(), items: [] }, null, 2));
    console.log(`[rollup] No snapshots in last ${days}d. Wrote empty ${outPath}`);
    return;
  }

  // Aggregate by channel using only filtered items
  const perChannel = new Map();
  for (const snap of windowSnaps) {
    for (const raw of snap.items) {
      const it = normalizeItem(raw);
      if (!passFilters(it)) continue;

      const prev = perChannel.get(it.channel_id) || { ranks: [], latest: null, latestTime: 0 };
      if (it.rank !== undefined) prev.ranks.push(it.rank);

      const pubT = Date.parse(it.latest_video_published_at || "") || 0;
      if (pubT >= prev.latestTime) {
        prev.latest = it;
        prev.latestTime = pubT;
      }
      perChannel.set(it.channel_id, prev);
    }
  }

  const scored = [];
  for (const [cid, agg] of perChannel.entries()) {
    const m = median(agg.ranks) ?? 9999;
    const base = agg.latest || { channel_id: cid, rank: m };
    scored.push({ ...base, rank: m });
  }

  scored.sort((a, b) => (Number(a.rank ?? 9999) - Number(b.rank ?? 9999)));
  const items = scored.slice(0, 500);

  await fsp.writeFile(
    outPath,
    JSON.stringify({ generated_at_utc: new Date().toISOString(), items }, null, 2)
  );
  console.log(`[rollup] Wrote ${items.length} items -> ${outPath}`);
}

main().catch((err) => {
  console.error("[rollup] ERROR:", err?.message || err);
  process.exit(1);
});
