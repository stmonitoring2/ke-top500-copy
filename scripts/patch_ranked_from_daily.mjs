// scripts/patch_ranked_from_daily.mjs
// Sync latest_* fields into public/top500_ranked.csv using:
// 1) public/data/top500.json (preferred, already long-form gated)
// 2) RSS backfill for channels missing from daily JSON (strict long-form ≥ 660s)
//
// Also ensures channel_url and channel_name are populated.

import fs from "fs";
import fsp from "fs/promises";
import path from "path";

// ---------- Tunables ----------
const MIN_LONGFORM_SEC = 660;      // 11 minutes
const MAX_RSS_ENTRIES = 20;
const RSS_TIMEOUT_MS = 15000;
const API_BATCH = 50;

// ---------- Filters (match the rest of the project) ----------
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

// Optional force-include list to override **text** filters (still enforces ≥660s)
const FORCE_INCLUDE = new Set(
  (process.env.DAILY_FORCE_INCLUDE_IDS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
);

// ---------- CSV helpers ----------
function splitCsvLine(line) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
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
function csvEscape(s) {
  if (s == null) return "";
  const str = String(s);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}
async function readCsvRows(p) {
  const txt = await fsp.readFile(p, "utf8");
  const lines = txt.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(Boolean);
  if (!lines.length) return { header: [], rows: [] };
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map((ln) => {
    const cols = splitCsvLine(ln);
    const obj = {};
    header.forEach((h, i) => (obj[h] = cols[i] ?? ""));
    return obj;
  });
  return { header, rows };
}
function writeCsv(p, header, rows) {
  const lines = [];
  lines.push(header.join(","));
  for (const r of rows) {
    const cols = header.map((h) => csvEscape(r[h] ?? ""));
    lines.push(cols.join(","));
  }
  return fsp.writeFile(p, lines.join("\n"), "utf8");
}
function toInt(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function ensureZ(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toISOString() : "";
}
async function fileExists(p) {
  try { await fsp.access(p, fs.constants.F_OK); return true; }
  catch { return false; }
}

// ---------- RSS + API helpers ----------
async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), RSS_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "ke-top500/1.0" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(t); }
}
function parseFeed(xml) {
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
  const k = process.env.YT_API_KEY;
  if (!k || !ids.length) return {};
  const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics&id=${ids.join(",")}&key=${k}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`videos.list ${res.status}`);
  const js = await res.json();
  const out = {};
  for (const it of js.items || []) {
    out[it.id] = {
      dur: iso8601ToSeconds(it?.contentDetails?.duration || null),
      views: toInt(it?.statistics?.viewCount, 0),
    };
  }
  return out;
}

// pick newest acceptable long-form (strict ≥660s)
async function probeLatestFromRSS(channelId) {
  try {
    const rss = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
    const { channelTitle, entries } = parseFeed(rss);
    if (!entries.length) return null;

    // newest → oldest
    entries.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    // duration via API (if key available)
    const meta = await fetchDurations(entries.slice(0, MAX_RSS_ENTRIES).map(e => e.id));

    for (const e of entries.slice(0, MAX_RSS_ENTRIES)) {
      const blocked = looksBlocked(e.title);
      const forced = FORCE_INCLUDE.has(channelId);
      if (blocked && !forced) continue;

      const dur = (meta[e.id]?.dur) ?? undefined;
      if (!dur || dur < MIN_LONGFORM_SEC) continue; // strict

      return {
        channel_name: channelTitle || "",
        channel_url: `https://www.youtube.com/channel/${channelId}`,
        latest_video_id: e.id,
        latest_video_title: e.title,
        latest_video_thumbnail: e.thumbnail || "",
        latest_video_published_at: ensureZ(e.publishedAt),
        latest_video_duration_sec: dur,
        latest_video_views: meta[e.id]?.views ?? 0,
      };
    }
  } catch (e) {
    console.warn("[patch] RSS probe failed for", channelId, e?.message || e);
  }
  return null;
}

