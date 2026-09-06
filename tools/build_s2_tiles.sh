#!/usr/bin/env bash
# build_s2_tiles.sh <layer_id> <yyyy-mm-dd> <S2 item id> [<S2 item id> ...]
#
# Sentinel-2 L2A true-colour (TCI, 10 m) web tiles straight from the AWS open
# COG archive (Earth Search / sentinel-cogs), read through /vsicurl so only the
# blocks inside the corridor window are fetched.  Replaces the 20 m JPEG-based
# Sentinel-2 pyramids that tools/retile.py built from the trisuli-flood-map
# sources.
#
#   tools/build_s2_tiles.sh post_s2_20260827 2026-08-27 \
#       S2B_45RUL_20260827_0_L2A S2B_45RUM_20260827_0_L2A
#
# Output: tiles/<layer_id>/{z}/{x}/{y}.webp, z8-14 (z14 is ~8.4 m/px at 28 N,
# the first zoom that shows 10 m pixels 1:1), 256 px, alpha outside the
# footprint.  Update data/imagery.json afterwards (minzoom/maxzoom/size_mb).
#
# Requires GDAL 3.6+ (gdalbuildvrt, gdalwarp, gdal2tiles with the WEBP tile
# driver) and network access to sentinel-cogs.s3.us-west-2.amazonaws.com.
# © ESA Copernicus Sentinel data 2026; free use with attribution.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

LAYER="${1:?layer id, e.g. post_s2_20260827}"; DATE="${2:?date yyyy-mm-dd}"; shift 2
[ $# -ge 1 ] || { echo "need at least one Sentinel-2 item id" >&2; exit 1; }

# Corridor window, matching the existing Sentinel-2 layers in data/imagery.json.
W=84.375; S=27.683528; E=85.78125; N=28.613459
ZMIN=8; ZMAX=14
WORK="work/s2/$LAYER"; OUT="tiles/$LAYER"
mkdir -p "$WORK"

urls=()
for id in "$@"; do
  # S2B_45RUL_20260827_0_L2A -> 45/R/UL/2026/8/<id>/TCI.tif
  mgrs="${id:4:5}"; utm="${mgrs:0:2}"; lat="${mgrs:2:1}"; sq="${mgrs:3:2}"
  y="${DATE:0:4}"; m="$((10#${DATE:5:2}))"
  urls+=("/vsicurl/https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/$utm/$lat/$sq/$y/$m/$id/TCI.tif")
done

echo "==> mosaic VRT of ${#urls[@]} TCI scene(s)"
gdalbuildvrt -q -overwrite "$WORK/tci.vrt" "${urls[@]}"

# Web Mercator at the z14 pixel size; alpha from the 0-valued no-data outside the swath.
echo "==> warp to EPSG:3857 (this downloads the needed COG blocks)"
GDAL_HTTP_MULTIRANGE=YES GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR \
gdalwarp -q -overwrite -t_srs EPSG:3857 -te_srs EPSG:4326 -te "$W" "$S" "$E" "$N" \
  -tr 9.554628535647032 9.554628535647032 -r bilinear -srcnodata 0 -dstalpha \
  -multi -wo NUM_THREADS=ALL_CPUS -co COMPRESS=DEFLATE -co TILED=YES -co BIGTIFF=IF_SAFER \
  "$WORK/tci.vrt" "$WORK/$LAYER.3857.tif"

echo "==> tiling z$ZMIN-$ZMAX into $OUT"
rm -rf "$OUT"
gdal2tiles.py -q --xyz -z "$ZMIN-$ZMAX" -r bilinear --tiledriver=WEBP --webp-quality=82 \
  -w none --processes="$(sysctl -n hw.ncpu 2>/dev/null || nproc)" "$WORK/$LAYER.3857.tif" "$OUT"
rm -f "$OUT"/*.html "$OUT"/*.mapml "$OUT"/*.json

echo "==> $(find "$OUT" -name '*.webp' | wc -l | tr -d ' ') tiles, $(du -sh "$OUT" | cut -f1)  (source ${#urls[@]} scene(s), $DATE)"
