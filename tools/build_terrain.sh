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

if [ ! -f "$WORK/glo30.tif" ] && [ ! -f "$WORK/contours_10m.gpkg" ]; then
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
[ -f "$WORK/contours_10m.gpkg" ] || \
"$GDAL_BIN/gdal_contour" -a ele -i 10.0 -f GPKG -nln contours10 \
  "$WORK/glo30.tif" "$WORK/contours_10m.gpkg"

SPLIT_GPKG="$WORK/contours_split.gpkg"
rm -f "$SPLIT_GPKG"

# Three clip masks (owner direction, 6 Sep 2026): the fine classes (c50, c10)
# are limited to the HOT flood-affected AOI (observed 27 Aug flood extent +
# 200 m, the "area of interest outline" in the app); c100 extends 2 km beyond
# it so the valley sides read; c500 and c1000 extend 10 km so the surrounding
# ridges are placed without drowning the map in lines. Earlier builds: full
# extent for the coarse classes with c50/c10 on the 1 km river corridor
# (76 MB), then all classes on the flood AOI (2.4 MB), then coarse classes to
# 1 km (4.2 MB) — see work/contours_v*. Full-extent c10 alone was ~226 MB, so
# the clipping is also what keeps the tileset small.
#
# The collapse origin (UNOSAT detachment zone, its centroid and the barrier
# lakes, data/hdx/derived/collapse_origin.geojson) sits ~85.48-85.53 E,
# 28.28-28.33 N, i.e. north-east of and outside every one of those buffers, so
# it had no contours at all. A 3 km buffer around it is unioned into the 2 km
# and 10 km clips and is also used as an extra full-opacity (fade=0) area for
# c50/c10, so all five classes are present at the source of the event
# (owner direction, 17 Sep 2026).
#
# Those two areas are ~6 km apart, which left a hole with no contours along the
# Lhende valley between them. The third clip is that connecting corridor: the
# OSM Lende Khola (waterway=river), which runs from inside the flood AOI up to
# 85.431 E, 28.330 N, plus a hand-drawn extension for the last 4.5 km that OSM
# does not map. The extension's vertices are the valley floor, read off the
# GLO-30 mosaic as the lowest cell per longitude column between 85.43 and
# 85.51 E over the 28.26-28.35 N band (2284 m at the river end rising to
# 3324 m at the detachment zone). Buffered 1.5 km, this joins the flood AOI
# clip and the origin buffer into one continuous area.
AOI_FINE="$ROOT/data/hdx/hot_flood_npl/hot_flood_npl_aoi.geojson"
AOI_MID="$WORK/aoi_flood_2km.geojson"
AOI_WIDE="$WORK/aoi_flood_10km.geojson"
ORIGIN_SRC="$ROOT/data/hdx/derived/collapse_origin.geojson"
AOI_ORIGIN="$WORK/aoi_origin_3km.geojson"
ORIGIN_BUF_M="${ORIGIN_BUF_M:-3000}"
WATERWAYS="$ROOT/data/hdx/hot_flood_npl/waterways_osm.geojson"
AOI_CORRIDOR="$WORK/aoi_lhende_corridor.geojson"
CORRIDOR_BUF_M="${CORRIDOR_BUF_M:-1500}"
CORRIDOR_EXT="LINESTRING(85.4296 28.3306, 85.4432 28.3356, 85.4612 28.3367, \
85.4748 28.3336, 85.4883 28.3308, 85.5019 28.3333, 85.5109 28.3317)"
# Buffers computed in UTM 45N so the distances are metric, then back to WGS84.
rm -f "$AOI_MID" "$AOI_WIDE" "$AOI_ORIGIN" "$AOI_CORRIDOR" "$WORK/aoi_utm.gpkg"
"$GDAL_BIN/ogr2ogr" -f GPKG -t_srs EPSG:32645 "$WORK/aoi_utm.gpkg" "$AOI_FINE" -nln aoi
# collapse_origin.geojson mixes polygons and a point, hence -nlt GEOMETRY.
"$GDAL_BIN/ogr2ogr" -f GPKG -update -t_srs EPSG:32645 "$WORK/aoi_utm.gpkg" \
  "$ORIGIN_SRC" -nln origin -nlt GEOMETRY
"$GDAL_BIN/ogr2ogr" -f GPKG -update -t_srs EPSG:32645 "$WORK/aoi_utm.gpkg" \
  "$WATERWAYS" -nln corridor -nlt LINESTRING -dialect sqlite -sql \
  "SELECT geometry AS geom FROM waterways
    WHERE waterway = 'river' AND name_en = 'Lende Khola'
   UNION ALL SELECT GeomFromText('$CORRIDOR_EXT', 4326) AS geom"
