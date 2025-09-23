#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Build KE Top 500 (podcasts & interview-style channels).

Features
- Reads API key from env YT_API_KEY.
- Sources channel ids from:
    * seeds/seed_channel_ids.txt (optional)
    * existing top500_ranked.csv (optional; to retain known channels)
    * discovery (optional; --discover true) via YouTube search
- Applies blocklists:
    * blocked_channel_ids.txt (optional)
    * blocked_keywords.txt (optional; title/channel text match)
- Fetches channel stats + uploads, walks back to find a long-form latest video
  (>= --min_duration_sec, default 300s) and avoids obvious Shorts.
- Applies additional heuristic filters to weed out highlight/sensational channels.
- Ranks by subscribers (desc) then by recent activity recency.
- Writes normalized CSV for the frontend.

Usage
  python scripts/build_ke_top500.py --out top500_ranked.csv --max_new 1500 --discover true
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Tuple

import pandas as pd
import requests


YOUTUBE_API = "https://www.googleapis.com/youtube/v3"
API_KEY = os.environ.get("YT_API_KEY", "").strip()


# ------------------------ Utilities ------------------------

def log(msg: str) -> None:
    print(f"[KE500] {msg}", flush=True)


def warn(msg: str) -> None:
    print(f"[KE500] WARN: {msg}", flush=True)


def epoch_utc_iso(dt: Optional[str]) -> str:
    if not dt:
        return ""
    try:
        # YouTube returns RFC3339 timestamps
        return datetime.fromisoformat(dt.replace("Z", "+00:00")).astimezone(timezone.utc).isoformat()
    except Exception:
        return ""


DUR_RX = re.compile(
    r"^P(?:(?P<days>\d+)D)?(?:T(?:(?P<hours>\d+)H)?(?:(?P<minutes>\d+)M)?(?:(?P<seconds>\d+)S)?)?$"
)

def parse_iso8601_duration(d: str) -> int:
    """
    'PT5M12S' -> 312 seconds. Returns 0 on failure.
    """
    if not d:
        return 0
    m = DUR_RX.match(d)
    if not m:
        return 0
    parts = {k: int(v) if v else 0 for k, v in m.groupdict().items()}
    td = timedelta(
        days=parts["days"],
        hours=parts["hours"],
        minutes=parts["minutes"],
        seconds=parts["seconds"],
    )
    return int(td.total_seconds())


def looks_like_shorts(title: str) -> bool:
    t = (title or "").lower()
    return "shorts" in t or "#shorts" in t


# Sensational/sports highlight heuristics (coarse; can be tuned)
SENSATIONAL_PATTERNS = [
    r"catch(?:ing)?\s+(?:a\s+)?(?:cheat|spouse)\b",
    r"cheaters?\b",
    r"phone\s+check\b",
    r"loyalty\s+test",
    r"exposed\b",
    r"drama\b",
    r"scandal\b",
]
SENSATIONAL_RX = re.compile("|".join(SENSATIONAL_PATTERNS), re.IGNORECASE)

SPORTS_PATTERNS = [
    r"\bhighlights?\b",
    r"\bmatch\b",
    r"\bg(?:oal|oals)\b",
    r"\b(game|fixture|derby)\b",
    r"\bnba\b|\bepl\b|\bserie a\b|\blaliga\b|\bbundesliga\b|\bufa\b",
    r"\bfootball\b|\bsoccer\b|\bbasketball\b",
]
SPORTS_RX = re.compile("|".join(SPORTS_PATTERNS), re.IGNORECASE)


def is_non_target_channel(name: str, desc: str) -> bool:
    blob = f"{name or ''} {desc or ''}".lower()
    if SENSATIONAL_RX.search(blob):
        return True
    if SPORTS_RX.search(blob):
        return True
    return False


def title_is_non_target(title: str) -> bool:
    if SENSATIONAL_RX.search(title or ""):
        return True
    if SPORTS_RX.search(title or ""):
        return True
    return False


# ------------------------ API Thin Client ------------------------

