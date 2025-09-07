import fs from 'fs/promises';
import path from 'path';
import { google } from 'googleapis';
import { parse as parseCSV } from 'csv-parse/sync';

const API_KEY = process.env.YT_API_KEY;
if (!API_KEY) throw new Error('Missing YT_API_KEY');

const args = Object.fromEntries(process.argv.slice(2).map((a)=>{ const [k,v]=a.split('='); return [k.replace(/^--/,''), v ?? true]; }));
const channelsPath = args.channels || './channels.csv';
const outPath      = args.out      || './public/data/top500.json';

async function latestFor(youtube, cid){
  const ch = await youtube.channels.list({ part:['contentDetails','snippet','statistics'], id:[cid] });
  const it = ch.data.items?.[0]; if(!it) return null;
  const uploads = it.contentDetails?.relatedPlaylists?.uploads;
  const pl = await youtube.playlistItems.list({ part:['contentDetails','snippet'], playlistId:uploads, maxResults:1 });
  const v = pl.data.items?.[0]; const vid = v?.contentDetails?.videoId;
  return {
    channel_id: cid,
    channel_name: it.snippet?.title,
    channel_url: it.snippet?.customUrl ? `https://www.youtube.com/${it.snippet.customUrl}` : `https://www.youtube.com/channel/${cid}`,
    latest_video_id: vid,
    latest_video_title: v?.snippet?.title,
    latest_video_published_at: v?.contentDetails?.videoPublishedAt,
    latest_video_thumbnail: vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : null
  };
}

async function main(){
  const youtube = google.youtube({ version:'v3', auth: API_KEY });
  const csv = await fs.readFile(channelsPath, 'utf8');
  const rows = parseCSV(csv, { columns:true, skip_empty_lines:true }).slice(0,500);
  const out = [];
  for(const r of rows){
    if(!r.channel_id) continue; // builder ensures channel_id
    const item = await latestFor(youtube, r.channel_id);
    out.push({ rank: Number(r.rank)||out.length+1, ...item });
    await new Promise(res=>setTimeout(res, 100));
  }
  const payload = { generated_at_utc: new Date().toISOString(), tz:'+03:00', items: out.sort((a,b)=>a.rank-b.rank) };
  await fs.mkdir(path.dirname(outPath), { recursive:true });
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2));
  console.log('Wrote', outPath, 'items=', payload.items.length);
}
main().catch(e=>{ console.error(e); process.exit(1); });