"$GDAL_BIN/ogr2ogr" -f GeoJSON -t_srs EPSG:4326 "$AOI_ORIGIN" "$WORK/aoi_utm.gpkg" \
  -dialect sqlite -sql \
  "SELECT ST_Union(ST_Buffer(geom, $ORIGIN_BUF_M)) AS geom FROM origin"
# The corridor's fade=0 area has the other two fade=0 areas subtracted, so the
# three c50/c10 passes below stay mutually exclusive: without this the stretch
# of corridor inside the flood AOI would emit a second, full-opacity copy of
# lines the HAND bands already place at fade 1 or 2.
"$GDAL_BIN/ogr2ogr" -f GeoJSON -t_srs EPSG:4326 "$AOI_CORRIDOR" "$WORK/aoi_utm.gpkg" \
  -dialect sqlite -sql \
  "SELECT ST_Difference(ST_Difference(c.g, a.g), o.g) AS geom FROM
     (SELECT ST_Union(ST_Buffer(geom, $CORRIDOR_BUF_M)) g FROM corridor) c,
     (SELECT ST_Union(ST_Buffer(geom, 2000)) g FROM aoi) a,
     (SELECT ST_Union(ST_Buffer(geom, $ORIGIN_BUF_M)) g FROM origin) o"
"$GDAL_BIN/ogr2ogr" -f GeoJSON -t_srs EPSG:4326 "$AOI_MID" "$WORK/aoi_utm.gpkg" \
  -dialect sqlite -sql \
  "SELECT ST_Union(geom) AS geom FROM (
     SELECT ST_Buffer(geom, 2000) AS geom FROM aoi
     UNION ALL SELECT ST_Buffer(geom, $ORIGIN_BUF_M) AS geom FROM origin
     UNION ALL SELECT ST_Buffer(geom, $CORRIDOR_BUF_M) AS geom FROM corridor)"
"$GDAL_BIN/ogr2ogr" -f GeoJSON -t_srs EPSG:4326 "$AOI_WIDE" "$WORK/aoi_utm.gpkg" \
  -dialect sqlite -sql \
  "SELECT ST_Union(geom) AS geom FROM (
     SELECT ST_Buffer(geom, 10000) AS geom FROM aoi
     UNION ALL SELECT ST_Buffer(geom, $ORIGIN_BUF_M) AS geom FROM origin
     UNION ALL SELECT ST_Buffer(geom, $CORRIDOR_BUF_M) AS geom FROM corridor)"

# ---------------------------------------------------------------------------
# 2b. Height-above-river (HAND-style) clip for c10/c50 (owner direction,
#     6 Sep 2026: "cut-off contours look untidy; clip by height above river
#     and fade the edge"). A polygon clip on the flood AOI left ugly stub
#     ends where fine contours crossed the AOI boundary mid-gully. Instead we
#     estimate a local river-surface elevation, spread it across the valley,
#     and clip c10/c50 by how far a pixel sits above that surface, split into
#     three bands that fade out (see the "fade" attribute added to c10/c50
#     below and the data-driven line-opacity in app/app.js).
#
#     1. Rasterize a "water" mask (flood extent polygon + OSM waterway=river
#        lines, NOT streams/tributaries which would drag the surface up side
#        gullies) on the DEM grid, burn river elevation from the DEM there.
#     2. gdal_fillnodata spreads that river elevation across the valley within
#        a bounded search radius (~3 km); beyond that pixels stay nodata,
#        which is what bounds the mask (no further blending needed).
#     3. hab = DEM - spread river elevation.
#     4. Threshold hab into three bands, each also hard-limited to the 2 km
#        flood AOI buffer, polygonized and dissolved with slivers dropped.
# ---------------------------------------------------------------------------
HAB_FULL="${HAB_FULL:-80}"
HAB_MID="${HAB_MID:-100}"
HAB_MAX="${HAB_MAX:-120}"
UTM=EPSG:32645
SLIVER_M2=1800   # ~2 DEM pixels (30 m) in UTM45N

RIVER_LINES="$WORK/hab_rivers.geojson"
WATER_MASK="$WORK/hab_water_mask.tif"
RIVER_ELEV_RAW="$WORK/hab_river_elev_raw.tif"
RIVER_ELEV_FILLED="$WORK/hab_river_elev_filled.tif"
HAB_TIF="$WORK/hab.tif"

