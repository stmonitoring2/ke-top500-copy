import pandas as pd
import argparse

ap = argparse.ArgumentParser()
ap.add_argument("--ranked", default="top500_ranked.csv")
ap.add_argument("--out", default="channels.csv")
args = ap.parse_args()

df = pd.read_csv(args.ranked)
for c in ["rank","channel_id","channel_name"]:
    if c not in df.columns: df[c] = ""

out = df.head(500)[["rank","channel_id","channel_name"]]
out.to_csv(args.out, index=False)
print("Wrote", args.out, len(out))
