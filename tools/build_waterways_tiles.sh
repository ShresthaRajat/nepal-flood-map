#!/usr/bin/env bash
# build_waterways_tiles.sh
#
# Rebuilds the "Waterways of Nepal (OSM)" overlay as Mapbox Vector Tiles.
#
# Input:  data/hdx/hotosm_npl_waterways/hotosm_npl_waterways_clip.geojson
#         The national HDX dataset hotosm_npl_waterways (OSM contributors, ODbL,
#         oex export) clipped to the corridor + approaches bbox (84.27 27.43
#         86.08 28.52 -- same window build_roads_tiles.sh uses) as a fast
#         pre-filter, then to the Rasuwa/Nuwakot/Dhading/Gorkha district union
#         (data/admin/districts_shown.geojson).  ~8 MB, gitignored: too big to
#         serve as GeoJSON to both maps, so only the tiles ship.
#
#         Unlike build_roads_tiles.sh, no other script produces this clip, so
#         this script fetches and clips it itself: it downloads the current
#         GeoJSON export from the HDX CKAN resource (resolved fresh from
#         package_show so a re-export at the same URL is picked up), unzips it
#         to work/waterways_build/ (gitignored) and clips it with ogr2ogr. It
#         always re-fetches -- the download is small and HOT overwrites the
#         same S3 key on every export, so an mtime check can't tell old from
#         new. Set FETCH=0 to skip fetching and reuse an existing $IN as-is
#         (offline retiling only; it will not reflect a newer HDX export).
# Output: data/hdx/tiles/hotosm_npl_waterways/{z}/{x}/{y}.pbf + metadata.json
#         (tracked).  One source-layer, `waterways`, z8-13; the app overzooms
#         above 13.  Covers Rasuwa, Nuwakot, Dhading and Gorkha districts only.
#
# Requires curl, unzip, GDAL 3.x ogr2ogr with the MVT driver.  Override the
# binary with OGR2OGR=/path/to/ogr2ogr.  Tiles are written uncompressed
# (COMPRESS=NO) because static hosts such as GitHub Pages do not set
# Content-Encoding.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

OGR2OGR="${OGR2OGR:-$(command -v ogr2ogr || echo /opt/homebrew/bin/ogr2ogr)}"
IN="data/hdx/hotosm_npl_waterways/hotosm_npl_waterways_clip.geojson"
OUT="data/hdx/tiles/hotosm_npl_waterways"
WORK="work/waterways_build"
BBOX=(84.27 27.43 86.08 28.52)
# Rasuwa, Nuwakot, Dhading, Gorkha district union -- the actual clip boundary.
DISTRICTS="data/admin/districts_shown.geojson"
FETCH="${FETCH:-1}"

if [ "$FETCH" = "1" ]; then
  echo "==> resolving hotosm_npl_waterways GeoJSON resource"
  mkdir -p "$WORK" "$(dirname "$IN")"
  curl -sS -f "https://data.humdata.org/api/3/action/package_show?id=hotosm_npl_waterways" \
    -o "$WORK/hotosm_npl_waterways.package.json"
  URL="$(python3 -c "
import json
d = json.load(open('$WORK/hotosm_npl_waterways.package.json'))['result']
for r in d['resources']:
    if (r.get('format') or '').lower() == 'geojson':
        print(r['url']); break
")"
  ZIP="$WORK/$(basename "$URL")"
  echo "==> downloading $(basename "$URL")"
  curl -sS -f -L --retry 3 -o "$ZIP" "$URL"
  rm -f "$WORK"/*.geojson
  echo "==> unzipping"
  unzip -oq "$ZIP" -d "$WORK"
  SRC="$(find "$WORK" -maxdepth 1 -name '*.geojson' | head -1)"
  [ -n "$SRC" ] || { echo "no .geojson found in $ZIP" >&2; exit 1; }
  echo "==> clipping $SRC to Rasuwa/Nuwakot/Dhading/Gorkha districts"
  rm -f "$IN"
  "$OGR2OGR" -f GeoJSON -spat "${BBOX[@]}" -clipsrc "$DISTRICTS" "$IN" "$SRC"
elif [ ! -f "$IN" ]; then
  echo "missing $IN and FETCH=0" >&2
  exit 1
fi

# The MVT driver cannot update an existing directory.
rm -rf "$OUT"

"$OGR2OGR" -f MVT "$OUT" "$IN" \
  -nln waterways \
  -select name,name_en,waterway,natural_class,water,width \
  -dsco FORMAT=DIRECTORY -dsco COMPRESS=NO \
  -dsco MINZOOM=8 -dsco MAXZOOM=13 \
  -dsco NAME=hotosm_npl_waterways \
  -dsco DESCRIPTION="OSM waterways of Nepal (HDX hotosm_npl_waterways) clipped to Rasuwa, Nuwakot, Dhading and Gorkha districts"

echo "==> $(find "$OUT" -name '*.pbf' | wc -l | tr -d ' ') tiles, $(du -sh "$OUT" | cut -f1)"
