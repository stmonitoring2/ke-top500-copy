// Build a N-day rollup JSON from public/data/history.jsonl
// Usage: node scripts/make_rollups_from_history.mjs <days> <outPath>
// Example: node scripts/make_rollups_from_history.mjs 7 public/data/top500_7d.json

import fs from "fs";
import { promises as fsp } from "fs";
import path from "path";
import process from "process";

// ----------------- config / paths -----------------
const DATA_DIR = path.join(process.cwd(), "public", "data");
const HISTORY_PATH = path.join(DATA_DIR, "history.jsonl");

// Same filters as UI / Python
const MIN_LONGFORM_SEC = 660;
const SHORTS_RE = /(^|\W)(shorts?|#shorts)(\W|$)/i;
const SPORTS_RE = /\b(highlights?|extended\s*highlights|FT|full\s*time|full\s*match|goal|matchday)\b|\b(\d+\s*-\s*\d+)\b/i;
const SENSATIONAL_RE = /(catch(ing)?|expos(e|ing)|confront(ing)?|loyalty\s*test|loyalty\s*challenge|pop\s*the\s*balloon)/i;
const MIX_RE = /\b(dj\s*mix|dj\s*set|mix\s*tape|mixtape|mixshow|party\s*mix|afrobeat\s*mix|bongo\s*mix|kenyan\s*mix|live\s*mix)\b/i;
const TAG_BLOCKS = new Set([
  "#sportshighlights", "#sports", "#highlights", "#shorts", "#short",
  "sportshighlights", "sports", "highlights", "shorts", "short",
]);

// Additional sports club/title blocks you wanted to exclude hard:
const CLUB_TITLE_BLOCKS = /\b(sportscast|manchester\s*united|arsenal|liverpool|chelsea)\b/i;

// optional performance floors (tune as you like)
const MIN_SUBS = 5000;     // ignore micro-channels
const MIN_VIEWS = 5000;    // ignore very low-view videos (if views present)

// ----------------- helpers -----------------
const toInt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const blockedByTextOrTags = (title = "", desc = "", tags = []) => {
  if (SHORTS_RE.test(title) || SHORTS_RE.test(desc)) return true;
  if (SPORTS_RE.test(title) || SPORTS_RE.test(desc)) return true;
  if (SENSATIONAL_RE.test(title) || SENSATIONAL_RE.test(desc)) return true;
  if (MIX_RE.test(title) || MIX_RE.test(desc)) return true;
  if (CLUB_TITLE_BLOCKS.test(title)) return true;
  for (const t of tags) {
    const tl = String(t || "").toLowerCase().trim();
    if (TAG_BLOCKS.has(tl)) return true;
    for (const bad of TAG_BLOCKS) if (tl.includes(bad)) return true;
  }
  return false;
};

const passFilters = (it) => {
  const dur = toInt(it.latest_video_duration_sec);
  if (dur != null && dur > 0 && dur < MIN_LONGFORM_SEC) return false;
  const tags = Array.isArray(it.tags) ? it.tags : [];
  if (blockedByTextOrTags(it.latest_video_title, "", tags)) return false;
  if (!it.latest_video_id) return false;

  // performance floors (only if the fields exist)
  const subs = toInt(it.subscribers);
  if (subs != null && subs < MIN_SUBS) return false;
  const views = toInt(it.views) ?? toInt(it.views_recent) ?? toInt(it.viewCount);
  if (views != null && views < MIN_VIEWS) return false;

  return true;
};

const normalize = (r = {}) => ({
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

  // pass through extras if present (used for floors / future scoring)
  subscribers: toInt(r.subscribers ?? r.subscriberCount),
  video_count: toInt(r.video_count ?? r.videoCount),
  views: toInt(r.views ?? r.viewCount),             // optional
  views_recent: toInt(r.views_recent),              // optional
  country: r.country ?? "",
  classification: r.classification ?? "",
  tags: Array.isArray(r.tags) ? r.tags : [],
});

// prefer newer publish date; tie-break by higher subs
const pickBetter = (a, b) => {
  const ad = Date.parse(a.latest_video_published_at || "") || 0;
  const bd = Date.parse(b.latest_video_published_at || "") || 0;
  if (ad !== bd) return ad > bd ? a : b;
  const asubs = toInt(a.subscribers) ?? 0;
  const bsubs = toInt(b.subscribers) ?? 0;
  return asubs >= bsubs ? a : b;
};

// ----------------- main -----------------
async function main() {
  const days = Number(process.argv[2] || "7");
  const outPathArg = process.argv[3];
  if (!days || !outPathArg) {
    console.error("Usage: node scripts/make_rollups_from_history.mjs <days> <outPath>");
    process.exit(2);
  }

  const outPath = path.isAbsolute(outPathArg) ? outPathArg : path.join(process.cwd(), outPathArg);

  // read history
  let lines = [];
  try {
    const raw = await fsp.readFile(HISTORY_PATH, "utf8");
    lines = raw.split(/\r?\n/).filter(Boolean);
  } catch (e) {
    console.error(`[rollup] history not found at ${HISTORY_PATH}`);
    process.exit(0); // nothing to roll up; don’t fail the workflow
  }

  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;

  // For each channel, keep the best candidate within the window
  /** @type {Map<string, any>} */
  const bestPerChannel = new Map();

  for (const line of lines) {
    let snap;
    try {
      snap = JSON.parse(line);
    } catch {
      continue;
    }
    const snapMs = Date.parse(snap?.date || "") || 0;
    if (!snapMs || snapMs < sinceMs) continue;

    const arr = Array.isArray(snap.items) ? snap.items : [];
    for (const raw of arr) {
      const it = normalize(raw);
      if (!passFilters(it)) continue;

      // within window: pick the newest/best for this channel
      const prev = bestPerChannel.get(it.channel_id);
      if (!prev) {
        bestPerChannel.set(it.channel_id, it);
      } else {
        bestPerChannel.set(it.channel_id, pickBetter(prev, it));
      }
    }
  }

  let items = Array.from(bestPerChannel.values());

  // rank: primarily by subscribers desc; tie by video_count desc; final tie by rank asc
  items.sort((a, b) => {
    const as = toInt(a.subscribers) ?? 0;
    const bs = toInt(b.subscribers) ?? 0;
    if (as !== bs) return bs - as;
    const av = toInt(a.video_count) ?? 0;
    const bv = toInt(b.video_count) ?? 0;
    if (av !== bv) return bv - av;
    const ar = toInt(a.rank) ?? 9999;
    const br = toInt(b.rank) ?? 9999;
    return ar - br;
  });

  // cap to top 500 for UI symmetry
  items = items.slice(0, 500);

  const out = {
    generated_at_utc: new Date().toISOString(),
    items,
  };

  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  await fsp.writeFile(outPath, JSON.stringify(out, null, 2), "utf8");
  console.log(`[rollup] Wrote ${items.length} items -> ${outPath}`);
}

main().catch((err) => {
  console.error("[rollup] ERROR:", err?.message || err);
  process.exit(1);
});
