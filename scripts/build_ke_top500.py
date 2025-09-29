#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Builds the KE Top 500 ranking CSV.

Two modes:
  --discover true  : discover Kenya podcast/interview channels via search + allowlist,
                     compute composite score per spec, output ranked list.
  --discover false : use only seed_channel_ids.txt (and still score), useful as fallback.

Scoring (min-max normalized hats across candidate set):
Score = 0.25 * ẑ(log10(subs))
      + 0.25 * ẑ(log10(views_total))
      + 0.10 * ẑ(log10(video_count))
      + 0.20 * ẑ(f_freq_90d)       where f_freq_90d = uploads_last_90d / 13
      + 0.20 * ẑ(recency)          where recency = exp(-d/45), d = days since last upload

Inclusion:
  - Channel title/description contains "podcast" or "interview"/"talk show"/"conversation"/"panel"
    OR channel id in allowlist (seed file).
  - Kenyan signals: brandingSettings.channel.country == KE, or text hints (Kenya, Kenyan, Nairobi, etc.)
  - Strong content filters to avoid shorts/sports/sensational/mixes when selecting latest video.

Requires env YT_API_KEY.
"""

from __future__ import annotations
import argparse, csv, math, os, re, sys, time
from dataclasses import dataclass, asdict
from datetime import datetime, timezone, timedelta
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

try:
    from googleapiclient.discovery import build
except Exception:
    print("[KE500] ERROR: google-api-python-client not installed. pip install google-api-python-client", file=sys.stderr)
    sys.exit(2)

# -------- Config / thresholds --------
SEED_IDS_PATH = "seed_channel_ids.txt"
BLOCKED_IDS_PATH = "blocked_channel_ids.txt"

DISCOVERY_QUERIES = [
    "podcast kenya",
    "kenyan podcast",
    "nairobi podcast",
    "kenya talk show",
    "kenyan interviews",
    "interview kenya",
    "JKLive",
    "The Trend NTV",
    "Cleaning The Airwaves",
    "Lynn Ngugi interview",
    "Presenter Ali interview",
    "Obinna TV interview",
    "MIC CHEQUE podcast",
    "Sandwich Podcast KE",
    "ManTalk Ke podcast",
]

# Hard filters to keep ranking meaningful
MIN_SUBSCRIBERS = 5000
MIN_CHANNEL_VIEWS = 2_000_000
MIN_LONGFORM_SEC = 660
MAX_VIDEO_AGE_DAYS = 365
MIN_VIDEO_VIEWS = 10_000

# API pagination / batching
YOUTUBE_SEARCH_PAGE_SIZE = 50
MAX_DISCOVER_RESULTS_PER_QUERY = 100  # cap per query
MAX_CHANNEL_BATCH = 50
MAX_VIDEO_BATCH = 50
UPLOADS_FETCH_CAP = 250  # how many recent uploads we inspect for counts/recency

# Text / tag filters
SHORTS_RE = re.compile(r'(^|\W)(shorts?|#shorts)(\W|$)', re.I)
SPORTS_RE = re.compile(r'\b(highlights?|extended\s*highlights|FT|full\s*time|full\s*match|goal|matchday)\b|\b(\d+\s*-\s*\d+)\b', re.I)
CLUBS_RE = re.compile(r'\b(sportscast|manchester united|arsenal|liverpool|chelsea)\b', re.I)
SENSATIONAL_RE = re.compile(r'(catch(ing)?|expos(e|ing)|confront(ing)?|loyalty\s*test|loyalty\s*challenge|pop\s*the\s*balloon)', re.I)
MIX_RE = re.compile(r'\b(dj\s*mix|dj\s*set|mixtape|party\s*mix|afrobeat\s*mix|bongo\s*mix|live\s*mix)\b', re.I)
TAG_BLOCKS = {t.lower() for t in ["#sportshighlights","#sports","#highlights","#shorts","#short","sportshighlights","sports","highlights","shorts","short"]}
KENYA_HINTS_RE = re.compile(r'\b(kenya|kenyan|nairob[iy]|mombasa|kisumu|ke\b)\b', re.I)
PODCAST_INTERVIEW_RE = re.compile(r'\b(podcast|interview|talk\s*show|conversation|panel)\b', re.I)

# -------- Helpers --------
def now_utc_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def iso8601_duration_to_seconds(s: Optional[str]) -> Optional[int]:
    if not s: return None
    m = re.match(r"^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$", s)
    if not m: return None
    h = int(m.group(1) or 0); m_ = int(m.group(2) or 0); sec = int(m.group(3) or 0)
    return h*3600 + m_*60 + sec

def load_lines(path: str) -> List[str]:
    if not os.path.exists(path): return []
    out = []
    with open(path, "r", encoding="utf-8") as f:
        for ln in f:
            ln = ln.strip()
            if ln and not ln.startswith("#"): out.append(ln)
    return out

def chunked(seq: Sequence[str], n: int) -> Iterable[Sequence[str]]:
    for i in range(0, len(seq), n):
        yield seq[i:i+n]

def safe_get(d: dict, path: Sequence[str], default=None):
    cur = d
    for key in path:
        if not isinstance(cur, dict): return default
        cur = cur.get(key)
        if cur is None: return default
    return cur

def to_int(x) -> int:
    try: return int(x or "0")
    except: return 0

def log10p1(x: int) -> float:
    return math.log10(max(0, x) + 1.0)

def days_since(iso: str) -> Optional[float]:
    try:
        dt = datetime.fromisoformat(iso.replace("Z","+00:00"))
        return (datetime.now(timezone.utc) - dt).total_seconds() / 86400.0
    except Exception:
        return None

# -------- Data classes --------
@dataclass
class ChannelCore:
    channel_id: str
    channel_name: str
    channel_url: str
    subscribers: int
    video_count: int
    views_total: int
    country: str
    classification: str
    uploads_playlist_id: Optional[str]

@dataclass
class ChannelWithSignals(ChannelCore):
    uploads_last_90d: int
    last_upload_iso: Optional[str]
    last_upload_days: Optional[float]
    latest_kept_video_id: Optional[str]
    latest_kept_title: Optional[str]
    latest_kept_thumb: Optional[str]
    latest_kept_published: Optional[str]
    latest_kept_duration: Optional[int]
    latest_kept_views: Optional[int]
    score: float = 0.0

# -------- API client --------
def yt_client():
    key = os.environ.get("YT_API_KEY")
    if not key:
        sys.exit("[KE500] ERROR: YT_API_KEY env var missing")
    return build("youtube", "v3", developerKey=key, cache_discovery=False)

# -------- Inclusion logic --------
def looks_blocked(title: str, desc: str, tags: Optional[List[str]]) -> bool:
    txt = f"{title}\n{desc}"
    if SHORTS_RE.search(txt) or SPORTS_RE.search(txt) or CLUBS_RE.search(txt): return True
    if SENSATIONAL_RE.search(txt) or MIX_RE.search(txt): return True
    if tags and any((t or "").lower().strip() in TAG_BLOCKS for t in tags): return True
    return False

def classify_channel(name: str, desc: str) -> str:
    txt = f"{name}\n{desc}".lower()
    if "podcast" in txt: return "podcast"
    if PODCAST_INTERVIEW_RE.search(txt): return "interview"
    return "other"

def is_kenyan(snippet: dict, branding: dict, allow_ids: Optional[Set[str]], cid: str) -> bool:
    if (safe_get(branding, ["channel", "country"], "") or "").upper() == "KE": return True
    text = (snippet.get("title","") + " " + snippet.get("description",""))
    if KENYA_HINTS_RE.search(text): return True
    if allow_ids and cid in allow_ids: return True
    return False

# -------- Discovery --------
def discover_channel_ids(y, max_new: int) -> List[str]:
    ids: List[str] = []
    seen: Set[str] = set()
    for q in DISCOVERY_QUERIES:
        tok = None
        fetched = 0
        while True:
            res = y.search().list(
                part="snippet",
                q=q,
                type="channel",
                regionCode="KE",
                maxResults=min(50, YOUTUBE_SEARCH_PAGE_SIZE),
                pageToken=tok,
            ).execute()
            for it in res.get("items", []):
                cid = safe_get(it, ["snippet", "channelId"])
                if cid and cid not in seen:
                    seen.add(cid); ids.append(cid)
                    if len(ids) >= max_new: break
            tok = res.get("nextPageToken")
            fetched += len(res.get("items", []))
            if not tok or fetched >= MAX_DISCOVER_RESULTS_PER_QUERY or len(ids) >= max_new:
                break
            time.sleep(0.1)
        if len(ids) >= max_new: break
        time.sleep(0.2)
    return ids

# -------- Channel + video fetch --------
def list_channels(y, cids: Sequence[str]) -> List[dict]:
    out: List[dict] = []
    for b in chunked(cids, MAX_CHANNEL_BATCH):
        res = y.channels().list(
            part="snippet,statistics,contentDetails,brandingSettings",
            id=",".join(b)
        ).execute()
        out += res.get("items", [])
        time.sleep(0.1)
    return out

def list_playlist_video_ids(y, pid: str, cap: int) -> List[str]:
    out: List[str] = []
    tok = None
    while len(out) < cap:
        res = y.playlistItems().list(
            part="contentDetails",
            playlistId=pid,
            maxResults=min(50, cap - len(out)),
            pageToken=tok
        ).execute()
        for it in res.get("items", []):
            vid = safe_get(it, ["contentDetails", "videoId"])
            if vid: out.append(vid)
        tok = res.get("nextPageToken")
        if not tok: break
        time.sleep(0.1)
    return out

def list_videos(y, vids: Sequence[str]) -> List[dict]:
    out: List[dict] = []
    for b in chunked(list(vids), MAX_VIDEO_BATCH):
        res = y.videos().list(
            part="snippet,contentDetails,statistics",
            id=",".join(b)
        ).execute()
        out += res.get("items", [])
        time.sleep(0.1)
    return out

def choose_latest_longform(videos: Sequence[dict]) -> Optional[dict]:
    # newest → oldest
    sorted_vs = sorted(videos, key=lambda v: safe_get(v, ["snippet","publishedAt"], ""), reverse=True)
    for v in sorted_vs:
        title = safe_get(v, ["snippet","title"], "") or ""
        desc = safe_get(v, ["snippet","description"], "") or ""
        tags = safe_get(v, ["snippet","tags"], [])
        dur = iso8601_duration_to_seconds(safe_get(v, ["contentDetails","duration"]))
        pub = safe_get(v, ["snippet","publishedAt"], "")
        views = to_int(safe_get(v, ["statistics","viewCount"]))
        if dur is not None and dur < MIN_LONGFORM_SEC: continue
        if looks_blocked(title, desc, tags): continue
        # too old?
        try:
            too_old = datetime.fromisoformat(pub.replace("Z","+00:00")) < (datetime.now(timezone.utc)-timedelta(days=MAX_VIDEO_AGE_DAYS))
        except Exception:
            too_old = False
        if too_old: continue
        if views < MIN_VIDEO_VIEWS: continue
        return v
    return None

# -------- Build rows (core + signals) --------
def build_channel_core(y, cids: Sequence[str], allow_ids: Set[str], block_ids: Set[str]) -> List[ChannelCore]:
    cores: List[ChannelCore] = []
    for ch in list_channels(y, cids):
        cid = ch.get("id") or ""
        if not cid or cid in block_ids: continue
        sn = ch.get("snippet", {})
        stats = ch.get("statistics", {})
        branding = ch.get("brandingSettings", {})
        content = ch.get("contentDetails", {})

        if not is_kenyan(sn, branding, allow_ids, cid): continue

        subs = to_int(stats.get("subscriberCount"))
        views = to_int(stats.get("viewCount"))
        vcount = to_int(stats.get("videoCount"))

        if subs < MIN_SUBSCRIBERS or views < MIN_CHANNEL_VIEWS:
            continue

        name = sn.get("title", "") or ""
        desc = sn.get("description", "") or ""
        classification = classify_channel(name, desc)
        if classification == "other" and cid not in allow_ids:
            # Require explicit podcast/interview signals unless allowlisted
            continue

        pid = safe_get(content, ["relatedPlaylists", "uploads"])
        cores.append(ChannelCore(
            channel_id=cid,
            channel_name=name,
            channel_url=f"https://www.youtube.com/channel/{cid}",
            subscribers=subs,
            video_count=vcount,
            views_total=views,
            country=(safe_get(branding,["channel","country"],"") or "").upper(),
            classification=classification,
            uploads_playlist_id=pid
        ))
    return cores

def enrich_signals(y, cores: Sequence[ChannelCore]) -> List[ChannelWithSignals]:
    out: List[ChannelWithSignals] = []
    for c in cores:
        uploads = c.uploads_playlist_id
        last_90d = 0
        last_iso: Optional[str] = None
        last_days: Optional[float] = None
        kept_vid: Optional[dict] = None

        if uploads:
            ids = list_playlist_video_ids(y, uploads, UPLOADS_FETCH_CAP)
            vids = list_videos(y, ids)
            # Count uploads in last 90d
            ninety_days_ago = datetime.now(timezone.utc) - timedelta(days=90)
            for v in vids:
                pub = safe_get(v, ["snippet","publishedAt"])
                if not pub: continue
                try:
                    dt = datetime.fromisoformat(pub.replace("Z","+00:00"))
                    if dt >= ninety_days_ago: last_90d += 1
                    if (last_iso is None) or (dt > datetime.fromisoformat(last_iso.replace("Z","+00:00"))):
                        last_iso = pub
                except Exception:
                    pass
            if last_iso:
                last_days = days_since(last_iso)
            # Choose a representative latest longform video (for UI fields)
            chosen = choose_latest_longform(vids)
            if chosen:
                kept_vid = {
                    "id": chosen.get("id",""),
                    "title": safe_get(chosen, ["snippet","title"], "") or "",
                    "thumb": safe_get(chosen, ["snippet","thumbnails","high","url"], "")
                             or safe_get(chosen, ["snippet","thumbnails","medium","url"], "") or "",
                    "publishedAt": safe_get(chosen, ["snippet","publishedAt"], "") or "",
                    "duration_sec": iso8601_duration_to_seconds(safe_get(chosen, ["contentDetails","duration"])),
                    "views": to_int(safe_get(chosen, ["statistics","viewCount"]))
                }

        out.append(ChannelWithSignals(
            **asdict(c),
            uploads_last_90d=last_90d,
            last_upload_iso=last_iso,
            last_upload_days=last_days,
            latest_kept_video_id=(kept_vid or {}).get("id"),
            latest_kept_title=(kept_vid or {}).get("title"),
            latest_kept_thumb=(kept_vid or {}).get("thumb"),
            latest_kept_published=(kept_vid or {}).get("publishedAt"),
            latest_kept_duration=(kept_vid or {}).get("duration_sec"),
            latest_kept_views=(kept_vid or {}).get("views"),
        ))
        time.sleep(0.05)
    return out

# -------- Scoring --------
def minmax(values: List[float]) -> List[float]:
    if not values: return []
    lo = min(values); hi = max(values)
    if hi <= lo:
        return [0.0 for _ in values]
    return [(v - lo) / (hi - lo) for v in values]

def compute_scores(rows: List[ChannelWithSignals]) -> None:
    logs_subs  = [log10p1(r.subscribers) for r in rows]
    logs_views = [log10p1(r.views_total) for r in rows]
    logs_videos= [log10p1(r.video_count) for r in rows]
    f_freq     = [min(1.0, (r.uploads_last_90d or 0)/13.0) for r in rows]
    recency    = []
    for r in rows:
        d = r.last_upload_days if r.last_upload_days is not None else 9999.0
        recency.append(math.exp(-d/45.0))

    nh_subs   = minmax(logs_subs)
    nh_views  = minmax(logs_views)
    nh_videos = minmax(logs_videos)
    nh_freq   = minmax(f_freq)
    nh_rec    = minmax(recency)

    for i, r in enumerate(rows):
        r.score = (
            0.25 * nh_subs[i] +
            0.25 * nh_views[i] +
            0.10 * nh_videos[i] +
            0.20 * nh_freq[i] +
            0.20 * nh_rec[i]
        )

# -------- Write CSV --------
def write_csv(path: str, rows: List[ChannelWithSignals]) -> None:
    fn = [
        "rank","channel_id","channel_name","channel_url",
        "subscribers","video_count","views_total","country","classification",
        "latest_video_id","latest_video_title","latest_video_thumbnail",
        "latest_video_published_at","latest_video_duration_sec","latest_video_views",
        "score","generated_at_utc"
    ]
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    gen = now_utc_iso()
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fn); w.writeheader()
        for i, r in enumerate(rows, start=1):
            d = {
                "rank": i,
                "channel_id": r.channel_id,
                "channel_name": r.channel_name,
                "channel_url": r.channel_url,
                "subscribers": r.subscribers,
                "video_count": r.video_count,
                "views_total": r.views_total,
                "country": r.country,
                "classification": r.classification,
                "latest_video_id": r.latest_kept_video_id or "",
                "latest_video_title": r.latest_kept_title or "",
                "latest_video_thumbnail": r.latest_kept_thumb or "",
                "latest_video_published_at": r.latest_kept_published or "",
                "latest_video_duration_sec": r.latest_kept_duration if r.latest_kept_duration is not None else "",
                "latest_video_views": r.latest_kept_views if r.latest_kept_views is not None else "",
                "score": f"{r.score:.6f}",
                "generated_at_utc": gen,
            }
            w.writerow(d)

# -------- Main --------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="public/top500_ranked.csv")
    ap.add_argument("--discover", default="false", choices=["true","false"])
    ap.add_argument("--max_new", type=int, default=1500)
    args = ap.parse_args()

    y = yt_client()
    seed_ids = load_lines(SEED_IDS_PATH)
    block_ids = set(load_lines(BLOCKED_IDS_PATH))

    candidate_ids: List[str] = []
    if args.discover == "true":
        # discover + include seeds to bias toward known good channels
        discovered = discover_channel_ids(y, args.max_new)
        candidate_ids = list(dict.fromkeys(seed_ids + discovered))
    else:
        candidate_ids = list(dict.fromkeys(seed_ids))

    if not candidate_ids:
        print("[KE500] WARNING: no candidates found; seeding with seed_channel_ids.txt required.", file=sys.stderr)

    # Build cores → enrich signals → score → sort
    cores = build_channel_core(y, candidate_ids, allow_ids=set(seed_ids), block_ids=block_ids)
    if not cores:
        # still output an empty CSV with just the header
        write_csv(args.out, [])
        return

    enriched = enrich_signals(y, cores)
    if not enriched:
        write_csv(args.out, [])
        return

    compute_scores(enriched)
    enriched.sort(key=lambda r: r.score, reverse=True)
    top = enriched[:500]
    write_csv(args.out, top)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        sys.exit(f"[KE500] ERROR: {e}")
