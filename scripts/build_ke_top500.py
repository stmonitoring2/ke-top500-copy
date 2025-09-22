#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Build the KE Top 500 CSV from YouTube Data API v3.

- Discovers channels by seed + keyword search (optional).
- Gets channel stats + latest upload.
- Classifies podcast/interview channels and Kenya-leaning ones.
- Applies blocklist + heuristics to remove sports highlights & "cheater" content.
- Ranks and writes a tidy CSV.

Env:
  YT_API_KEY = <your key>

Example:
  python scripts/build_ke_top500.py --out top500_ranked.csv --max_new 1500 --discover true
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import pandas as pd

try:
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
except Exception as e:  # pragma: no cover
    print("[KE500] ERROR: googleapiclient is required. pip install google-api-python-client", file=sys.stderr)
    raise

# ----------------------------
# Config & constants
# ----------------------------

DEFAULT_OUT = "top500_ranked.csv"
DEFAULT_MAX_NEW = 1500
DEFAULT_DISCOVER = True
SEED_FILE = Path("seeds/ke_seed_channel_ids.txt")  # optional; one UC... per line
BLOCKLIST_FILE = Path("blocked_channel_ids.txt")   # optional; one UC... per line

# Queries we try for discovery (stop early if quota exceeded).
DISCOVERY_QUERIES = [
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

# Heuristics keywords
SPORTS_RE = re.compile(
    r"(highlights|(?:^|\s)vs(?:\s|$)|matchday|goal|goals|epl|premier league|laliga|serie a|bundesliga|uefa|fifa|afcon|caf|champions league|kpl|harambee stars)",
    re.I,
)
CHEATERS_RE = re.compile(
    r"(loyalty test|catch(?:ing)?\s+a\s+cheater|cheater|went through.*phone|checking phone|caught cheating|exposed)",
    re.I,
)
PODCAST_RE = re.compile(r"(podcast|sit ?down|interview|talk show|panel|roundtable|conversation|chats?)", re.I)
KENYA_RE = re.compile(r"\b(kenya|kenyan|nairobi|mombasa|kisumu|eldoret)\b", re.I)

# ----------------------------
# Utilities
# ----------------------------

def load_lines_file(p: Path) -> List[str]:
    if not p.exists():
        return []
    out: List[str] = []
    for line in p.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if s and not s.startswith("#"):
            out.append(s)
    return out


def load_blocked_ids() -> set[str]:
    return set(load_lines_file(BLOCKLIST_FILE))


def classify_text(title: str, description: str) -> str:
    """Simple text classifier: 'podcast', 'interview', or ''."""
    text = f"{title}\n{description}".lower()
    if re.search(r"\binterview(s)?\b", text):
        return "interview"
    if PODCAST_RE.search(text):
        return "podcast"
    # Very common KE talk formats
    if re.search(r"\b(talk|conversation|sit ?down)\b", text):
        return "interview"
    return ""


def is_kenya_leaning(snippet: dict, branding: dict) -> bool:
    """Prefer channels likely Kenyan: brandingSettings.channel.country == 'KE'
    or text mentions (Kenya/Nairobi/etc.)."""
    try:
        country = (branding or {}).get("channel", {}).get("country", "")
    except Exception:
        country = ""

    title = (snippet or {}).get("title", "") or ""
    description = (snippet or {}).get("description", "") or ""

    if (country or "").upper() == "KE":
        return True
    if KENYA_RE.search(title) or KENYA_RE.search(description):
        return True
    return False


def is_unwanted_row(row: dict) -> bool:
    """Weed out sports highlight + loyalty-test/cheater content."""
    text = " ".join(
        [
            str(row.get("channel_name", "")),
            str(row.get("latest_video_title", "")),
            str(row.get("description", "")),
        ]
    ).lower()
    return bool(SPORTS_RE.search(text) or CHEATERS_RE.search(text))


def batched(seq: Sequence[str], n: int) -> Iterable[Sequence[str]]:
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


def safe_api_call(fn, *args, **kwargs):
    """Call YouTube API, gracefully warn & bubble up quotaExceeded."""
    try:
        return fn(*args, **kwargs)
    except HttpError as e:
        msg = str(e)
        print(f"[KE500] WARN: API call failed: {e}", file=sys.stderr)
        # Allow caller to decide whether to abort discovery on quota
        raise


def yt_build(api_key: str):
    return build("youtube", "v3", developerKey=api_key, cache_discovery=False)


# ----------------------------
# Core pipeline
# ----------------------------

@dataclass
class ChannelInfo:
    channel_id: str
    channel_name: str = ""
    channel_url: str = ""
    description: str = ""
    classification: str = ""
    country: str = ""
    subs: int = 0
    views: int = 0
    videos: int = 0
    latest_video_id: str = ""
    latest_video_title: str = ""
    latest_video_thumbnail: str = ""
    latest_video_published_at: str = ""


def discover_channel_ids(yt, queries: List[str], max_new: int) -> List[str]:
    found: List[str] = []
    for q in queries:
        print(f"[KE500] Discovering q='{q}' ...")
        try:
            search = yt.search().list(
                part="snippet",
                q=q,
                type="channel",
                maxResults=50,
                # regionCode="KE",  # (optional) sometimes too restrictive
            )
            resp = safe_api_call(search.execute)
        except HttpError as e:
            if "quota" in str(e).lower():
                print(f"[KE500] WARN: discovery stopped early: {e}", file=sys.stderr)
                break
            else:
                continue

        for item in (resp.get("items") or []):
            cid = item.get("snippet", {}).get("channelId")
            if cid and cid not in found:
                found.append(cid)
                if len(found) >= max_new:
                    return found
        time.sleep(0.2)
    return found


def fetch_channels(yt, channel_ids: List[str]) -> List[ChannelInfo]:
    rows: List[ChannelInfo] = []
    for chunk in batched(channel_ids, 50):
        try:
            req = yt.channels().list(
                part="snippet,statistics,contentDetails,brandingSettings",
                id=",".join(chunk),
                maxResults=50,
            )
            resp = safe_api_call(req.execute)
        except HttpError as e:
            print(f"[KE500] WARN: channels.list failed for batch {chunk[0]}:{chunk[-1]}: {e}", file=sys.stderr)
            continue

        for ch in resp.get("items", []):
            cid = ch.get("id")
            snippet = ch.get("snippet", {}) or {}
            stats = ch.get("statistics", {}) or {}
            branding = ch.get("brandingSettings", {}) or {}
            content = ch.get("contentDetails", {}) or {}

            channel_url = f"https://www.youtube.com/channel/{cid}" if cid else ""
            title = snippet.get("title", "") or ""
            desc = snippet.get("description", "") or ""
            country = (branding.get("channel", {}) or {}).get("country", "") or ""

            subs = int(stats.get("subscriberCount", "0") or 0)
            views = int(stats.get("viewCount", "0") or 0)
            videos = int(stats.get("videoCount", "0") or 0)

            latest_video_id = ""
            latest_video_title = ""
            latest_video_thumb = ""
            latest_video_published_at = ""

            uploads = (content.get("relatedPlaylists", {}) or {}).get("uploads")
            if uploads:
                try:
                    preq = yt.playlistItems().list(
                        part="snippet,contentDetails",
                        playlistId=uploads,
                        maxResults=1,
                    )
                    presp = safe_api_call(preq.execute)
                    items = presp.get("items") or []
                    if items:
                        pi = items[0]
                        vid = (pi.get("contentDetails", {}) or {}).get("videoId", "")
                        s2 = pi.get("snippet", {}) or {}
                        latest_video_id = vid or ""
                        latest_video_title = s2.get("title", "") or ""
                        latest_video_thumb = (
                            ((s2.get("thumbnails", {}) or {}).get("medium") or {}).get("url")
                            or ((s2.get("thumbnails", {}) or {}).get("default") or {}).get("url")
                            or ""
                        )
                        latest_video_published_at = s2.get("publishedAt", "") or ""
                except HttpError as e:
                    # If quota fails here, we still keep the channel without latest video
                    print(f"[KE500] WARN: playlistItems.list failed for channel {cid}: {e}", file=sys.stderr)

            # Basic text-based classification (no KeyError later)
            classification = classify_text(title, desc)

            rows.append(
                ChannelInfo(
                    channel_id=cid or "",
                    channel_name=title,
                    channel_url=channel_url,
                    description=desc,
                    classification=classification,
                    country=country,
                    subs=subs,
                    views=views,
                    videos=videos,
                    latest_video_id=latest_video_id,
                    latest_video_title=latest_video_title,
                    latest_video_thumbnail=latest_video_thumb,
                    latest_video_published_at=latest_video_published_at,
                )
            )
        time.sleep(0.2)
    print(f"[KE500] Got stats for: {len(rows)} channels")
    return rows


def rank_channels(df: pd.DataFrame) -> pd.DataFrame:
    """Score & rank. Keep it simple: prioritize subs, then views, then recency."""
    df = df.copy()

    # Safety: fill missing numeric
    for col in ["subs", "views", "videos"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    # recency in days (lower is better)
    def recency_days(iso: str) -> float:
        if not iso:
            return 9999.0
        try:
            ts = pd.to_datetime(iso, utc=True)
            delta = pd.Timestamp.utcnow() - ts
            return max(0.0, delta.total_seconds() / 86400.0)
        except Exception:
            return 9999.0

    df["recency_days"] = df.get("latest_video_published_at", pd.Series([""] * len(df))).apply(recency_days)

    # Score: log10(subs+1) + 0.5*log10(views+1) + 0.2*(1/(1+recency_days))
    df["score"] = (
        (df["subs"] + 1).apply(lambda x: math.log10(x)) +
        0.5 * (df["views"] + 1).apply(lambda x: math.log10(x)) +
        0.2 * (1.0 / (1.0 + df["recency_days"]))
    )

    df = df.sort_values(["score", "subs", "views"], ascending=[False, False, False]).reset_index(drop=True)
    df["rank"] = df.index + 1
    return df


# ----------------------------
# Main
# ----------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=DEFAULT_OUT, help="Output CSV path")
    ap.add_argument("--max_new", type=int, default=DEFAULT_MAX_NEW, help="Max new channels discovered via search")
    ap.add_argument("--discover", type=lambda s: s.lower() in ("1", "true", "yes", "y"), default=DEFAULT_DISCOVER, help="Whether to run discovery searches")
    args = ap.parse_args()

    api_key = os.environ.get("YT_API_KEY")
    if not api_key:
        print("[KE500] ERROR: YT_API_KEY env var is required", file=sys.stderr)
        sys.exit(2)

    yt = yt_build(api_key)

    # 1) Seed channel IDs (optional)
    seed_ids = [s for s in load_lines_file(SEED_FILE) if s.startswith("UC")]
    print(f"[KE500] Seed channel IDs: {len(seed_ids)}")

    # 2) Discovery (optional; stops gracefully on quotaExceeded)
    discovered_ids: List[str] = []
    if args.discover:
        try:
            discovered_ids = discover_channel_ids(yt, DISCOVERY_QUERIES, max_new=args.max_new)
        except Exception:
            # already logged
            pass
    print(f"[KE500] Discovered IDs this run: {len(discovered_ids)}")

    # combine seed + discovered
    all_ids: List[str] = []
    seen = set()
    for cid in seed_ids + discovered_ids:
        if cid and cid not in seen:
            seen.add(cid)
            all_ids.append(cid)
    print(f"[KE500] Total unique IDs to evaluate: {len(all_ids)}")

    # 3) Fetch channel stats + latest upload
    rows = fetch_channels(yt, all_ids)

    # 4) To DataFrame
    raw_df = pd.DataFrame([r.__dict__ for r in rows])
    if raw_df.empty:
        print("[KE500] WARN: no channels fetched; writing empty CSV for consistency.", file=sys.stderr)
        Path(args.out).write_text("rank,channel_id,channel_name,channel_url,latest_video_id,latest_video_title,latest_video_thumbnail,latest_video_published_at,description,classification,subs,views,videos\n", encoding="utf-8")
        sys.exit(0)

    # 5) Base filters:
    #    a) Kenya-leaning
    if not {"channel_id", "channel_name", "description"}.issubset(set(raw_df.columns)):
        # Ensure columns exist
        for col in ["channel_id", "channel_name", "description"]:
            if col not in raw_df.columns:
                raw_df[col] = ""

    # If we kept branding country earlier, try to reconstruct a minimal boolean flag
    # Fallback: apply text KE heuristic
    if "country" not in raw_df.columns:
        raw_df["country"] = ""
    raw_df["is_ke"] = (
        (raw_df["country"].str.upper() == "KE") |
        raw_df["channel_name"].fillna("").str.contains(KENYA_RE) |
        raw_df["description"].fillna("").str.contains(KENYA_RE)
    )
    ke_df = raw_df[raw_df["is_ke"]].copy()
    print(f"[KE500] After KE filter: {len(ke_df)} channels")

    #    b) Classification (podcast/interview). If missing, classify now.
    if "classification" not in ke_df.columns:
        ke_df["classification"] = ""

    def _classify_row(row):
        c = (row.get("classification") or "").strip().lower()
        if c:
            return c
        return classify_text(str(row.get("channel_name", "")), str(row.get("description", "")))

    ke_df["classification"] = ke_df.apply(_classify_row, axis=1)
    ok_mask = ke_df["classification"].fillna("").isin(["podcast", "interview"])
    ke_df = ke_df[ok_mask].copy()
    print(f"[KE500] After classification filter: {len(ke_df)} channels")

    # 6) Defense-in-depth filters (blocklist + unwanted)
    blocked_ids = load_blocked_ids()
    if blocked_ids:
        ke_df = ke_df[~ke_df["channel_id"].isin(blocked_ids)].copy()
        print(f"[KE500] After blocklist filter: {len(ke_df)} channels")

    def _is_unwanted_apply(row) -> bool:
        return is_unwanted_row(
            {
                "channel_name": row.get("channel_name", ""),
                "latest_video_title": row.get("latest_video_title", ""),
                "description": row.get("description", ""),
            }
        )

    if len(ke_df):
        unwanted_mask = ke_df.apply(_is_unwanted_apply, axis=1)
        ke_df = ke_df[~unwanted_mask].copy()
        print(f"[KE500] After unwanted heuristics: {len(ke_df)} channels")

    # 7) Rank & cut to top 500
    ranked = rank_channels(ke_df)
    ranked = ranked.sort_values("rank").head(500).copy()

    # 8) Tidy columns for UI
    def _channel_url(cid: str) -> str:
        return f"https://www.youtube.com/channel/{cid}" if cid else ""

    ranked["channel_url"] = ranked.get("channel_url", "").where(ranked["channel_url"].astype(bool), ranked["channel_id"].apply(_channel_url))

    out_cols = [
        "rank",
        "channel_id",
        "channel_name",
        "channel_url",
        "latest_video_id",
        "latest_video_title",
        "latest_video_thumbnail",
        "latest_video_published_at",
        "description",
        "classification",
        "subs",
        "views",
        "videos",
    ]
    for c in out_cols:
        if c not in ranked.columns:
            ranked[c] = ""

    ranked[out_cols].to_csv(args.out, index=False)
    print(f"[KE500] Wrote {len(ranked)} rows -> {args.out}")


if __name__ == "__main__":
    main()
