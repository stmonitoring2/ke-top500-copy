#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
KE Top 500 weekly rebuild:
- Prefer long-form newest video per channel with strong content filters
- BUT: seed channels are allowlisted (bypass KE/subs/views floors) so they don’t vanish
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timezone, timedelta
from typing import Iterable, List, Optional, Set

try:
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
except Exception:
    print("[KE500] ERROR: google-api-python-client not installed. pip install google-api-python-client", file=sys.stderr)
    sys.exit(2)

# ---------------- tunables ----------------
SEED_IDS_PATH = "scripts/seed_channel_ids.txt"       # optional
BLOCKED_IDS_PATH = "blocked_channel_ids.txt" # optional

DISCOVERY_QUERIES = [
    "podcast kenya", "kenyan podcast", "nairobi podcast",
    "kenya talk show", "kenyan interviews", "JKLive",
    "The Trend NTV", "Cleaning The Airwaves",
    "Presenter Ali interview", "Obinna live",
    "MIC CHEQUE podcast", "Sandwich Podcast KE",
    "ManTalk Ke podcast",
]

# Frontend-mirrored filters
MIN_LONGFORM_SEC = 660                 # >= 11 minutes
MAX_VIDEO_AGE_DAYS = 365               # published within the last year
MIN_SUBSCRIBERS = 5_000                # floor for non-seed channels

# “high-performing” gates (only for non-seed channels)
MIN_CHANNEL_VIEWS = 2_000_000
MIN_VIDEO_VIEWS = 10_000

# Regex filters
SHORTS_RE = re.compile(r'(^|\W)(shorts?|#shorts)(\W|$)', re.I)
SPORTS_RE = re.compile(
    r'\b(highlights?|extended\s*highlights|FT|full\s*time|full\s*match|goal|matchday)\b'
    r'|\b(\d+\s*-\s*\d+)\b',
    re.I
)
CLUBS_RE = re.compile(r'\b(sportscast|manchester united|arsenal|liverpool|chelsea)\b', re.I)
SENSATIONAL_RE = re.compile(
    r'(catch(ing)?|expos(e|ing)|confront(ing)?|loyalty\s*test|loyalty\s*challenge|pop\s*the\s*balloon)',
    re.I
)
MIX_RE = re.compile(
    r'\b(dj\s*mix|dj\s*set|mix\s*tape|mixtape|mixshow|party\s*mix|afrobeat\s*mix|bongo\s*mix|kenyan\s*mix|live\s*mix)\b',
    re.I
)
TAG_BLOCKS = {
    "#sportshighlights", "#sports", "#highlights", "#shorts", "#short",
    "sportshighlights", "sports", "highlights", "shorts", "short",
}

KENYA_HINTS_RE = re.compile(r'\b(kenya|kenyan|nairob[iy]|mombasa|kisumu|ke\b)\b', re.I)
PODCAST_INTERVIEW_RE = re.compile(r'\b(podcast|interview|sit[-\s]?down|talk\s*show|conversation|panel)\b', re.I)

YOUTUBE_SEARCH_PAGE_SIZE = 50
PLAYLIST_FETCH_COUNT = 20   # look a bit deeper to catch latest longform
MAX_CHANNEL_BATCH = 50
MAX_VIDEO_BATCH = 50

# ---------------- utils ----------------

def now_utc_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

_DURATION_RE = re.compile(r"^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$")

def iso8601_duration_to_seconds(s: Optional[str]) -> Optional[int]:
    if not s:
        return None
    m = _DURATION_RE.match(s)
    if not m:
        return None
    h = int(m.group(1) or 0); m_ = int(m.group(2) or 0); sec = int(m.group(3) or 0)
    return h * 3600 + m_ * 60 + sec

def load_lines(path: str) -> List[str]:
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        return [ln.strip() for ln in f if ln.strip() and not ln.strip().startswith("#")]

def chunked(seq: List[str], n: int) -> Iterable[List[str]]:
    for i in range(0, len(seq), n):
        yield seq[i:i+n]

