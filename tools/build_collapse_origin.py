#!/usr/bin/env python3
"""Glacier collapse origin, barrier lakes and the upstream area-of-interest extension.

Source: UNOSAT FL20260826NPL geodatabase (CC BY-SA), HDX dataset
"Mudflow/Rockflow Impact Assessment in Rasuwa & Nuwakot Districts",
https://unosat.org/static/unosat_filesystem/4259/FL20260826NPL.gdb.zip

Writes two tracked GeoJSON files under data/hdx/derived/:
  collapse_origin.geojson       the Landsat-9 (26 Aug 2026) detachment zone polygon,
                                its centroid as the "Collapse origin (approx.)" point,
                                and the two Cartosat-3 (28 Aug) barrier lakes
  aoi_upstream_extension.geojson  the UNOSAT multi-sensor flood extent (26-28 Aug),
                                buffered 200 m like HOT's own AOI, for the stretch
                                beyond HOT's AOI: Rasuwagadhi up the Lende Khola to
                                the detachment zone.  Drawn with the HOT AOI outline.

Requires the GDAL Python bindings (osgeo) and curl.  Downloads go to work/unosat/.
"""
import json
import os
import subprocess
import zipfile

from osgeo import ogr, osr

ogr.UseExceptions()
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, 'work', 'unosat')
GDB = os.path.join(WORK, 'FL20260826NPL.gdb')
URL = 'https://unosat.org/static/unosat_filesystem/4259/FL20260826NPL.gdb.zip'
HOT_AOI = os.path.join(ROOT, 'data', 'hdx', 'hot_flood_npl', 'hot_flood_npl_aoi.geojson')
OUT_ORIGIN = os.path.join(ROOT, 'data', 'hdx', 'derived', 'collapse_origin.geojson')
OUT_AOI = os.path.join(ROOT, 'data', 'hdx', 'derived', 'aoi_upstream_extension.geojson')
UPSTREAM_BOX = (85.30, 28.20, 85.60, 28.36)     # Lende Khola valley, Rasuwagadhi to the glacier
BUFFER_M = 200

if not os.path.isdir(GDB):
    os.makedirs(WORK, exist_ok=True)
    z = os.path.join(WORK, 'FL20260826NPL.gdb.zip')
    subprocess.run(['curl', '-sS', '-f', '-L', '-o', z, URL], check=True)
    zipfile.ZipFile(z).extractall(WORK)

wgs = osr.SpatialReference(); wgs.ImportFromEPSG(4326); wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
utm = osr.SpatialReference(); utm.ImportFromEPSG(32645); utm.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
to_utm = osr.CoordinateTransformation(wgs, utm); to_wgs = osr.CoordinateTransformation(utm, wgs)

ds = ogr.Open(GDB)
def first_geom(name):
    lyr = ds.GetLayerByName(name); f = next(iter(lyr)); g = f.GetGeometryRef().Clone()
    if g.GetGeometryName() == 'MULTISURFACE':
        g = ogr.ForceToMultiPolygon(g)
    g.FlattenTo2D(); return g

def as_wgs_utm(g):
    u = g.Clone(); u.Transform(to_utm); return u

def rounded(g, nd=6):
    return json.loads(g.ExportToJson(options=[f'COORDINATE_PRECISION={nd}']))

# ---- collapse origin + barrier lakes
zone = first_geom('UNOSAT_Landsat9_20260826_DetachmentZone')
zone_area = as_wgs_utm(zone).GetArea() / 1e6
origin = zone.Centroid()
features = [
    {'type': 'Feature', 'properties': {'kind': 'detachment_zone', 'label': 'Glacier / rock detachment zone',
     'source': 'UNOSAT, Landsat-9 26 Aug 2026', 'area_km2': round(zone_area, 2)}, 'geometry': rounded(zone)},
    {'type': 'Feature', 'properties': {'kind': 'origin', 'label': 'Collapse origin (approx.)',
     'source': 'centroid of the UNOSAT detachment zone'}, 'geometry': rounded(origin)},
]
lakes = ds.GetLayerByName('UNOSAT_Cartosat3_20260828_BarrierLakes')
for i, f in enumerate(lakes, 1):
    g = f.GetGeometryRef().Clone(); g.FlattenTo2D()
    features.append({'type': 'Feature', 'properties': {'kind': 'barrier_lake', 'label': f'Barrier lake {i}',
                     'source': 'UNOSAT, Cartosat-3 28 Aug 2026', 'area_km2': round(as_wgs_utm(g).GetArea() / 1e6, 2)},
                     'geometry': rounded(g)})
