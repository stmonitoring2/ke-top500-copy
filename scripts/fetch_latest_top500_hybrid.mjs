// scripts/fetch_latest_top500_hybrid.mjs
// Build public/data/top500.json from channels.csv.
// Adds compatibility aliases for the Daily UI: video_id, title, thumbnail, published_at, duration_sec, url.

import fs from "fs";
import fsp from "fs/promises";
import path from "path";

// ---- Tunables ----
const MIN_LONGFORM_SEC = 660;   // 11 minutes
const MAX_RSS_ENTRIES = 20;
const MAX_AGE_DAYS = 90;
const RSS_TIMEOUT_MS = 15000;
const BATCH_API = 50;
const API_PAUSE_MS = 120;
const API_RETRIES = 1;

// ---- Fallback envs ----
const FALLBACK_ALLOW = (process.env.DAILY_FALLBACK_ALLOW_UNKNOWN || "").toLowerCase() === "true";
const FALLBACK_MAX_AGE = Number.parseInt(process.env.DAILY_FALLBACK_MAX_AGE_DAYS || "14", 10) || 14;

// ---- Filters ----
const SHORTS_RE = /(^|\W)(shorts?|#shorts)(\W|$)/i;
const SPORTS_RE = /\b(highlights?|extended\s*highlights|FT|full\s*time|full\s*match|goal|matchday)\b|\b(\d+\s*-\s*\d+)\b/i;
const SENSATIONAL_RE = /(catch(ing)?|expos(e|ing)|confront(ing)?|loyalty\s*test|loyalty\s*challenge|pop\s*the\s*balloon)/i;
const MIX_RE = /\b(dj\s*mix|dj\s*set|mix\s*tape|mixtape|mixshow|party\s*mix|afrobeat\s*mix|bongo\s*mix|kenyan\s*mix|live\s*mix)\b/i;
const EXTRA_SPORTS_WORDS = /\b(sportscast|manchester\s*united|arsenal|liverpool|chelsea)\b/i;

const looksBlocked = (t = "") =>
  SHORTS_RE.test(t) || SPORTS_RE.test(t) || SENSATIONAL_RE.test(t) || MIX_RE.test(t) || EXTRA_SPORTS_WORDS.test(t);

// ---- Utils ----
const toInt = (v) => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };
const daysAgo = (iso) => {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? (Date.now() - t) / (1000 * 60 * 60 * 24) : Infinity;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toUtcZ = (x) => { const d = new Date(x); return isNaN(d.getTime()) ? null : d.toISOString(); };

// ---- CSV ----
function splitCsvLine(line) {
  const out = []; let cur = ""; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') { if (i + 1 < line.length && line[i + 1] === '"') { cur += '"'; i++; } else { inQ = false; } }
      else cur += ch;
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
    const get = (name) => { const j = idx[name]; return j == null ? "" : (cols[j] ?? ""); };
    rows.push({ rank: toInt(get("rank")), channel_id: get("channel_id"), channel_name: get("channel_name") || "" });
  }
  return rows;
}

// ---- IO & RSS ----
async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), RSS_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "ke-top500/1.0" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(t); }
}

function parseYouTubeRSS(xml) {
  const entries = [];
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

// ---- API enrichment ----
function iso8601ToSeconds(s) {
  if (!s) return undefined;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(s);
  if (!m) return undefined;
  const h = parseInt(m[1] || "0", 10);
  const mm = parseInt(m[2] || "0", 10);
  const sec = parseInt(m[3] || "0", 10);
  return h * 3600 + mm * 60 + sec;
}

async function fetchMeta(ids) {
  const apiKey = process.env.YT_API_KEY;
  if (!apiKey) return null;
  if (!ids.length) return {};
  const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics&id=${ids.join(",")}&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`videos.list ${res.status}`);
  const json = await res.json();
  const out = {};
  for (const it of json.items || []) {
    out[it.id] = { dur: iso8601ToSeconds(it?.contentDetails?.duration || null), views: toInt(it?.statistics?.viewCount) };
  }
  return out;
}