def safe_get(d: dict, path: List[str], default=None):
    cur = d
    for key in path:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(key)
        if cur is None:
            return default
    return cur

def to_int(x: Optional[str]) -> int:
    try:
        return int(x or "0")
    except Exception:
        return 0

# ---------------- model ----------------

@dataclass
class ChannelRow:
    rank: int
    channel_id: str
    channel_name: str
    channel_url: str
    subscribers: int
    video_count: int
    views_total: int
    country: str
    classification: str
    latest_video_id: str
    latest_video_title: str
    latest_video_thumbnail: str
    latest_video_published_at: str
    latest_video_duration_sec: Optional[int]
    latest_video_views: Optional[int]

# ---------------- YouTube helpers ----------------

def yt_client() -> any:
    api_key = os.environ.get("YT_API_KEY")
    if not api_key:
        print("[KE500] ERROR: YT_API_KEY env var missing", file=sys.stderr)
        sys.exit(2)
    return build("youtube", "v3", developerKey=api_key, cache_discovery=False)

def discover_channel_ids(youtube, queries: List[str], max_new: int) -> Set[str]:
    out: Set[str] = set()
    for q in queries:
        try:
            print(f"[KE500] Discovering q='{q}' ...")
            res = youtube.search().list(
                part="snippet",
                q=q,
                type="channel",
                maxResults=min(YOUTUBE_SEARCH_PAGE_SIZE, max_new - len(out))
            ).execute()
            for item in res.get("items", []):
                cid = safe_get(item, ["snippet", "channelId"]) or item.get("id", {}).get("channelId")
                if cid:
                    out.add(cid)
            if len(out) >= max_new:
                break
        except HttpError as e:
            print(f"[KE500] WARN: discovery stopped early: {e}")
            break
        except Exception as e:
            print(f"[KE500] WARN: discovery error: {e}")
            break
        time.sleep(0.1)
    return out

def list_channels(youtube, channel_ids: List[str]) -> List[dict]:
    items: List[dict] = []
    for batch in chunked(channel_ids, MAX_CHANNEL_BATCH):
        try:
            res = youtube.channels().list(
                part="snippet,statistics,contentDetails,brandingSettings",
                id=",".join(batch),
                maxResults=MAX_CHANNEL_BATCH
            ).execute()
            items.extend(res.get("items", []))
        except HttpError as e:
            print(f"[KE500] WARN: channels.list failed for batch {batch[0]}:{batch[-1]}: {e}")
        time.sleep(0.1)
    return items

def list_playlist_items(youtube, playlist_id: str, max_items: int) -> List[str]:
    out: List[str] = []
    page_token = None
    while len(out) < max_items:
        try:
            res = youtube.playlistItems().list(
                part="contentDetails",
                playlistId=playlist_id,
                maxResults=min(50, max_items - len(out)),
                pageToken=page_token
            ).execute()
            for it in res.get("items", []):
                vid = safe_get(it, ["contentDetails", "videoId"])
                if vid:
                    out.append(vid)
            page_token = res.get("nextPageToken")
            if not page_token:
                break
        except HttpError as e:
            print(f"[KE500] WARN: playlistItems.list failed for {playlist_id}: {e}")
            break
        time.sleep(0.1)
    return out

def list_videos(youtube, video_ids: List[str]) -> List[dict]:
    out: List[dict] = []
    for batch in chunked(video_ids, MAX_VIDEO_BATCH):
        try:
            res = youtube.videos().list(
                part="snippet,contentDetails,statistics",
                id=",".join(batch),
                maxResults=MAX_VIDEO_BATCH
            ).execute()
            out.extend(res.get("items", []))
        except HttpError as e:
            print(f"[KE500] WARN: videos.list failed for batch size {len(batch)}: {e}")
        time.sleep(0.1)
    return out

# ---------------- filtering ----------------

