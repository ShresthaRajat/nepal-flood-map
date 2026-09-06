#!/usr/bin/env bash
# build_cog_tiles.sh <layer_id> <zmin> <zmax> <W> <S> <E> <N> <cog_url> [<cog_url> ...]
#
# Web tiles from one or more RGB cloud-optimised GeoTIFFs (e.g. Vantor open-data
# scenes), read through /vsicurl so only the blocks inside the window are
# fetched.  Companion to build_s2_tiles.sh; used by tools/imagery_watch.py.
#
#   tools/build_cog_tiles.sh post_wv02_20260828_cf1610 10 17 85.27 28.11 85.44 28.34 \
#       https://vantor-opendata.s3.amazonaws.com/events/Nepal-Flooding-Aug-2026/B030001100CF1610.tif
#
# Output: tiles/<layer_id>/{z}/{x}/{y}.webp, 256 px, alpha outside the footprint.
# Requires GDAL 3.6+ (gdalbuildvrt, gdalwarp, gdal2tiles with WEBP).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

LAYER="${1:?layer id}"; ZMIN="${2:?zmin}"; ZMAX="${3:?zmax}"
W="${4:?west}"; S="${5:?south}"; E="${6:?east}"; N="${7:?north}"; shift 7
[ $# -ge 1 ] || { echo "need at least one COG url" >&2; exit 1; }

WORK="work/cog/$LAYER"; OUT="tiles/$LAYER"
mkdir -p "$WORK"

urls=()
for u in "$@"; do case "$u" in http*) urls+=("/vsicurl/$u");; *) urls+=("$u");; esac; done

# Web Mercator pixel size at the max zoom (256 px tiles).
TR=$(python3 -c "print(156543.03392804097 / 2**$ZMAX)")

echo "==> VRT of ${#urls[@]} source(s)"
gdalbuildvrt -q -overwrite "$WORK/src.vrt" "${urls[@]}"

echo "==> warp to EPSG:3857 at $TR m/px, window $W $S $E $N"
GDAL_HTTP_MULTIRANGE=YES GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR GDAL_HTTP_MAX_RETRY=4 GDAL_HTTP_RETRY_DELAY=5 \
gdalwarp -q -overwrite -t_srs EPSG:3857 -te_srs EPSG:4326 -te "$W" "$S" "$E" "$N" \
  -tr "$TR" "$TR" -r bilinear -srcnodata 0 -dstalpha \
  -multi -wo NUM_THREADS=ALL_CPUS -co COMPRESS=DEFLATE -co TILED=YES -co BIGTIFF=IF_SAFER \
  "$WORK/src.vrt" "$WORK/$LAYER.3857.tif"

echo "==> tiling z$ZMIN-$ZMAX into $OUT"
rm -rf "$OUT"
gdal2tiles.py -q --xyz -z "$ZMIN-$ZMAX" -r bilinear --tiledriver=WEBP --webp-quality=82 \
  -w none --processes="$(sysctl -n hw.ncpu 2>/dev/null || nproc)" "$WORK/$LAYER.3857.tif" "$OUT"
rm -f "$OUT"/*.html "$OUT"/*.mapml "$OUT"/*.json
rm -f "$WORK/$LAYER.3857.tif"   # the warped mosaic can be hundreds of MB; the tiles are the product

echo "==> $(find "$OUT" -name '*.webp' | wc -l | tr -d ' ') tiles, $(du -sh "$OUT" | cut -f1)"