rm -f "$RIVER_LINES" "$WATER_MASK" "$RIVER_ELEV_RAW" "$RIVER_ELEV_FILLED" "$HAB_TIF"

"$GDAL_BIN/ogr2ogr" -f GeoJSON "$RIVER_LINES" \
  "$ROOT/data/hdx/hot_flood_npl/waterways_osm.geojson" \
  -where "waterway='river'" -clipsrc "$AOI_FINE"

# Byte mask on the DEM grid: 1 = water (flood extent OR river centerline).
"$GDAL_BIN/gdal_calc.py" -A "$WORK/glo30.tif" --outfile="$WATER_MASK" \
  --calc="0*A" --type=Byte --overwrite --quiet
"$GDAL_BIN/gdal_rasterize" -q -burn 1 \
  "$ROOT/data/hdx/hot_flood_npl/hot_flood_npl_flood_extent.geojson" "$WATER_MASK"
"$GDAL_BIN/gdal_rasterize" -q -burn 1 "$RIVER_LINES" "$WATER_MASK"

# river_elev = DEM where water mask = 1, nodata elsewhere.
"$GDAL_BIN/gdal_calc.py" -A "$WORK/glo30.tif" -B "$WATER_MASK" \
  --outfile="$RIVER_ELEV_RAW" \
  --calc="(B==1)*A + (B!=1)*(-9999)" --NoDataValue=-9999 --type=Float32 \
  --overwrite --quiet

# Spread the river surface ~3 km (100 px @ 30 m) across the valley; beyond
# that pixels stay nodata, which bounds the mask.
"$GDAL_BIN/gdal_fillnodata.py" -md 100 -si 2 -q \
  "$RIVER_ELEV_RAW" "$RIVER_ELEV_FILLED"

"$GDAL_BIN/gdal_calc.py" -A "$WORK/glo30.tif" -B "$RIVER_ELEV_FILLED" \
  --outfile="$HAB_TIF" --calc="A-B" --NoDataValue=-9999 --type=Float32 \
  --overwrite --quiet

mk_band () {
  local idx="$1" thresh="$2"
  local rast="$WORK/hab_band${idx}.tif"
  local raw="$WORK/hab_band${idx}_raw.gpkg"
  local raw_utm="$WORK/hab_band${idx}_utm.gpkg"
  local dissolved="$WORK/hab_band${idx}_dissolved.geojson"
  local out="$WORK/hab_band${idx}.geojson"
  rm -f "$rast" "$raw" "$raw_utm" "$dissolved" "$out"
  "$GDAL_BIN/gdal_calc.py" -A "$HAB_TIF" --outfile="$rast" --calc="$thresh" \
    --NoDataValue=0 --type=Byte --overwrite --quiet
  "$GDAL_BIN/gdal_polygonize.py" -q "$rast" -f GPKG "$raw" band DN
  "$GDAL_BIN/ogr2ogr" -f GPKG -t_srs $UTM "$raw_utm" "$raw" -nln band
  "$GDAL_BIN/ogr2ogr" -f GeoJSON -t_srs EPSG:4326 "$dissolved" "$raw_utm" \
    -dialect sqlite -sql \
    "SELECT ST_Union(geom) AS geom FROM band WHERE DN=1 AND ST_Area(geom) >= $SLIVER_M2"
  "$GDAL_BIN/ogr2ogr" -f GeoJSON "$out" "$dissolved" -clipsrc "$AOI_MID"
}

mk_band 0 "1*(A<$HAB_FULL)"
mk_band 1 "1*(A>=$HAB_FULL)*(A<$HAB_MID)"
mk_band 2 "1*(A>=$HAB_MID)*(A<$HAB_MAX)"

HAB_BAND0="$WORK/hab_band0.geojson"
HAB_BAND1="$WORK/hab_band1.geojson"
HAB_BAND2="$WORK/hab_band2.geojson"

mk_class () {
  local name="$1" where="$2" clip="$3"
  local first_opt=()
  [ -f "$SPLIT_GPKG" ] && first_opt=(-update)
  "$GDAL_BIN/ogr2ogr" -f GPKG ${first_opt[@]+"${first_opt[@]}"} "$SPLIT_GPKG" \
    "$WORK/contours_10m.gpkg" -dialect sqlite -sql \
    "SELECT geom, CAST(ROUND(ele) AS INTEGER) AS ele, \
            CASE WHEN CAST(ROUND(ele) AS INTEGER) % 100 = 0 THEN 1 ELSE 0 END AS idx, \
            0 AS fade \
     FROM contours10 WHERE $where" \
    -nln "$name" -nlt LINESTRING -clipsrc "$clip"
}

