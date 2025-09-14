// Hybrid latest-video fetcher:
// 1) Try YouTube RSS feed (free).
// 2) If RSS fails or has no entries, fallback to YouTube Data API (needs YT_API_KEY; ~2 quota units/channel).

import fs from "fs/promises";
import path from "path";
import { parseStringPromise } from "xml2js";
import { google } from "googleapis";

// --- tiny CSV reader (no extra deps) ---
function parseCSV(text) {
  const [header, ...rows] = text.trim().split(/\r?\n/);
  const cols = header.split(",");
  return rows
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(",");
      const obj = {};
      cols.forEach((c, i) => (obj[c.trim()] = (parts[i] || "").trim()));
      return obj;
    });
}

async function fetchLatestFromRSS(channelId) {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const xml = await res.text();
  const feed = await parseStringPromise(xml).catch(() => null);
  const entry = feed?.feed?.entry?.[0];
  if (!entry) return null;

  const videoId = entry?.["yt:videoId"]?.[0];
  const title = entry?.title?.[0] || "";
  const published = entry?.published?.[0] || "";
  const thumb = videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;

  return videoId
    ? {
        latest_video_id: videoId,
        latest_video_title: title,
        latest_video_published_at: published,
        latest_video_thumbnail: thumb,
        source: "rss",
      }
    : null;
}

async function fetchLatestFromAPI(youtube, channelId) {
  // channels.list -> uploads playlist -> playlistItems.list (maxResults=1)
  const ch = await youtube.channels
    .list({ part: ["contentDetails", "snippet"], id: [channelId] })
    .then((r) => r.data.items?.[0])
    .catch(() => null);
  if (!ch) return null;
  const uploads = ch.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return null;

  const item = await youtube.playlistItems
    .list({ part: ["contentDetails", "snippet"], playlistId: uploads, maxResults: 1 })
    .then((r) => r.data.items?.[0])
    .catch(() => null);
  const vid = item?.contentDetails?.videoId;
  if (!vid) return null;

  return {
    latest_video_id: vid,
    latest_video_title: item?.snippet?.title || "",
    latest_video_published_at: item?.contentDetails?.videoPublishedAt || "",
    latest_video_thumbnail: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
    source: "api",
  };
}

async function main() {
  const channelsPath = process.argv[2] || "./channels.csv";
  const outPath = process.argv[3] || "./public/data/top500.json";
  const API_KEY = process.env.YT_API_KEY || "";

  const csv = await fs.readFile(channelsPath, "utf8");
  const rows = parseCSV(csv).slice(0, 500);

  const youtube = API_KEY ? google.youtube({ version: "v3", auth: API_KEY }) : null;

  const out = [];
  for (const r of rows) {
    const cid = r.channel_id;
    if (!cid) continue;

    let latest = null;

    // 1) Try RSS first
    try {
      latest = await fetchLatestFromRSS(cid);
    } catch (_) {
      /* ignore */
    }

    // 2) If no luck and API available, try API fallback
    if (!latest && youtube) {
      try {
        latest = await fetchLatestFromAPI(youtube, cid);
      } catch (_) {
        /* ignore */
      }
    }

    // Build row (even if latest is null — but we'll filter nulls later in UI)
    out.push({
      rank: Number(r.rank) || out.length + 1,
      channel_id: cid,
      channel_name: r.channel_name || "",
      channel_url: `https://www.youtube.com/channel/${cid}`,
      ...(latest || {
        latest_video_id: null,
        latest_video_title: "",
        latest_video_published_at: "",
        latest_video_thumbnail: null,
      }),
    });

    // Be polite
    await new Promise((res) => setTimeout(res, 60));
  }

  const payload = {
    generated_at_utc: new Date().toISOString(),
    tz: "+03:00",
    items: out.sort((a, b) => (a.rank || 9999) - (b.rank || 9999)),
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2));
  console.log("Wrote", outPath, "items=", payload.items.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
