#!/usr/bin/env python3
# scripts/build_ke_top500.py

import os, sys, json, argparse
import pandas as pd
import numpy as np
from googleapiclient.discovery import build

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
            # de-dup while preserving order
            json.dump(list(dict.fromkeys(ids)), f)
    except Exception:
        pass

# ----------------------------
# Config / Scoring
# ----------------------------
WEIGHTS = dict(subs=0.25, views=0.25, videos=0.10, freq=0.20, recency=0.20)
TAU = 45.0  # days decay for "recency" feature

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

def ap():
    p = argparse.ArgumentParser()
    p.add_argument("--api_key", default=os.getenv("YT_API_KEY"))
    p.add_argument("--today", default=None)
    p.add_argument("--max_new", type=int, default=1500)
    p.add_argument("--out", default="top500_ranked.csv")
    p.add_argument("--discover", default="true", help="true/false: run YouTube search discovery")
    p.add_argument("--seed_ids", default="scripts/seed_channel_ids.txt", help="file with UC... per line")
    p.add_argument("--cache_discovered", default="discovered_ids.json", help="persist discovered IDs")
    return p.parse_args()

def log(msg: str):
    print(f"[KE500] {msg}")

def norm(x: pd.Series) -> pd.Series:
    x = x.astype(float)
    mx, mn = np.nanmax(x), np.nanmin(x)
    if np.isnan(mx) or mx == mn:
        return pd.Series(np.zeros(len(x)), index=x.index)
    return (x - mn) / (mx - mn + 1e-9)

def classify(sn: dict) -> str:
    name = (sn.get("title", "") or "").lower()
    desc = (sn.get("description", "") or "").lower()
    if "podcast" in name or "podcast" in desc:
        return "podcast"
    for kw in ["interview", "talk", "conversation", "live", "sit-down", "sitdown", "one-on-one"]:
        if kw in name or kw in desc:
            return "interview"
    return ""

def is_ke(row: pd.Series) -> bool:
    """
    Heuristic for "Kenya-related" channels:
    - brandingSettings.channel.country == "KE", OR
    - channel name/URL/description mention kenya/nairobi/ke, OR
    - customUrl contains 'ke' (weak signal, but helps)
    """
    country = (row.get("country") or "").strip().upper()
    if country == "KE":
        return True

    name = (row.get("channel_name") or "").lower()
    url  = (row.get("channel_url") or "").lower()
    # we don't have description here (we only kept snippet.title), so rely on name/url
    KE_KWS = [" kenya", " kenyan", "nairobi", "(ke)", " ke ", "-ke", " ke/"]
    if any(k in f" {name} " for k in KE_KWS):
        return True
    if any(k in f" {url} " for k in KE_KWS):
        return True

    # allowlist: common KE shows/hosts keywords (helps when country is unset)
    ALLOW = ["jklive", "ctaw", "ntv kenya", "citizen tv", "presenter ali", "obinna", "mics cheque", "sandwich podcast"]
    if any(a in name for a in ALLOW):
        return True

    return False

