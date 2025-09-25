#!/usr/bin/env node
/**
 * Build simple 7d / 30d rollups from the current daily snapshot.
 *
 * Usage:
 *   node scripts/build_rollups_from_daily.js public/data/top500.json public/data/top500_7d.json public/data/top500_30d.json
 *
 * What it does:
 * - Reads the daily JSON (items array).
 * - (Light filter) If items have latest_video_published_at, it tries to keep only those within the past 7/30 days.
 * - If that filter would produce an empty list, it falls back to the full daily list (so the UI never ends up empty).
 */

const fs = require("fs");
const path = require("path");

function parseISO(d) {
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : null;
}

function withinDays(iso, days) {
  const ts = parseISO(iso);
  if (!ts) return false;
  const now = Date.now();
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return ts >= cutoff;
}

function loadJson(fp) {
  const text = fs.readFileSync(fp, "utf8");
  return JSON.parse(text);
}

function saveJson(fp, data) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), "utf8");
  console.log(`[rollups] wrote ${fp} (${data.items?.length || 0} items)`);
}

function buildRollup(daily, days) {
  const items = Array.isArray(daily.items) ? daily.items : [];
  let filtered = items.filter((x) => {
    const p = x.latest_video_published_at || x.published_at || x.date || "";
    return p ? withinDays(p, days) : true; // if no date, keep it (so we don’t drop everything)
  });

  // If filtering nuked everything (e.g., missing dates), fall back to all items.
  if (!filtered.length) filtered = items.slice();

  // keep order by rank if present
  filtered.sort((a, b) => (a.rank || 9999) - (b.rank || 9999));

  return {
    range: `${days}d`,
    generated_at_utc: new Date().toISOString(),
    items: filtered,
  };
}

function main() {
  const [inDaily, out7d, out30d] = process.argv.slice(2);
  if (!inDaily || !out7d || !out30d) {
    console.error("Usage: node scripts/build_rollups_from_daily.js <daily.json> <out7d.json> <out30d.json>");
    process.exit(1);
  }

  const daily = loadJson(inDaily);
  const r7 = buildRollup(daily, 7);
  const r30 = buildRollup(daily, 30);

  saveJson(out7d, r7);
  saveJson(out30d, r30);
}

main();