# c10/c50: clipped per HAND fade band in turn, appended into one layer with
# an integer `fade` attribute (0/1/2) so the app can fade opacity by band.
# The collapse-origin buffer and the Lhende corridor are appended as two
# further fade=0 areas. The HAND surface is only spread ~3 km from the mapped
# rivers and so never reaches either of them, and the corridor polygon has the
# other two subtracted when it is built above, so all four passes are mutually
# exclusive and no contour is emitted twice.
mk_class_faded () {
  local name="$1" where="$2"
  local first=1
  local spec clip fade
  for spec in "$HAB_BAND0:0" "$HAB_BAND1:1" "$HAB_BAND2:2" \
              "$AOI_ORIGIN:0" "$AOI_CORRIDOR:0"; do
    clip="${spec%:*}"
    fade="${spec##*:}"
    local opts=(-update)
    [ "$first" -eq 0 ] && opts+=(-append)
    first=0
    "$GDAL_BIN/ogr2ogr" -f GPKG "${opts[@]}" "$SPLIT_GPKG" \
      "$WORK/contours_10m.gpkg" -dialect sqlite -sql \
      "SELECT geom, CAST(ROUND(ele) AS INTEGER) AS ele, \
              CASE WHEN CAST(ROUND(ele) AS INTEGER) % 100 = 0 THEN 1 ELSE 0 END AS idx, \
              $fade AS fade \
       FROM contours10 WHERE $where" \
      -nln "$name" -nlt LINESTRING -clipsrc "$clip"
  done
}

mk_class c1000 "CAST(ROUND(ele) AS INTEGER) % 1000 = 0" "$AOI_WIDE"
mk_class c500  "CAST(ROUND(ele) AS INTEGER) % 500 = 0 AND CAST(ROUND(ele) AS INTEGER) % 1000 != 0" "$AOI_WIDE"
mk_class c100  "CAST(ROUND(ele) AS INTEGER) % 100 = 0 AND CAST(ROUND(ele) AS INTEGER) % 500 != 0" "$AOI_MID"
mk_class_faded c50 "CAST(ROUND(ele) AS INTEGER) % 50 = 0  AND CAST(ROUND(ele) AS INTEGER) % 100 != 0"
mk_class_faded c10 "CAST(ROUND(ele) AS INTEGER) % 10 = 0  AND CAST(ROUND(ele) AS INTEGER) % 50 != 0"

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

# Keep a copy of the previous tileset (repo convention, work/contours_v*)
# before it's overwritten.
if [ -d "$TILES/contours" ] && [ ! -d "$WORK/contours_v10_aoi_polygon_clip" ]; then
  cp -R "$TILES/contours" "$WORK/contours_v10_aoi_polygon_clip"
fi

# The MVT driver refuses to Create() into a directory that already exists.
rm -rf "$TILES/contours"

"$GDAL_BIN/ogr2ogr" -f MVT "$TILES/contours" "$SPLIT_GPKG" \
  c1000 c500 c100 c50 c10 \
  -dsco MINZOOM=8 -dsco MAXZOOM=15 -dsco COMPRESS=NO -dsco FORMAT=DIRECTORY \
  -dsco NAME=trisuli-contours \
  -dsco DESCRIPTION="Trisuli/Bhote Koshi flood map contours, GLO-30: 10/50 m clipped by height above river (HAND-style; fade bands at ${HAB_FULL}/${HAB_MID}/${HAB_MAX} m, hard-limited to 2 km of the flood AOI) plus a ${ORIGIN_BUF_M} m buffer of the collapse origin and a ${CORRIDOR_BUF_M} m Lhende valley corridor between the two, both at full opacity, 100 m to 2 km beyond the AOI, 500/1000 m to 10 km; all buffers unioned with the collapse-origin buffer and the corridor" \
  -dsco BOUNDS="$MINLON,$MINLAT,$MAXLON,$MAXLAT" \
  -dsco CONF="$WORK/mvt_conf.json"

# Sanity check: tile z14 containing lon 85.152 lat 27.925 should exist and
# decode with the MVT driver, e.g.:
#   ogrinfo -oo X=<x> -oo Y=<y> -oo Z=14 MVT:"$TILES/contours"

if [ "${SKIP_HILLSHADE:-0}" = "1" ]; then echo "Contours done (hillshade skipped)."; exit 0; fi

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
