#!/usr/bin/env bash
# Build terrain layers (contours + hillshade) for the Bhote Koshi-Trishuli
# flood map. Reproduces:
#   R/work/glo30.tif                (DEM mosaic, gitignored)
#   R/tiles/contours/{z}/{x}/{y}.pbf (MVT contours)
#   R/tiles/hillshade/{z}/{x}/{y}.webp (raster hillshade)
#   R/data/terrain.json             (layer descriptor, written separately)
#
# Requires: GDAL 3.13+ (gdalbuildvrt, gdalwarp, gdal_contour, ogr2ogr with the
# MVT driver, gdaldem, gdal2tiles.py) and python3 with osgeo.gdal.
#
# Map extent: lon 84.45-85.65, lat 27.65-28.50 (Trishuli corridor,
# Mugling/Galchhi to Rasuwagadhi and the Lhende valley into Tibet).

set -euo pipefail

GDAL_BIN="${GDAL_BIN:-/opt/homebrew/bin}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$ROOT/work"
TILES="$ROOT/tiles"

MINLON=84.45
MINLAT=27.65
MAXLON=85.65
MAXLAT=28.50

mkdir -p "$WORK" "$TILES"

# ---------------------------------------------------------------------------
# 1. DEM: Copernicus GLO-30 (public AWS bucket, no auth), 4 tiles covering the
#    extent, mosaicked and clipped.
# ---------------------------------------------------------------------------
BASE_URL="https://copernicus-dem-30m.s3.amazonaws.com"
DEM_TILES=(
  "Copernicus_DSM_COG_10_N27_00_E084_00_DEM"
  "Copernicus_DSM_COG_10_N27_00_E085_00_DEM"
  "Copernicus_DSM_COG_10_N28_00_E084_00_DEM"
  "Copernicus_DSM_COG_10_N28_00_E085_00_DEM"
)

if [ ! -f "$WORK/glo30.tif" ]; then
  for t in "${DEM_TILES[@]}"; do
    if [ ! -f "$WORK/$t.tif" ]; then
      echo "Fetching $t ..."
      curl -sS -o "$WORK/$t.tif" "$BASE_URL/$t/$t.tif"
    fi
  done

  "$GDAL_BIN/gdalbuildvrt" "$WORK/mosaic.vrt" "${DEM_TILES[@]/%/.tif}" \
    2>/dev/null || \
  "$GDAL_BIN/gdalbuildvrt" "$WORK/mosaic.vrt" \
    "$WORK/${DEM_TILES[0]}.tif" "$WORK/${DEM_TILES[1]}.tif" \
    "$WORK/${DEM_TILES[2]}.tif" "$WORK/${DEM_TILES[3]}.tif"

  "$GDAL_BIN/gdalwarp" -te $MINLON $MINLAT $MAXLON $MAXLAT -t_srs EPSG:4326 \
    -of COG -co COMPRESS=DEFLATE -co BIGTIFF=IF_SAFER \
    "$WORK/mosaic.vrt" "$WORK/glo30.tif"
fi

# Sanity check: compare against R/data/dem/glo30_focus.asc (small crop over
# Trisuli Bazar) - values should be close (within a few metres, given
# resampling/pixel-alignment differences), not identical.

# ---------------------------------------------------------------------------
# 2. Contours: gdal_contour at 10 m interval with an `ele` (metres) attribute,
#    then split into 5 mutually-exclusive elevation classes so each MVT layer
#    only carries the lines specific to its resolution band (no duplicate
#    geometry across layers at a given zoom). `idx`=1 flags contours that are
#    also multiples of 100 m (useful for bolder-line styling).
# ---------------------------------------------------------------------------
"$GDAL_BIN/gdal_contour" -a ele -i 10.0 -f GPKG -nln contours10 \
  "$WORK/glo30.tif" "$WORK/contours_10m.gpkg"

SPLIT_GPKG="$WORK/contours_split.gpkg"
rm -f "$SPLIT_GPKG"

mk_class () {
  local name="$1" where="$2"
  local first_opt=()
  [ -f "$SPLIT_GPKG" ] && first_opt=(-update)
  "$GDAL_BIN/ogr2ogr" -f GPKG "${first_opt[@]}" "$SPLIT_GPKG" \
    "$WORK/contours_10m.gpkg" -dialect sqlite -sql \
    "SELECT geom, CAST(ROUND(ele) AS INTEGER) AS ele, \
            CASE WHEN CAST(ROUND(ele) AS INTEGER) % 100 = 0 THEN 1 ELSE 0 END AS idx \
     FROM contours10 WHERE $where" \
    -nln "$name" -nlt LINESTRING
}

