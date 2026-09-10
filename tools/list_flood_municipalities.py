#!/usr/bin/env python3
"""Print the local levels (COD-AB adm3_name) whose polygon intersects the HOT
observed flood extent, within the four districts the map draws.

The result is baked into app/app.js as EXTENT_MUNIS (the municipality-boundary
filter) because the admin GeoJSON is fetched by MapLibre, not by the app, so the
app cannot compute it at run time without a second fetch.  Re-run after an HDX
refresh changes data/hdx/hot_flood_npl/hot_flood_npl_flood_extent.geojson and
paste the output if it differs.

    python3 tools/list_flood_municipalities.py
"""
import json
import os
import sys

from osgeo import ogr

ogr.UseExceptions()
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DISTRICTS = {'Rasuwa', 'Nuwakot', 'Dhading', 'Gorkha'}


def union(path):
    ds = ogr.Open(path)          # keep the datasource alive while the layer is read
    layer = ds.GetLayer()
    geom = None
    for f in layer:
        g = f.GetGeometryRef().Clone()
        geom = g if geom is None else geom.Union(g)
    return geom


def main():
    extent = union(os.path.join(ROOT, 'data/hdx/hot_flood_npl/hot_flood_npl_flood_extent.geojson'))
    ds = ogr.Open(os.path.join(ROOT, 'data/admin/admin_municipality.geojson'))
    layer = ds.GetLayer()
    hits = {}
    for f in layer:
        if f.GetField('adm2_name') in DISTRICTS and f.GetGeometryRef().Intersects(extent):
            hits.setdefault(f.GetField('adm2_name'), set()).add(f.GetField('adm3_name'))
    names = sorted(n for s in hits.values() for n in s)
    for d in sorted(hits):
        print(f'# {d}: {", ".join(sorted(hits[d]))}', file=sys.stderr)
    print(json.dumps(names))


if __name__ == '__main__':
    main()