def yt_get(endpoint: str, params: Dict) -> Dict:
    """
    GET helper with API key and basic 403/429 tolerance.
    """
    if not API_KEY:
        raise RuntimeError("Missing YT_API_KEY")
    url = f"{YOUTUBE_API}/{endpoint}"
    q = dict(params or {})
    q["key"] = API_KEY
    r = requests.get(url, params=q, timeout=30)
    if r.status_code in (403, 429):
        # Bubble up with a descriptive error so caller can stop discovery early.
        raise RuntimeError(f"quotaExceeded or forbidden: {r.status_code} - {r.text[:200]}")
    r.raise_for_status()
    return r.json()


def search_channels(query: str, max_results: int = 50, region_code: str = "KE") -> List[str]:
    """
    Discover channel IDs for a query.
    """
    ids: List[str] = []
    try:
        resp = yt_get(
            "search",
            {
                "part": "snippet",
                "q": query,
                "type": "channel",
                "maxResults": max_results,
                "regionCode": region_code,
            },
        )
        for item in resp.get("items", []):
            cid = item["snippet"].get("channelId") or item.get("id", {}).get("channelId")
            if cid:
                ids.append(cid)
    except Exception as e:
        warn(f"discovery stopped early: {e}")
    return ids


def get_channels(channel_ids: List[str]) -> List[Dict]:
    out: List[Dict] = []
    for i in range(0, len(channel_ids), 50):
        batch = channel_ids[i : i + 50]
        try:
            resp = yt_get(
                "channels",
                {"part": "snippet,statistics,contentDetails,brandingSettings", "id": ",".join(batch)},
            )
        except Exception as e:
            warn(f"channels.list failed for batch {i}:{i+50}: {e}")
            continue
        out.extend(resp.get("items", []))
        time.sleep(0.1)
    return out


def get_playlist_items(playlist_id: str, max_items: int = 25) -> List[Dict]:
    items: List[Dict] = []
    page_token = None
    try:
        while len(items) < max_items:
            resp = yt_get(
                "playlistItems",
                {
                    "part": "snippet,contentDetails",
                    "playlistId": playlist_id,
                    "maxResults": min(50, max_items - len(items)),
                    "pageToken": page_token or "",
                },
            )
            items.extend(resp.get("items", []))
            page_token = resp.get("nextPageToken")
            if not page_token:
                break
            time.sleep(0.1)
    except Exception as e:
        warn(f"playlistItems failed: {e}")
    return items


def get_videos(video_ids: List[str]) -> Dict[str, Dict]:
    """
    Returns dict id -> video resource (snippet, contentDetails).
    """
    out: Dict[str, Dict] = {}
    for i in range(0, len(video_ids), 50):
        batch = video_ids[i : i + 50]
        try:
            resp = yt_get(
                "videos",
                {"part": "snippet,contentDetails", "id": ",".join(batch)},
            )
        except Exception as e:
            warn(f"videos.list failed for batch {i}:{i+50}: {e}")
            continue
        for it in resp.get("items", []):
            vid = it.get("id")
            if vid:
                out[vid] = it
        time.sleep(0.1)
    return out


# ------------------------ Data Model ------------------------

@dataclass
class ChannelRow:
    rank: int
    channel_id: str
    channel_url: str
    channel_name: str
    channel_description: str
    subscribers: int
    video_count: int
    views_total: int
    country: str

    latest_video_id: str
    latest_video_title: str
    latest_video_thumbnail: str
    latest_video_published_at: str
    latest_video_duration_sec: int

    discovered_via: str  # seed|cached|discovery|existing


# ------------------------ I/O helpers ------------------------

def read_lines_if_exists(path: str) -> List[str]:
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        return [ln.strip() for ln in f if ln.strip() and not ln.strip().startswith("#")]


def load_existing_channel_ids_from_csv(out_csv_path: str) -> List[str]:
    if not os.path.exists(out_csv_path):
        return []
    try:
        df = pd.read_csv(out_csv_path)
        ids = [str(x) for x in df.get("channel_id", []) if pd.notna(x)]
        return list(dict.fromkeys(ids))
    except Exception:
        return []


def normalize_int(x) -> int:
    try:
        return int(str(x).replace(",", ""))
    except Exception:
        return 0


# ------------------------ Core build ------------------------

