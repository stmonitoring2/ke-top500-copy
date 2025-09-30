// Build public/data/top500.json from channels.csv by scanning each channel’s RSS (newest 20),
// enriching durations via YouTube API (if key present), and picking the NEWEST long-form (>=11min).
// Fallback mode (no/low API):
//   - DAILY_FALLBACK_ALLOW_UNKNOWN=true    -> allow unknown durations
//   - DAILY_FALLBACK_MAX_AGE_DAYS=14       -> only accept unknowns up to this age
//   - We assign MIN_LONGFORM_SEC as a conservative duration so UI treats as long-form.
// Also fixes "Seed Channel #" by taking feed <title>, and de-dupes final list by video_id and by normalized title.
//
// Usage: node scripts/fetch_latest_top500_hybrid.mjs ./channels.csv ./public/data/top500.json

import fsp from "fs/promises";
import path from "path";

const MIN_LONGFORM_SEC = 660;
const MAX_RSS_ENTRIES = 20;
const STRICT_MAX_AGE_DAYS = 90;
const RSS_TIMEOUT_MS = 15000;

const BATCH_API = 50;
const API_PAUSE_MS = 100;
const API_RETRIES = 1;

const FALLBACK_ALLOW =
  (process.env.DAILY_FALLBACK_ALLOW_UNKNOWN || "").toLowerCase() === "true";
const FALLBACK_MAX_AGE =
  Number.parseInt(process.env.DAILY_FALLBACK_MAX_AGE_DAYS || "14", 10) || 14;

// --------- Filters ----------
const SHORTS_RE = /(^|\W)(shorts?|#shorts)(\W|$)/i;
const SPORTS_RE = /\b(highlights?|extended\s*highlights|FT|full\s*time|full\s*match|goal|matchday)\b|\b(\d+\s*-\s*\d+)\b/i;
const SENSATIONAL_RE = /(catch(ing)?|expos(e|ing)|confront(ing)?|loyalty\s*test|loyalty\s*challenge|pop\s*the\s*balloon)/i;
const MIX_RE = /\b(dj\s*mix|dj\s*set|mix\s*tape|mixtape|mixshow|party\s*mix|afrobeat\s*mix|bongo\s*mix|kenyan\s*mix|live\s*mix)\b/i;
const EXTRA_SPORTS_WORDS = /\b(sportscast|manchester\s*united|arsenal|liverpool|chelsea)\b/i;

const looksBlocked = (title = "") =>
  SHORTS_RE.test(title) ||
  SPORTS_RE.test(title) ||
  SENSATIONAL_RE.test(title) ||
  MIX_RE.test(title) ||
  EXTRA_SPORTS_WORDS.test(title);

// --------- utils ----------
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

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQ = false; }
      } else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

async function readCsv(filepath) {
  const text = await fsp.readFile(filepath, "utf8");
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(Boolean);
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
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
  const feedTitleMatch = /<feed[^>]*?>[\s\S]*?<title>([\s\S]*?)<\/title>/i.exec(xml);
  const channelTitle = (feedTitleMatch && feedTitleMatch[1]?.trim()) || "";
  const entries = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRegex.exec(xml))) {
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

async function fetchDurations(ids) {
  const apiKey = process.env.YT_API_KEY;
  if (!apiKey) return null;
  if (!ids.length) return {};
  const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids.join(",")}&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`videos.list ${res.status}`);
  const json = await res.json();
  const out = {};
  for (const it of json.items || []) {
    out[it.id] = iso8601ToSeconds(it?.contentDetails?.duration || null);
  }
  return out;
}

async function enrichWithYouTubeAPI(items) {
  const apiKey = process.env.YT_API_KEY;
  if (!apiKey || !items.length) {
    console.warn("[daily] YT_API_KEY missing or no items; fallback may apply.");
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
      out.push({ ...v, latest_video_duration_sec: byId[v.latest_video_id] });
    }
    await sleep(API_PAUSE_MS);
  }
  return out;
}

function normTitle(s = "") {
  return s.toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ]/g, "").trim();
}

async function main() {
  const [, , channelsPath, outPath] = process.argv;
  if (!channelsPath || !outPath) {
    console.error("Usage: node scripts/fetch_latest_top500_hybrid.mjs ./channels.csv ./public/data/top500.json");
    process.exit(2);
  }

  const channels = await readCsv(channelsPath);
  const candidates = [];

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
    const displayName = channelTitle || ch.channel_name || "";

    const prelim = entries
      .slice(0, MAX_RSS_ENTRIES)
      .filter((e) => e.id && e.title && !looksBlocked(e.title) && daysAgo(e.publishedAt) <= STRICT_MAX_AGE_DAYS);

    for (const e of prelim) {
      candidates.push({
        channel_id: cid,
        channel_name: displayName,
        channel_url: `https://www.youtube.com/channel/${cid}`,
        rank: ch.rank ?? 9999,

        latest_video_id: e.id,
        latest_video_title: e.title,
        latest_video_thumbnail: e.thumbnail || "",
        latest_video_published_at: e.publishedAt,
        latest_video_duration_sec: undefined,
      });
    }

    processed++;
    if (processed % 50 === 0) console.log(`[daily] processed RSS for ${processed} channels...`);
  }

  let enriched = await enrichWithYouTubeAPI(candidates);

  // pick newest acceptable per channel (with fallback if enabled)
  const newestByChannel = new Map();
  for (const v of enriched) {
    let dur = v.latest_video_duration_sec;
    if (dur == null) {
      if (FALLBACK_ALLOW && daysAgo(v.latest_video_published_at) <= FALLBACK_MAX_AGE) {
        dur = MIN_LONGFORM_SEC; // conservative min
      } else {
        continue;
      }
    }
    if (dur < MIN_LONGFORM_SEC) continue;

    const prev = newestByChannel.get(v.channel_id);
    if (!prev || new Date(v.latest_video_published_at) > new Date(prev.latest_video_published_at)) {
      newestByChannel.set(v.channel_id, { ...v, latest_video_duration_sec: dur });
    }
  }

  // flatten + sort by channel rank
  let items = Array.from(newestByChannel.values()).sort(
    (a, b) => Number(a.rank ?? 9999) - Number(b.rank ?? 9999)
  );

  // final de-dupe by video_id and by normalized title to avoid obvious re-uploads
  const seenIds = new Set();
  const seenTitles = new Set();
  const deduped = [];
  for (const it of items) {
    const nt = normTitle(it.latest_video_title);
    if (seenIds.has(it.latest_video_id) || seenTitles.has(nt)) continue;
    seenIds.add(it.latest_video_id);
    seenTitles.add(nt);
    deduped.push(it);
  }
  items = deduped;

  const payload = { generated_at_utc: new Date().toISOString(), items };
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  await fsp.writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(
    `[daily] Wrote ${items.length} items -> ${outPath} (fallback=${FALLBACK_ALLOW ? "on" : "off"}, fallback_max_age=${FALLBACK_MAX_AGE}d)`
  );
}

main().catch((e) => {
  console.error("[daily] ERROR:", e?.message || e);
  process.exit(1);
});
