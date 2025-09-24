#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Roll up daily snapshots into 7-day and 30-day leaderboards.

Input snapshots (created by daily workflow):
  public/data/history/2025-09-23.json  (same shape as /public/data/top500.json)

Output:
  public/data/top500_7d.json
  public/data/top500_30d.json
"""

from __future__ import annotations
import json, os, glob, datetime as dt
from typing import Dict, List, Any, Tuple

HISTORY_DIR = "public/data/history"
OUT_7D = "public/data/top500_7d.json"
OUT_30D = "public/data/top500_30d.json"

# tunables
WINDOWS = {
    7: OUT_7D,
    30: OUT_30D,
}
# scoring weights (tweak as you like)
W_AVG = 1.0        # lower avg rank is better -> we use 1/avg_rank
W_BEST = 1.2       # reward best (peak) rank -> 1/best_rank
W_PRESENCE = 0.8   # reward showing up frequently -> appearances / N

def load_json(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def list_history_files() -> List[str]:
    if not os.path.isdir(HISTORY_DIR):
        return []
    files = sorted(glob.glob(os.path.join(HISTORY_DIR, "*.json")))
    return files

def filter_last_n_days(files: List[str], n: int) -> List[str]:
    """Keep files whose filename date is within last n days (inclusive)."""
    out = []
    today = dt.date.today()
    n_ago = today - dt.timedelta(days=n-1)
    for p in files:
        # expect .../YYYY-MM-DD.json
        base = os.path.basename(p)
        name = os.path.splitext(base)[0]
        try:
            d = dt.date.fromisoformat(name)
        except Exception:
            continue
        if n_ago <= d <= today:
            out.append(p)
    return sorted(out)

def build_rollup(files: List[str]) -> Dict[str, Any]:
    """
    Build rollup scoreboard.
    Returns {"generated_at_utc": ..., "range": "7d"|"30d", "items":[...]}
    """
    # aggregate per channel_id
    by_channel: Dict[str, Dict[str, Any]] = {}
    snapshots = []
    for p in files:
        try:
            snap = load_json(p)
            if isinstance(snap, dict) and isinstance(snap.get("items"), list):
                snapshots.append(snap)
        except Exception:
            pass

    # nothing to roll up
    if not snapshots:
        return {"generated_at_utc": dt.datetime.utcnow().isoformat() + "Z", "items": []}

    for snap in snapshots:
        # index by channel_id for faster lookup of metadata
        for it in snap["items"]:
            cid = it.get("channel_id")
            rank = it.get("rank")
            if not cid or not isinstance(rank, int):
                continue
            slot = by_channel.setdefault(cid, {
                "channel_id": cid,
                "channel_name": it.get("channel_name", ""),
                "channel_url": it.get("channel_url", ""),
                "latest_video_id": it.get("latest_video_id", ""),
                "latest_video_title": it.get("latest_video_title", ""),
                "latest_video_thumbnail": it.get("latest_video_thumbnail", ""),
                "latest_video_published_at": it.get("latest_video_published_at", ""),
                "subscribers": it.get("subscribers", 0),
                "video_count": it.get("video_count", 0),
                "country": it.get("country", ""),
                "classification": it.get("classification", "other"),
                "_ranks": [],
                "_first_seen": it.get("latest_video_published_at", ""),
            })
            slot["_ranks"].append(rank)
            # keep the most recent "latest video" metadata (snapshots are chronological by filename; we don’t assume order here)
            cur_pub = slot.get("latest_video_published_at") or ""
            new_pub = it.get("latest_video_published_at") or ""
            if new_pub > cur_pub:
                slot["latest_video_id"] = it.get("latest_video_id", "")
                slot["latest_video_title"] = it.get("latest_video_title", "")
                slot["latest_video_thumbnail"] = it.get("latest_video_thumbnail", "")
                slot["latest_video_published_at"] = new_pub

    N = len(snapshots)

    items = []
    for cid, v in by_channel.items():
        ranks = v["_ranks"]
        if not ranks:
            continue
        avg_rank = sum(ranks) / len(ranks)
        best_rank = min(ranks)
        appearances = len(ranks)
        presence = appearances / N

        # score: larger is better
        score = (
            W_AVG * (1.0 / avg_rank) +
            W_BEST * (1.0 / best_rank) +
            W_PRESENCE * presence
        )

        items.append({
            "channel_id": cid,
            "channel_name": v["channel_name"],
            "channel_url": v["channel_url"],
            "subscribers": v["subscribers"],
            "video_count": v["video_count"],
            "country": v["country"],
            "classification": v["classification"],
            "latest_video_id": v["latest_video_id"],
            "latest_video_title": v["latest_video_title"],
            "latest_video_thumbnail": v["latest_video_thumbnail"],
            "latest_video_published_at": v["latest_video_published_at"],
            "avg_rank": avg_rank,
            "best_rank": best_rank,
            "appearances": appearances,
            "presence": presence,
            "score": score,
        })

    # sort by score desc, then best_rank asc
    items.sort(key=lambda x: (-x["score"], x["best_rank"]))

    # assign 1..500 ranks
    for i, it in enumerate(items[:500], start=1):
        it["rank"] = i

    return {
        "generated_at_utc": dt.datetime.utcnow().isoformat() + "Z",
        "items": items[:500],
    }

def main():
    files = list_history_files()
    if not files:
        print("[rollup] no history files; nothing to do")
        return

    for days, out_path in WINDOWS.items():
        window_files = filter_last_n_days(files, days)
        data = build_rollup(window_files)
        data["range"] = f"{days}d"
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"[rollup] wrote {out_path} from {len(window_files)} snapshot(s)")

if __name__ == "__main__":
    main()
