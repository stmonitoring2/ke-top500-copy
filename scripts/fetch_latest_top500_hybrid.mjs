// scripts/fetch_latest_top500_hybrid.mjs
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// ---------- tunables (mirror UI/Python) ----------
const MIN_DURATION_SEC = 660;          // 11 minutes
const MAX_VIDEO_AGE_DAYS = 365;
const MIN_SUBSCRIBERS = 5000;

const SHORTS_RE = /(^|\W)(shorts?|#shorts)(\W|$)/i;
const SPORTS_RE =
  /\b(highlights?|extended\s*highlights|FT|full\s*time|full\s*match|goal|matchday)\b|\b(\d+\s*-\s*\d+)\b/i;
const CLUBS_RE = /\b(sportscast|manchester united|arsenal|liverpool|chelsea)\b/i;
const SENSATIONAL_RE =
  /(catch(ing)?|expos(e|ing)|confront(ing)?|loyalty\s*test|loyalty\s*challenge|pop\s*the\s*balloon)/i;
const MIX_RE =
  /\b(dj\s*mix|dj\s*set|mix\s*tape|mixtape|mixshow|party\s*mix|afrobeat\s*mix|bongo\s*mix|kenyan\s*mix|live\s*mix)\b/i;
const TAG_BLOCKS = new Set([
  "#sportshighlights",
  "#sports",
  "#highlights",
  "#shorts",
  "#short",
  "sportshighlights",
  "sports",
  "highlights",
  "shorts",
  "short",
]);

// ---------- helpers ----------
function parseDurationSec(text) {
  if (text == null) return null;
  if (typeof text === "number" && Number.isFinite(text)) return text;
  const s = String(text).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(s);
  if (m) {
    const h = parseInt(m[1] || "0", 10);
    const mm = parseInt(m[2] || "0", 10);
    const sec = parseInt(m[3] || "0", 10);
    return h * 3600 + mm * 60 + sec;
  }
  return null;
}

function blockedByTextOrTags(title = "", desc = "", tags = []) {
  if (SHORTS_RE.test(title) || SHORTS_RE.test(desc)) return true;
  if (SPORTS_RE.test(title) || SPORTS_RE.test(desc)) return true;
  if (CLUBS_RE.test(title) || CLUBS_RE.test(desc)) return true;
  if (SENSATIONAL_RE.test(title) || SENSATIONAL_RE.test(desc)) return true;
  if (MIX_RE.test(title) || MIX_RE.test(desc)) return true;
  for (const t of tags) {
    const tl = (t || "").toLowerCase().trim();
    if (TAG_BLOCKS.has(tl)) return true;
    for (const bad of TAG_BLOCKS) {
      if (tl.includes(bad)) return true;
    }
  }
  return false;
}

function tooOld(iso, maxDays = MAX_VIDEO_AGE_DAYS) {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000;
  return t < cutoff;
}

function csvParse(text) {
  // minimal CSV for channels.csv (no embedded commas expected)
  const lines = text.trim().split(/\r?\n/);
  const header = lines.shift().split(",");
  return lines.map((ln) => {
    const cols = ln.split(",");
    const o = {};
    header.forEach((h, i) => (o[h] = cols[i]));
    return o;
  });
}

async function fetchRssLatestVideo(channelId) {
  // YouTube RSS feed: https://www.youtube.com/feeds/videos.xml?channel_id=...
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const xml = await res.text();

  // super-light parsing (gets first <entry>)
  const entry = xml.split("<entry>")[1]?.split("</entry>")[0];
  if (!entry) return null;

  const get = (tag) => {
    const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(entry);
    return m ? m[1].trim() : "";
  };

  const idHref = /<link[^>]*href="https:\/\/www\.youtube\.com\/watch\?v=([^"&]+)"/.exec(entry)?.[1] || "";
  const title = get("title");
  const published = get("published");
  const mediaDesc = /<media:description[^>]*>([\s\S]*?)<\/media:description>/.exec(entry)?.[1] || "";
  const mediaThumb = /<media:thumbnail[^>]*url="([^"]+)"/.exec(entry)?.[1] || "";
  // duration is not present in RSS; we’ll keep null here. API fallback can fill it.
  return {
    id: idHref,
    title,
    desc: mediaDesc,
    thumb: mediaThumb,
    publishedAt: published,
    duration_sec: null,
    tags: [],
  };
}

