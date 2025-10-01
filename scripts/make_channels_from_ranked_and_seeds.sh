#!/usr/bin/env bash
set -euo pipefail

RANKED="${1:-public/top500_ranked.csv}"
SEEDS=""
if   [ -f scripts/seed_channel_ids.txt ]; then SEEDS="scripts/seed_channel_ids.txt"
elif [ -f seed_channel_ids.txt ]; then         SEEDS="seed_channel_ids.txt"
fi

# Start from ranked if present, else empty
if [ -f "$RANKED" ]; then
  python scripts/make_channels_csv.py --ranked "$RANKED" --out channels.csv
else
  echo "rank,channel_id,channel_name" > channels.csv
fi

# Append seeds that aren't already in channels.csv
if [ -n "${SEEDS}" ]; then
  awk -F, 'NR>1{seen[$2]=1} END{for(k in seen){}}' channels.csv >/dev/null 2>&1 || true
  i=1
  while IFS= read -r cid; do
    [ -z "$cid" ] && continue
    if ! grep -q ",${cid}," channels.csv; then
      echo "$((100000 + i)),$cid,Seed Channel $i" >> channels.csv
      i=$((i+1))
    fi
  done < "$SEEDS"
fi

echo "---- channels.csv (first 15) ----"
head -n 15 channels.csv || true
