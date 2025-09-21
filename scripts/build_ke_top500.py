import os, sys, argparse, json
import pandas as pd
import numpy as np
from dateutil import parser as dtp
from googleapiclient.discovery import build

# -----------------------------
# Config & constants
# -----------------------------
WEIGHTS = dict(subs=0.25, views=0.25, videos=0.10, freq=0.20, recency=0.20)
TAU = 45.0  # recency decay (days)

# Discovery queries (safe to trim/extend)
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

# Positive signals that it's interview/podcast-like
POSITIVE_KWS = [
    "podcast","interview","talk","conversation","sit-down","sitdown",
    "episode","ep.","ep ","ft.","feat.","host","panel"
]

# Sensational / “loyalty test” / prank / tabloid-y
NEGATIVE_SENSATIONAL = [
    "loyalty test","catch a cheater","cheater","cheating","dna test",
    "expose","exposed","gold digger","phone challenge","go through your phone",
    "unfaithful","confrontation","sting","set up","trap","caught",
    "mwitu","mtaachana","wueh","drama","scandal","prank"
]

# Sports highlight patterns
NEGATIVE_SPORTS = [
    "highlights","matchday","goals","goal","assist","reaction",
    "epl","premier league","la liga","serie a","bundesliga","ucl","uefa",
    "afcon","kpl","fifa","world cup","liga","fa cup","community shield",
    "ft:","vs","v ","man united","man utd","arsenal","chelsea","liverpool",
    "man city","real madrid","barcelona","juventus","psg","dortmund",
    "highlite","hls","extended highlights"
]

# If a channel matches these negative patterns strongly, we exclude it.
NEGATIVE_KWS = NEGATIVE_SENSATIONAL + NEGATIVE_SPORTS


# -----------------------------
# Helpers: I/O
# -----------------------------
def log(msg: str):
    print(f"[KE500] {msg}")

def load_ids_from_file(path):
    ids = []
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                t = line.strip()
                if t.startswith("UC"):
                    ids.append(t)
    return ids

def load_cached_ids(path):
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return [x for x in data if isinstance(x, str) and x.startswith("UC")]
        except Exception:
            return []
    return []

def save_cached_ids(path, ids):
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(sorted(list(dict.fromkeys(ids))), f)
    except Exception:
        pass


# -----------------------------
# Scoring
# -----------------------------
def norm(x: pd.Series) -> pd.Series:
    x = x.astype(float)
    mx, mn = np.nanmax(x), np.nanmin(x)
    if np.isnan(mx) or mx == mn:
        return pd.Series(np.zeros(len(x)), index=x.index)
    return (x - mn) / (mx - mn + 1e-9)

def score(df: pd.DataFrame, today=None) -> pd.DataFrame:
    today = pd.Timestamp(today) if today else pd.Timestamp.utcnow()
    for c in ["subs","views","videos","uploads_last_30","uploads_last_90"]:
        df[c] = pd.to_numeric(df.get(c, 0), errors="coerce").fillna(0)

    # Ensure timezone awareness consistency
    if isinstance(today, pd.Timestamp) and today.tz is None:
        today = today.tz_localize("UTC")

    df["last_upload_date"] = pd.to_datetime(df.get("last_upload_date"), errors="coerce", utc=True)

    # Safe subtraction (all tz-aware)
    df["days_since_last"] = (today - df["last_upload_date"]).dt.days

    f_subs   = np.log10(df["subs"]+1)
    f_views  = np.log10(df["views"]+1)
    f_videos = np.log10(df["videos"]+1)
    f_freq   = (df["uploads_last_90"] / 13.0).clip(lower=0)  # ~weekly

    rec = np.exp(-(df["days_since_last"].fillna(365)) / TAU)

    s = (
        WEIGHTS['subs']   * norm(f_subs)   +
        WEIGHTS['views']  * norm(f_views)  +
        WEIGHTS['videos'] * norm(f_videos) +
        WEIGHTS['freq']   * norm(f_freq)   +
        WEIGHTS['recency']* norm(rec)
    ).round(6)

    out = df.copy()
    out["score"] = s
    return out.sort_values("score", ascending=False)


# -----------------------------
# Classification & filters
# -----------------------------
def text_has_any(text: str, words: list[str]) -> bool:
    if not text:
        return False
    t = text.lower()
    return any(w in t for w in words)

def classify_channel(snippet: dict) -> str:
    """Return 'podcast', 'interview', '' or 'block' based on channel metadata."""
    name = (snippet.get("title") or "").lower()
    desc = (snippet.get("description") or "").lower()
    if text_has_any(name + " " + desc, NEGATIVE_KWS):
        return "block"
    if "podcast" in name or "podcast" in desc:
        return "podcast"
    if text_has_any(name + " " + desc, ["interview","talk","conversation","sit-down","sitdown","one-on-one"]):
        return "interview"
    return ""

def looks_block_from_recent_titles(recent_titles_text: str) -> bool:
    """Heuristic: if any negative keyword appears in the last N titles, block."""
    return text_has_any(recent_titles_text, NEGATIVE_KWS)

