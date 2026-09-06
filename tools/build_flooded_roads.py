#!/usr/bin/env python3
"""Roads inside the observed flood extent.

Clips the HOT flood-area OSM roads (all highway classes, with their damage
`status`) to the 27 Aug 2026 flood extent polygon, so the map can draw the
stretches that were physically inside the mapped water even where nobody has
recorded a status yet.  Complements the status-based red in the roads layer.

Inputs  (both come from tools/build_hdx_tiles.sh / the HDX snapshot):
  data/hdx/gpkg/hot_flood_npl/roads_osm/*.gpkg          attribute-complete roads
  data/hdx/hot_flood_npl/hot_flood_npl_flood_extent.geojson
Output:
  data/hdx/derived/roads_in_flood_extent.geojson         tracked, ~hundreds of KB

Requires the GDAL Python bindings (osgeo).  Run from anywhere.
"""
import glob
import json
import os
import sys

from osgeo import ogr, osr

ogr.UseExceptions()
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROADS = glob.glob(os.path.join(ROOT, 'data/hdx/gpkg/hot_flood_npl/roads_osm/*.gpkg'))
EXTENT = os.path.join(ROOT, 'data/hdx/hot_flood_npl/hot_flood_npl_flood_extent.geojson')
OUT = os.path.join(ROOT, 'data/hdx/derived/roads_in_flood_extent.geojson')
KEEP = ['id', 'name', 'name_en', 'highway', 'status', 'surface', 'bridge']

if not ROADS:
    sys.exit('roads GeoPackage missing: run tools/build_hdx_tiles.sh first')

# Flood extent as one geometry (union of every polygon in the file).
ext_ds = ogr.Open(EXTENT)
ext_lyr = ext_ds.GetLayer(0)
extent = None
for f in ext_lyr:
    g = f.GetGeometryRef().Clone()
    extent = g if extent is None else extent.Union(g)
if extent is None:
    sys.exit('flood extent has no features')
extent = extent.Buffer(0)   # heal any self-touching rings before intersecting

# UTM 45N for lengths.
wgs = osr.SpatialReference(); wgs.ImportFromEPSG(4326); wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
utm = osr.SpatialReference(); utm.ImportFromEPSG(32645); utm.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
to_utm = osr.CoordinateTransformation(wgs, utm)

roads_ds = ogr.Open(ROADS[0])
roads = roads_ds.GetLayer(0)
roads.SetSpatialFilter(extent)
defn = roads.GetLayerDefn()
fields = [k for k in KEEP if defn.GetFieldIndex(k) >= 0]

features, n_in, total_m = [], 0, 0.0
for f in roads:
    g = f.GetGeometryRef()
    if g is None or not g.Intersects(extent):
        continue
    clipped = g.Intersection(extent)
    if clipped is None or clipped.IsEmpty():
        continue
    if clipped.GetGeometryType() not in (ogr.wkbLineString, ogr.wkbMultiLineString,
                                        ogr.wkbLineString25D, ogr.wkbMultiLineString25D):
        # Intersection can return a collection with stray points; keep the lines only.
        parts = [clipped.GetGeometryRef(i).Clone() for i in range(clipped.GetGeometryCount())
                 if clipped.GetGeometryRef(i).GetGeometryName() in ('LINESTRING', 'MULTILINESTRING')]
        if not parts:
            continue
        clipped = ogr.Geometry(ogr.wkbMultiLineString)
        for p in parts:
            if p.GetGeometryName() == 'MULTILINESTRING':
                for i in range(p.GetGeometryCount()):
                    clipped.AddGeometry(p.GetGeometryRef(i))
            else:
                clipped.AddGeometry(p)
    m = clipped.Clone(); m.Transform(to_utm)
    length_m = round(m.Length(), 1)
    props = {k: f.GetField(k) for k in fields}
    props['length_m'] = length_m
    total_m += length_m
    n_in += 1
    features.append({'type': 'Feature', 'properties': props,
                     'geometry': json.loads(clipped.ExportToJson())})

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w') as fh:
    json.dump({'type': 'FeatureCollection',
               'name': 'roads_in_flood_extent',
               'description': 'HOT flood-area OSM roads clipped to the 27 Aug 2026 observed flood extent',
               'features': features}, fh, separators=(',', ':'))

by_status = {}
for ft in features:
    by_status[ft['properties'].get('status')] = by_status.get(ft['properties'].get('status'), 0) + 1
print(f'{n_in} road segments inside the flood extent, {total_m/1000:.1f} km, status counts {by_status}')
print(f'wrote {OUT} ({os.path.getsize(OUT)/1e3:.0f} KB)')
