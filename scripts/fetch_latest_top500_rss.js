import fs from "fs/promises";
import path from "path";
import { parseStringPromise } from "xml2js";

// Minimal CSV reader (no extra deps)
function parseCSV(text) {
  const [header, ...rows] = text.trim().split(/\r?\n/);
  const cols = header.split(",");
  return rows.map(line => {
    const parts = line.split(",");
    const obj = {};
    cols.forEach((c, i) => obj[c.trim()] = (parts[i] || "").trim());
    return obj;
  });
}

async function fetchLatestFromRSS(channelId) {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const xml = await res.text();
  const feed = await parseStringPromise(xml);
  const entry = feed?.feed?.entry?.[0];
  if (!entry) return null;

  // Extract fields
  const videoUrl = entry?.link?.[0]?.$.href || "";
  const videoId = entry?.["yt:videoId"]?.[0];
  const title = entry?.title?.[0] || "";
  const published = entry?.published?.[0] || "";

  return {
    latest_video_id: videoId,
    latest_video_title: title,
    latest_video_published_at: published,
    latest_video_thumbnail: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null
  };
}

async function main() {
  const channelsPath = process.argv[2] || "./channels.csv";
  const outPath = process.argv[3] || "./public/data/top500.json";

  const csv = await fs.readFile(channelsPath, "utf8");
  const rows = parseCSV(csv).slice(0, 500);

  const out = [];
  for (const r of rows) {
    const cid = r.channel_id;
    if (!cid) continue;
    try {
      const latest = await fetchLatestFromRSS(cid);
      out.push({
        rank: Number(r.rank) || out.length + 1,
        channel_id: cid,
        channel_name: r.channel_name,
        channel_url: `https://www.youtube.com/channel/${cid}`,
        ...latest
      });
    } catch (e) {
      console.error("RSS error for", cid, e?.message || e);
    }
    // polite delay
    await new Promise(res => setTimeout(res, 50));
  }

  const payload = {
    generated_at_utc: new Date().toISOString(),
    tz: "+03:00",
    items: out.sort((a, b) => (a.rank || 9999) - (b.rank || 9999))
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2));
  console.log("Wrote", outPath, "items=", payload.items.length);
}

main().catch(e => { console.error(e); process.exit(1); });
