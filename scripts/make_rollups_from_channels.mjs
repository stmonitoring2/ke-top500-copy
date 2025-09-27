// scripts/make_rollups_from_channels.mjs
// Build 7d / 30d rollups from channel RSS, with strict long-form gate.
// Usage: node scripts/make_rollups_from_channels.mjs <days> <outpath>

import fs from "fs";
import fsp from "fs/promises";
import path from "path";

// ---------- Tunables ----------
const MIN_LONGFORM_SEC = 660; // 11 min (strict)
const PER_CHANNEL_CAP_7D = 3;
const PER_CHANNEL_CAP_30D = 5;
const MAX_TOTAL = 500;
const RSS_TIMEOUT_MS = 15000;
const MAX_RSS_ENTRIES = 20;
const BATCH_API = 50;

// Filters (match UI & Python)
const SHORTS_RE = /(^|\W)(shorts?|#shorts)(\W|$)/i;
const SPORTS_RE = /\b(highlights?|extended\s*highlights|FT|full\s*time|full\s*match|goal|matchday)\b|\b(\d+\s*-\s*\d+)\b/i;
const SENSATIONAL_RE = /(catch(ing)?|expos(e|ing)|confront(ing)?|loyalty\s*test|loyalty\s*challenge|pop\s*the\s*balloon)/i;
const MIX_RE = /\b(dj\s*mix|dj\s*set|mix\s*tape|mixtape|mixshow|party\s*mix|afrobeat\s*mix|bongo\s*mix|kenyan\s*mix|live\s*mix)\b/i;
const EXTRA_SPORTS_WORDS = /\b(sportscast|manchester\s*united|arsenal|liverpool|chelsea)\b/i;

// Utils
const toInt = (v) => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };
const daysAgo = (iso) => {
  if (!iso) return Infinity;
  const d = new Date(iso).getTime();
  if (!Number.isFinite(d)) return Infinity;
  return (Date.now() - d) / (1000 * 60 * 60 * 24);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Read channels.csv ----------
async function readCsv(filepath) {
  const text = await fsp.readFile(filepath, "utf8");
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(Boolean);
  const header = lines[0].split(",");
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    rows.push({
      rank: toInt(cols[idx["rank"]]),
      channel_id: cols[idx["channel_id"]],
      channel_name: cols[idx["channel_name"]] ?? "",
    });
  }
  return rows;
}

// ---------- RSS helpers ----------
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
  return entries;
}

const looksBlockedByText = (title = "") =>
  SHORTS_RE.test(title) ||
  SPORTS_RE.test(title) ||
  SENSATIONAL_RE.test(title) ||
  MIX_RE.test(title) ||
  EXTRA_SPORTS_WORDS.test(title);

// ---------- API enrichment ----------
function iso8601ToSeconds(s) {
  if (!s) return undefined;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(s);
  if (!m) return undefined;
  const h = parseInt(m[1] || "0", 10);
  const m_ = parseInt(m[2] || "0", 10);
  const sec = parseInt(m[3] || "0", 10);
  return h * 3600 + m_ * 60 + sec;
}

async function enrichWithYouTubeAPI(items) {
  const apiKey = process.env.YT_API_KEY;
  if (!apiKey || !items.length) return items.map((x) => ({ ...x, latest_video_duration_sec: undefined, view_count: undefined }));

  const out = [];
  for (let i = 0; i < items.length; i += BATCH_API) {
    const batch = items.slice(i, i + BATCH_API);
    const ids = batch.map((x) => x.latest_video_id).join(",");
    const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics&id=${ids}&key=${apiKey}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`videos.list ${res.status}`);
      const json = await res.json();
      const byId = Object.create(null);
      for (const it of json.items || []) byId[it.id] = it;

      for (const v of batch) {
        const meta = byId[v.latest_video_id];
        const dur = iso8601ToSeconds(meta?.contentDetails?.duration || null);
        const views = toInt(meta?.statistics?.viewCount) ?? undefined;
        out.push({ ...v, latest_video_duration_sec: dur, view_count: views });
      }
    } catch (e) {
      console.error("[rollup] API error:", e.message);
      out.push(...batch.map((v) => ({ ...v, latest_video_duration_sec: undefined, view_count: undefined })));
    }
    await sleep(100);
  }
  return out;
}