os.makedirs(os.path.dirname(OUT_ORIGIN), exist_ok=True)
json.dump({'type': 'FeatureCollection', 'name': 'collapse_origin',
           'description': 'UNOSAT FL20260826NPL: detachment zone (Landsat-9 26 Aug 2026), its centroid, and barrier lakes (Cartosat-3 28 Aug 2026). CC BY-SA.',
           'features': features}, open(OUT_ORIGIN, 'w'), separators=(',', ':'))
print(f'origin: zone {zone_area:.2f} km2 at {origin.GetX():.4f}, {origin.GetY():.4f}; {len(features) - 2} barrier lakes')

# ---- upstream AOI extension: UNOSAT extent, buffered, minus HOT's AOI, within the Lende valley box
extent = first_geom('UNOSAT_Multisensor_20260826_20260828_FloodExtent')
hot = None
hot_ds = ogr.Open(HOT_AOI); hot_lyr = hot_ds.GetLayer(0)   # keep the dataset alive while iterating
for f in hot_lyr:
    g = f.GetGeometryRef().Clone(); hot = g if hot is None else hot.Union(g)
ext_u = as_wgs_utm(extent).Buffer(BUFFER_M)
zone_u = as_wgs_utm(zone).Buffer(BUFFER_M)
hot_u = as_wgs_utm(hot)
box = ogr.Geometry(ogr.wkbPolygon); ring = ogr.Geometry(ogr.wkbLinearRing)
w, s, e, n = UPSTREAM_BOX
for x, y in [(w, s), (e, s), (e, n), (w, n), (w, s)]: ring.AddPoint_2D(x, y)
box.AddGeometry(ring); box_u = as_wgs_utm(box)
ext_up = ext_u.Union(zone_u).Intersection(box_u).Difference(hot_u.Buffer(-50))   # -50 m so the join overlaps HOT's edge
# keep the connected valley piece(s) larger than 0.05 km2, dropping slivers
parts = [ext_up.GetGeometryRef(i).Clone() for i in range(ext_up.GetGeometryCount())] if ext_up.GetGeometryName() == 'MULTIPOLYGON' else [ext_up]
parts = [p for p in parts if p.GetArea() > 5e4]
merged = ogr.Geometry(ogr.wkbMultiPolygon)
for p in parts: merged.AddGeometry(p)
merged = merged.UnionCascaded() if merged.GetGeometryCount() > 1 else merged
merged.Transform(to_wgs)
json.dump({'type': 'FeatureCollection', 'name': 'aoi_upstream_extension',
           'description': 'UNOSAT multi-sensor flood/mudflow extent (26-28 Aug 2026) buffered 200 m, for the Lende Khola from Rasuwagadhi to the detachment zone, beyond the HOT flood-affected AOI. CC BY-SA.',
           'features': [{'type': 'Feature', 'properties': {'label': 'Upstream extension (UNOSAT extent + 200 m)',
                          'area_km2': round(sum(p.GetArea() for p in parts) / 1e6, 2)}, 'geometry': rounded(merged)}]},
          open(OUT_AOI, 'w'), separators=(',', ':'))
e2 = merged.GetEnvelope()
print(f'aoi extension: {sum(p.GetArea() for p in parts)/1e6:.1f} km2, {len(parts)} part(s), lon {e2[0]:.3f}-{e2[1]:.3f} lat {e2[2]:.3f}-{e2[3]:.3f}')
print('wrote', OUT_ORIGIN, f'{os.path.getsize(OUT_ORIGIN)/1e3:.0f} KB;', OUT_AOI, f'{os.path.getsize(OUT_AOI)/1e3:.0f} KB')
