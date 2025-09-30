// Build 7d / 30d rollups from channel RSS with strict long-form gate.
// Optional fallback (like daily) using ROLLUP_FALLBACK_ALLOW_UNKNOWN + window days.
//
// Usage: node scripts/make_rollups_from_channels.mjs <days> <outpath>

import fsp from "fs/promises";
import path from "path";

const MIN_LONGFORM_SEC = 660;
const RSS_TIMEOUT_MS = 15000;
const MAX_RSS_ENTRIES = 20;

const BATCH_API = 50;
const API_PAUSE_MS = 100;
const API_RETRIES = 1;

const ROLLUP_FALLBACK_ALLOW =
  (process.env.ROLLUP_FALLBACK_ALLOW_UNKNOWN || "").toLowerCase() === "true";

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

const toInt = (v) => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };
const daysAgo = (iso) => {
  if (!iso) return Infinity;
  const d = new Date(iso).getTime();
  if (!Number.isFinite(d)) return Infinity;
  return (Date.now() - d) / (1000 * 60 * 60 * 24);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function splitCsvLine(line) {
  const out = []; let cur = ""; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') { if (i + 1 < line.length && line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
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
  const header = splitCsvLine(lines[0]);
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    rows.push({ rank: toInt(cols[idx["rank"]]), channel_id: cols[idx["channel_id"]], channel_name: cols[idx["channel_name"]] ?? "" });
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
  } finally { clearTimeout(t); }
}

function parseYouTubeRSS(xml) {
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  const entries = [];
  let m;
  while ((m = entryRegex.exec(xml))) {
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
  const m_ = parseInt(m[2] || "0", 10);
  const sec = parseInt(m[3] || "0", 10);
  return h * 3600 + m_ * 60 + sec;
}

async function fetchDurationsAndViews(ids) {
  const apiKey = process.env.YT_API_KEY;
  if (!apiKey) return null;
  if (!ids.length) return {};
  const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics&id=${ids.join(",")}&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`videos.list ${res.status}`);
  const json = await res.json();
  const out = {};
  for (const it of json.items || []) {
    out[it.id] = { dur: iso8601ToSeconds(it?.contentDetails?.duration || null), views: toInt(it?.statistics?.viewCount) ?? undefined };
  }
  return out;
}

async function enrichWithYouTubeAPI(items) {
  const apiKey = process.env.YT_API_KEY;
  if (!apiKey || !items.length) {
    console.warn("[rollup] YT_API_KEY missing or no items; strict gate may drop unknowns unless fallback is enabled.");
    return items.map((x) => ({ ...x, latest_video_duration_sec: undefined, view_count: undefined }));
  }
  const out = [];
  for (let i = 0; i < items.length; i += BATCH_API) {
    const batch = items.slice(i, i + BATCH_API);
    let byId = {};
    for (let attempt = 0; attempt <= API_RETRIES; attempt++) {
      try {
        const map = await fetchDurationsAndViews(batch.map((x) => x.latest_video_id));
        if (map) byId = map;
        break;
      } catch (e) {
        if (attempt === API_RETRIES) console.error("[rollup] API error (final):", e.message);
        else { console.warn("[rollup] API error, retrying:", e.message); await sleep(400); continue; }
      }
    }
    for (const v of batch) {
      const meta = byId[v.latest_video_id] || {};
      out.push({ ...v, latest_video_duration_sec: meta.dur, view_count: meta.views });
    }
    await sleep(API_PAUSE_MS);
  }
  return out;
}

function scoreVideo(v) {
  const age = Math.max(0.25, daysAgo(v.latest_video_published_at));
  const views = v.view_count != null ? Math.log10(v.view_count + 1) : 0;
  return 0.7 * (1 / age) + 0.3 * views; // recent-first + views assist
}

function normTitle(s = "") {
  return s.toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ]/g, "").trim();
}