mk_class c1000 "CAST(ROUND(ele) AS INTEGER) % 1000 = 0"
mk_class c500  "CAST(ROUND(ele) AS INTEGER) % 500 = 0 AND CAST(ROUND(ele) AS INTEGER) % 1000 != 0"
mk_class c100  "CAST(ROUND(ele) AS INTEGER) % 100 = 0 AND CAST(ROUND(ele) AS INTEGER) % 500 != 0"
mk_class c50   "CAST(ROUND(ele) AS INTEGER) % 50 = 0  AND CAST(ROUND(ele) AS INTEGER) % 100 != 0"
mk_class c10   "CAST(ROUND(ele) AS INTEGER) % 10 = 0  AND CAST(ROUND(ele) AS INTEGER) % 50 != 0"

# Per-layer zoom ranges via the MVT driver's CONF option. NOTE: the JSON keys
# are "minzoom"/"maxzoom" (no underscore) and the layer map is the TOP LEVEL
# of the JSON (not nested under a "layers" key) - both are easy to get wrong
# and the driver silently falls back to the dataset-wide MINZOOM/MAXZOOM if
# the keys don't match, which produced an oversized (350+ MB) first attempt.
cat > "$WORK/mvt_conf.json" <<'EOF'
{
  "c1000": { "target_name": "c1000", "minzoom": 8,  "maxzoom": 15 },
  "c500":  { "target_name": "c500",  "minzoom": 9,  "maxzoom": 15 },
  "c100":  { "target_name": "c100",  "minzoom": 11, "maxzoom": 15 },
  "c50":   { "target_name": "c50",   "minzoom": 13, "maxzoom": 15 },
  "c10":   { "target_name": "c10",   "minzoom": 14, "maxzoom": 15 }
}
EOF

# The MVT driver refuses to Create() into a directory that already exists.
[ -d "$TILES/contours" ] && rmdir "$TILES/contours" 2>/dev/null || true

"$GDAL_BIN/ogr2ogr" -f MVT "$TILES/contours" "$SPLIT_GPKG" \
  c1000 c500 c100 c50 c10 \
  -dsco MINZOOM=8 -dsco MAXZOOM=15 -dsco COMPRESS=NO -dsco FORMAT=DIRECTORY \
  -dsco NAME=trisuli-contours \
  -dsco DESCRIPTION="Trisuli/Bhote Koshi flood map contours, GLO-30" \
  -dsco BOUNDS="$MINLON,$MINLAT,$MAXLON,$MAXLAT" \
  -dsco CONF="$WORK/mvt_conf.json"

# Sanity check: tile z14 containing lon 85.152 lat 27.925 should exist and
# decode with the MVT driver, e.g.:
#   ogrinfo -oo X=<x> -oo Y=<y> -oo Z=14 MVT:"$TILES/contours"

# ---------------------------------------------------------------------------
# 3. Hillshade: multidirectional, degrees z-factor, tiled as XYZ WEBP.
#    gdal2tiles/WEBP requires 3 or 4 bands, so the single-band hillshade is
#    duplicated into a fake-RGB GeoTIFF before tiling.
# ---------------------------------------------------------------------------
"$GDAL_BIN/gdaldem" hillshade -multidirectional -s 111120 -compute_edges \
  -of COG -co COMPRESS=DEFLATE "$WORK/glo30.tif" "$WORK/hillshade.tif"

"$GDAL_BIN/gdal_translate" -b 1 -b 1 -b 1 -co COMPRESS=DEFLATE \
  "$WORK/hillshade.tif" "$WORK/hillshade_rgb.tif"

[ -d "$TILES/hillshade" ] && rmdir "$TILES/hillshade" 2>/dev/null || true

"$GDAL_BIN/gdal2tiles.py" --xyz --profile=mercator --tiledriver=WEBP \
  --webp-quality=75 -z 8-14 --processes=8 \
  "$WORK/hillshade_rgb.tif" "$TILES/hillshade"

echo "Done. See $ROOT/data/terrain.json for the layer descriptor."
