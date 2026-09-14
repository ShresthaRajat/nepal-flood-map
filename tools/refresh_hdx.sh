#!/usr/bin/env bash
# refresh_hdx.sh — pull the latest HOT/HDX exports and rebuild everything derived from them.
#
#   1. GeoJSON per layer, the combined files (AOI, flood extent, bridge damage,
#      exposed hydropowers, Tasking Manager projects), layer metadata and the
#      PMTiles archive, for both datasets -> data/hdx/<dataset>/, data/hdx/pmtiles/
#   2. GeoPackages re-downloaded and re-tiled by build_hdx_tiles.sh
#      (its skip-if-present rule means the old GeoPackages are cleared first)
#   3. Derived overlays: roads inside the flood extent (build_flooded_roads.py)
#   4. Category counts and snapshot dates in app/config.js, README.md and
#      docs/LICENSING.md, recomputed from the downloaded data (update_hdx_counts.py)
#
# Prints a before/after count table.  Nothing is committed.  ~20-30 min.
# Requires curl, unzip, python3 (+ osgeo), GDAL; see build_hdx_tiles.sh.

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
DATASETS=(hot_flood_npl hot_flood_npl_corridor)
WORK="work/hdx_refresh"; mkdir -p "$WORK" data/hdx/pmtiles

echo "==> snapshot of current counts"
python3 tools/update_hdx_counts.py --snapshot "$WORK/counts_before.json"

echo "==> resolving HDX resources"
for ds in "${DATASETS[@]}"; do
  curl -sS -f "https://data.humdata.org/api/3/action/package_show?id=${ds}" -o "$WORK/${ds}.package.json"
done

python3 - "$WORK" "${DATASETS[@]}" <<'PYEOF'
import json, os, subprocess, sys, zipfile, re, shutil
work, datasets = sys.argv[1], sys.argv[2:]
for ds in datasets:
    pkg = json.load(open(os.path.join(work, f'{ds}.package.json')))['result']
    out = os.path.join('data', 'hdx', ds); os.makedirs(out, exist_ok=True)
    tmp = os.path.join(work, ds); shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
    n_layers = n_combined = 0
    for r in pkg['resources']:
        url, fmt = r['url'], (r.get('format') or '')
        name = url.rsplit('/', 1)[-1]
        if fmt == 'PMTiles':
            subprocess.run(['curl', '-sS', '-f', '-L', '-o', os.path.join('data', 'hdx', 'pmtiles', name), url], check=True)
        elif fmt == 'GeoJSON' and name.endswith('_geojson.zip'):
            # <ds>_<layer>_<src>_geojson.zip -> <layer>_<src>.geojson (zip holds <layer>.geojson + README/config/metadata)
            stem = name[len(ds) + 1:-len('_geojson.zip')]              # e.g. bridges_osm
            z = os.path.join(tmp, name); subprocess.run(['curl', '-sS', '-f', '-L', '-o', z, url], check=True)
            with zipfile.ZipFile(z) as zf:
                for m in zf.namelist():
                    if m.endswith('.geojson'):
                        with zf.open(m) as src, open(os.path.join(out, stem + '.geojson'), 'wb') as dst: shutil.copyfileobj(src, dst)
                    elif m in ('README.txt', 'config.yaml', 'metadata.json'):
                        zf.extract(m, out)
            n_layers += 1
        elif fmt in ('GeoJSON', 'JSON') and '/combined/' in url:
            subprocess.run(['curl', '-sS', '-f', '-L', '-o', os.path.join(out, name if fmt == 'GeoJSON' else 'metadata_' + name.split('_')[-2] + '.json'), url], check=True)
            n_combined += 1
        elif fmt == 'GeoJSON' and name.startswith(ds + '_') and name.endswith('.geojson'):
            # HDX now ships per-layer files unzipped, no README/config/metadata bundle:
            # <ds>_<layer>_<src>.geojson -> <layer>_<src>.geojson.  A handful of singular,
            # non-category resources (e.g. tasking_manager/<ds>_tm_projects.geojson) don't
            # follow the category|source split and keep their full ds-prefixed name instead,
            # matching how the app and other combined files reference them.
            stem = name[len(ds) + 1:-len('.geojson')]              # e.g. bridges_osm
            fname = stem + '.geojson' if stem.endswith(('_osm', '_overture')) else name
            subprocess.run(['curl', '-sS', '-f', '-L', '-o', os.path.join(out, fname), url], check=True)
            n_layers += 1
    # HDX no longer ships a companion README.txt with the per-layer bundle (that format is
    # gone); refresh its Generated/Snapshot lines from metadata_osm.json instead, which HOT
    # does regenerate every export and which update_hdx_counts.py's snapshot_dates() reads.
    meta_path = os.path.join(out, 'metadata_osm.json')
    readme_path = os.path.join(out, 'README.txt')
    if os.path.exists(meta_path):
        layers = json.load(open(meta_path)).get('layers') or []
        gens = [l['generated_utc'] for l in layers if l.get('generated_utc')]
        snaps = [l['snapshot_label'] for l in layers if l.get('snapshot_label')]
        if gens:
            gen_dt = max(gens)[:10] + ' ' + max(gens)[11:16] + ' UTC'
            snap = max(snaps) if snaps else max(gens)
            if os.path.exists(readme_path):
                s = open(readme_path).read()
                s2 = re.sub(r'^Generated:\s+\S+ \S+ UTC', f'Generated:        {gen_dt}', s, flags=re.M)
                s2 = re.sub(r'^Snapshot:\s+\S+', f'Snapshot:         {snap}', s2, flags=re.M)
                open(readme_path, 'w').write(s2)
            else:
                open(readme_path, 'w').write(f'Generated:        {gen_dt}\nSnapshot:         {snap}\n')
    print(f'   {ds}: {n_layers} layer files, {n_combined} combined files, PMTiles refreshed')
PYEOF

echo "==> re-downloading GeoPackages and re-tiling"
for ds in "${DATASETS[@]}"; do rm -rf "data/hdx/gpkg/$ds"; done
./tools/build_hdx_tiles.sh 2>&1 | grep -E "^(==>|---|  [a-z_]+ +features=| +elapsed)" || true

echo "==> derived overlays"
python3 tools/build_flooded_roads.py 2>&1 | grep -v "^Warning" | tail -6

echo "==> counts and snapshot dates"
python3 tools/update_hdx_counts.py --apply --before "$WORK/counts_before.json"

echo "==> done. Review with: git status --short | grep -v '^.. data/hdx/tiles/'"
