#!/usr/bin/env python3
"""Copernicus EMS road damage grading for activation EMSR927 (Nepal flood, Aug 2026).

Downloads the Rapid Mapping grading GeoPackages for the four areas of interest,
takes the road/bridge line features (`transportationL_*`) and merges them into
one GeoJSON with a common schema, so the map can draw per-segment damage grades
from 0.3-0.7 m post-event imagery.  For AOI03 (Bidur / Trisuli Bazar) and AOI05
(Phosretar) the later monitoring product supersedes the initial grading.

  AOI01  Syapru Besi   post-event 27 Aug 2026, 0.3 m
  AOI02  Timure        post-event 27 Aug 2026, 0.3 m
  AOI03  Bidur         monitoring: post-event 27 Aug (0.7 m) and 28 Aug 2026 (0.6 m)
  AOI05  Phosretar     monitoring 1 (v2, 7 Sep 2026): post-event 5 Sep 2026,
                       corrects missing damaged/destroyed bridges from the
                       initial grading (v3, 4 Sep 2026)
  (AOI04 Bharatpur and AOI06 Kyundi are still "Waiting" on Copernicus EMS as
  of 9 Sep 2026, no products delivered)

Grades: Destroyed, Damaged, Possibly damaged, No visible damage, Not Analysed.

Source: https://data.humdata.org/dataset/npl-flood-emsr927 (CC BY 4.0)
Citation: Copernicus Emergency Management Service (© 2026 European Union), EMSR927

Every feature carries a `uid`, `<product>#<fid>`: the GeoPackage feature id
within the product it came from.  It is stable for as long as Copernicus does
not supersede the product, which is what the owner's status edits key on.

Owner status overrides.  `data/edits/status_edits.geojson` (exported from the
map's Road & bridge status editor and committed by hand) is applied last: a
feature whose `uid` it names gets `status_override` (restored / under_repair /
damaged / destroyed) plus `override_as_of`, `override_source`,
`override_source_url`, `override_note` and `override_lane`, so the derived file
carries the reading even without the browser.  An edit whose uid is gone (a
superseded product) falls back to the copied geometry's end points and vertex
count, and is reported either way.  With the file empty or absent the output is
exactly what the grading alone gives.

Output: data/hdx/derived/ems_road_grading.geojson (tracked).  Downloads go to
work/ems/ (gitignored).  Requires the GDAL Python bindings (osgeo) and curl.
"""
import json
import os
import subprocess
import sys

from osgeo import ogr

ogr.UseExceptions()
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, 'work', 'ems')
OUT = os.path.join(ROOT, 'data', 'hdx', 'derived', 'ems_road_grading.geojson')
EDITS = os.path.join(ROOT, 'data', 'edits', 'status_edits.geojson')
ROAD_STATUSES = {'restored', 'under_repair', 'damaged', 'destroyed'}
BASE = 'https://rapidmapping.emergency.copernicus.eu/backend/EMSR927'

# (aoi, product path, locality).  The ?type=gpkg download is a bare GeoPackage.
PRODUCTS = [
    ('AOI01', 'AOI01/GRA_PRODUCT/EMSR927_AOI01_GRA_PRODUCT_v1', 'Syapru Besi'),
    ('AOI02', 'AOI02/GRA_PRODUCT/EMSR927_AOI02_GRA_PRODUCT_v2', 'Timure'),
    ('AOI03', 'AOI03/GRA_MONIT01/EMSR927_AOI03_GRA_MONIT01_v1', 'Bidur'),
    ('AOI05', 'AOI05/GRA_MONIT01/EMSR927_AOI05_GRA_MONIT01_v2', 'Phosretar'),
]
KEEP = ['obj_type', 'name', 'damage_gra', 'det_method', 'dmg_src_id']

