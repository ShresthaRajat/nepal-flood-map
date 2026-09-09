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
        }
        features.append({'type': 'Feature', 'properties': props, 'geometry': json.loads(g.ExportToJson())})
        counts[grade] = counts.get(grade, 0) + 1
        n += 1
    print(f'   {aoi} {locality:12s} {product}: {n} line features')

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w') as fh:
    json.dump({'type': 'FeatureCollection', 'name': 'ems_road_grading',
               'description': 'Copernicus EMS Rapid Mapping EMSR927 grading: roads and bridges (transportationL), '
                              'AOI01/02 initial products, AOI03 and AOI05 monitoring 1. CC BY 4.0. '
                              'Citation: Copernicus Emergency Management Service (© 2026 European Union), EMSR927',
               'features': features}, fh, separators=(',', ':'))
print(f'{len(features)} graded segments: {counts}')
print(f'wrote {OUT} ({os.path.getsize(OUT)/1e3:.0f} KB)')
