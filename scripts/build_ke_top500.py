import os, sys, argparse, pandas as pd, numpy as np
from dateutil import parser as dtp
from googleapiclient.discovery import build
import json, os

def load_ids_from_file(path):
    ids = []
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                t = line.strip()
                if t.startswith("UC"): ids.append(t)
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


WEIGHTS = dict(subs=0.25, views=0.25, videos=0.10, freq=0.20, recency=0.20)
TAU = 45.0
QUERIES = [
    "podcast kenya", "kenyan podcast", "nairobi podcast",
    "kenya talk show", "kenyan interviews", "JKLive", "The Trend NTV",
    "Cleaning The Airwaves", "Presenter Ali interview", "Obinna live",
    "MIC CHEQUE podcast", "Sandwich Podcast KE", "ManTalk Ke podcast"
]

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
    print("Missing YT_API_KEY"); sys.exit(1)

yt = build("youtube","v3",developerKey=args.api_key)

def norm(x):
    x = x.astype(float)
    mx, mn = np.nanmax(x), np.nanmin(x)
    if np.isnan(mx) or mx == mn: return pd.Series(np.zeros(len(x)), index=x.index)
    return (x - mn) / (mx - mn + 1e-9)

def score(df, today=None):
    today = pd.Timestamp(today) if today else pd.Timestamp.utcnow()
    for c in ["subs","views","videos","uploads_last_30","uploads_last_90"]:
        df[c] = pd.to_numeric(df.get(c, 0), errors="coerce").fillna(0)
    df["last_upload_date"] = pd.to_datetime(df.get("last_upload_date"), errors="coerce")
    df["days_since_last"] = (today - df["last_upload_date"]).dt.days
    f_subs = np.log10(df["subs"]+1); f_views = np.log10(df["views"]+1); f_videos = np.log10(df["videos"]+1)
    f_freq = (df["uploads_last_90"] / 13.0).clip(lower=0)
    rec = np.exp(-(df["days_since_last"].fillna(365))/TAU)
    s = (WEIGHTS['subs']*norm(f_subs) + WEIGHTS['views']*norm(f_views) + WEIGHTS['videos']*norm(f_videos) +
         WEIGHTS['freq']*norm(f_freq) + WEIGHTS['recency']*norm(rec)).round(6)
    out = df.copy(); out["score"] = s
    return out.sort_values("score", ascending=False)

def classify(sn):
    name, desc = (sn.get('title','') or '').lower(), (sn.get('description','') or '').lower()
    if 'podcast' in name or 'podcast' in desc: return 'podcast'
    for kw in ['interview','talk','conversation','live','sit-down','sitdown','one-on-one']:
        if kw in name or kw in desc: return 'interview'
    return ''

def get_stats(ids):
    rows = []
    for i in range(0, len(ids), 50):
        resp = yt.channels().list(part="snippet,statistics,contentDetails,brandingSettings", id=",".join(ids[i:i+50]), maxResults=50).execute()
        for it in resp.get("items",[]):
            cid = it["id"]
            sn, st = it.get("snippet",{}), it.get("statistics",{})
            uploads = it.get("contentDetails",{}).get("relatedPlaylists",{}).get("uploads")
            rows.append(dict(
                channel_id=cid,
                channel_name=sn.get("title"),
                channel_url=(f"https://www.youtube.com/{sn.get('customUrl')}" if sn.get('customUrl') else f"https://www.youtube.com/channel/{cid}"),
                country=it.get("brandingSettings",{}).get("channel",{}).get("country",""),
                classification=classify(sn),
                subs=(None if st.get('hiddenSubscriberCount') else int(st.get('subscriberCount',0) or 0)),
                views=int(st.get('viewCount',0) or 0),
                videos=int(st.get('videoCount',0) or 0),
                uploads_playlist=uploads,
                last_upload_date=None, uploads_last_30=0, uploads_last_90=0
            ))
    return pd.DataFrame(rows)

def fill_activity(df, today=None):
    today = pd.Timestamp(today) if today else pd.Timestamp.utcnow()
    df = df.copy()
    for i, r in df.iterrows():
        pid = r.get("uploads_playlist")
        if not pid: continue
        resp = yt.playlistItems().list(part="contentDetails", playlistId=pid, maxResults=50).execute()
        vids = []
        for it in resp.get("items", []):
            pa = it.get("contentDetails", {}).get("publishedAt")
            if pa:
                try: vids.append(pd.Timestamp(dtp.parse(pa)))
                except: pass
        if vids:
            last = max(vids)
            df.at[i, "last_upload_date"] = last
            df.at[i, "uploads_last_30"] = sum(v >= (today - pd.Timedelta(days=30)) for v in vids)
            df.at[i, "uploads_last_90"] = sum(v >= (today - pd.Timedelta(days=90)) for v in vids)
    return df

# Discovery
ids = []
# Always include any local seed channel IDs (optional file)
ids += load_ids_from_file(args.seed_ids)
# Include previously discovered IDs so we don't re-spend search quota
ids += load_cached_ids(args.cache_discovered)

ids = list(dict.fromkeys(ids))  # de-dup early

should_discover = str(args.discover).lower() in ["1","true","yes","y"]
if should_discover:
    pulled_total = 0
    for q in QUERIES:
        pt, pulled = None, 0
        try:
            while True:
                resp = yt.search().list(
                    part="snippet", q=q, type="channel", maxResults=50, pageToken=pt
                ).execute()
                ids += [it['snippet']['channelId'] for it in resp.get('items',[])]
                pulled += len(resp.get('items',[]))
                pulled_total += len(resp.get('items',[]))
                pt = resp.get('nextPageToken')
                if not pt or pulled >= args.max_new:
                    break
        except Exception as e:
            # Quota or transient error — stop discovery gracefully and use what we have
            print("WARN: discovery stopped early due to:", repr(e))
            break

ids = list(dict.fromkeys(ids))
# Persist discoveries for future LIGHT runs
save_cached_ids(args.cache_discovered, ids)

if not ids:
    print("No channel IDs available. Provide --seed_ids or increase quota.")
    sys.exit(0)  # exit 0 so workflow continues gracefully (optional)


raw = get_stats(ids)

def is_ke(row):
    if (row.get('country') or '').upper() == 'KE': return True
    t = (row.get('channel_name') or '').lower()
    return any(x in t for x in [' kenya', ' kenyan', ' nairobi', ' mombasa', ' kisumu'])

raw = raw[ raw.apply(is_ke, axis=1) ].reset_index(drop=True)
raw = fill_activity(raw, today=args.today)

ok = raw['classification'].fillna('').isin(['podcast','interview'])
ranked = score(raw[ok].copy(), today=args.today)
ranked['rank'] = range(1, len(ranked)+1)
ranked.head(500).to_csv(args.out, index=False)
print("Wrote", args.out, len(ranked.head(500)))
