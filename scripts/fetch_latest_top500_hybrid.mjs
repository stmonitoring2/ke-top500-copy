// Build public/data/top500.json (daily):
// 1) Strict pass: RSS -> API durations -> newest longform per channel
// 2) Per-channel relaxed fallback if strict found none: RSS-only newest (title filters, 120d window)

import fs from "fs";
import fsp from "fs/promises";
import path from "path";

const MIN_LONGFORM_SEC = 660;
const MAX_RSS_ENTRIES = 20;
const STRICT_MAX_AGE_DAYS = 90;
const RELAXED_MAX_AGE_DAYS = 120;
const RSS_TIMEOUT_MS = 15000;
const BATCH_API = 50;

const SHORTS_RE = /(^|\W)(shorts?|#shorts)(\W|$)/i;
const SPORTS_RE = /\b(highlights?|extended\s*highlights|FT|full\s*time|full\s*match|goal|matchday)\b|\b(\d+\s*-\s*\d+)\b/i;
const SENSATIONAL_RE = /(catch(ing)?|expos(e|ing)|confront(ing)?|loyalty\s*test|loyalty\s*challenge|pop\s*the\s*balloon)/i;
const MIX_RE = /\b(dj\s*mix|dj\s*set|mix\s*tape|mixtape|mixshow|party\s*mix|afrobeat\s*mix|bongo\s*mix|kenyan\s*mix|live\s*mix)\b/i;
const EXTRA_SPORTS_WORDS = /\b(sportscast|manchester\s*united|arsenal|liverpool|chelsea)\b/i;

const blocked = (t="") => SHORTS_RE.test(t) || SPORTS_RE.test(t) || SENSATIONAL_RE.test(t) || MIX_RE.test(t) || EXTRA_SPORTS_WORDS.test(t);
const toInt = (v) => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };
const daysAgo = (iso) => {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / (1000 * 60 * 60 * 24);
};

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
  const re = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = re.exec(xml))) {
    const b = m[1];
    const id = (b.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1] || "";
    const title = (b.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.trim() || "";
    const published = (b.match(/<published>([^<]+)<\/published>/) || [])[1] || "";
    const thumb = (b.match(/<media:thumbnail[^>]+url="([^"]+)"/) || [])[1] || "";
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

async function enrichDurations(items) {
  const apiKey = process.env.YT_API_KEY;
  if (!apiKey || !items.length) return items.map((x) => ({ ...x, latest_video_duration_sec: undefined }));

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
      console.error("[daily] API error:", e.message);
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

  // Collect candidates per channel from RSS (strict window)
  const byChannel = new Map();
  let processed = 0;
  for (const ch of channels) {
    const cid = ch.channel_id;
    if (!cid) continue;
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${cid}`;
    let xml = "";
    try { xml = await fetchText(rssUrl); }
    catch (e) { console.error("[daily] RSS fetch failed for", cid, e.message); continue; }
    const entries = parseYouTubeRSS(xml).slice(0, MAX_RSS_ENTRIES);

    const arr = [];
    for (const e of entries) {
      if (!e.id || !e.title) continue;
      if (blocked(e.title)) continue;
      if (daysAgo(e.publishedAt) > STRICT_MAX_AGE_DAYS) continue;
      arr.push({
        channel_id: cid,
        channel_name: ch.channel_name || "",
        channel_url: `https://www.youtube.com/channel/${cid}`,
        rank: ch.rank ?? 9999,
        latest_video_id: e.id,
        latest_video_title: e.title,
        latest_video_thumbnail: e.thumbnail || "",
        latest_video_published_at: e.publishedAt,
        latest_video_duration_sec: undefined,
      });
    }
    byChannel.set(cid, arr);

    processed++;
    if (processed % 50 === 0) console.log(`[daily] processed RSS for ${processed} channels...`);
  }

  // Strict: require duration >= 11min (if duration missing, drop)
  const strictPool = await enrichDurations([...byChannel.values()].flat());
  const strictByChannel = new Map();
  for (const v of strictPool) {
    if (v.latest_video_duration_sec == null || v.latest_video_duration_sec < MIN_LONGFORM_SEC) continue;
    const prev = strictByChannel.get(v.channel_id);
    if (!prev || new Date(v.latest_video_published_at) > new Date(prev.latest_video_published_at)) {
      strictByChannel.set(v.channel_id, v);
    }
  }

  // Per-channel relaxed fallback if strict found nothing:
  // - take newest RSS within 120d that passes title filters (no duration requirement)
  for (const ch of channels) {
    const cid = ch.channel_id;
    if (!cid) continue;
    if (strictByChannel.has(cid)) continue; // already satisfied
    const rssItems = (byChannel.get(cid) || []).filter((x) => daysAgo(x.latest_video_published_at) <= RELAXED_MAX_AGE_DAYS);
    if (!rssItems.length) continue;
    rssItems.sort((a, b) => new Date(b.latest_video_published_at) - new Date(a.latest_video_published_at));
    strictByChannel.set(cid, rssItems[0]);
  }

  // Final guard: if duration is known and < 11m, drop it
  const items = Array.from(strictByChannel.values())
  .filter(v => (v.latest_video_duration_sec == null) || (v.latest_video_duration_sec >= MIN_LONGFORM_SEC))
  .sort((a, b) => Number(a.rank ?? 9999) - Number(b.rank ?? 9999));

  );

  const payload = { generated_at_utc: new Date().toISOString(), items };
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  await fsp.writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`[daily] Wrote ${items.length} items -> ${outPath}`);
}

main().catch((e) => { console.error("[daily] ERROR:", e?.message || e); process.exit(1); });
