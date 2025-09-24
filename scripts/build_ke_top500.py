#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Builds the KE Top 500 CSV by fetching YouTube channel stats and latest longform video,
with extra filters to avoid shorts, sports highlights, “pop the balloon” style videos,
and DJ mixes/mixtapes.

Usage examples:
  python scripts/build_ke_top500.py --out top500_ranked.csv
  python scripts/build_ke_top500.py --out top500_ranked.csv --discover true --max_new 1500
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Set, Tuple

# googleapiclient
try:
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
except Exception:
    print("[KE500] ERROR: google-api-python-client not installed. pip install google-api-python-client", file=sys.stderr)
    sys.exit(2)

# -------------- tunables --------------

# Root-relative file paths (keep as-is for your repo layout)
SEED_IDS_PATH = "seed_channel_ids.txt"            # optional
BLOCKED_IDS_PATH = "blocked_channel_ids.txt"      # optional

DISCOVERY_QUERIES = [
    "podcast kenya", "kenyan podcast", "nairobi podcast",
    "kenya talk show", "kenyan interviews", "JKLive",
    "The Trend NTV", "Cleaning The Airwaves",
    "Presenter Ali interview", "Obinna live",
    "MIC CHEQUE podcast", "Sandwich Podcast KE",
    "ManTalk Ke podcast",
]

# Heuristics/filters
MIN_LONGFORM_SEC = 660  # 5 minutes minimum

# Short content
SHORTS_RE = re.compile(r'(^|\W)(shorts?|#shorts)(\W|$)', re.I)

# Sports/highlights (title/description)
SPORTS_RE = re.compile(
    r'\b(highlights?|extended\s*highlights|FT|full\s*time|full\s*match|goal|matchday)\b'
    r'|\b(\d+\s*-\s*\d+)\b',  # scorelines like 2-1
    re.I
)

# Sensational / “loyalty test” / “pop the balloon” style
SENSATIONAL_RE = re.compile(
    r'(catch(ing)?|expos(e|ing)|confront(ing)?|loyalty\s*test|loyalty\s*challenge|pop\s*the\s*balloon)',
    re.I
)

# DJ mixes / mixtapes / sets
MIX_RE = re.compile(
    r'\b(dj\s*mix|dj\s*set|mix\s*tape|mixtape|mixshow|party\s*mix|afrobeat\s*mix|bongo\s*mix|kenyan\s*mix|live\s*mix)\b',
    re.I
)

# Tag-based blocks (lowercased match)
TAG_BLOCKS = {
    "#sportshighlights", "#sports", "#highlights", "#shorts", "#short",
    "sportshighlights", "sports", "highlights", "shorts", "short",
}

# "Kenya-ness" heuristic (country code preferred, fallback on strings)
KENYA_HINTS_RE = re.compile(r'\b(kenya|kenyan|nairob[iy]|mombasa|kisumu|ke\b)\b', re.I)

# classification heuristics
PODCAST_INTERVIEW_RE = re.compile(r'\b(podcast|interview|sit[-\s]?down|talk\s*show|conversation|panel)\b', re.I)

# pagination limits / safety
YOUTUBE_SEARCH_PAGE_SIZE = 50
PLAYLIST_FETCH_COUNT = 10   # check up to N most recent uploads per channel when choosing latest longform
MAX_CHANNEL_BATCH = 50      # channels.list limit
MAX_VIDEO_BATCH = 50        # videos.list limit

# -------------- small utils --------------

def now_utc_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

_DURATION_RE = re.compile(r"^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$")

def iso8601_duration_to_seconds(s: Optional[str]) -> Optional[int]:
    if not s:
        return None
    m = _DURATION_RE.match(s)
    if not m:
        return None
    h = int(m.group(1) or 0)
    m_ = int(m.group(2) or 0)
    sec = int(m.group(3) or 0)
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

# -------------- data model --------------

@dataclass
class ChannelRow:
    rank: int
    channel_id: str
    channel_name: str
    channel_url: str
    subscribers: int
    video_count: int
    country: str
    classification: str  # "podcast" | "interview" | "other"
    latest_video_id: str
    latest_video_title: str
    latest_video_thumbnail: str
    latest_video_published_at: str
    latest_video_duration_sec: Optional[int]

# -------------- youtube helpers --------------

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
            # stop discovery on quota or any 4xx
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
            # keep going (likely quota)
        time.sleep(0.1)
    return items

def list_playlist_items(youtube, playlist_id: str, max_items: int) -> List[str]:
    """Return up to max_items video IDs from a playlist."""
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

# -------------- filtering --------------

def looks_blocked_by_text(title: str, desc: str) -> bool:
    """Return True if the text clearly indicates unwanted content."""
    if SHORTS_RE.search(title) or SHORTS_RE.search(desc):
        return True
    if SPORTS_RE.search(title) or SPORTS_RE.search(desc):
        return True
    if SENSATIONAL_RE.search(title) or SENSATIONAL_RE.search(desc):
        return True
    if MIX_RE.search(title) or MIX_RE.search(desc):
        return True
    return False

def looks_blocked_by_tags(tags: Optional[List[str]]) -> bool:
    if not tags:
        return False
    for t in tags:
        tl = t.lower().strip()
        if tl in TAG_BLOCKS or any(tb in tl for tb in TAG_BLOCKS):
            return True
    return False