def looks_podcastish_from_titles(recent_titles_text: str) -> bool:
    """Extra positive reinforcement from recent titles."""
    return text_has_any(recent_titles_text, POSITIVE_KWS)


# -----------------------------
# YouTube fetchers
# -----------------------------
def get_stats(yt, ids):
    rows = []
    for i in range(0, len(ids), 50):
        batch = ids[i:i+50]
        try:
            resp = yt.channels().list(
                part="snippet,statistics,contentDetails,brandingSettings",
                id=",".join(batch),
                maxResults=50
            ).execute()
        except Exception as e:
            log(f"WARN: channels.list failed for batch {i}:{i+50}: {repr(e)}")
            resp = {"items": []}

        for it in resp.get("items",[]):
            cid = it["id"]
            sn, st = it.get("snippet",{}), it.get("statistics",{})
            uploads = it.get("contentDetails",{}).get("relatedPlaylists",{}).get("uploads")
            country = it.get("brandingSettings",{}).get("channel",{}).get("country","") or sn.get("country","")

            rows.append(dict(
                channel_id=cid,
                channel_name=sn.get("title"),
                channel_desc=sn.get("description","") or "",
                channel_url=(f"https://www.youtube.com/{sn.get('customUrl')}" if sn.get('customUrl') else f"https://www.youtube.com/channel/{cid}"),
                country=country or "",
                classification=classify_channel(sn),
                subs=(None if st.get('hiddenSubscriberCount') else int(st.get('subscriberCount',0) or 0)),
                views=int(st.get('viewCount',0) or 0),
                videos=int(st.get('videoCount',0) or 0),
                uploads_playlist=uploads,
                # will be filled:
                last_upload_date=None,
                uploads_last_30=0,
                uploads_last_90=0,
                recent_titles_text="",
                latest_video_id=None,
                latest_video_title=None,
                latest_video_thumbnail=None,
                latest_video_published_at=None,
            ))
    return pd.DataFrame(rows)

def fill_activity(yt, df: pd.DataFrame, today=None, per_channel_fetch=10):
    """Populate last_upload_date, uploads_last_30/90, and recent video titles (snippet) cheaply."""
    today = pd.Timestamp(today) if today else pd.Timestamp.utcnow()
    if today.tz is None:
        today = today.tz_localize("UTC")

    df = df.copy()

    for i, r in df.iterrows():
        pid = r.get("uploads_playlist")
        if not pid:
            continue
        try:
            resp = yt.playlistItems().list(
                part="snippet,contentDetails",  # <-- includes video-like titles without calling videos.list
                playlistId=pid,
                maxResults=min(50, max(5, per_channel_fetch))
            ).execute()
        except Exception as e:
            log(f"WARN: playlistItems.list failed for {pid}: {repr(e)}")
            continue

        vids_dates = []
        titles = []
        thumb = None
        first_vid_id = None
        first_published = None

        items = resp.get("items", [])
        for j, it in enumerate(items):
            cd = it.get("contentDetails", {})
            sn = it.get("snippet", {}) or {}
            pa = cd.get("publishedAt") or sn.get("publishedAt")
            if pa:
                try:
                    dt = pd.Timestamp(dtp.parse(pa)).tz_convert("UTC") if dtp.parse(pa).tzinfo else pd.Timestamp(dtp.parse(pa)).tz_localize("UTC")
                    vids_dates.append(dt)
                except Exception:
                    pass

            title = (sn.get("title") or "").strip()
            if title:
                titles.append(title)

            if j == 0:
                first_vid_id = cd.get("videoId")
                first_published = cd.get("publishedAt") or sn.get("publishedAt")
                # thumbnail (best-effort)
                thumbs = (sn.get("thumbnails") or {})
                # pick a reasonable size if present:
                for k in ["maxres","standard","high","medium","default"]:
                    if thumbs.get(k,{}).get("url"):
                        thumb = thumbs[k]["url"]
                        break

        if vids_dates:
            last = max(vids_dates)
            df.at[i, "last_upload_date"] = last
            df.at[i, "uploads_last_30"] = sum(v >= (today - pd.Timedelta(days=30)) for v in vids_dates)
            df.at[i, "uploads_last_90"] = sum(v >= (today - pd.Timedelta(days=90)) for v in vids_dates)

        # recent titles text used for classification filtering
        df.at[i, "recent_titles_text"] = " ".join(titles[:20]).lower()

        # expose “latest video” convenience fields
        if first_vid_id:
            df.at[i, "latest_video_id"] = first_vid_id
        if first_published:
            try:
                dt = pd.Timestamp(dtp.parse(first_published))
                if dt.tzinfo:
                    dt = dt.tz_convert("UTC")
                else:
                    dt = dt.tz_localize("UTC")
                df.at[i, "latest_video_published_at"] = dt.isoformat()
            except Exception:
                pass
        if thumb:
            df.at[i, "latest_video_thumbnail"] = thumb

    return df