os.makedirs(WORK, exist_ok=True)
features, counts = [], {}
for aoi, path, locality in PRODUCTS:
    product = os.path.basename(path)
    gpkg = os.path.join(WORK, product + '.gpkg')
    if not os.path.exists(gpkg):
        print(f'==> downloading {product}')
        subprocess.run(['curl', '-sS', '-f', '-L', '--retry', '3', '-o', gpkg, f'{BASE}/{path}.zip?type=gpkg'], check=True)
    ds = ogr.Open(gpkg)
    # post-event source dates by id, for the popup
    src_date = {}
    for i in range(ds.GetLayerCount()):
        if ds.GetLayer(i).GetName().startswith('source_'):
            for f in ds.GetLayer(i):
                if f.GetField('eventphase') == 'Post-event':
                    d = f.GetField('src_date')           # dd/mm/yyyy
                    src_date[f.GetField('src_id')] = '-'.join(reversed(d.split('/'))) if d and '/' in d else d
    lyr = next(ds.GetLayer(i) for i in range(ds.GetLayerCount()) if ds.GetLayer(i).GetName().startswith('transportationL'))
    n = 0
    for f in lyr:
        g = f.GetGeometryRef()
        if g is None:
            continue
        p = {k: f.GetField(k) for k in KEEP}
        grade = p.pop('damage_gra')
        ot = p.pop('obj_type') or ''
        props = {
            'grade': grade,
            'kind': 'bridge' if ot.startswith('214') else 'road',
            'name': None if p['name'] in (None, 'Unknown') else p['name'],
            'aoi': aoi, 'locality': locality, 'product': product,
            'post_event_date': src_date.get(p['dmg_src_id']),
            'method': p['det_method'],
            'uid': f'{product}#{f.GetFID()}',
        }
        features.append({'type': 'Feature', 'properties': props, 'geometry': json.loads(g.ExportToJson())})
        counts[grade] = counts.get(grade, 0) + 1
        n += 1
    print(f'   {aoi} {locality:12s} {product}: {n} line features')



def geom_sig(g):
    """End points (6 dp) and vertex count: the fallback identity for an edit
    whose uid no longer exists because Copernicus superseded the product."""
    c = (g or {}).get('coordinates') or []
    if (g or {}).get('type') == 'MultiLineString':
        c = [p for part in c for p in part]
    if not c or not isinstance(c[0], list):
        return None
    r = lambda p: (round(p[0], 6), round(p[1], 6))
    return (r(c[0]), r(c[-1]), len(c))


def apply_status_edits(features):
    """data/edits/status_edits.geojson, layer 'ems', applied last by uid."""
    if not os.path.exists(EDITS):
        return
    try:
        with open(EDITS, encoding='utf-8') as fh:
            edits = [e for e in (json.load(fh).get('features') or [])
                     if ((e or {}).get('properties') or {}).get('layer') == 'ems']
    except (OSError, ValueError) as e:
        print(f'   status edits: could not read {os.path.relpath(EDITS, ROOT)} ({e}); none applied', file=sys.stderr)
        return
    if not edits:
        return
    by_uid = {f['properties']['uid']: f for f in features}
    by_sig = {}
    for f in features:
        by_sig.setdefault(geom_sig(f['geometry']), []).append(f)
    n, missing = 0, []
    for e in edits:
        ep = e['properties']
        if ep.get('status') not in ROAD_STATUSES:
            print(f"   status edits: {ep.get('uid')}: unknown status {ep.get('status')!r}, skipped", file=sys.stderr)
            continue
        f = by_uid.get(ep.get('uid'))
        if f is None:
            cands = by_sig.get(geom_sig(e.get('geometry')), [])
            if len(cands) == 1:
                f = cands[0]
                print(f"   status edits: {ep.get('uid')} matched {f['properties']['uid']} by geometry")
        if f is None:
            missing.append(ep.get('uid'))
            continue
        lane = ep.get('lane')
        f['properties'].update({
            'status_override': ep['status'],
            'override_as_of': ep.get('as_of') or None,
            'override_source': ep.get('source_title') or None,
            'override_source_url': ep.get('source_url') or None,
            'override_note': ep.get('note') or None,
            'override_lane': None if lane in (None, '', 'unknown') else lane,
        })
        n += 1
    print(f'   status edits: {n} of {len(edits)} owner overrides applied')
    for u in missing:
        print(f'   status edits: {u} matches no segment, not applied', file=sys.stderr)


apply_status_edits(features)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w') as fh:
    json.dump({'type': 'FeatureCollection', 'name': 'ems_road_grading',
               'description': 'Copernicus EMS Rapid Mapping EMSR927 grading: roads and bridges (transportationL), '
                              'AOI01/02 initial products, AOI03 and AOI05 monitoring 1. CC BY 4.0. '
                              'Citation: Copernicus Emergency Management Service (© 2026 European Union), EMSR927',
               'features': features}, fh, separators=(',', ':'))
print(f'{len(features)} graded segments: {counts}')
print(f'wrote {OUT} ({os.path.getsize(OUT)/1e3:.0f} KB)')
