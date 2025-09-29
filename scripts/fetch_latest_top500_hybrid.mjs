// scripts/fetch_latest_top500_hybrid.mjs
// Build public/data/top500.json from channels.csv (or public/top500_ranked.csv) by
// scanning each channel’s RSS (newest 20), enriching with YouTube API, and choosing
// the NEWEST long-form (>=11min) that passes text/tag filters within a max-age window.
//
// Fallback mode (no/low API):
//   - Set DAILY_FALLBACK_ALLOW_UNKNOWN=true to allow unknown durations
//   - Only accept items <= DAILY_FALLBACK_MAX_AGE_DAYS (default 14)
//   - Assign a conservative duration = MIN_LONGFORM_SEC so UI treats as long-form
//
// Usage: node scripts/fetch_latest_top500_hybrid.mjs ./channels.csv ./public/data/top500.json

import fs from "fs";
import fsp from "fs/promises";
import path from "path";

// ---- Tunables ----
const MIN_LONGFORM_SEC = 660;   // 11 minutes (STRICT)
const MAX_RSS_ENTRIES = 20;
const MAX_AGE_DAYS = 90;        // “recent” window for homepage (strict path)
const RSS_TIMEOUT_MS = 15000;
const BATCH_API = 50;           // videos.list batch size
const API_PAUSE_MS = 100;       // light throttle
const API_RETRIES = 1;          // retry once on API hiccups

// ---- Fallback envs ----
const FALLBACK_ALLOW = (process.env.DAILY_FALLBACK_ALLOW_UNKNOWN || "").toLowerCase() === "true";
const FALLBACK_MAX_AGE =
  Number.parseInt(process.env.DAILY_FALLBACK_MAX_AGE_DAYS || "14", 10) || 14;

// ---- Text filters (match UI & Python) ----
const SHORTS_RE = /(^|\W)(shorts?|#shorts)(\W|$)/i;
const SPORTS_RE =
  /\b(highlights?|extended\s*highlights|FT|full\s*time|full\s*match|goal|matchday)\b|\b(\d+\s*-\s*\d+)\b/i;
const SENSATIONAL_RE =
  /(catch(ing)?|expos(e|ing)|confront(ing)?|loyalty\s*test|loyalty\s*challenge|pop\s*the\s*balloon)/i;
const MIX_RE =
  /\b(dj\s*mix|dj\s*set|mix\s*tape|mixtape|mixshow|party\s*mix|afrobeat\s*mix|bongo\s*mix|kenyan\s*mix|live\s*mix)\b/i;
const EXTRA_SPORTS_WORDS = /\b(sportscast|manchester\s*united|arsenal|liverpool|chelsea)\b/i;

const looksBlocked = (title = "") =>
  SHORTS_RE.test(title) ||
  SPORTS_RE.test(title) ||
  SENSATIONAL_RE.test(title) ||
  MIX_RE.test(title) ||
  EXTRA_SPORTS_WORDS.test(title);

// ---- Utils ----
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Robust CSV parsing (handles quotes & commas) ----
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQ) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQ = true;
      } else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}

async function readCsv(filepath) {
  const text = await fsp.readFile(filepath, "utf8");
  const nl = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = nl.split("\n").filter((l) => l.length > 0);

  if (!lines.length) return [];

  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const get = (name) => {
      const j = idx[name];
      return j == null ? "" : cols[j] ?? "";
    };
    rows.push({
      rank: toInt(get("rank")),
      channel_id: get("channel_id"),
      channel_name: get("channel_name") || "",
    });
  }
  return rows;
}

// ---- IO helpers ----
async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), RSS_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": "ke-top500/1.0" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

// Parse feed-wide channel title + entries
function parseYouTubeRSS(xml) {
  const entries = [];
  // Feed/channel title (first <title> under <feed>)
  const feedTitleMatch = /<feed[^>]*?>[\s\S]*?<title>([\s\S]*?)<\/title>/i.exec(xml);
  const channelTitle = (feedTitleMatch && feedTitleMatch[1]?.trim()) || "";

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
  return { channelTitle, entries };
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

// ---- YouTube API enrichment (durations) ----
async function fetchDurations(ids) {
  const apiKey = process.env.YT_API_KEY;
  if (!apiKey) return null;
  if (!ids.length) return {};

  const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids.join(
    ","
  )}&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`videos.list ${res.status}`);
  const json = await res.json();
  const out = {};
  for (const it of json.items || []) {
    const dur = iso8601ToSeconds(it?.contentDetails?.duration || null);
    out[it.id] = dur;
  }
  return out;
}