// ---------- Scoring + fair newest-per-channel selection ----------
function scoreVideo(v) {
  const age = Math.max(0.25, daysAgo(v.latest_video_published_at));
  const views = v.view_count != null ? Math.log10(v.view_count + 1) : 0;
  return 0.7 * (1 / age) + 0.3 * views; // recent-first + views assist
}

function fairCapAndFillNewestFirst(candidates, maxTotal, perChannelCap) {
  const byChannel = new Map();
  for (const v of candidates) {
    if (!byChannel.has(v.channel_id)) byChannel.set(v.channel_id, []);
    byChannel.get(v.channel_id).push(v);
  }
  // newest → oldest per channel
  for (const arr of byChannel.values()) {
    arr.sort((a, b) => new Date(b.latest_video_published_at) - new Date(a.latest_video_published_at));
  }

  const taken = [];
  while (taken.length < maxTotal) {
    let moved = 0;
    for (const [cid, arr] of byChannel) {
      if (!arr.length) continue;
      const already = taken.filter((x) => x.channel_id === cid).length;
      if (already >= perChannelCap) continue;
      const v = arr.shift();
      if (!v) continue;
      taken.push(v);
      moved++;
      if (taken.length >= maxTotal) break;
    }
    if (!moved) break;
  }
  return taken;
}

// ---------- Main ----------
async function main() {
  const [, , daysStr, outPath] = process.argv;
  const days = parseInt(daysStr || "7", 10);
  if (!Number.isFinite(days) || days <= 0) {
    console.error("Usage: node scripts/make_rollups_from_channels.mjs <days> <outpath>");
    process.exit(2);
  }
  const perCap = days <= 7 ? PER_CHANNEL_CAP_7D : PER_CHANNEL_CAP_30D;

  const channelsCsv = fs.existsSync("channels.csv") ? "channels.csv" : "public/top500_ranked.csv";
  const channels = await readCsv(channelsCsv);

  // collect window candidates from RSS
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
      console.error("[rollup] RSS fetch failed for", cid, e.message);
      continue;
    }
    const entries = parseYouTubeRSS(xml).slice(0, MAX_RSS_ENTRIES);
    for (const e of entries) {
      if (!e.id || !e.title) continue;
      if (looksBlockedByText(e.title)) continue;
      if (daysAgo(e.publishedAt) > days) continue;

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
    if (processed % 50 === 0) {
      console.log(`[rollup] processed RSS for ${processed} channels...`);
    }
  }

  if (!candidates.length) {
    const payload = { generated_at_utc: new Date().toISOString(), items: [] };
    await fsp.mkdir(path.dirname(outPath), { recursive: true });
    await fsp.writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
    console.log("[rollup] No candidates -> wrote empty rollup");
    return;
  }

  // enrichment (durations + views)
  let enriched = await enrichWithYouTubeAPI(candidates);

  // STRICT: require known duration >= 11min (if duration unknown, DROP to prevent shorts)
  enriched = enriched.filter((v) => v.latest_video_duration_sec != null && v.latest_video_duration_sec >= MIN_LONGFORM_SEC);

  if (!enriched.length) {
    const payload = { generated_at_utc: new Date().toISOString(), items: [] };
    await fsp.mkdir(path.dirname(outPath), { recursive: true });
    await fsp.writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
    console.log("[rollup] All candidates dropped by strict long-form gate");
    return;
  }

  // score for ordering
  for (const v of enriched) v.__score = scoreVideo(v);

  // fair, newest-first per channel
  const picked = fairCapAndFillNewestFirst(enriched, MAX_TOTAL, perCap);

  // final ordering: score desc, then recency desc
  picked.sort((a, b) => (b.__score - a.__score) || (new Date(b.latest_video_published_at) - new Date(a.latest_video_published_at)));

  const items = picked.map(({ __score, ...rest }) => rest);
  const payload = { generated_at_utc: new Date().toISOString(), items };
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  await fsp.writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`[rollup] Wrote ${items.length} items -> ${outPath}`);
}

main().catch((e) => {
  console.error("[rollup] ERROR:", e?.message || e);
  process.exit(1);
});