async function fetchApiVideoDetail(videoId, apiKey) {
  if (!apiKey) return null;
  const u = new URL("https://www.googleapis.com/youtube/v3/videos");
  u.searchParams.set("id", videoId);
  u.searchParams.set("part", "snippet,contentDetails,statistics");
  u.searchParams.set("key", apiKey);

  const res = await fetch(u.toString());
  if (!res.ok) return null;
  const json = await res.json();
  const v = (json.items || [])[0];
  if (!v) return null;

  const title = v?.snippet?.title || "";
  const desc = v?.snippet?.description || "";
  const publishedAt = v?.snippet?.publishedAt || "";
  const thumb =
    v?.snippet?.thumbnails?.medium?.url ||
    v?.snippet?.thumbnails?.high?.url ||
    "";
  const tags = v?.snippet?.tags || [];
  const duration_iso = v?.contentDetails?.duration || null;
  const duration_sec = parseDurationSec(duration_iso);
  return {
    id: videoId,
    title,
    desc,
    publishedAt,
    thumb,
    duration_sec,
    tags,
  };
}

// ---------- main ----------
async function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const args = process.argv.slice(2);
  const channelsCsvPath = args[0] || path.join(__dirname, "..", "channels.csv");
  const outPath = args[1] || path.join(__dirname, "..", "public", "data", "top500.json");
  const apiKey = process.env.YT_API_KEY || "";

  const csvText = await fs.readFile(channelsCsvPath, "utf8");
  const rows = csvParse(csvText);

  const items = [];
  for (const r of rows) {
    const rank = Number(r.rank || 9999);
    const channel_id = r.channel_id;
    const channel_name = r.channel_name || "";
    const channel_url = r.channel_url || `https://www.youtube.com/channel/${channel_id}`;
    const subscribers = r.subscribers ? Number(r.subscribers) : 0;

    // quality floor on channel
    if (subscribers < MIN_SUBSCRIBERS) continue;

    // RSS first
    let vid = await fetchRssLatestVideo(channel_id);

    // If RSS missing a duration or anything looks off, try API
    if (vid && (!vid.duration_sec || vid.duration_sec < MIN_DURATION_SEC) && apiKey) {
      const apiVid = await fetchApiVideoDetail(vid.id, apiKey);
      if (apiVid) vid = { ...vid, ...apiVid };
    }

    if (!vid || !vid.id) continue;

    // apply filters (length, text/tags, age)
    const dur = vid.duration_sec;
    if (dur !== null && dur > 0 && dur < MIN_DURATION_SEC) continue;
    if (blockedByTextOrTags(vid.title || "", vid.desc || "", vid.tags || [])) continue;
    if (tooOld(vid.publishedAt)) continue;

    items.push({
      rank,
      channel_id,
      channel_name,
      channel_url,
      subscribers,
      latest_video_id: vid.id,
      latest_video_title: vid.title || "",
      latest_video_thumbnail: vid.thumb || "",
      latest_video_published_at: vid.publishedAt || "",
      latest_video_duration_sec: dur,
    });
  }

  // sort by rank just in case
  items.sort((a, b) => (Number(a.rank ?? 9999) - Number(b.rank ?? 9999)));

  const out = {
    generated_at_utc: new Date().toISOString(),
    items,
  };
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(out, null, 2), "utf8");
  console.log(`[hybrid] Wrote ${outPath} (${items.length} items)`);
}

main().catch((e) => {
  console.error("[hybrid] ERROR:", e?.message || e);
  process.exit(1);
});