async function enrichWithYouTubeAPI(items) {
  const apiKey = process.env.YT_API_KEY;
  if (!apiKey || !items.length) {
    console.warn(
      "[daily] YT_API_KEY missing or no items → durations unknown. If DAILY_FALLBACK_ALLOW_UNKNOWN=true, fallback will apply."
    );
    return items.map((x) => ({ ...x, latest_video_duration_sec: undefined }));
  }

  const out = [];
  for (let i = 0; i < items.length; i += BATCH_API) {
    const batch = items.slice(i, i + BATCH_API);

    let byId = {};
    for (let attempt = 0; attempt <= API_RETRIES; attempt++) {
      try {
        const map = await fetchDurations(batch.map((x) => x.latest_video_id));
        if (map) byId = map;
        break;
      } catch (e) {
        if (attempt === API_RETRIES) {
          console.error("[daily] API error (final):", e.message);
        } else {
          console.warn("[daily] API error, retrying:", e.message);
          await sleep(400);
          continue;
        }
      }
    }

    for (const v of batch) {
      const dur = byId[v.latest_video_id];
      out.push({ ...v, latest_video_duration_sec: dur });
    }

    await sleep(API_PAUSE_MS);
  }
  return out;
}

// ---- Main ----
async function main() {
  const [, , channelsPath, outPath] = process.argv;
  if (!channelsPath || !outPath) {
    console.error("Usage: node scripts/fetch_latest_top500_hybrid.mjs ./channels.csv ./public/data/top500.json");
    process.exit(2);
  }

  const channels = await readCsv(channelsPath);
  const candidates = [];

  // 1) Pull latest entries from RSS per channel
  let processed = 0;
  for (const ch of channels) {
    const cid = ch.channel_id;
    if (!cid) continue;

    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${cid}`;
    let xml = "";
    try {
      xml = await fetchText(rssUrl);
    } catch (e) {
      console.error("[daily] RSS fetch failed for", cid, e.message);
      continue;
    }

    const { channelTitle, entries } = parseYouTubeRSS(xml);
    const fallbackName = channelTitle || ch.channel_name || "";

    // prefilter text + (strict) age window for base candidate pool
    const prelim = entries
      .slice(0, MAX_RSS_ENTRIES)
      .filter(
        (e) =>
          e.id &&
          e.title &&
          !looksBlocked(e.title) &&
          daysAgo(e.publishedAt) <= MAX_AGE_DAYS
      );

    for (const e of prelim) {
      candidates.push({
        channel_id: cid,
        // If channels.csv had "Seed Channel #", overwrite with RSS channel title
        channel_name: fallbackName || ch.channel_name || "",
        channel_url: `https://www.youtube.com/channel/${cid}`,
        rank: ch.rank ?? 9999,

        latest_video_id: e.id,
        latest_video_title: e.title,
        latest_video_thumbnail: e.thumbnail || "",
        latest_video_published_at: e.publishedAt,
        latest_video_duration_sec: undefined, // filled by API below (or fallback)
      });
    }

    processed++;
    if (processed % 50 === 0) {
      console.log(`[daily] processed RSS for ${processed} channels...`);
    }
  }

  // 2) Enrich with durations (STRICT gate relies on this)
  let enriched = await enrichWithYouTubeAPI(candidates);

  // 3) Choose the NEWEST acceptable per channel.
  // STRICT path: require known duration >= 11min
  // FALLBACK path: if no duration but FALLBACK_ALLOW and age <= FALLBACK_MAX_AGE,
  //                assign conservative duration = MIN_LONGFORM_SEC and accept.
  const newestByChannel = new Map();
  for (const v of enriched) {
    let dur = v.latest_video_duration_sec;

    if (dur == null) {
      // Potential fallback
      if (
        FALLBACK_ALLOW &&
        daysAgo(v.latest_video_published_at) <= FALLBACK_MAX_AGE
      ) {
        dur = MIN_LONGFORM_SEC; // conservative assumption (bare minimum long-form)
      } else {
        continue; // drop unknowns in strict mode
      }
    }

    if (dur < MIN_LONGFORM_SEC) continue; // still too short → drop

    const key = v.channel_id;
    const prev = newestByChannel.get(key);
    if (!prev) {
      newestByChannel.set(key, { ...v, latest_video_duration_sec: dur });
    } else {
      const newer =
        new Date(v.latest_video_published_at) > new Date(prev.latest_video_published_at);
      if (newer) newestByChannel.set(key, { ...v, latest_video_duration_sec: dur });
    }
  }

  // 4) Build output array, ordered by channel rank
  const items = Array.from(newestByChannel.values()).sort(
    (a, b) => Number(a.rank ?? 9999) - Number(b.rank ?? 9999)
  );

  const payload = { generated_at_utc: new Date().toISOString(), items };
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  await fsp.writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");

  console.log(
    `[daily] Wrote ${items.length} items -> ${outPath} (fallback=${
      FALLBACK_ALLOW ? "on" : "off"
    }, fallback_max_age=${FALLBACK_MAX_AGE}d)`
  );
}

main().catch((e) => {
  console.error("[daily] ERROR:", e?.message || e);
  process.exit(1);
});