// ---------- Main ----------
async function main() {
  const dailyPath = "public/data/top500.json";
  const rankedPath = "public/top500_ranked.csv";
  const channelsCsv = "channels.csv";

  const dailyById = new Map();
  if (await fileExists(dailyPath)) {
    const daily = JSON.parse(await fsp.readFile(dailyPath, "utf8"));
    for (const it of daily.items || []) {
      if (!it.channel_id) continue;
      dailyById.set(it.channel_id, {
        channel_name: it.channel_name || "",
        channel_url: it.channel_url || `https://www.youtube.com/channel/${it.channel_id}`,
        latest_video_id: it.latest_video_id || "",
        latest_video_title: it.latest_video_title || "",
        latest_video_thumbnail: it.latest_video_thumbnail || "",
        latest_video_published_at: ensureZ(it.latest_video_published_at),
        latest_video_duration_sec: toInt(it.latest_video_duration_sec, 0),
        latest_video_views: toInt(it.view_count, 0),
      });
    }
    console.log(`[patch] Loaded daily JSON items: ${dailyById.size}`);
  } else {
    console.warn("[patch] daily JSON not found; will rely on RSS backfill only.");
  }

  let header = [
    "rank","channel_id","channel_name","channel_url",
    "subscribers","video_count","views_total","country","classification",
    "latest_video_id","latest_video_title","latest_video_thumbnail",
    "latest_video_published_at","latest_video_duration_sec","latest_video_views","generated_at_utc"
  ];

  let rows = [];
  if (await fileExists(rankedPath)) {
    const r = await readCsvRows(rankedPath);
    header = Array.from(new Set([...(r.header || []), ...header]));
    rows = r.rows;
  } else if (await fileExists(channelsCsv)) {
    const r = await readCsvRows(channelsCsv);
    rows = (r.rows || []).map((x) => ({
      rank: x.rank || "",
      channel_id: x.channel_id || "",
      channel_name: x.channel_name || "",
      channel_url: x.channel_id ? `https://www.youtube.com/channel/${x.channel_id}` : "",
      subscribers: "0",
      video_count: "0",
      views_total: "0",
      country: "",
      classification: "",
      latest_video_id: "",
      latest_video_title: "",
      latest_video_thumbnail: "",
      latest_video_published_at: "",
      latest_video_duration_sec: "",
      latest_video_views: "",
      generated_at_utc: "",
    }));
  } else {
    console.error("[patch] ERROR: Neither ranked CSV nor channels.csv present.");
    process.exit(3);
  }

  // First pass: patch from daily JSON
  let patchedDaily = 0;
  for (const r of rows) {
    const cid = r.channel_id || "";
    if (!cid) continue;
    const d = dailyById.get(cid);
    if (!d) continue;

    r.channel_name = r.channel_name || d.channel_name || "";
    r.channel_url  = r.channel_url  || d.channel_url  || "";

    r.latest_video_id            = d.latest_video_id || r.latest_video_id || "";
    r.latest_video_title         = d.latest_video_title || r.latest_video_title || "";
    r.latest_video_thumbnail     = d.latest_video_thumbnail || r.latest_video_thumbnail || "";
    r.latest_video_published_at  = d.latest_video_published_at || r.latest_video_published_at || "";
    r.latest_video_duration_sec  = String(d.latest_video_duration_sec ?? r.latest_video_duration_sec ?? "");
    r.latest_video_views         = String(d.latest_video_views ?? r.latest_video_views ?? "");

    patchedDaily++;
  }

  // Second pass: RSS backfill for any rows still missing a valid long-form
  let patchedRss = 0;
  for (const r of rows) {
    const cid = r.channel_id || "";
    if (!cid) continue;

    const hasLong =
      toInt(r.latest_video_duration_sec, 0) >= MIN_LONGFORM_SEC &&
      (r.latest_video_id || "").length > 0;

    if (hasLong) continue;

    const d = await probeLatestFromRSS(cid);
    if (!d) continue;

    r.channel_name = r.channel_name || d.channel_name || "";
    r.channel_url  = r.channel_url  || d.channel_url  || "";

    r.latest_video_id            = d.latest_video_id || r.latest_video_id || "";
    r.latest_video_title         = d.latest_video_title || r.latest_video_title || "";
    r.latest_video_thumbnail     = d.latest_video_thumbnail || r.latest_video_thumbnail || "";
    r.latest_video_published_at  = d.latest_video_published_at || r.latest_video_published_at || "";
    r.latest_video_duration_sec  = String(d.latest_video_duration_sec ?? r.latest_video_duration_sec ?? "");
    r.latest_video_views         = String(d.latest_video_views ?? r.latest_video_views ?? "");

    patchedRss++;
  }

  // Stamp
  const gen = new Date().toISOString();
  for (const r of rows) r.generated_at_utc = gen;

  await fsp.mkdir(path.dirname(rankedPath) || ".", { recursive: true });
  await writeCsv(rankedPath, header, rows);
  console.log(`[patch] Wrote ${rankedPath}. Patched from daily=${patchedDaily}, from RSS=${patchedRss}, rows=${rows.length}`);
}

main().catch((e) => {
  console.error("[patch] ERROR:", e?.message || e);
  process.exit(1);
});
