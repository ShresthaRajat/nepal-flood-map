#!/usr/bin/env bash
# build_hdx_tiles.sh
#
# Rebuilds attribute-complete Mapbox Vector Tiles for the two HOT/HDX flood
# response datasets covering the 2026 Bhote Koshi-Trishuli flood:
#   - hot_flood_npl           (Kathmandu valley / upper catchment AOI)
#   - hot_flood_npl_corridor  (Bhote Koshi-Trishuli river corridor AOI)
#
# HOT's own PMTiles archives on HDX strip every attribute except
# category/source/name. This script re-downloads the source GeoPackage
# resources (which retain all fields, including `status`, `highway`,
# `bridge_structure`, `building`, `damage_type` etc.) and re-tiles them
# with ogr2ogr so every field survives into the vector tiles.
#
# Pipeline: download zips -> unzip per layer -> build one MVT tileset
# per dataset (one source-layer per HOT layer, e.g. roads_osm, bridges_osm).
#
# Requires: curl, unzip, GDAL 3.13+ (ogr2ogr/ogrinfo with MVT driver),
# python3 with the GDAL Python bindings (osgeo). No tippecanoe.
#
# Writes only under:
#   data/hdx/gpkg/<dataset>/<layer>/   (downloaded GeoPackages, gitignored)
#   data/hdx/tiles/<dataset>/          (MVT tile output)
#   work/                              (scratch/log files)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

GPKG_ROOT="$REPO_ROOT/data/hdx/gpkg"
TILES_ROOT="$REPO_ROOT/data/hdx/tiles"
WORK_DIR="$REPO_ROOT/work/hdx_tiles_build"
OGR2OGR="${OGR2OGR:-/opt/homebrew/bin/ogr2ogr}"
OGRINFO="${OGRINFO:-/opt/homebrew/bin/ogrinfo}"
PYTHON="${PYTHON:-python3}"

# Dataset names double as their HDX CKAN package ids.
DATASETS=(hot_flood_npl hot_flood_npl_corridor)

mkdir -p "$GPKG_ROOT" "$TILES_ROOT" "$WORK_DIR"

# ---------------------------------------------------------------------------
# Step 1: resolve GeoPackage resource URLs from the HDX CKAN API
# ---------------------------------------------------------------------------
echo "==> Fetching HDX package metadata..."
for ds in "${DATASETS[@]}"; do
  curl -sS -f "https://data.humdata.org/api/3/action/package_show?id=${ds}" \
    -o "$WORK_DIR/${ds}.package.json"
done

"$PYTHON" - "$WORK_DIR" "${DATASETS[@]}" <<'PYEOF'
import json, sys, os
work_dir = sys.argv[1]
datasets = sys.argv[2:]
lines = []
for ds in datasets:
    d = json.load(open(os.path.join(work_dir, f"{ds}.package.json")))
    for r in d["result"]["resources"]:
        fmt = (r.get("format") or "").lower()
        if "geopackage" in fmt:
            lines.append(f"{ds} {r['url']}")
with open(os.path.join(work_dir, "gpkg_urls.txt"), "w") as f:
    f.write("\n".join(lines) + "\n")
print(f"Resolved {len(lines)} GeoPackage resource URLs.")
PYEOF

# ---------------------------------------------------------------------------
# Step 2: download + unzip each GeoPackage into its own layer subdirectory
#         (the zips all contain an internally-named <category>.gpkg, so a
#         flat unzip would clobber e.g. buildings_osm and buildings_overture
#         into the same buildings.gpkg -- unzip each into its own folder)
# ---------------------------------------------------------------------------
echo "==> Downloading and unzipping GeoPackage resources..."
mkdir -p "$WORK_DIR/dl"
while read -r ds url; do
  [ -z "$url" ] && continue
  fname=$(basename "$url")
  base="${fname%_gpkg.zip}"
  case "$ds" in
    hot_flood_npl_corridor) resname="${base#hot_flood_npl_corridor_}" ;;
    *)                      resname="${base#hot_flood_npl_}" ;;
  esac
  outdir="$GPKG_ROOT/$ds/$resname"
  mkdir -p "$outdir"
  if [ -n "$(ls -A "$outdir" 2>/dev/null)" ]; then
    echo "  skip (already present) $ds/$resname"
    continue
  fi
  echo "  fetching $ds/$resname"
  curl -sS -f -L "$url" -o "$WORK_DIR/dl/$fname"
  unzip -oq "$WORK_DIR/dl/$fname" -d "$outdir"
done < "$WORK_DIR/gpkg_urls.txt"