# -----------------------------
# Region heuristics (KE)
# -----------------------------
def is_ke(row: pd.Series) -> bool:
    # 1) Explicit channel country
    ctry = (row.get("country") or "").strip().upper()
    if ctry == "KE":
        return True

    # 2) Kenyan markers in name/desc (loose)
    hay = f"{row.get('channel_name','')} {row.get('channel_desc','')}".lower()
    hints = [" kenya ", " kenyan ", " nairobi ", " ke "]
    if any(h in f" {hay} " for h in hints):
        return True

    # 3) Fallback: allow through; later filters may catch unrelated stuff
    return True


# -----------------------------
# Main
# -----------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api_key", default=os.getenv("YT_API_KEY"))
    ap.add_argument("--today", default=None)
    ap.add_argument("--max_new", type=int, default=1500)
    ap.add_argument("--out", default="top500_ranked.csv")
    ap.add_argument("--discover", default="true", help="true/false: run YouTube search discovery")
    ap.add_argument("--seed_ids", default="scripts/seed_channel_ids.txt", help="UC… IDs, one per line")
    ap.add_argument("--blocked_ids", default="scripts/blocked_channel_ids.txt", help="UC… IDs to force-exclude")
    ap.add_argument("--cache_discovered", default="discovered_ids.json", help="persist discovered IDs across runs")
    args = ap.parse_args()

    if not args.api_key:
        print("Missing YT_API_KEY"); sys.exit(1)

    yt = build("youtube","v3",developerKey=args.api_key)

    # Seeds + cache
    ids = []
    ids += load_ids_from_file(args.seed_ids)
    ids += load_cached_ids(args.cache_discovered)
    ids = list(dict.fromkeys(ids))
    log(f"Seed+cache channel IDs: {len(ids)}")

    # Optional discovery (stop early if quota errors)
    should_discover = str(args.discover).lower() in ["1","true","yes","y"]
    if should_discover:
        pulled_total = 0
        for q in QUERIES:
            log(f"Discovering q='{q}' ...")
            try:
                pt, pulled = None, 0
                while True:
                    resp = yt.search().list(
                        part="snippet", q=q, type="channel", maxResults=50, pageToken=pt
                    ).execute()
                    new_ids = [it['snippet']['channelId'] for it in resp.get('items',[])]
                    ids += new_ids
                    pulled += len(new_ids); pulled_total += len(new_ids)
                    pt = resp.get('nextPageToken')
                    if not pt or pulled >= args.max_new:
                        break
            except Exception as e:
                log(f"WARN: discovery stopped early: {repr(e)}")
                # keep whatever we got so far and continue to next query
        log(f"Discovered IDs this run: {pulled_total}")

    ids = list(dict.fromkeys(ids))

    # Apply manual blocklist early
    blocked = set(load_ids_from_file(args.blocked_ids))
    if blocked:
        ids = [x for x in ids if x not in blocked]

    save_cached_ids(args.cache_discovered, ids)
    log(f"Total unique IDs to evaluate: {len(ids)}")

    if not ids:
        log("ERROR: 0 channel IDs. Provide seeds or increase quota.")
        sys.exit(2)

    # Fetch stats & activity
    raw = get_stats(yt, ids)
    log(f"Got stats for: {len(raw)} channels")

    # Country gate (KE or obvious KE mentions)
    if len(raw):
        raw_ke = raw[ raw.apply(is_ke, axis=1) ].reset_index(drop=True)
    else:
        raw_ke = raw
    log(f"After KE filter: {len(raw_ke)} channels")

    # Fill activity and recent titles (for keyword filter)
    raw_ke = fill_activity(yt, raw_ke, today=args.today, per_channel_fetch=12)

    # Heuristic content weed-out
    # 1) channel-level block classification
    mask_not_block = (raw_ke["classification"] != "block")

    # 2) negative keywords in recent titles
    mask_titles_ok = ~raw_ke["recent_titles_text"].apply(looks_block_from_recent_titles)

    # 3) positive signal: either channel classification says podcast/interview OR titles look podcast-ish
    mask_positive = (
        raw_ke["classification"].isin(["podcast","interview"]) |
        raw_ke["recent_titles_text"].apply(looks_podcastish_from_titles)
    )

    cand = raw_ke[ mask_not_block & mask_titles_ok & mask_positive ].copy()
    log(f"After content filters: {len(cand)} channels")

    # Rank
    ranked = score(cand, today=args.today)
    ranked['rank'] = range(1, len(ranked)+1)
    topN = ranked.head(500)
    log(f"Ranked count: {len(ranked)} ; Writing top {len(topN)} to {args.out}")

    # Guardrail
    MIN_ROWS = 100
    if len(topN) < MIN_ROWS:
        log(f"ERROR: Only {len(topN)} rows (<{MIN_ROWS}). Refusing to overwrite output.")
        ranked.head(50).to_csv("DEBUG_ranked_head50.csv", index=False)
        raw_ke.head(50).to_csv("DEBUG_raw_ke_head50.csv", index=False)
        sys.exit(3)

    topN.to_csv(args.out, index=False)
    print("Wrote", args.out, len(topN))


if __name__ == "__main__":
    main()