def pick_latest_longform_video(uploads_playlist_id: str, min_seconds: int) -> Tuple[str, Dict]:
    """
    Walk uploads newest -> older and return first acceptable long-form video.
    Returns (video_id, video_resource) or ("", {}).
    """
    if not uploads_playlist_id:
        return "", {}

    pl_items = get_playlist_items(uploads_playlist_id, max_items=30)
    candidates = [it.get("contentDetails", {}).get("videoId") for it in pl_items if it.get("contentDetails")]
    candidates = [c for c in candidates if c]

    if not candidates:
        return "", {}

    vmap = get_videos(candidates)

    chosen = ""
    chosen_resource: Dict = {}
    for vid in candidates:
        v = vmap.get(vid)
        if not v:
            continue
        cd = v.get("contentDetails", {}) or {}
        sn = v.get("snippet", {}) or {}
        dur = parse_iso8601_duration(cd.get("duration", ""))
        title = sn.get("title", "") or ""

        if dur < min_seconds:
            continue
        if looks_like_shorts(title):
            continue
        if title_is_non_target(title):
            continue

        chosen = vid
        chosen_resource = v
        break

    return chosen, chosen_resource


def build(
    out_path: str,
    max_new: int,
    discover: bool,
    min_duration_sec: int,
) -> None:
    if not API_KEY:
        raise SystemExit("ENV YT_API_KEY is required.")

    # 1) Gather initial candidate channel IDs
    seeds = read_lines_if_exists("seeds/seed_channel_ids.txt")
    existing_ids = load_existing_channel_ids_from_csv(out_path)
    candidates: List[Tuple[str, str]] = []  # (id, source)

    for cid in seeds:
        candidates.append((cid, "seed"))
    for cid in existing_ids:
        candidates.append((cid, "existing"))

    # Optional discovery
    if discover:
        queries = [
            "podcast kenya",
            "kenyan podcast",
            "nairobi podcast",
            "kenya talk show",
            "kenyan interviews",
            "JKLive",
            "The Trend NTV",
            "Cleaning The Airwaves",
            "Presenter Ali interview",
            "Obinna live",
            "MIC CHEQUE podcast",
            "Sandwich Podcast KE",
            "ManTalk Ke podcast",
        ]
        for q in queries:
            log(f"Discovering q='{q}' ...")
            ids = search_channels(q, max_results=50, region_code="KE")
            for cid in ids:
                candidates.append((cid, "discovery"))
            # tiny delay to be nice
            time.sleep(0.1)

    # De-dup (keep first source label encountered)
    dedup: Dict[str, str] = {}
    for cid, src in candidates:
        if cid not in dedup:
            dedup[cid] = src

    # Hard limit on how many (API cost control)
    all_ids = list(dedup.keys())[: max_new or 1500]
    log(f"Seed+cache+discovery channel IDs (pre-filter): {len(all_ids)}")

    # Apply channel-id blocklist early
    blocked_ids = set(read_lines_if_exists("blocked_channel_ids.txt"))
    all_ids = [cid for cid in all_ids if cid not in blocked_ids]

    if not all_ids:
        warn("No candidate channels after blocklist.")
        # still write an empty file with header to avoid frontend errors
        write_output(out_path, [])
        return

    # 2) Fetch channel resources
    ch_resources = get_channels(all_ids)
    log(f"Got stats for: {len(ch_resources)} channels")

    # 3) Build rows with latest acceptable long-form video
    blocked_kw = [s.lower() for s in read_lines_if_exists("blocked_keywords.txt")]
    rows: List[ChannelRow] = []

    for ch in ch_resources:
        cid = ch.get("id", "")
        snippet = ch.get("snippet", {}) or {}
        stats = ch.get("statistics", {}) or {}
        branding = ch.get("brandingSettings", {}) or {}
        details = ch.get("contentDetails", {}) or {}
        desc = snippet.get("description", "") or ""
        name = snippet.get("title", "") or ""
        country = snippet.get("country", "") or branding.get("channel", {}).get("country", "")

        # Skip if basic heuristics say it's non-target (sports/sensational)
        if is_non_target_channel(name, desc):
            continue

        # Skip if any blocked keyword matches channel name/desc
        blob = f"{name} {desc}".lower()
        if any(kw in blob for kw in blocked_kw):
            continue

        uploads_pid = details.get("relatedPlaylists", {}).get("uploads")
        vid, vres = pick_latest_longform_video(uploads_pid, min_duration_sec)

        # If we failed to find a long-form video, keep the channel but unplayable
        latest_id = ""
        latest_title = ""
        latest_thumb = ""
        latest_published = ""
        latest_duration = 0
        if vid and vres:
            vsn = vres.get("snippet", {}) or {}
            vcd = vres.get("contentDetails", {}) or {}
            # Final check on title keyword blocks
            vt = vsn.get("title", "") or ""
            if any(kw in (vt.lower()) for kw in blocked_kw):
                # Treat as no valid video
                pass
            else:
                latest_id = vid
                latest_title = vt
                latest_published = epoch_utc_iso(vsn.get("publishedAt", ""))
                latest_duration = parse_iso8601_duration(vcd.get("duration", ""))
                thumbs = vsn.get("thumbnails", {}) or {}
                # pick best available
                for k in ("maxres", "standard", "high", "medium", "default"):
                    if thumbs.get(k, {}).get("url"):
                        latest_thumb = thumbs[k]["url"]
                        break

        row = ChannelRow(
            rank=0,  # set later
            channel_id=cid,
            channel_url=f"https://www.youtube.com/channel/{cid}",
            channel_name=name,
            channel_description=desc,
            subscribers=normalize_int(stats.get("subscriberCount", 0)),
            video_count=normalize_int(stats.get("videoCount", 0)),
            views_total=normalize_int(stats.get("viewCount", 0)),
            country=country or "KE",

            latest_video_id=latest_id,
            latest_video_title=latest_title,
            latest_video_thumbnail=latest_thumb,
            latest_video_published_at=latest_published,
            latest_video_duration_sec=latest_duration,

            discovered_via=dedup.get(cid, "seed"),
        )
        rows.append(row)

    # 4) Rank: by subscribers (desc), then by latest video recency (desc), then views_total
    def latest_dt(row: ChannelRow) -> float:
        try:
            if not row.latest_video_published_at:
                return 0.0
            return datetime.fromisoformat(row.latest_video_published_at.replace("Z", "+00:00")).timestamp()
        except Exception:
            return 0.0

    rows.sort(
        key=lambda r: (
            r.subscribers,
            latest_dt(r),
            r.views_total,
        ),
        reverse=True,
    )
    for i, r in enumerate(rows, start=1):
        r.rank = i

    write_output(out_path, rows)
    log(f"Wrote {len(rows)} rows -> {out_path}")