# ---------------------------------------------------------------------------
# Step 3: build one MVT tileset per dataset, one source-layer per HOT layer,
#         with per-layer minzoom tiers set via GDAL's Python API (the MVT
#         driver has no update/append capability and ogr2ogr's CLI -lco
#         flags apply uniformly to every layer in a single invocation, so
#         per-layer minzoom requires driving CreateLayer() directly).
#
#   z9  (lines):  roads_osm, bridges_osm, waterways_osm, destroyed_features_osm
#   z10 (points/small polygons): education/financial/health facilities,
#       helipads, open_spaces, points_of_interest, police_stations,
#       populated_places (osm + overture variants)
#   z12 (large polygons): buildings_osm, buildings_overture, residential_areas_osm
#
#   All fields are kept except adm<N>_pcode (adm0_pcode..adm4_pcode);
#   adm2_name/adm3_name and all other admin-name fields are kept.
# ---------------------------------------------------------------------------
echo "==> Building MVT tiles..."
"$PYTHON" - "$GPKG_ROOT" "$TILES_ROOT" "${DATASETS[@]}" <<'PYEOF'
import os, re, shutil, sys, time
from osgeo import ogr, gdal

gdal.UseExceptions()
ogr.UseExceptions()

gpkg_root, tiles_root = sys.argv[1], sys.argv[2]
datasets = sys.argv[3:]

PCODE_RE = re.compile(r"^adm\d_pcode$")
DATASET_MINZOOM, DATASET_MAXZOOM = 8, 15

ZOOM_TIERS = {
    9: ["roads_osm", "bridges_osm", "waterways_osm", "destroyed_features_osm"],
    10: [
        "education_facilities_osm", "education_facilities_overture",
        "financial_services_osm",
        "health_facilities_osm", "health_facilities_overture",
        "helipads_osm", "open_spaces_osm",
        "points_of_interest_osm", "points_of_interest_overture",
        "police_stations_osm", "populated_places_osm",
    ],
    12: ["buildings_osm", "buildings_overture", "residential_areas_osm"],
}
MINZOOM_MAP = {l: z for z, layers in ZOOM_TIERS.items() for l in layers}

def build_dataset(dataset_name):
    ds_dir = os.path.join(gpkg_root, dataset_name)
    out_dir = os.path.join(tiles_root, dataset_name)
    if os.path.exists(out_dir):
        shutil.rmtree(out_dir)

    drv = ogr.GetDriverByName("MVT")
    dsco = [
        f"NAME={dataset_name}",
        "DESCRIPTION=HOT/HDX flood response features (attribute-complete)",
        "FORMAT=DIRECTORY",
        "COMPRESS=NO",
        f"MINZOOM={DATASET_MINZOOM}",
        f"MAXZOOM={DATASET_MAXZOOM}",
    ]
    out_ds = drv.CreateDataSource(out_dir, options=dsco)

    report = []
    for layer_key in sorted(os.listdir(ds_dir)):
        layer_dir = os.path.join(ds_dir, layer_key)
        if not os.path.isdir(layer_dir):
            continue
        gpkg_files = [f for f in os.listdir(layer_dir) if f.endswith(".gpkg")]
        if not gpkg_files:
            continue
        src_ds = ogr.Open(os.path.join(layer_dir, gpkg_files[0]))
        src_lyr = src_ds.GetLayer(0)
        src_defn = src_lyr.GetLayerDefn()
        srs = src_lyr.GetSpatialRef()

        minz = MINZOOM_MAP.get(layer_key, 10)
        lco = [f"MINZOOM={minz}", f"MAXZOOM={DATASET_MAXZOOM}", f"NAME={layer_key}"]
        out_lyr = out_ds.CreateLayer(layer_key, srs=srs, geom_type=ogr.wkbUnknown, options=lco)

        keep_fields = []
        for i in range(src_defn.GetFieldCount()):
            fd = src_defn.GetFieldDefn(i)
            if PCODE_RE.match(fd.GetName()):
                continue
            new_fd = ogr.FieldDefn(fd.GetName(), fd.GetType())
            new_fd.SetSubType(fd.GetSubType())
            new_fd.SetWidth(fd.GetWidth())
            new_fd.SetPrecision(fd.GetPrecision())
            out_lyr.CreateField(new_fd)
            keep_fields.append(fd.GetName())

        count = 0
        src_lyr.ResetReading()
        for feat in src_lyr:
            geom = feat.GetGeometryRef()
            if geom is None:
                continue
            new_feat = ogr.Feature(out_lyr.GetLayerDefn())
            for fname in keep_fields:
                new_feat.SetField(fname, feat.GetField(fname))
            new_feat.SetGeometry(geom.Clone())
            out_lyr.CreateFeature(new_feat)
            count += 1
        report.append((layer_key, count, minz, len(keep_fields)))
        src_ds = None

    out_ds = None  # closing triggers final tile flush
    return report

for ds in datasets:
    t0 = time.time()
    print(f"--- {ds} ---")
    for layer_key, count, minz, nfields in build_dataset(ds):
        print(f"  {layer_key:32s} features={count:7d} minzoom={minz:2d} fields={nfields}")
    print(f"  elapsed={time.time()-t0:.1f}s")
PYEOF

echo "==> Done. Tile output:"
du -sh "$TILES_ROOT"/* 2>/dev/null || true
