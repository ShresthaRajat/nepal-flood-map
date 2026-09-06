#!/usr/bin/env bash
# build_roads_tiles.sh
#
# Builds the "Highways and main roads" overlay as Mapbox Vector Tiles from the
# national HDX dataset hotosm_npl_roads (OpenStreetMap contributors, ODbL,
# oex export).  The HOT flood datasets stop at the 1 km corridor edge; this
# layer shows the approach roads beyond it.
#
# Pipeline: download the 220 MB GeoPackage zip to work/ (gitignored) ->
#           clip to the corridor bbox and keep highway IN (motorway, trunk,
#           primary, secondary, tertiary) plus unclassified/construction ways
#           whose name says Highway / Rajmarg / Lokmarg / Rajpath (Nepal's
#           highways are under-tagged in OSM: stretches of the Pasang Lhamu and
#           Mid-Hill highways are tertiary or unclassified) -> one MVT tileset,
#           source-layer `roads`,
#           z7-13 (the app overzooms above 13).
# Output:   data/hdx/tiles/hotosm_npl_roads/{z}/{x}/{y}.pbf + metadata.json (tracked)
#
# Requires curl, unzip, GDAL 3.x ogr2ogr with the MVT driver (override with
# OGR2OGR=...).  Tiles are uncompressed (COMPRESS=NO) for static hosts.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

OGR2OGR="${OGR2OGR:-$(command -v ogr2ogr || echo /opt/homebrew/bin/ogr2ogr)}"
URL="https://production-raw-data-api.s3.amazonaws.com/ISO3/NPL/roads/hotosm_npl_roads_osm_gpkg.zip"
WORK="work/roads_build"
ZIP="$WORK/hotosm_npl_roads_osm_gpkg.zip"
CLIP="$WORK/roads_corridor.gpkg"
OUT="data/hdx/tiles/hotosm_npl_roads"
# Same window as the waterways layer: corridor plus the Kathmandu / Dhading approaches.
BBOX=(84.27 27.43 86.08 28.52)

mkdir -p "$WORK"
if [ ! -s "$ZIP" ]; then
  echo "==> downloading $(basename "$URL")"
  curl -sS -f -L --retry 3 -o "$ZIP" "$URL"
fi
find_src() { find "$WORK" -name '*.gpkg' ! -name 'roads_corridor.gpkg' | head -1; }
if [ -z "$(find_src)" ]; then
  echo "==> unzipping"
  unzip -oq "$ZIP" -d "$WORK"
fi
SRC="$(find_src)"

echo "==> clipping and filtering $SRC"
rm -f "$CLIP"
"$OGR2OGR" -f GPKG "$CLIP" "$SRC" \
  -clipsrc "${BBOX[@]}" \
  -where "highway IN ('motorway','trunk','primary','secondary','tertiary') OR (highway IN ('unclassified','construction') AND (COALESCE(name_en,name_latin,name,'') LIKE '%ighway%' OR COALESCE(name_en,name_latin,name,'') LIKE '%Rajmarg%' OR COALESCE(name_en,name_latin,name,'') LIKE '%Lokmarg%' OR COALESCE(name_en,name_latin,name,'') LIKE '%Rajpath%' OR name LIKE '%राजमार्ग%' OR name LIKE '%लोकमार्ग%'))" \
  -nln roads -nlt PROMOTE_TO_MULTI

echo "==> tiling"
rm -rf "$OUT"
"$OGR2OGR" -f MVT "$OUT" "$CLIP" \
  -nln roads \
  -select highway,name,name_en,name_latin,surface,bridge \
  -dsco FORMAT=DIRECTORY -dsco COMPRESS=NO \
  -dsco MINZOOM=7 -dsco MAXZOOM=13 \
  -dsco NAME=hotosm_npl_roads \
  -dsco DESCRIPTION="OSM motorway/trunk/primary/secondary/tertiary roads and named highways (HDX hotosm_npl_roads, 9 Aug 2026 snapshot) clipped to the Bhote Koshi-Trishuli corridor and approaches"

echo "==> $(find "$OUT" -name '*.pbf' | wc -l | tr -d ' ') tiles, $(du -sh "$OUT" | cut -f1)"
