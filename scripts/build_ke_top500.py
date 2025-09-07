import os, sys, argparse, pandas as pd, numpy as np
from dateutil import parser as dtp
from googleapiclient.discovery import build

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
for q in QUERIES:
    pt, pulled = None, 0
    while True:
        resp = yt.search().list(part="snippet", q=q, type="channel", maxResults=50, pageToken=pt).execute()
        ids += [it['snippet']['channelId'] for it in resp.get('items',[])]
        pulled += len(resp.get('items',[])); pt = resp.get('nextPageToken')
        if not pt or pulled >= args.max_new: break
ids = list(dict.fromkeys(ids))

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