# ----------------------------
# YouTube API fetchers
# ----------------------------
def get_stats(yt, ids):
    """Fetch snippet/statistics/contentDetails for channel IDs in batches; skip batches that 403 due to quota."""
    rows = []
    for start in range(0, len(ids), 50):
        batch = ids[start : start + 50]
        try:
            resp = yt.channels().list(
                part="snippet,statistics,contentDetails,brandingSettings",
                id=",".join(batch),
                maxResults=50,
            ).execute()
        except Exception as e:
            log(f"WARN: channels.list failed for batch {start}:{start+50}: {repr(e)}")
            continue

        for it in resp.get("items", []):
            cid = it.get("id")
            sn = it.get("snippet", {}) or {}
            st = it.get("statistics", {}) or {}
            bs = (it.get("brandingSettings", {}) or {}).get("channel", {}) or {}
            uploads = (it.get("contentDetails", {}) or {}).get("relatedPlaylists", {}).get("uploads")
            custom = sn.get("customUrl")
            rows.append(
                dict(
                    channel_id=cid,
                    channel_name=sn.get("title"),
                    channel_url=(f"https://www.youtube.com/{custom}" if custom else f"https://www.youtube.com/channel/{cid}"),
                    country=(bs.get("country") or "").upper(),
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
    return pd.DataFrame(rows)

def fill_activity(yt, df: pd.DataFrame, today=None) -> pd.DataFrame:
    """Populate last_upload_date, uploads_last_30, uploads_last_90 from uploads playlist; robust to quota errors."""
    # Make 'today' tz-naive to match what we'll store in the DataFrame
    today = (pd.Timestamp(today) if today else pd.Timestamp.utcnow()).tz_localize(None)
    df = df.copy()

    for i, r in df.iterrows():
        pid = r.get("uploads_playlist")
        if not pid:
            continue
        try:
            resp = yt.playlistItems().list(part="contentDetails", playlistId=pid, maxResults=50).execute()
        except Exception as e:
            log(f"WARN: playlistItems.list failed for {pid}: {repr(e)}")
            continue

        vids = []
        for it in resp.get("items", []):
            pa = (it.get("contentDetails", {}) or {}).get("publishedAt")
            if pa:
                # parse as UTC-aware, then convert to tz-naive
                ts = pd.to_datetime(pa, utc=True).tz_convert(None)
                vids.append(ts)

        if vids:
            last = max(vids)
            df.at[i, "last_upload_date"] = last
            df.at[i, "uploads_last_30"] = sum(v >= (today - pd.Timedelta(days=30)) for v in vids)
            df.at[i, "uploads_last_90"] = sum(v >= (today - pd.Timedelta(days=90)) for v in vids)

    return df

def score(df: pd.DataFrame, today=None) -> pd.DataFrame:
    # Ensure tz-naive 'today' and dates
    today = (pd.Timestamp(today) if today else pd.Timestamp.utcnow()).tz_localize(None)

    df = df.copy()
    # numeric coercions
    for c in ["subs", "views", "videos", "uploads_last_30", "uploads_last_90"]:
        df[c] = pd.to_numeric(df.get(c, 0), errors="coerce").fillna(0)

    # dates -> tz-naive
    df["last_upload_date"] = pd.to_datetime(df.get("last_upload_date"), errors="coerce", utc=True).dt.tz_convert(None)

    # features
    df["days_since_last"] = (today - df["last_upload_date"]).dt.days
    f_subs = np.log10(df["subs"] + 1)
    f_views = np.log10(df["views"] + 1)
    f_videos = np.log10(df["videos"] + 1)
    f_freq = (df["uploads_last_90"] / 13.0).clip(lower=0)  # ~weekly uploads over 90d

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
# Main
# ----------------------------
def main():
    args = ap()

    if not args.api_key:
        print("Missing YT_API_KEY")
        sys.exit(1)

    yt = build("youtube", "v3", developerKey=args.api_key)

    # Load seeds + cache
    ids = []
    ids += load_ids_from_file(args.seed_ids)
    ids += load_cached_ids(args.cache_discovered)
    ids = list(dict.fromkeys(ids))
    log(f"Seed+cache channel IDs: {len(ids)}")

    # Discovery (optional)
    should_discover = str(args.discover).lower() in ["1", "true", "yes", "y"]
    if should_discover:
        pulled_total = 0
        for q in QUERIES:
            pt, pulled = None, 0
            log(f"Discovering q='{q}' ...")
            try:
                while True:
                    resp = yt.search().list(
                        part="snippet", q=q, type="channel", maxResults=50, pageToken=pt
                    ).execute()
                    new_ids = [it["snippet"]["channelId"] for it in resp.get("items", [])]
                    ids += new_ids
                    pulled += len(new_ids)
                    pulled_total += len(new_ids)
                    pt = resp.get("nextPageToken")
                    if not pt or pulled >= args.max_new:
                        break
            except Exception as e:
                log(f"WARN: discovery stopped early: {repr(e)}")
                # keep what we already found; move on to next query
                continue
        log(f"Discovered IDs this run: {pulled_total}")

    # Persist discovered set
    ids = list(dict.fromkeys(ids))
    save_cached_ids(args.cache_discovered, ids)
    log(f"Total unique IDs to evaluate: {len(ids)}")

    if not ids:
        log("ERROR: 0 channel IDs. Provide seeds or increase quota.")
        sys.exit(2)

    # Fetch stats
    raw = get_stats(yt, ids)
    log(f"Got stats for: {len(raw)} channels")

    # Kenya-only filter
    raw_ke = raw[raw.apply(is_ke, axis=1)].reset_index(drop=True)
    log(f"After KE filter: {len(raw_ke)} channels")

    # Fill activity (may be partial if quota is tight)
    raw_ke = fill_activity(yt, raw_ke, today=args.today)

    # Keep podcast/interview-like
    ok_mask = raw_ke["classification"].fillna("").isin(["podcast", "interview"])
    cand = raw_ke[ok_mask].copy()
    log(f"Podcast/interview-like: {len(cand)} channels")

    # Rank
    ranked = score(cand, today=args.today)
    ranked["rank"] = range(1, len(ranked) + 1)
    topN = ranked.head(500)
    log(f"Ranked count: {len(ranked)} ; Writing top {len(topN)} to {args.out}")

    # Guardrail: require a healthy set before overwriting
    MIN_ROWS = 100
    if len(topN) < MIN_ROWS:
        log(f"ERROR: Only {len(topN)} rows (<{MIN_ROWS}). Refusing to overwrite output.")
        # Write debug snapshots for CI artifacts
        try:
            ranked.head(50).to_csv("DEBUG_ranked_head50.csv", index=False)
            raw_ke.head(50).to_csv("DEBUG_raw_ke_head50.csv", index=False)
        except Exception:
            pass
        sys.exit(3)

    topN.to_csv(args.out, index=False)
    print("Wrote", args.out, len(topN))

if __name__ == "__main__":
    main()
