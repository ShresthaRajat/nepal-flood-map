#!/usr/bin/env bash
# build_waterways_tiles.sh
#
# Rebuilds the "Waterways of Nepal (OSM)" overlay as Mapbox Vector Tiles.
#
# Input:  data/hdx/hotosm_npl_waterways/hotosm_npl_waterways_clip.geojson
#         The national HDX dataset hotosm_npl_waterways (OSM contributors, ODbL,
#         oex export, 9 Aug 2026 snapshot) clipped to the Bhote Koshi-Trishuli
#         corridor bbox (84.27 27.43 86.08 28.52).  8 MB, gitignored: too big to
#         serve as GeoJSON to both maps, so only the tiles ship.
# Output: data/hdx/tiles/hotosm_npl_waterways/{z}/{x}/{y}.pbf + metadata.json
#         (tracked).  One source-layer, `waterways`, z8-13; the app overzooms
#         above 13.  ~1,100 files, ~7 MB.
#
# Requires GDAL 3.x ogr2ogr with the MVT driver.  Override the binary with
# OGR2OGR=/path/to/ogr2ogr.  Tiles are written uncompressed (COMPRESS=NO)
# because static hosts such as GitHub Pages do not set Content-Encoding.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

OGR2OGR="${OGR2OGR:-$(command -v ogr2ogr || echo /opt/homebrew/bin/ogr2ogr)}"
IN="data/hdx/hotosm_npl_waterways/hotosm_npl_waterways_clip.geojson"
OUT="data/hdx/tiles/hotosm_npl_waterways"

if [ ! -f "$IN" ]; then
  echo "missing $IN" >&2
  echo "Download hotosm_npl_waterways (GeoJSON) from https://data.humdata.org/dataset/hotosm_npl_waterways" >&2
  echo "and clip it, e.g.: ogr2ogr -f GeoJSON -clipsrc 84.27 27.43 86.08 28.52 $IN hotosm_npl_waterways.geojson" >&2
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
  -dsco DESCRIPTION="OSM waterways of Nepal (HDX hotosm_npl_waterways, 9 Aug 2026 snapshot) clipped to the Bhote Koshi-Trishuli corridor"

echo "==> $(find "$OUT" -name '*.pbf' | wc -l | tr -d ' ') tiles, $(du -sh "$OUT" | cut -f1)"
