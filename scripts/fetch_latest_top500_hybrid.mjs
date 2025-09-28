// scripts/fetch_latest_top500_hybrid.mjs
// Build public/data/top500.json from channels.csv (or public/top500_ranked.csv) by
// scanning each channel’s RSS (newest 20), enriching with YouTube API, and choosing
// the NEWEST long-form (>=11min) that passes text/tag filters within a max-age window.
//
// Usage: node scripts/fetch_latest_top500_hybrid.mjs ./channels.csv ./public/data/top500.json

import fsp from "fs/promises";
import path from "path";

// ---- Tunables ----
const MIN_LONGFORM_SEC = 660; // 11 minutes
const MAX_RSS_ENTRIES = 20;
const MAX_AGE_DAYS = 90;      // daily should reflect "recent" episodes
const RSS_TIMEOUT_MS = 15000;
const BATCH_API = 50;

// Text filters (match UI & Python)
const SHORTS_RE = /(^|\W)(shorts?|#shorts)(\W|$)/i;
const SPORTS_RE = /\b(highlights?|extended\s*highlights|FT|full\s*time|full\s*match|goal|matchday)\b|\b(\d+\s*-\s*\d+)\b/i;
const SENSATIONAL_RE = /(catch(ing)?|expos(e|ing)|confront(ing)?|loyalty\s*test|loyalty\s*challenge|pop\s*the\s*balloon)/i;
const MIX_RE = /\b(dj\s*mix|dj\s*set|mix\s*tape|mixtape|mixshow|party\s*mix|afrobeat\s*mix|bongo\s*mix|kenyan\s*mix|live\s*mix)\b/i;
const EXTRA_SPORTS_WORDS = /\b(sportscast|manchester\s*united|arsenal|liverpool|chelsea)\b/i;

const blocked = (title = "") =>
  SHORTS_RE.test(title) ||
  SPORTS_RE.test(title) ||
  SENSATIONAL_RE.test(title) ||
  MIX_RE.test(title) ||
  EXTRA_SPORTS_WORDS.test(title);

const toInt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const daysAgo = (iso) => {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / (1000 * 60 * 60 * 24);
};

// ---- IO helpers ----
function parseCsvLine(line) {
  // Minimal CSV parser for 3 columns, supports quoted fields with commas
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

async function readCsv(filepath) {
  const text = await fsp.readFile(filepath, "utf8");
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(Boolean);
  const header = parseCsvLine(lines[0]);
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    rows.push({
      rank: toInt(cols[idx["rank"]]),
      channel_id: cols[idx["channel_id"]],
      channel_name: cols[idx["channel_name"]] ?? "",
    });
  }
  return rows;
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), RSS_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "ke-top500/1.0" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function parseYouTubeRSS(xml) {
  const entries = [];
  const mRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = mRe.exec(xml))) {
    const block = m[1];
    const id = (block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1] || "";
    const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.trim() || "";
    const published = (block.match(/<published>([^<]+)<\/published>/) || [])[1] || "";
    const thumb = (block.match(/<media:thumbnail[^>]+url="([^"]+)"/) || [])[1] || "";
    entries.push({ id, title, publishedAt: published, thumbnail: thumb });
  }
  return entries;
}

function iso8601ToSeconds(s) {
  if (!s) return undefined;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(s);
  if (!m) return undefined;
  const h = parseInt(m[1] || "0", 10);
  const mm = parseInt(m[2] || "0", 10);
  const sec = parseInt(m[3] || "0", 10);
  return h * 3600 + mm * 60 + sec;
}

async function enrichWithYouTubeAPI(items) {
  const apiKey = process.env.YT_API_KEY;
  if (!apiKey || !items.length) {
    return items.map((x) => ({ ...x, latest_video_duration_sec: undefined }));
  }

  const out = [];
  for (let i = 0; i < items.length; i += BATCH_API) {
    const batch = items.slice(i, i + BATCH_API);
    const ids = batch.map((x) => x.latest_video_id).join(",");
    const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids}&key=${apiKey}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`videos.list ${res.status}`);
      const json = await res.json();
      const byId = Object.create(null);
      for (const it of json.items || []) byId[it.id] = it;

      for (const v of batch) {
        const meta = byId[v.latest_video_id];
        const dur = iso8601ToSeconds(meta?.contentDetails?.duration || null);
        out.push({ ...v, latest_video_duration_sec: dur });
      }
    } catch (e) {
      console.error("[daily] API error:", e.message || e);
      out.push(...batch.map((v) => ({ ...v, latest_video_duration_sec: undefined })));
    }
  }
  return out;
}

async function main() {
  const [, , channelsPath, outPath] = process.argv;
  if (!channelsPath || !outPath) {
    console.error("Usage: node scripts/fetch_latest_top500_hybrid.mjs ./channels.csv ./public/data/top500.json");
    process.exit(2);
  }

  const channels = await readCsv(channelsPath);
  const candidates = [];

  // 1) pull latest 20 entries from RSS per channel
  let processed = 0;
  for (const ch of channels) {
    const cid = ch.channel_id;
    if (!cid) continue;
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${cid}`;
    let xml = "";
    try {
      xml = await fetchText(rssUrl);
    } catch (e) {
      console.error("[daily] RSS fetch failed for", cid, e.message || e);
      continue;
    }
    const entries = parseYouTubeRSS(xml).slice(0, MAX_RSS_ENTRIES);
    // prefilter obvious text blocks + age window
    const prelim = entries.filter(
      (e) => e.id && e.title && !blocked(e.title) && daysAgo(e.publishedAt) <= MAX_AGE_DAYS
    );

    for (const e of prelim) {
      candidates.push({
        channel_id: cid,
        channel_name: ch.channel_name || "",
        channel_url: `https://www.youtube.com/channel/${cid}`,
        rank: ch.rank ?? 9999,

        latest_video_id: e.id,
        latest_video_title: e.title,
        latest_video_thumbnail: e.thumbnail || "",
        latest_video_published_at: e.publishedAt,
        latest_video_duration_sec: undefined, // filled by API below
      });
    }

    processed++;
    if (processed % 50 === 0) {
      console.log(`[daily] processed RSS for ${processed} channels...`);
    }
  }

  // 2) enrich with durations
  const enriched = await enrichWithYouTubeAPI(candidates);

  // 3) choose the NEWEST acceptable per channel
  // Rule:
  //  - If duration is known and < 11m -> DROP
  //  - If duration is unknown -> allow (daily is tolerant)
  const newestByChannel = new Map();
  for (const v of enriched) {
    if (v.latest_video_duration_sec != null && v.latest_video_duration_sec < MIN_LONGFORM_SEC) continue;

    const key = v.channel_id;
    const prev = newestByChannel.get(key);
    if (!prev) {
      newestByChannel.set(key, v);
    } else {
      const newer = new Date(v.latest_video_published_at) > new Date(prev.latest_video_published_at);
      if (newer) newestByChannel.set(key, v);
    }
  }

  // 4) final list, ordered by channel rank
  const items = Array.from(newestByChannel.values()).sort(
    (a, b) => Number(a.rank ?? 9999) - Number(b.rank ?? 9999)
  );

  const payload = { generated_at_utc: new Date().toISOString(), items };
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  await fsp.writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");

  console.log(`[daily] Wrote ${items.length} items -> ${outPath}`);
}

main().catch((e) => {
  console.error("[daily] ERROR:", e?.message || e);
  process.exit(1);
});