def write_output(path: str, rows: List[ChannelRow]) -> None:
    cols = [
        "rank",
        "channel_id",
        "channel_url",
        "channel_name",
        "channel_description",
        "subscribers",
        "video_count",
        "views_total",
        "country",
        "latest_video_id",
        "latest_video_title",
        "latest_video_thumbnail",
        "latest_video_published_at",
        "latest_video_duration_sec",
        "discovered_via",
        "generated_at_utc",
    ]
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols)
        now_utc = datetime.now(timezone.utc).isoformat()
        for r in rows:
            w.writerow(
                [
                    r.rank,
                    r.channel_id,
                    r.channel_url,
                    r.channel_name,
                    r.channel_description,
                    r.subscribers,
                    r.video_count,
                    r.views_total,
                    r.country,
                    r.latest_video_id,
                    r.latest_video_title,
                    r.latest_video_thumbnail,
                    r.latest_video_published_at,
                    r.latest_video_duration_sec,
                    r.discovered_via,
                    now_utc,
                ]
            )


# ------------------------ CLI ------------------------

def parse_bool(s: Optional[str]) -> bool:
    if s is None:
        return False
    return str(s).strip().lower() in {"1", "true", "yes", "y"}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="top500_ranked.csv", help="Output CSV path")
    ap.add_argument("--max_new", type=int, default=1500, help="Max candidate channels to evaluate")
    ap.add_argument("--discover", default="true", help="Run discovery (true/false)")
    ap.add_argument("--min_duration_sec", type=int, default=300, help="Minimum duration (seconds) for latest video")
    args = ap.parse_args()

    try:
        build(
            out_path=args.out,
            max_new=args.max_new,
            discover=parse_bool(args.discover),
            min_duration_sec=args.min_duration_sec,
        )
    except SystemExit:
        raise
    except Exception as e:
        warn(f"fatal: {e}")
        # Best-effort: write empty file to unblock frontend
        try:
            write_output(args.out, [])
        except Exception:
            pass
        sys.exit(1)


if __name__ == "__main__":
    main()
