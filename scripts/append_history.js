// ESM version with filters: appends a daily snapshot of public/data/top500.json
import fs from "fs";
import { promises as fsp } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "public", "data");
const INPUT_JSON = path.join(DATA_DIR, "top500.json");
const HISTORY_PATH = path.join(DATA_DIR, "history.jsonl");

// ---- filters/heuristics (match your Python) ----
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

    // keep extras if present (may help later)
    subscribers: toInt(r.subscribers ?? r.subscriberCount),
    video_count: toInt(r.video_count ?? r.videoCount),
    country: r.country ?? "",
    classification: r.classification ?? "",

    // if your daily script outputs tags, keep them (array or string)
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
  // duration gate: if known and < 11min -> reject
  if (it.latest_video_duration_sec != null &&
      it.latest_video_duration_sec > 0 &&
      it.latest_video_duration_sec < MIN_LONGFORM_SEC) return false;

  // textual/tag bans
  if (blockedByTextOrTags(it.latest_video_title, "", it.tags)) return false;

  return Boolean(it.latest_video_id);
}

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

async function main() {
  await ensureDir(DATA_DIR);

  // Read today's list (written earlier in the workflow)
  const raw = await fsp.readFile(INPUT_JSON, "utf8");
  const json = JSON.parse(raw);
  const rawItems = Array.isArray(json.items) ? json.items : [];
  const items = rawItems.map(normalizeItem).filter(passFilters);

  if (!items.length) {
    console.log("[history] Skipping append: filtered daily has 0 items.");
    return;
  }

  const snapshot = {
    date: new Date().toISOString(),
    items,
  };

  await ensureDir(path.dirname(HISTORY_PATH));
  await fsp.appendFile(HISTORY_PATH, JSON.stringify(snapshot) + "\n", "utf8");
  console.log(`[history] Appended snapshot with ${items.length} items -> ${HISTORY_PATH}`);
}

main().catch((err) => {
  console.error("[history] ERROR:", err?.message || err);
  process.exit(1);
});