async function enrichWithYouTubeAPI(items) {
  const apiKey = process.env.YT_API_KEY;
  if (!apiKey || !items.length) {
    console.warn("[daily] YT_API_KEY missing or no items → duration/views unknown; fallback may apply.");
    return items.map((x) => ({ ...x, latest_video_duration_sec: undefined, view_count: undefined }));
  }
  const out = [];
  for (let i = 0; i < items.length; i += BATCH_API) {
    const batch = items.slice(i, i + BATCH_API);
    let byId = {};
    for (let attempt = 0; attempt <= API_RETRIES; attempt++) {
      try { byId = (await fetchMeta(batch.map((x) => x.latest_video_id))) || {}; break; }
      catch (e) { if (attempt === API_RETRIES) console.error("[daily] API error (final):", e.message); else { console.warn("[daily] API error, retrying:", e.message); await sleep(400); } }
    }
    for (const v of batch) {
      const meta = byId[v.latest_video_id] || {};
      out.push({ ...v, latest_video_duration_sec: meta.dur, view_count: meta.views });
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

  // 1) RSS scrape
  let processed = 0;
  for (const ch of channels) {
    const cid = ch.channel_id;
    if (!cid) continue;

    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${cid}`;
    let xml = "";
    try { xml = await fetchText(rssUrl); }
    catch (e) { console.error("[daily] RSS fetch failed for", cid, e.message); continue; }

    const { channelTitle, entries } = parseYouTubeRSS(xml);
    const fallbackName = channelTitle || ch.channel_name || "";

    const prelim = entries
      .slice(0, MAX_RSS_ENTRIES)
      .filter((e) => e.id && e.title && !looksBlocked(e.title) && daysAgo(e.publishedAt) <= MAX_AGE_DAYS);

    for (const e of prelim) {
      const pubZ = toUtcZ(e.publishedAt);
      if (!pubZ) continue;
      candidates.push({
        channel_id: cid,
        channel_name: fallbackName || ch.channel_name || "",
        channel_url: `https://www.youtube.com/channel/${cid}`,
        rank: ch.rank ?? 9999,

        latest_video_id: e.id,
        latest_video_title: e.title,
        latest_video_thumbnail: e.thumbnail || "",
        latest_video_published_at: pubZ,
        latest_video_duration_sec: undefined,
        view_count: undefined,
      });
    }

    processed++;
    if (processed % 50 === 0) console.log(`[daily] processed RSS for ${processed} channels...`);
  }

  // 2) Enrich (duration + views)
  let enriched = await enrichWithYouTubeAPI(candidates);

  // 3) Strict long-form w/ optional fallback
  const newestByChannel = new Map();
  for (const v of enriched) {
    let dur = v.latest_video_duration_sec;
    if (dur == null) {
      if (FALLBACK_ALLOW && daysAgo(v.latest_video_published_at) <= FALLBACK_MAX_AGE) {
        dur = MIN_LONGFORM_SEC; // conservative fallback
      } else continue;
    }
    if (dur < MIN_LONGFORM_SEC) continue;

    const key = v.channel_id;
    const prev = newestByChannel.get(key);
    const nextObj = { ...v, latest_video_duration_sec: dur, is_longform: true };
    if (!prev) newestByChannel.set(key, nextObj);
    else if (new Date(v.latest_video_published_at) > new Date(prev.latest_video_published_at)) newestByChannel.set(key, nextObj);
  }

  // 4) Sort by channel rank and add compatibility aliases for Daily UI
  const items = Array.from(newestByChannel.values())
    .sort((a, b) => Number(a.rank ?? 9999) - Number(b.rank ?? 9999))
    .map((it) => {
      const video_id = it.latest_video_id;
      return {
        ...it,
        // --- compatibility aliases (do not remove) ---
        video_id,
        title: it.latest_video_title,
        thumbnail: it.latest_video_thumbnail,
        published_at: it.latest_video_published_at,
        duration_sec: it.latest_video_duration_sec,
        url: `https://www.youtube.com/watch?v=${video_id}`,
      };
    });

  const payload = { generated_at_utc: new Date().toISOString(), items };
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  await fsp.writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");

  console.log(`[daily] Wrote ${items.length} items -> ${outPath} (fallback=${FALLBACK_ALLOW ? "on" : "off"}, fallback_max_age=${FALLBACK_MAX_AGE}d)`);
}

main().catch((e) => { console.error("[daily] ERROR:", e?.message || e); process.exit(1); });
