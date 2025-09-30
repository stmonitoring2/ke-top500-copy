#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Builds the KE Top 500 CSV by discovering channels that match the Kenya
podcast / interview space, ranks them with the composite score:

Score = 0.25 * ^log10(subs) +
        0.25 * ^log10(views_total) +
        0.10 * ^log10(video_count) +
        0.20 * ^f_freq(90d) +
        0.20 * ^recency

where:
  f_freq(90d) = uploads_in_last_90_days / 13  (≈ uploads/week)
  recency     = exp(-days_since_last_upload / 45)

Hats (^) are min–max normalization within the candidate set.

We then write public/top500_ranked.csv and this will be converted to channels.csv.
"""

from __future__ import annotations
import argparse, csv, os, re, sys, time, math
from dataclasses import dataclass, asdict
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Set, Iterable

try:
    from googleapiclient.discovery import build
except Exception:
    print("[KE500] ERROR: google-api-python-client not installed. pip install google-api-python-client", file=sys.stderr)
    sys.exit(2)

# ----------------- Config -----------------
SEED_IDS_PATH = "seed_channel_ids.txt"
BLOCKED_IDS_PATH = "blocked_channel_ids.txt"

DISCOVERY_QUERIES = [
    # broad → narrow
    "podcast kenya", "kenyan podcast", "nairobi podcast", "kenya talk show",
    "kenyan interviews", "interview kenya", "talk show kenya",
    "Lynn Ngugi interview", "JKLive", "The Trend NTV",
    "Cleaning The Airwaves", "Presenter Ali interview",
    "MIC CHEQUE podcast", "Sandwich Podcast KE", "ManTalk Ke podcast",
]

YOUTUBE_SEARCH_PAGE_SIZE = 50
MAX_DISCOVER_CHANNELS_PER_QUERY = 100   # cap per query
MAX_DISCOVER_QUERIES = 20               # hard cap in case someone extends list

# Minimum channel bar to avoid noise
MIN_SUBSCRIBERS     = 2_000
MIN_CHANNEL_VIEWS   = 500_000

# Video gate for long-form + content type
MIN_LONGFORM_SEC    = 11 * 60
MAX_VIDEO_AGE_DAYS  = 365
MIN_VIDEO_VIEWS     = 5_000   # just to avoid tiny uploads in the "latest" check

# Filters (match your Node filtering)
SHORTS_RE = re.compile(r'(^|\W)(shorts?|#shorts)(\W|$)', re.I)
SPORTS_RE = re.compile(r'\b(highlights?|extended\s*highlights|FT|full\s*time|full\s*match|goal|matchday)\b|\b(\d+\s*-\s*\d+)\b', re.I)
CLUBS_RE  = re.compile(r'\b(sportscast|manchester united|arsenal|liverpool|chelsea)\b', re.I)
SENS_RE   = re.compile(r'(catch(ing)?|expos(e|ing)|confront(ing)?|loyalty\s*test|loyalty\s*challenge|pop\s*the\s*balloon)', re.I)
MIX_RE    = re.compile(r'\b(dj\s*mix|dj\s*set|mixtape|party\s*mix|afrobeat\s*mix|bongo\s*mix|live\s*mix)\b', re.I)
TAG_BLOCKS = {"#sportshighlights","#sports","#highlights","#shorts","#short","sportshighlights","sports","highlights","shorts","short"}

KENYA_HINTS_RE       = re.compile(r'\b(kenya|kenyan|nairob[iy]|mombasa|kisumu|ke\b)\b', re.I)
PODCAST_INTERVIEW_RE = re.compile(r'\b(podcast|interview|talk\s*show|conversation|panel)\b', re.I)

# ------------- Helpers -------------
def now_utc_iso(): return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def iso8601_duration_to_seconds(s: Optional[str]) -> Optional[int]:
    if not s: return None
    m = re.match(r"^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$", s)
    if not m: return None
    h = int(m.group(1) or 0); m_ = int(m.group(2) or 0); sec = int(m.group(3) or 0)
    return h*3600 + m_*60 + sec

def load_lines(path: str) -> List[str]:
    if not os.path.exists(path): return []
    with open(path, "r", encoding="utf-8") as f:
        return [ln.strip() for ln in f if ln.strip() and not ln.startswith("#")]

def chunked(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i+n]

def safe_get(d, path, default=None):
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
    return math.log10(max(1, x))

def minmax_norm(values: List[float]) -> Dict[int, float]:
    if not values: return {}
    mn, mx = min(values), max(values)
    if mx <= mn: return {i: 0.0 for i in range(len(values))}
    return {i: (values[i] - mn) / (mx - mn) for i in range(len(values))}

def days_since(iso_str: str) -> float:
    try:
        t = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    except Exception:
        return 9999.0
    return (datetime.now(timezone.utc) - t).total_seconds() / 86400.0

def looks_blocked_text(title: str, desc: str, tags: List[str]) -> bool:
    txt = (title or "") + "\n" + (desc or "")
    if SHORTS_RE.search(txt) or SPORTS_RE.search(txt) or CLUBS_RE.search(txt): return True
    if SENS_RE.search(txt) or MIX_RE.search(txt): return True
    if tags and any((t or "").lower().strip() in TAG_BLOCKS for t in tags): return True
    return False

def is_kenyan(snippet: dict, branding: dict, cid: str, allow_ids: Set[str]) -> bool:
    country = (safe_get(branding, ["channel", "country"], "") or "").upper()
    if country == "KE": return True
    txt = (snippet.get("title","") or "") + " " + (snippet.get("description","") or "")
    if KENYA_HINTS_RE.search(txt): return True
    return cid in allow_ids

# ------------- YouTube client -------------
def yt_client():
    k = os.environ.get("YT_API_KEY")
    if not k:
        sys.exit("[KE500] ERROR: YT_API_KEY env var missing")
    return build("youtube", "v3", developerKey=k, cache_discovery=False)

def search_channels(y, query: str, limit: int) -> List[str]:
    """Return a list of channel IDs for a query."""
    ids = []
    tok = None
    while len(ids) < limit:
        res = y.search().list(
            q=query, part="snippet", type="channel",
            maxResults=min(50, limit - len(ids)),
            pageToken=tok, regionCode="KE"
        ).execute()
        for it in res.get("items", []):
            cid = safe_get(it, ["snippet", "channelId"])
            if cid: ids.append(cid)
        tok = res.get("nextPageToken")
        if not tok: break
        time.sleep(0.1)
    return ids

def list_channels(y, cids: List[str]) -> List[dict]:
    out = []
    for b in chunked(cids, 50):
        res = y.channels().list(
            part="snippet,statistics,contentDetails,brandingSettings",
            id=",".join(b)
        ).execute()
        out += res.get("items", [])
        time.sleep(0.1)
    return out

def list_upload_ids(y, uploads_playlist_id: str, max_items: int) -> List[str]:
    out, tok = [], None
    while len(out) < max_items:
        res = y.playlistItems().list(
            part="contentDetails", playlistId=uploads_playlist_id,
            maxResults=min(50, max_items - len(out)), pageToken=tok
        ).execute()
        for it in res.get("items", []):
            vid = safe_get(it, ["contentDetails", "videoId"])
            if vid: out.append(vid)
        tok = res.get("nextPageToken")
        if not tok: break
        time.sleep(0.1)
    return out

def list_videos(y, ids: List[str]) -> List[dict]:
    out = []
    for b in chunked(ids, 50):
        res = y.videos().list(
            part="snippet,contentDetails,statistics",
            id=",".join(b)
        ).execute()
        out += res.get("items", [])
        time.sleep(0.1)
    return out

# ------------- Build features -------------
def latest_acceptable(y, uploads_playlist_id: str) -> Optional[dict]:
    """Return the newest acceptable long-form video dict (id, title, thumb, publishedAt, duration, views)."""
    ids = list_upload_ids(y, uploads_playlist_id, 15)
    if not ids: return None
    vids = list_videos(y, ids)
    # newest first
    vids.sort(key=lambda v: safe_get(v, ["snippet", "publishedAt"], ""), reverse=True)

    for v in vids:
        dur = iso8601_duration_to_seconds(safe_get(v, ["contentDetails", "duration"]))
        title = safe_get(v, ["snippet", "title"], "") or ""
        desc  = safe_get(v, ["snippet", "description"], "") or ""
        tags  = safe_get(v, ["snippet", "tags"], []) or []
        pub   = safe_get(v, ["snippet", "publishedAt"], "") or ""
        views = to_int(safe_get(v, ["statistics", "viewCount"]))
        if dur and dur < MIN_LONGFORM_SEC:      continue
        if looks_blocked_text(title, desc, tags): continue
        if days_since(pub) > MAX_VIDEO_AGE_DAYS:  continue
        if views < MIN_VIDEO_VIEWS:               continue
        thumb = (safe_get(v, ["snippet", "thumbnails", "high", "url"], "")
              or safe_get(v, ["snippet", "thumbnails", "medium", "url"], ""))
        return {
            "id": v.get("id",""), "title": title, "thumb": thumb,
            "publishedAt": pub, "duration_sec": dur, "views": views
        }
    return None

@dataclass
class ChannelFeatures:
    cid: str
    name: str
    url: str
    subscribers: int
    video_count: int
    views_total: int
    uploads_90d: int
    days_since_last: float

def extract_features(y, ch: dict) -> Optional[ChannelFeatures]:
    cid = ch.get("id") or ""
    sn  = ch.get("snippet", {}) or {}
    stats = ch.get("statistics", {}) or {}
    branding = ch.get("brandingSettings", {}) or {}
    content  = ch.get("contentDetails", {}) or {}

    # Kenya inclusion
    if not is_kenyan(sn, branding, cid, allow_ids=set()):  # allow_ids handled later globally
        # we'll allow via seeds later; for discovery we keep Kenya-only
        country = (safe_get(branding, ["channel", "country"], "") or "").upper()
        txt = (sn.get("title","") or "") + " " + (sn.get("description","") or "")
        if country != "KE" and not KENYA_HINTS_RE.search(txt):
            return None

    subs  = to_int(stats.get("subscriberCount"))
    views = to_int(stats.get("viewCount"))
    vids  = to_int(stats.get("videoCount"))
    if subs < MIN_SUBSCRIBERS or views < MIN_CHANNEL_VIEWS:
        return None

    uploads = safe_get(content, ["relatedPlaylists", "uploads"])
    if not uploads: return None

    # Pull recent ~30 upload ids to compute 90d uploads + recency
    ids = list_upload_ids(y, uploads, 30)
    if not ids:
        return None
    vmeta = list_videos(y, ids)

    # uploads in last 90 days + last upload age
    ninety_days_ago = datetime.now(timezone.utc) - timedelta(days=90)
    uploads_90d = 0
    latest_pub = None
    for v in vmeta:
        pub = safe_get(v, ["snippet", "publishedAt"], "")
        try:
            ts = datetime.fromisoformat(pub.replace("Z", "+00:00"))
        except Exception:
            continue
        if ts >= ninety_days_ago:
            uploads_90d += 1
        if (latest_pub is None) or (ts > latest_pub):
            latest_pub = ts

    days_last = (datetime.now(timezone.utc) - latest_pub).total_seconds() / 86400.0 if latest_pub else 9999.0

    return ChannelFeatures(
        cid=cid,
        name=sn.get("title","") or "",
        url=f"https://www.youtube.com/channel/{cid}",
        subscribers=subs,
        video_count=vids,
        views_total=views,
        uploads_90d=uploads_90d,
        days_since_last=days_last
    )

def compute_scores(rows: List[ChannelFeatures]) -> List[float]:
    # components
    subs   = [log10p1(r.subscribers) for r in rows]
    views  = [log10p1(r.views_total) for r in rows]
    vids   = [log10p1(r.video_count) for r in rows]
    freq   = [min(1.0, r.uploads_90d / 13.0) for r in rows]   # ≈ uploads/week
    recency= [math.exp(-r.days_since_last / 45.0) for r in rows]

    nsubs  = minmax_norm(subs)
    nviews = minmax_norm(views)
    nvids  = minmax_norm(vids)
    nfreq  = minmax_norm(freq)
    nrec   = minmax_norm(recency)

    scores = []
    for i in range(len(rows)):
        s = 0.25 * nsubs[i] + 0.25 * nviews[i] + 0.10 * nvids[i] + 0.20 * nfreq[i] + 0.20 * nrec[i]
        scores.append(s)
    return scores

# ------------- Main -------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="public/top500_ranked.csv")
    ap.add_argument("--max_new", type=int, default=1500)
    ap.add_argument("--discover", choices=["true","false"], default="true")
    args = ap.parse_args()

    y = yt_client()
    seed_ids = set(load_lines(SEED_IDS_PATH))
    blocked  = set(load_lines(BLOCKED_IDS_PATH))

    # ----- discovery -----
    candidate_ids: List[str] = []
    if args.discover == "true":
        for qi, q in enumerate(DISCOVERY_QUERIES[:MAX_DISCOVER_QUERIES], 1):
            ids = search_channels(y, q, MAX_DISCOVER_CHANNELS_PER_QUERY)
            candidate_ids += ids
            time.sleep(0.2)
        # also pull from related channels of the seeds (light)
        if seed_ids:
            seed_ch_objs = list_channels(y, list(seed_ids))
            for ch in seed_ch_objs:
                # brandingSettings.channel.keywords sometimes contains related hints
                kws = (safe_get(ch, ["brandingSettings","channel","keywords"], "") or "")
                # pick potential channel ids embedded — this is best-effort; usually empty
                # (we won't rely on this; discovery queries do the heavy lifting)
            time.sleep(0.2)

    # always include seeds
    candidate_ids = list(dict.fromkeys(list(seed_ids) + candidate_ids))
    if args.max_new and len(candidate_ids) > args.max_new:
        candidate_ids = candidate_ids[:args.max_new]

    # ----- Fetch channel objects & features -----
    ch_objs = list_channels(y, candidate_ids) if candidate_ids else []
    # merge-in seeds that might not appear in discovery (ensure all seeds processed)
    extra_seed_objs = []
    if seed_ids:
        already = {c.get("id") for c in ch_objs}
        missing = [cid for cid in seed_ids if cid not in already]
        if missing:
            extra_seed_objs = list_channels(y, missing)
    ch_objs = ch_objs + extra_seed_objs

    # Deduplicate by channel id
    uniq = {}
    for ch in ch_objs:
        cid = ch.get("id")
        if cid and cid not in uniq:
            uniq[cid] = ch
    ch_objs = list(uniq.values())

    # Filter by Kenya + thresholds and compute features
    features: List[ChannelFeatures] = []
    for ch in ch_objs:
        cid = ch.get("id") or ""
        if not cid or cid in blocked: 
            continue
        feat = extract_features(y, ch)
        if feat:
            features.append(feat)

    if not features:
        # fallback: just write seeds minimally with rank by subs
        seed_objs = list_channels(y, list(seed_ids)) if seed_ids else []
        for ch in seed_objs:
            cid = ch.get("id") or ""
            if not cid or cid in blocked: continue
            sn = ch.get("snippet", {}) or {}
            stats = ch.get("statistics", {}) or {}
            features.append(ChannelFeatures(
                cid=cid,
                name=sn.get("title","") or "",
                url=f"https://www.youtube.com/channel/{cid}",
                subscribers=to_int(stats.get("subscriberCount")),
                video_count=to_int(stats.get("videoCount")),
                views_total=to_int(stats.get("viewCount")),
                uploads_90d=0, days_since_last=9999.0
            ))

    # Score + rank
    scores = compute_scores(features)
    ranked = list(zip(features, scores))
    ranked.sort(key=lambda t: t[1], reverse=True)
    ranked = ranked[:500]

    # Write CSV (rank + id + name)
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["rank","channel_id","channel_name"])
        for i, (feat, _) in enumerate(ranked, 1):
            w.writerow([i, feat.cid, feat.name])

    print(f"[KE500] wrote {args.out} with {len(ranked)} channels")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        sys.exit(f"[KE500] ERROR: {e}")
