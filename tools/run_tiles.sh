#!/bin/bash
set -uo pipefail
R=/Users/rajatshrestha/Documents/nepal-flood-2026
GDAL2TILES=/opt/homebrew/bin/gdal2tiles.py
LOG=$R/work/tile_runs.log
: > "$LOG"

python3 - <<'PYEOF' > "$R/work/tile_jobs.tsv"
import json
layers = json.load(open("/Users/rajatshrestha/Documents/nepal-flood-2026/work/layers.json"))
for l in layers:
    print(l["id"], l["vrt"], l["minzoom"], l["maxzoom"], sep="\t")
PYEOF

while IFS=$'\t' read -r id vrt minz maxz; do
  outdir="$R/tiles/$id"
  mkdir -p "$outdir"
  echo "=== $id z${minz}-${maxz} $(date) ===" | tee -a "$LOG"
  t0=$(date +%s)
  "$GDAL2TILES" --xyz --profile=mercator --tiledriver=WEBP --webp-quality=80 \
    --resampling=bilinear --processes=10 --exclude -z "${minz}-${maxz}" \
    "$vrt" "$outdir" >> "$LOG" 2>&1
  rc=$?
  t1=$(date +%s)
  n=$(find "$outdir" -name '*.webp' | wc -l | tr -d ' ')
  sz=$(du -sh "$outdir" 2>/dev/null | cut -f1)
  echo "=== $id done rc=$rc in $((t1-t0))s tiles=$n size=$sz ===" | tee -a "$LOG"
done < "$R/work/tile_jobs.tsv"

echo "ALL_DONE" | tee -a "$LOG"