def choose_latest_longform_video(video_items: List[dict]) -> Optional[dict]:
    """
    Pick the newest video that:
      - has duration >= 5min (if known)
      - doesn't look like #shorts
      - isn't obvious sports highlight or sensational 'loyalty tests/pop the balloon'
      - isn't a DJ mix/mixtape
      - and whose tags don't include #sportshighlights/#shorts/#highlights/etc.
    Returns a dict with id,title,thumb,publishedAt,duration_sec; or None.
    """
    # Newest first
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

        # duration gate
        if dur_sec is not None and dur_sec < MIN_LONGFORM_SEC:
            continue

        # text-based blocks
        if looks_blocked_by_text(title, desc):
            continue

        # tag-based blocks
        if looks_blocked_by_tags(tags):
            continue

        thumb = safe_get(v, ["snippet", "thumbnails", "medium", "url"], "") or \
                safe_get(v, ["snippet", "thumbnails", "high", "url"], "") or ""

        return {
            "id": vid or "",
            "title": title,
            "thumb": thumb,
            "publishedAt": published_at(v),
            "duration_sec": dur_sec,
        }
    return None

def classify_channel_text(name: str, desc: str) -> str:
    """Very lightweight classification: 'podcast' | 'interview' | 'other'."""
    text = f"{name}\n{desc}"
    if PODCAST_INTERVIEW_RE.search(text):
        # prefer "podcast" if that word appears, else "interview"
        if re.search(r'\bpodcast\b', text, re.I):
            return "podcast"
        if re.search(r'\binterview(s)?\b', text, re.I):
            return "interview"
        return "podcast"
    return "other"

def is_kenyan_channel(snippet: dict, branding: dict) -> bool:
    country = (safe_get(branding, ["channel", "country"], "") or "").upper()
    if country == "KE":
        return True
    name = (snippet.get("title") or "")
    desc = (snippet.get("description") or "")
    if KENYA_HINTS_RE.search(name) or KENYA_HINTS_RE.search(desc):
        return True
    return False

# -------------- main build logic --------------

def build_rows(youtube, channel_ids: List[str], blocked_ids: Set[str]) -> List[ChannelRow]:
    # 1) channel metadata
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

        # country / KE filter
        if not is_kenyan_channel(snippet, branding):
            continue

        # gather uploads and pick latest longform
        uploads_playlist = safe_get(content, ["relatedPlaylists", "uploads"], None)
        if not uploads_playlist:
            continue
        upload_vids = list_playlist_items(youtube, uploads_playlist, PLAYLIST_FETCH_COUNT)
        if not upload_vids:
            continue
        vid_items = list_videos(youtube, upload_vids)
        chosen = choose_latest_longform_video(vid_items)
        if not chosen or not chosen.get("id"):
            # no acceptable latest video
            continue

        # classification
        classification = classify_channel_text(
            name=snippet.get("title", "") or "",
            desc=snippet.get("description", "") or ""
        )

        subs = to_int(stats.get("subscriberCount"))
        vcount = to_int(stats.get("videoCount"))
        country = (safe_get(branding, ["channel", "country"], "") or "").upper()

        rows.append(ChannelRow(
            rank=0,  # fill later
            channel_id=cid,
            channel_name=snippet.get("title", "") or "",
            channel_url=f"https://www.youtube.com/channel/{cid}",
            subscribers=subs,
            video_count=vcount,
            country=country,
            classification=classification,
            latest_video_id=chosen["id"],
            latest_video_title=chosen["title"],
            latest_video_thumbnail=chosen["thumb"],
            latest_video_published_at=chosen["publishedAt"],
            latest_video_duration_sec=chosen["duration_sec"],
        ))

    print(f"[KE500] After KE filter: {len(rows)} channels")
    # 2) rank by subscribers desc (tie-breaker: video_count desc)
    rows.sort(key=lambda r: (r.subscribers, r.video_count), reverse=True)
    for i, r in enumerate(rows, start=1):
        r.rank = i

    return rows

def write_csv(path: str, rows: List[ChannelRow]) -> None:
    fieldnames = [
        "rank",
        "channel_id",
        "channel_name",
        "channel_url",
        "subscribers",
        "video_count",
        "country",
        "classification",
        "latest_video_id",
        "latest_video_title",
        "latest_video_thumbnail",
        "latest_video_published_at",
        "latest_video_duration_sec",
        "generated_at_utc",
    ]
    gen = now_utc_iso()
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            d = asdict(r)
            d["generated_at_utc"] = gen
            w.writerow(d)

# -------------- CLI --------------

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--out", default="top500_ranked.csv", help="Output CSV path")
    p.add_argument("--discover", default="false", choices=["true", "false"], help="Run discovery to find more channels")
    p.add_argument("--max_new", type=int, default=1500, help="Max new channels to discover")
    args = p.parse_args()

    youtube = yt_client()

    # seeds
    seed_ids = load_lines(SEED_IDS_PATH)
    # blocklist
    blocked_ids: Set[str] = set(load_lines(BLOCKED_IDS_PATH))

    # (optional) discovery
    discovered: Set[str] = set()
    if args.discover.lower() == "true":
        discovered = discover_channel_ids(youtube, DISCOVERY_QUERIES, max_new=args.max_new)

    # combine + de-dup
    all_ids = list(dict.fromkeys(list(seed_ids) + list(discovered)))
    print(f"[KE500] Seed+cache channel IDs: {len(seed_ids)}")
    print(f"[KE500] Discovered IDs this run: {len(discovered)}")
    print(f"[KE500] Total unique IDs to evaluate: {len(all_ids)}")

    # build rows
    rows = build_rows(youtube, all_ids, blocked_ids)

    # keep top 500 max
    rows = rows[:500]

    # write
    write_csv(args.out, rows)

    print(f"[KE500] Wrote: {args.out}")
    # show head (like your CI echo)
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
        # Surface a clean error (useful in CI)
        print(f"[KE500] ERROR: YouTube API error: {e}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("[KE500] Aborted.")
        sys.exit(130)
    except Exception as e:
        print(f"[KE500] ERROR: {e}", file=sys.stderr)
        sys.exit(1)