def looks_blocked_by_text(title: str, desc: str) -> bool:
    if SHORTS_RE.search(title) or SHORTS_RE.search(desc): return True
    if SPORTS_RE.search(title) or SPORTS_RE.search(desc): return True
    if CLUBS_RE.search(title) or CLUBS_RE.search(desc): return True
    if SENSATIONAL_RE.search(title) or SENSATIONAL_RE.search(desc): return True
    if MIX_RE.search(title) or MIX_RE.search(desc): return True
    return False

def looks_blocked_by_tags(tags: Optional[List[str]]) -> bool:
    if not tags: return False
    for t in tags:
        tl = t.lower().strip()
        if tl in TAG_BLOCKS or any(tb in tl for tb in TAG_BLOCKS): return True
    return False

def too_old(published_at: str, max_days: int = MAX_VIDEO_AGE_DAYS) -> bool:
    if not published_at: return False
    try:
        dt = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
        return dt < (datetime.now(timezone.utc) - timedelta(days=max_days))
    except Exception:
        return False

def choose_latest_longform_video(video_items: List[dict], relax_views: bool) -> Optional[dict]:
    """Pick newest video that passes duration/text/tag/age (+views unless relax_views=True)."""
    def published_at(v: dict) -> str:
        return safe_get(v, ["snippet", "publishedAt"], "") or ""

    video_items = sorted(video_items, key=published_at, reverse=True)
    for v in video_items:
        vid = v.get("id")
        title = safe_get(v, ["snippet", "title"], "") or ""
        desc = safe_get(v, ["snippet", "description"], "") or ""
        tags = safe_get(v, ["snippet", "tags"], []) or []
        dur_iso = safe_get(v, ["contentDetails", "duration"], None)
        dur_sec = iso8601_duration_to_seconds(dur_iso)
        views = to_int(safe_get(v, ["statistics", "viewCount"], "0"))
        pub = published_at(v)

        if dur_sec is not None and dur_sec < MIN_LONGFORM_SEC: continue
        if looks_blocked_by_text(title, desc): continue
        if looks_blocked_by_tags(tags): continue
        if too_old(pub): continue
        if not relax_views and views < MIN_VIDEO_VIEWS: continue

        thumb = safe_get(v, ["snippet", "thumbnails", "medium", "url"], "") or \
                safe_get(v, ["snippet", "thumbnails", "high", "url"], "") or ""

        return {
            "id": vid or "",
            "title": title,
            "thumb": thumb,
            "publishedAt": pub,
            "duration_sec": dur_sec,
            "views": views,
        }
    return None

def classify_channel_text(name: str, desc: str) -> str:
    text = f"{name}\n{desc}"
    if PODCAST_INTERVIEW_RE.search(text):
        if re.search(r'\bpodcast\b', text, re.I): return "podcast"
        if re.search(r'\binterview(s)?\b', text, re.I): return "interview"
        return "podcast"
    return "other"

def is_kenyan_channel(snippet: dict, branding: dict) -> bool:
    country = (safe_get(branding, ["channel", "country"], "") or "").upper()
    if country == "KE": return True
    name = (snippet.get("title") or ""); desc = (snippet.get("description") or "")
    if KENYA_HINTS_RE.search(name) or KENYA_HINTS_RE.search(desc): return True
    return False

# ---------------- main build ----------------