async function main() {
  const [, , daysStr, outPath] = process.argv;
  const windowDays = parseInt(daysStr || "7", 10);
  if (!Number.isFinite(windowDays) || windowDays <= 0) {
    console.error("Usage: node scripts/make_rollups_from_channels.mjs <days> <outpath>");
    process.exit(2);
  }

  const channelsCsv = "channels.csv";
  const channelsTxt = await fsp.readFile(channelsCsv, "utf8").catch(() => null);
  if (!channelsTxt) {
    await fsp.mkdir(path.dirname(outPath), { recursive: true });
    await fsp.writeFile(outPath, JSON.stringify({ generated_at_utc: new Date().toISOString(), items: []}, null, 2), "utf8");
    console.log("[rollup] No channels.csv -> wrote empty rollup");
    return;
  }
  const lines = channelsTxt.split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) {
    await fsp.mkdir(path.dirname(outPath), { recursive: true });
    await fsp.writeFile(outPath, JSON.stringify({ generated_at_utc: new Date().toISOString(), items: []}, null, 2), "utf8");
    console.log("[rollup] channels.csv header-only -> wrote empty rollup");
    return;
  }

  const channels = await (async () => {
    const tmp = await fsp.writeFile(".tmp.csv", channelsTxt);
    return (await (await readCsv("channels.csv")));
  })().catch(async () => await readCsv("channels.csv"));

  const candidates = [];
  let processed = 0;
  for (const ch of channels) {
    const cid = ch.channel_id;
    if (!cid) continue;
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${cid}`;
    let xml = "";
    try { xml = await fetchText(rssUrl); }
    catch (e) { console.error("[rollup] RSS fetch failed for", cid, e.message); continue; }

    const entries = parseYouTubeRSS(xml).slice(0, MAX_RSS_ENTRIES);
    for (const e of entries) {
      if (!e.id || !e.title) continue;
      if (looksBlocked(e.title)) continue;
      if (daysAgo(e.publishedAt) > windowDays) continue;

      candidates.push({
        channel_id: cid,
        channel_name: ch.channel_name || "",
        channel_url: `https://www.youtube.com/channel/${cid}`,
        rank: ch.rank ?? 9999,

        latest_video_id: e.id,
        latest_video_title: e.title,
        latest_video_thumbnail: e.thumbnail || "",
        latest_video_published_at: e.publishedAt,
        latest_video_duration_sec: undefined,
        view_count: undefined,
      });
    }

    processed++;
    if (processed % 50 === 0) console.log(`[rollup] processed RSS for ${processed} channels...`);
  }

  if (!candidates.length) {
    const payload = { generated_at_utc: new Date().toISOString(), items: [] };
    await fsp.mkdir(path.dirname(outPath), { recursive: true });
    await fsp.writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
    console.log("[rollup] No candidates -> wrote empty rollup");
    return;
  }

  // Enrich
  let enriched = await enrichWithYouTubeAPI(candidates);

  // Strict gate + optional fallback (permit unknown duration if within window)
  const picked = [];
  const seenIds = new Set();
  const seenTitles = new Set();
  for (const v of enriched) {
    let dur = v.latest_video_duration_sec;
    if (dur == null) {
      if (ROLLUP_FALLBACK_ALLOW) dur = MIN_LONGFORM_SEC;
      else continue;
    }
    if (dur < MIN_LONGFORM_SEC) continue;

    const idDupe = seenIds.has(v.latest_video_id);
    const titleDupe = seenTitles.has(normTitle(v.latest_video_title));
    if (idDupe || titleDupe) continue;
    seenIds.add(v.latest_video_id);
    seenTitles.add(normTitle(v.latest_video_title));
    picked.push(v);
  }

  // Order: score desc, then recency
  for (const v of picked) v.__score = scoreVideo(v);
  picked.sort((a, b) => (b.__score - a.__score) || (new Date(b.latest_video_published_at) - new Date(a.latest_video_published_at)));

  const items = picked.map(({ __score, ...rest }) => rest).slice(0, 500);
  const payload = { generated_at_utc: new Date().toISOString(), items };
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  await fsp.writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`[rollup] Wrote ${items.length} items -> ${outPath}`);
}

main().catch((e) => {
  console.error("[rollup] ERROR:", e?.message || e);
  process.exit(1);
});
