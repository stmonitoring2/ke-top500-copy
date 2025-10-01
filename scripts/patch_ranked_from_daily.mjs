// scripts/patch_ranked_from_daily.mjs
// Sync latest long-form fields from public/data/top500.json -> public/top500_ranked.csv
// so legacy Daily UI (which reads ranked CSV) has non-empty latest_* columns.

import fs from "fs";
import fsp from "fs/promises";
import path from "path";

// ---- tiny CSV helpers ----
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
function toInt(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function ensureZ(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toISOString() : "";
}

async function readJSON(p) {
  const txt = await fsp.readFile(p, "utf8");
  return JSON.parse(txt);
}

async function fileExists(p) {
  try { await fsp.access(p, fs.constants.F_OK); return true; }
  catch { return false; }
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

// ---- main patch ----
async function main() {
  const dailyPath = "public/data/top500.json";
  const rankedPath = "public/top500_ranked.csv";
  const channelsCsv = "channels.csv";

  if (!(await fileExists(dailyPath))) {
    console.error("[patch] ERROR: daily JSON not found:", dailyPath);
    process.exit(2);
  }

  const daily = await readJSON(dailyPath);
  const byId = new Map();
  for (const it of daily.items || []) {
    const cid = it.channel_id;
    if (!cid) continue;
    byId.set(cid, {
      latest_video_id: it.latest_video_id || it.video_id || "",
      latest_video_title: it.latest_video_title || it.title || "",
      latest_video_thumbnail: it.latest_video_thumbnail || it.thumbnail || "",
      latest_video_published_at: ensureZ(it.latest_video_published_at || it.published_at || ""),
      latest_video_duration_sec: toInt(it.latest_video_duration_sec ?? it.duration_sec, 0),
      latest_video_views: toInt(it.view_count, 0),
      channel_name: it.channel_name || "",
      channel_url: it.channel_url || (cid ? `https://www.youtube.com/channel/${cid}` : ""),
    });
  }

  // Required header (superset of legacy)
  const HEADER = [
    "rank","channel_id","channel_name","channel_url",
    "subscribers","video_count","views_total","country","classification",
    "latest_video_id","latest_video_title","latest_video_thumbnail",
    "latest_video_published_at","latest_video_duration_sec","latest_video_views","generated_at_utc"
  ];

  let rows = [];
  let header = HEADER.slice();

  if (await fileExists(rankedPath)) {
    const r = await readCsvRows(rankedPath);
    // upgrade header to superset
    header = Array.from(new Set([...(r.header || []), ...HEADER]));
    rows = r.rows;
    console.log(`[patch] Loaded existing ranked CSV with ${rows.length} rows.`);
  } else if (await fileExists(channelsCsv)) {
    // synthesize from channels.csv
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
    console.log(`[patch] Built ranked rows from channels.csv (${rows.length}).`);
  } else {
    console.error("[patch] ERROR: Neither ranked CSV nor channels.csv is present.");
    process.exit(3);
  }

  // apply daily latest fields
  let patched = 0;
  for (const r of rows) {
    const cid = r.channel_id || "";
    if (!cid) continue;
    const d = byId.get(cid);
    if (!d) continue;

    r.channel_name = r.channel_name || d.channel_name || "";
    r.channel_url  = r.channel_url  || d.channel_url  || "";

    r.latest_video_id            = d.latest_video_id || r.latest_video_id || "";
    r.latest_video_title         = d.latest_video_title || r.latest_video_title || "";
    r.latest_video_thumbnail     = d.latest_video_thumbnail || r.latest_video_thumbnail || "";
    r.latest_video_published_at  = d.latest_video_published_at || r.latest_video_published_at || "";
    r.latest_video_duration_sec  = String(d.latest_video_duration_sec ?? r.latest_video_duration_sec ?? "");
    r.latest_video_views         = String(d.latest_video_views ?? r.latest_video_views ?? "");

    patched++;
  }

  // stamp generation time
  const gen = new Date().toISOString();
  for (const r of rows) r.generated_at_utc = gen;

  await fsp.mkdir(path.dirname(rankedPath) || ".", { recursive: true });
  await writeCsv(rankedPath, header, rows);
  console.log(`[patch] Wrote ${rankedPath} (${rows.length} rows). Patched: ${patched}`);
}

main().catch((e) => {
  console.error("[patch] ERROR:", e?.message || e);
  process.exit(1);
});
