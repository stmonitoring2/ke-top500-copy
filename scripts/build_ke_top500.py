#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Builds the KE Top 500 CSV by fetching YouTube channel stats and latest longform video,
with strong filters to avoid shorts, sports highlights, sensational bait, DJ mixes,
and to keep only recent/high-performing content.
"""

from __future__ import annotations
import argparse, csv, os, re, sys, time
from dataclasses import dataclass, asdict
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Set, Iterable

try:
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
except Exception:
    print("[KE500] ERROR: google-api-python-client not installed. pip install google-api-python-client", file=sys.stderr)
    sys.exit(2)

SEED_IDS_PATH = "seed_channel_ids.txt"
BLOCKED_IDS_PATH = "blocked_channel_ids.txt"

DISCOVERY_QUERIES = [
    "podcast kenya","kenyan podcast","nairobi podcast","kenya talk show",
    "kenyan interviews","JKLive","The Trend NTV","Cleaning The Airwaves",
    "Presenter Ali interview","Obinna live","MIC CHEQUE podcast","Sandwich Podcast KE","ManTalk Ke podcast",
]

MIN_LONGFORM_SEC = 660
MAX_VIDEO_AGE_DAYS = 365
MIN_SUBSCRIBERS = 5_000
MIN_CHANNEL_VIEWS = 2_000_000
MIN_VIDEO_VIEWS = 10_000

SHORTS_RE = re.compile(r'(^|\W)(shorts?|#shorts)(\W|$)', re.I)
SPORTS_RE = re.compile(r'\b(highlights?|extended\s*highlights|FT|full\s*time|full\s*match|goal|matchday)\b|\b(\d+\s*-\s*\d+)\b', re.I)
CLUBS_RE = re.compile(r'\b(sportscast|manchester united|arsenal|liverpool|chelsea)\b', re.I)
SENSATIONAL_RE = re.compile(r'(catch(ing)?|expos(e|ing)|confront(ing)?|loyalty\s*test|loyalty\s*challenge|pop\s*the\s*balloon)', re.I)
MIX_RE = re.compile(r'\b(dj\s*mix|dj\s*set|mixtape|party\s*mix|afrobeat\s*mix|bongo\s*mix|live\s*mix)\b', re.I)
TAG_BLOCKS = {"#sportshighlights","#sports","#highlights","#shorts","#short","sportshighlights","sports","highlights","shorts","short"}
KENYA_HINTS_RE = re.compile(r'\b(kenya|kenyan|nairob[iy]|mombasa|kisumu|ke\b)\b', re.I)
PODCAST_INTERVIEW_RE = re.compile(r'\b(podcast|interview|talk\s*show|conversation|panel)\b', re.I)

YOUTUBE_SEARCH_PAGE_SIZE=50; PLAYLIST_FETCH_COUNT=10; MAX_CHANNEL_BATCH=50; MAX_VIDEO_BATCH=50

def now_utc_iso(): return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
def iso8601_duration_to_seconds(s: Optional[str]): 
    if not s: return None
    m=re.match(r"^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$",s)
    if not m: return None
    h=int(m.group(1) or 0); m_=int(m.group(2) or 0); sec=int(m.group(3) or 0)
    return h*3600+m_*60+sec
def load_lines(path): 
    return [ln.strip() for ln in open(path,"r",encoding="utf-8") if ln.strip() and not ln.startswith("#")] if os.path.exists(path) else []
def chunked(seq,n): 
    for i in range(0,len(seq),n): yield seq[i:i+n]
def safe_get(d,path,default=None):
    cur=d
    for key in path:
        if not isinstance(cur,dict): return default
        cur=cur.get(key)
        if cur is None: return default
    return cur
def to_int(x): 
    try: return int(x or "0")
    except: return 0

@dataclass
class ChannelRow:
    rank:int; channel_id:str; channel_name:str; channel_url:str
    subscribers:int; video_count:int; views_total:int; country:str; classification:str
    latest_video_id:str; latest_video_title:str; latest_video_thumbnail:str
    latest_video_published_at:str; latest_video_duration_sec:Optional[int]; latest_video_views:Optional[int]

def yt_client():
    k=os.environ.get("YT_API_KEY")
    if not k: sys.exit("[KE500] ERROR: YT_API_KEY env var missing")
    return build("youtube","v3",developerKey=k,cache_discovery=False)

def list_channels(y,cids):
    out=[]
    for b in chunked(cids,MAX_CHANNEL_BATCH):
        res=y.channels().list(part="snippet,statistics,contentDetails,brandingSettings",id=",".join(b)).execute()
        out+=res.get("items",[])
        time.sleep(0.1)
    return out

def list_playlist_items(y,pid,max_items):
    out=[]; tok=None
    while len(out)<max_items:
        res=y.playlistItems().list(part="contentDetails",playlistId=pid,maxResults=min(50,max_items-len(out)),pageToken=tok).execute()
        for it in res.get("items",[]): 
            vid=safe_get(it,["contentDetails","videoId"])
            if vid: out.append(vid)
        tok=res.get("nextPageToken")
        if not tok: break
        time.sleep(0.1)
    return out

def list_videos(y,vids):
    out=[]
    for b in chunked(vids,MAX_VIDEO_BATCH):
        res=y.videos().list(part="snippet,contentDetails,statistics",id=",".join(b)).execute()
        out+=res.get("items",[])
        time.sleep(0.1)
    return out

def looks_blocked(title,desc,tags):
    if SHORTS_RE.search(title+desc) or SPORTS_RE.search(title+desc) or CLUBS_RE.search(title+desc): return True
    if SENSATIONAL_RE.search(title+desc) or MIX_RE.search(title+desc): return True
    if tags and any(t.lower().strip() in TAG_BLOCKS for t in tags): return True
    return False

def too_old(pub,max_days=MAX_VIDEO_AGE_DAYS):
    try: return datetime.fromisoformat(pub.replace("Z","+00:00")) < (datetime.now(timezone.utc)-timedelta(days=max_days))
    except: return False

def choose_latest(vs):
    vs=sorted(vs,key=lambda v:safe_get(v,["snippet","publishedAt"],""),reverse=True)
    for v in vs:
        dur=iso8601_duration_to_seconds(safe_get(v,["contentDetails","duration"]))
        views=to_int(safe_get(v,["statistics","viewCount"]))
        pub=safe_get(v,["snippet","publishedAt"],"")
        title= safe_get(v,["snippet","title"],""); desc=safe_get(v,["snippet","description"],""); tags=safe_get(v,["snippet","tags"],[])
        if dur and dur<MIN_LONGFORM_SEC: continue
        if looks_blocked(title,desc,tags): continue
        if too_old(pub): continue
        if views<MIN_VIDEO_VIEWS: continue
        thumb=safe_get(v,["snippet","thumbnails","medium","url"],"") or safe_get(v,["snippet","thumbnails","high","url"],"")
        return {"id":v.get("id",""),"title":title,"thumb":thumb,"publishedAt":pub,"duration_sec":dur,"views":views}
    return None

def classify(name,desc):
    txt=f"{name}\n{desc}"
    if PODCAST_INTERVIEW_RE.search(txt): return "podcast" if "podcast" in txt.lower() else "interview"
    return "other"

def is_kenyan(snippet,branding,allow_ids:Optional[Set[str]]=None,cid:str=""):
    if (safe_get(branding,["channel","country"],"") or "").upper()=="KE": return True
    if KENYA_HINTS_RE.search(snippet.get("title","")+snippet.get("description","")): return True
    if allow_ids and cid in allow_ids: return True
    return False

def build_rows(y,cids,blocked,seed_ids):
    rows=[]
    for ch in list_channels(y,cids):
        cid=ch.get("id") or ""
        if not cid or cid in blocked: continue
        sn,chstats,branding,content=ch.get("snippet",{}),ch.get("statistics",{}),ch.get("brandingSettings",{}),ch.get("contentDetails",{})
        if not is_kenyan(sn,branding,allow_ids=seed_ids,cid=cid): continue
        subs,views,vcount=to_int(chstats.get("subscriberCount")),to_int(chstats.get("viewCount")),to_int(chstats.get("videoCount"))
        if subs<MIN_SUBSCRIBERS or views<MIN_CHANNEL_VIEWS: continue
        pid=safe_get(content,["relatedPlaylists","uploads"]); 
        if not pid: continue
        vids=list_playlist_items(y,pid,PLAYLIST_FETCH_COUNT); 
        if not vids: continue
        chosen=choose_latest(list_videos(y,vids))
        if not chosen: continue
        rows.append(ChannelRow(0,cid,sn.get("title",""),f"https://www.youtube.com/channel/{cid}",subs,vcount,views,
            (safe_get(branding,["channel","country"],"") or "").upper(),classify(sn.get("title",""),sn.get("description","")),
            chosen["id"],chosen["title"],chosen["thumb"],chosen["publishedAt"],chosen["duration_sec"],chosen["views"]))
    rows.sort(key=lambda r:(r.subscribers,r.views_total,r.video_count),reverse=True)
    for i,r in enumerate(rows,1): r.rank=i
    return rows

def write_csv(path,rows):
    fn=["rank","channel_id","channel_name","channel_url","subscribers","video_count","views_total","country","classification","latest_video_id","latest_video_title","latest_video_thumbnail","latest_video_published_at","latest_video_duration_sec","latest_video_views","generated_at_utc"]
    os.makedirs(os.path.dirname(path) or ".",exist_ok=True)
    gen=now_utc_iso()
    with open(path,"w",newline="",encoding="utf-8") as f:
        w=csv.DictWriter(f,fieldnames=fn); w.writeheader()
        for r in rows: d=asdict(r); d["generated_at_utc"]=gen; w.writerow(d)

def main():
    p=argparse.ArgumentParser(); p.add_argument("--out",default="public/top500_ranked.csv"); p.add_argument("--discover",default="false",choices=["true","false"]); p.add_argument("--max_new",type=int,default=1500)
    a=p.parse_args(); y=yt_client()
    seed=load_lines(SEED_IDS_PATH); blocked=set(load_lines(BLOCKED_IDS_PATH))
    all_ids=list(dict.fromkeys(seed)); rows=build_rows(y,all_ids,blocked,set(seed)); rows=rows[:500]; write_csv(a.out,rows)

if __name__=="__main__": 
    try: main()
    except Exception as e: sys.exit(f"[KE500] ERROR: {e}")
