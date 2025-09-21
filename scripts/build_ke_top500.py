#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import sys
import argparse
import json
import time

import pandas as pd
import numpy as np
from dateutil import parser as dtp
from googleapiclient.discovery import build

# ----------------------------
# Config & weights
# ----------------------------

WEIGHTS = dict(
    subs=0.25,
    views=0.25,
    videos=0.10,
    freq=0.20,
    recency=0.20,
)

# Recency time constant for the exponential freshness boost
TAU = 45.0  # days

# Discovery queries (ASCII quotes only)
QUERIES = [
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

# ----------------------------
# Argparse
# ----------------------------

ap = argparse.ArgumentParser()
ap.add_argument("--api_key", default=os.getenv("YT_API_KEY"))
ap.add_argument("--today", default=None)
ap.add_argument("--max_new", type=int, default=1500)
ap.add_argument("--out", default="top500_ranked.csv")
ap.add_argument("--discover", default="true", help="true/false: run YouTube search discovery")
ap.add_argument("--seed_ids", default="scripts/seed_channel_ids.txt", help="optional file of channel IDs (UC...) one per line")
ap.add_argument("--cache_discovered", default="discovered_ids.json", help="file to persist discovered IDs across runs")
args = ap.parse_args()

if not args.api_key:
    print("Missing YT_API_KEY")
    sys.exit(1)

# ----------------------------
# YouTube client
# ----------------------------

yt = build("youtube", "v3", developerKey=args.api_key)

# ----------------------------
# Helpers for ID persistence
# ----------------------------

def load_ids_from_file(path: str):
    ids = []
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                t = line.strip()
                if t.startswith("UC"):
                    ids.append(t)
    return ids


def load_cached_ids(path: str):
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return [x for x in data if isinstance(x, str) and x.startswith("UC")]
        except Exception:
            return []
    return []


def save_cached_ids(path: str, ids):
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(sorted(list(dict.fromkeys(ids))), f)
    except Exception:
        pass


def log(msg: str):
    print(f"[KE500] {msg}")

# ----------------------------
# Scoring utils
# ----------------------------

def norm(x: pd.Series) -> pd.Series:
    x = x.astype(float)
    mx, mn = np.nanmax(x), np.nanmin(x)
    if np.isnan(mx) or mx == mn:
        return pd.Series(np.zeros(len(x)), index=x.index)
    return (x - mn) / (mx - mn + 1e-9)


def score(df: pd.DataFrame, today=None) -> pd.DataFrame:
    today = pd.Timestamp(today) if today else pd.Timestamp.utcnow()

    # numeric coercions
    for c in ["subs", "views", "videos", "uploads_last_30", "uploads_last_90"]:
        df[c] = pd.to_numeric(df.get(c, 0), errors="coerce").fillna(0)

    # dates / recency
    df["last_upload_date"] = pd.to_datetime(df.get("last_upload_date"), errors="coerce")
    df["days_since_last"] = (today - df["last_upload_date"]).dt.days

    # feature transforms
    f_subs = np.log10(df["subs"] + 1)
    f_views = np.log10(df["views"] + 1)
    f_videos = np.log10(df["videos"] + 1)
    f_freq = (df["uploads_last_90"] / 13.0).clip(lower=0)  # ~90 days / 7 ≈ 13 weeks
    rec = np.exp(-(df["days_since_last"].fillna(365)) / TAU)

    s = (
        WEIGHTS["subs"] * norm(f_subs)
        + WEIGHTS["views"] * norm(f_views)
        + WEIGHTS["videos"] * norm(f_videos)
        + WEIGHTS["freq"] * norm(f_freq)
        + WEIGHTS["recency"] * norm(rec)
    ).round(6)

    out = df.copy()
    out["score"] = s
    return out.sort_values("score", ascending=False)

# ----------------------------
# Classification & KE heuristic
# ----------------------------

def classify(sn: dict) -> str:
    """Return 'podcast' / 'interview' / '' based on snippet text."""
    name = (sn.get("title", "") or "").lower()
    desc = (sn.get("description", "") or "").lower()
    if "podcast" in name or "podcast" in desc:
        return "podcast"
    for kw in ["interview", "talk", "conversation", "live", "sit-down", "sitdown", "one-on-one"]:
        if kw in name or kw in desc:
            return "interview"
    return ""


def is_ke(row: dict) -> bool:
    """Heuristic to identify Kenyan channels.

    Priority:
    1) Explicit country code 'KE' from brandingSettings.channel.country
    2) Kenyan terms in title/customUrl/description
    """
    if (row.get("country") or "").strip().upper() == "KE":
        return True

    text = " ".join(
        [
            str(row.get("channel_name") or ""),
            str(row.get("channel_url") or ""),
            str(row.get("description") or ""),
        ]
    ).lower()

    ke_terms = [
        " kenya",
        " kenyan",
        " nairobi",
        " mombasa",
        " kisumu",
        " kiambu",
        " eldoret",
        " nakuru",
        " kenyan podcast",
        " kenya podcast",
        " ke ",  # try to avoid false positives like 'mike'
    ]
    return any(t in text for t in ke_terms)

# ----------------------------
# Data collectors
# ----------------------------

def get_stats(ids) -> pd.DataFrame:
    """Fetch channel snippet/statistics/contentDetails for batches of IDs."""
    rows = []
    for i in range(0, len(ids), 50):
        batch = ids[i : i + 50]
        try:
            resp = (
                yt.channels()
                .list(
                    part="snippet,statistics,contentDetails,brandingSettings",
                    id=",".join(batch),
                    maxResults=50,
                )
                .execute()
            )
        except Exception as e:
            log(f"WARN: channels.list failed for batch {i}:{i+50}: {repr(e)}")
            continue

        for it in resp.get("items", []):
            cid = it["id"]
            sn = it.get("snippet", {}) or {}
            st = it.get("statistics", {}) or {}
            uploads = (
                it.get("contentDetails", {})
                .get("relatedPlaylists", {})
                .get("uploads")
            )
            country = (
                it.get("brandingSettings", {})
                .get("channel", {})
                .get("country", "")
            )

            rows.append(
                dict(
                    channel_id=cid,
                    channel_name=sn.get("title"),
                    description=sn.get("description", ""),
                    channel_url=(
                        f"https://www.youtube.com/{sn.get('customUrl')}"
                        if sn.get("customUrl")
                        else f"https://www.youtube.com/channel/{cid}"
                    ),
                    country=country,
                    classification=classify(sn),
                    subs=(None if st.get("hiddenSubscriberCount") else int(st.get("subscriberCount", 0) or 0)),
                    views=int(st.get("viewCount", 0) or 0),
                    videos=int(st.get("videoCount", 0) or 0),
                    uploads_playlist=uploads,
                    last_upload_date=None,
                    uploads_last_30=0,
                    uploads_last_90=0,
                )
            )

        # small politeness delay
        time.sleep(0.05)

    return pd.DataFrame(rows)


def fill_activity(df: pd.DataFrame, today=None) -> pd.DataFrame:
    """For each channel, look at uploads playlist and compute last upload + counts."""
    today = pd.Timestamp(today) if today else pd.Timestamp.utcnow()
    df = df.copy()

    for i, r in df.iterrows():
        pid = r.get("uploads_playlist")
        if not pid:
            continue
        try:
            resp = (
                yt.playlistItems()
                .list(part="contentDetails", playlistId=pid, maxResults=50)
                .execute()
            )
        except Exception as e:
            log(f"WARN: playlistItems.list failed for {r.get('channel_id')}: {repr(e)}")
            continue

        vids = []
        for it in resp.get("items", []):
            pa = it.get("contentDetails", {}).get("publishedAt")
            if pa:
                try:
                    vids.append(pd.Timestamp(dtp.parse(pa)))
                except Exception:
                    pass

        if vids:
            last = max(vids)
            df.at[i, "last_upload_date"] = last
            df.at[i, "uploads_last_30"] = sum(v >= (today - pd.Timedelta(days=30)) for v in vids)
            df.at[i, "uploads_last_90"] = sum(v >= (today - pd.Timedelta(days=90)) for v in vids)

        time.sleep(0.02)

    return df

# ----------------------------
# Discovery (safe & verbose)
# ----------------------------

ids = []
# Seeds and cache first (cheap)
ids += load_ids_from_file(args.seed_ids)
ids += load_cached_ids(args.cache_discovered)
ids = list(dict.fromkeys(ids))
log(f"Seed+cache channel IDs: {len(ids)}")

should_discover = str(args.discover).lower() in ["1", "true", "yes", "y"]
if should_discover:
    pulled_total = 0
    for q in QUERIES:
        pt, pulled = None, 0
        log(f"Discovering q='{q}' ...")
        try:
            while True:
                resp = (
                    yt.search()
                    .list(part="snippet", q=q, type="channel", maxResults=50, pageToken=pt)
                    .execute()
                )
                new_ids = [it["snippet"]["channelId"] for it in resp.get("items", [])]
                ids += new_ids
                pulled += len(new_ids)
                pulled_total += len(new_ids)
                pt = resp.get("nextPageToken")
                if not pt or pulled >= args.max_new:
                    break
        except Exception as e:
            log(f"WARN: discovery stopped early: {repr(e)}")
            break
    log(f"Discovered IDs this run: {pulled_total}")

ids = list(dict.fromkeys(ids))
save_cached_ids(args.cache_discovered, ids)
log(f"Total unique IDs to evaluate: {len(ids)}")

if not ids:
    log("ERROR: 0 channel IDs. Provide seeds or increase quota.")
    sys.exit(2)

# ----------------------------
# Build dataset → filter → rank
# ----------------------------

raw = get_stats(ids)
log(f"Got stats for: {len(raw)} channels")

# Country gate (KE or obvious KE mentions)
raw_ke = raw[raw.apply(is_ke, axis=1)].reset_index(drop=True)
log(f"After KE filter: {len(raw_ke)} channels")

# Fill recent activity
raw_ke = fill_activity(raw_ke, today=args.today)

# Keep only relevant classifications
ok_mask = raw_ke["classification"].fillna("").isin(["podcast", "interview"])
cand = raw_ke[ok_mask].copy()
log(f"Podcast/interview-like: {len(cand)} channels")

# Rank
ranked = score(cand, today=args.today)
ranked["rank"] = range(1, len(ranked) + 1)
topN = ranked.head(500)
log(f"Ranked count: {len(ranked)} ; Writing top {len(topN)} to {args.out}")

# Guardrail: only write file if we have a healthy set
MIN_ROWS = 100  # adjust if you want a stricter/looser floor
if len(topN) < MIN_ROWS:
    log(f"ERROR: Only {len(topN)} rows (<{MIN_ROWS}). Refusing to overwrite output.")
    ranked.head(50).to_csv("DEBUG_ranked_head50.csv", index=False)
    raw_ke.head(50).to_csv("DEBUG_raw_ke_head50.csv", index=False)
    sys.exit(3)

topN.to_csv(args.out, index=False)
print("Wrote", args.out, len(topN))