def build_rows(youtube, channel_ids: List[str], blocked_ids: Set[str], allowlist: Set[str]) -> List[ChannelRow]:
    channels = list_channels(youtube, channel_ids)
    print(f"[KE500] Got stats for: {len(channels)} channels")

    rows: List[ChannelRow] = []

    for ch in channels:
        cid = ch.get("id") or ""
        if not cid or cid in blocked_ids:
            continue

        snippet = ch.get("snippet", {}) or {}
        stats = ch.get("statistics", {}) or {}
        branding = ch.get("brandingSettings", {}) or {}
        content = ch.get("contentDetails", {}) or {}

        is_seed = cid in allowlist

        # KE filter (skip for seeds)
        if not is_seed and not is_kenyan_channel(snippet, branding):
            continue

        subs = to_int(stats.get("subscriberCount"))
        total_views = to_int(stats.get("viewCount"))
        vcount = to_int(stats.get("videoCount"))

        # floors (skip for seeds)
        if not is_seed and subs < MIN_SUBSCRIBERS:
            continue
        if not is_seed and total_views < MIN_CHANNEL_VIEWS:
            continue

        uploads_playlist = safe_get(content, ["relatedPlaylists", "uploads"], None)
        if not uploads_playlist:
            continue

        upload_vids = list_playlist_items(youtube, uploads_playlist, PLAYLIST_FETCH_COUNT)
        if not upload_vids:
            continue

        vid_items = list_videos(youtube, upload_vids)
        chosen = choose_latest_longform_video(vid_items, relax_views=is_seed)
        if not chosen or not chosen.get("id"):
            continue

        classification = classify_channel_text(snippet.get("title", "") or "", snippet.get("description", "") or "")
        country = (safe_get(branding, ["channel", "country"], "") or "").upper()

        rows.append(ChannelRow(
            rank=0,
            channel_id=cid,
            channel_name=snippet.get("title", "") or "",
            channel_url=f"https://www.youtube.com/channel/{cid}",
            subscribers=subs,
            video_count=vcount,
            views_total=total_views,
            country=country,
            classification=classification,
            latest_video_id=chosen["id"],
            latest_video_title=chosen["title"],
            latest_video_thumbnail=chosen["thumb"],
            latest_video_published_at=chosen["publishedAt"],
            latest_video_duration_sec=chosen["duration_sec"],
            latest_video_views=chosen["views"],
        ))

    print(f"[KE500] After filters: {len(rows)} channels")

    rows.sort(key=lambda r: (r.subscribers, r.views_total, r.video_count), reverse=True)
    for i, r in enumerate(rows, start=1):
        r.rank = i

    return rows

def write_csv(path: str, rows: List[ChannelRow]) -> None:
    fieldnames = [
        "rank","channel_id","channel_name","channel_url",
        "subscribers","video_count","views_total","country","classification",
        "latest_video_id","latest_video_title","latest_video_thumbnail",
        "latest_video_published_at","latest_video_duration_sec","latest_video_views",
        "generated_at_utc",
    ]
    gen = now_utc_iso()
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            d = asdict(r); d["generated_at_utc"] = gen; w.writerow(d)

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--out", default="public/top500_ranked.csv", help="Output CSV path")
    p.add_argument("--discover", default="false", choices=["true","false"])
    p.add_argument("--max_new", type=int, default=1500)
    args = p.parse_args()

    youtube = yt_client()

    seed_ids = set(load_lines(SEED_IDS_PATH))
    blocked_ids: Set[str] = set(load_lines(BLOCKED_IDS_PATH))

    discovered: Set[str] = set()
    if args.discover.lower() == "true":
        discovered = discover_channel_ids(youtube, DISCOVERY_QUERIES, max_new=args.max_new)

    all_ids = list(dict.fromkeys(list(seed_ids) + list(discovered)))
    print(f"[KE500] Seeds: {len(seed_ids)}  Discovered: {len(discovered)}  Total: {len(all_ids)}")

    rows = build_rows(youtube, all_ids, blocked_ids, allowlist=seed_ids)
    rows = rows[:500]
    write_csv(args.out, rows)

    print(f"[KE500] Wrote: {args.out}")
    try:
        import pandas as pd  # type: ignore
        df = pd.read_csv(args.out)
        print("---- top500_ranked.csv (head) ----")
        print(df.head().to_string(index=False))
    except Exception:
        pass

if __name__ == "__main__":
    try:
        main()
    except HttpError as e:
        print(f"[KE500] ERROR: YouTube API error: {e}", file=sys.stderr); sys.exit(1)
    except KeyboardInterrupt:
        print("[KE500] Aborted."); sys.exit(130)
    except Exception as e:
        print(f"[KE500] ERROR: {e}", file=sys.stderr); sys.exit(1)
