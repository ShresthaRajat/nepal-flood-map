#!/usr/bin/env python3
"""Roads inside the observed flood extent.

Clips the HOT flood-area OSM roads (all highway classes, with their damage
`status`) to the 27 Aug 2026 flood extent polygon, so the map can draw the
stretches that were physically inside the mapped water even where nobody has
recorded a status yet.  Complements the status-based red in the roads layer.
Bridge segments are decided by river position and the ground reports, not by
the polygon: a deck over the river always intersects the flood polygon, which
says nothing about damage.  Position along the Trishuli / Bhote Koshi centreline
(stitched from the OSM waterways) splits the corridor into three zones, per the
owner's field knowledge (6 Sep 2026):
  upstream of the BhimDhunga bridge   every bridge is destroyed -> red, unless a
                                      ground report explicitly says Intact
  BhimDhunga to Benighat              the nearest ground report within
                                      REPORT_RADIUS_M decides (Washed out /
                                      Damaged -> red; Intact or none -> dropped)
  Benighat and downstream             unaffected -> dropped unless a report
                                      explicitly says Washed out / Damaged
Where Copernicus EMS graded the road (data/hdx/derived/ems_road_grading.geojson,
built by build_ems_roads.py), the grade wins over all of the above: Destroyed or
Damaged keeps the segment red, "No visible damage" drops it, other grades leave
the rules above to decide.  A segment is matched to EMS lines by sampling points
every ~15 m and taking the dominant grade within EMS_MATCH_M.

Inputs  (both come from tools/build_hdx_tiles.sh / the HDX snapshot):
  data/hdx/gpkg/hot_flood_npl/roads_osm/*.gpkg          attribute-complete roads
  data/hdx/hot_flood_npl/hot_flood_npl_flood_extent.geojson
  data/hdx/hot_flood_npl/hot_flood_npl_bridge_damage.geojson   58 ground reports
  data/hdx/hotosm_npl_waterways/hotosm_npl_waterways_clip.geojson  river centreline (gitignored)
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
REPORTS = os.path.join(ROOT, 'data/hdx/hot_flood_npl/hot_flood_npl_bridge_damage.geojson')
OUT = os.path.join(ROOT, 'data/hdx/derived/roads_in_flood_extent.geojson')
KEEP = ['id', 'name', 'name_en', 'highway', 'status', 'surface', 'bridge']
REPORT_RADIUS_M = 120   # a report point sits near the bridge centre; decks here are up to ~200 m long
WATERWAYS = os.path.join(ROOT, 'data/hdx/hotosm_npl_waterways/hotosm_npl_waterways_clip.geojson')
RIVER_NAMES = ('lende khola', 'bhote koshi', 'trisuli', 'trishuli')   # main stem, source to Benighat
UPSTREAM_REF, DOWNSTREAM_REF = 'BhimDhunga', 'Benighat'               # substrings of report names
EMS = os.path.join(ROOT, 'data/hdx/derived/ems_road_grading.geojson')
EMS_MATCH_M = 12

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

# River centreline: named main-stem segments, stitched from the northernmost end
# (the Lende Khola at the border) downstream, so that chainage grows with flow.
def river_pieces():
    if not os.path.exists(WATERWAYS):
        sys.exit(f'river centreline missing: {WATERWAYS} (download hotosm_npl_waterways, see build_waterways_tiles.sh)')
    ww_ds = ogr.Open(WATERWAYS); ww = ww_ds.GetLayer(0)
    out = []
    for f in ww:
        nm = (f.GetField('name_en') or f.GetField('name') or '').lower()
        if f.GetField('waterway') == 'river' and any(k in nm for k in RIVER_NAMES):
            g = f.GetGeometryRef().Clone(); g.Transform(to_utm)
            if g.GetGeometryName() == 'MULTILINESTRING':
                out += [[g.GetGeometryRef(i).GetPoint_2D(j) for j in range(g.GetGeometryRef(i).GetPointCount())] for i in range(g.GetGeometryCount())]
            else:
                out.append([g.GetPoint_2D(j) for j in range(g.GetPointCount())])
    return out

def stitch(pieces):
    d2 = lambda a, b: (a[0]-b[0])**2 + (a[1]-b[1])**2
    # start at the piece with the northernmost endpoint, oriented north -> south
    pieces = [list(p) for p in pieces]
    start = max(pieces, key=lambda p: max(p[0][1], p[-1][1]))
    pieces.remove(start)
    if start[0][1] < start[-1][1]: start.reverse()
    line = start
    while pieces:
        end = line[-1]
        best = min(pieces, key=lambda p: min(d2(end, p[0]), d2(end, p[-1])))
        pieces.remove(best)
        if d2(end, best[-1]) < d2(end, best[0]): best.reverse()
        line += best
    return line

RIVER = stitch(river_pieces())
RIVER_CUM = [0.0]
for a, b in zip(RIVER, RIVER[1:]):
    RIVER_CUM.append(RIVER_CUM[-1] + ((a[0]-b[0])**2 + (a[1]-b[1])**2) ** 0.5)

def chainage(geom_wgs):
    """Metres along the stitched river to the nearest point of geom's centroid."""
    c = geom_wgs.Centroid(); c.Transform(to_utm); px, py = c.GetX(), c.GetY()
    best = (float('inf'), 0.0)
    for i, (a, b) in enumerate(zip(RIVER, RIVER[1:])):
        dx, dy = b[0]-a[0], b[1]-a[1]
        L2 = dx*dx + dy*dy
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px-a[0])*dx + (py-a[1])*dy) / L2))
        qx, qy = a[0] + t*dx, a[1] + t*dy
        d = (px-qx)**2 + (py-qy)**2
        if d < best[0]: best = (d, RIVER_CUM[i] + t * L2 ** 0.5)
    return best[1]

# Bridge ground reports, projected once so distances are in metres.
reports = []
rep_ds = ogr.Open(REPORTS); rep_lyr = rep_ds.GetLayer(0)   # keep the dataset alive while iterating
for f in rep_lyr:
    g = f.GetGeometryRef().Clone(); g.Transform(to_utm)
    reports.append((g, f.GetField('status') or '', f.GetField('name') or ''))
REPORT_BAD = {'washed out', 'damaged', 'destroyed'}

def ref_chainage(sub):
    hits = [f for f in rep_lyr if sub.lower() in (f.GetField('name') or '').lower()]
    if len(hits) != 1: sys.exit(f'expected one report matching {sub!r}, got {len(hits)}')
    return chainage(hits[0].GetGeometryRef())
CH_UP, CH_DOWN = ref_chainage(UPSTREAM_REF), ref_chainage(DOWNSTREAM_REF)
if not CH_UP < CH_DOWN: sys.exit(f'river orientation wrong: {UPSTREAM_REF} at {CH_UP:.0f} m, {DOWNSTREAM_REF} at {CH_DOWN:.0f} m')
print(f'river {RIVER_CUM[-1]/1000:.1f} km; {UPSTREAM_REF} at {CH_UP/1000:.1f} km, {DOWNSTREAM_REF} at {CH_DOWN/1000:.1f} km')
def zone(geom_wgs):
    ch = chainage(geom_wgs)
    return 'upstream' if ch < CH_UP else 'middle' if ch < CH_DOWN else 'downstream'

def nearest_report(geom_wgs):
    m = geom_wgs.Clone(); m.Transform(to_utm)
    best = None
    for g, status, name in reports:
        d = m.Distance(g)
        if d <= REPORT_RADIUS_M and (best is None or d < best[0]):
            best = (d, status, name)
    return best

# Copernicus EMS road grades, in an in-memory layer with a spatial index (optional input).
ems_lyr = None
if os.path.exists(EMS):
    ems_src_ds = ogr.Open(EMS); ems_src = ems_src_ds.GetLayer(0)   # keep the dataset alive while iterating
    ems_ds = (ogr.GetDriverByName('MEM') or ogr.GetDriverByName('Memory')).CreateDataSource('ems')
    ems_lyr = ems_ds.CreateLayer('ems', srs=utm, geom_type=ogr.wkbMultiLineString)
    ems_lyr.CreateField(ogr.FieldDefn('grade', ogr.OFTString))
    for f in ems_src:
        g = f.GetGeometryRef().Clone(); g.Transform(to_utm)
        nf = ogr.Feature(ems_lyr.GetLayerDefn()); nf.SetField('grade', f.GetField('grade')); nf.SetGeometry(g)
        ems_lyr.CreateFeature(nf)
    print(f'EMS grades loaded: {ems_lyr.GetFeatureCount()} segments')
else:
    print('EMS grading not found; run tools/build_ems_roads.py to let Copernicus grades correct the overlay')

def _linestrings(g):
    """Flatten any (multi)line geometry into lists of 2-D vertices."""
    n = g.GetGeometryName()
    if n == 'LINESTRING':
        return [[g.GetPoint_2D(i) for i in range(g.GetPointCount())]]
    out = []
    for i in range(g.GetGeometryCount()):
        out += _linestrings(g.GetGeometryRef(i))
    return out

def _samples(verts, step=15.0):
    """Points every `step` metres along a vertex list, always including both ends."""
    if len(verts) < 2:
        return list(verts)
    seg = [((b[0]-a[0])**2 + (b[1]-a[1])**2) ** 0.5 for a, b in zip(verts, verts[1:])]
    L = sum(seg); n = max(2, int(L / step) + 1)
    pts = []
    for k in range(n):
        target = L * k / (n - 1); acc = 0.0
        for (a, b), sl in zip(zip(verts, verts[1:]), seg):
            if acc + sl >= target or (a, b) == (verts[-2], verts[-1]):
                t = 0.0 if sl == 0 else min(1.0, (target - acc) / sl)
                pts.append((a[0] + t*(b[0]-a[0]), a[1] + t*(b[1]-a[1]))); break
            acc += sl
    return pts

def ems_grade(geom_wgs):
    """Dominant EMS grade along geom (samples every ~15 m, nearest EMS line within EMS_MATCH_M), or None."""
    if ems_lyr is None:
        return None
    m = geom_wgs.Clone(); m.Transform(to_utm)
    votes = {}
    for verts in _linestrings(m):
        for x, y in _samples(verts):
            pt = ogr.Geometry(ogr.wkbPoint); pt.AddPoint_2D(x, y)
            ems_lyr.SetSpatialFilterRect(x - EMS_MATCH_M, y - EMS_MATCH_M, x + EMS_MATCH_M, y + EMS_MATCH_M)
            best = None
            for e in ems_lyr:
                d = e.GetGeometryRef().Distance(pt)
                if d <= EMS_MATCH_M and (best is None or d < best[0]):
                    best = (d, e.GetField('grade'))
            if best:
                votes[best[1]] = votes.get(best[1], 0) + 1
    ems_lyr.SetSpatialFilter(None)
    if not votes:
        return None
    # damage evidence anywhere on the segment outranks "no damage" elsewhere on it
    for g in ('Destroyed', 'Damaged'):
        if votes.get(g, 0) >= 2:
            return g
    return max(votes, key=votes.get)

roads_ds = ogr.Open(ROADS[0])
roads = roads_ds.GetLayer(0)
roads.SetSpatialFilter(extent)
defn = roads.GetLayerDefn()
fields = [k for k in KEEP if defn.GetFieldIndex(k) >= 0]

DAMAGED = {'damaged', 'destroyed', 'washed out', 'major damage', 'major-damage'}
def is_damaged(f):
    return str(f.GetField('status') or '').lower() in DAMAGED if defn.GetFieldIndex('status') >= 0 else False

features, n_in, total_m = [], 0, 0.0
bridge_stats = {z: {'kept_by_ems': 0, 'kept_by_report': 0, 'kept_upstream_rule': 0, 'kept_by_status': 0,
                    'dropped_by_ems': 0, 'dropped_intact_report': 0, 'dropped_no_report': 0}
                for z in ('upstream', 'middle', 'downstream')}
ems_stats = {'graded': 0, 'dropped_no_visible_damage': 0, 'kept_destroyed_or_damaged': 0}
for f in roads:
    g = f.GetGeometryRef()
    if g is None or not g.Intersects(extent):
        continue
    report, bzone = None, None
    eg = ems_grade(g)
    if eg: ems_stats['graded'] += 1
    is_bridge = defn.GetFieldIndex('bridge') >= 0 and str(f.GetField('bridge') or '').lower() not in ('', 'no')
    if is_bridge:
        # A bridge deck crosses the water by design; Copernicus grades, then river position and
        # the ground reports decide.
        bzone = zone(g); st = bridge_stats[bzone]
        best = nearest_report(g)
        if eg in ('Destroyed', 'Damaged'):
            st['kept_by_ems'] += 1; ems_stats['kept_destroyed_or_damaged'] += 1
        elif eg == 'No visible damage':
            st['dropped_by_ems'] += 1; ems_stats['dropped_no_visible_damage'] += 1; continue
        # An explicit ground report always wins over the zone rules; the upstream rule covers the
        # unreported rest (mostly main-river crossings), since tributary bridges up there were spared.
        elif best and best[1].lower() in REPORT_BAD:
            st['kept_by_report'] += 1; report = best
        elif best:
            st['dropped_intact_report'] += 1; continue
        elif bzone == 'upstream':
            st['kept_upstream_rule'] += 1; report = (None, 'Destroyed (all unreported bridges upstream of BhimDhunga)', '')
        elif is_damaged(f):
            st['kept_by_status'] += 1
        else:
            st['dropped_no_report'] += 1; continue
    else:
        if eg == 'No visible damage' and not is_damaged(f):
            ems_stats['dropped_no_visible_damage'] += 1; continue
        if eg in ('Destroyed', 'Damaged'):
            ems_stats['kept_destroyed_or_damaged'] += 1
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
    if bzone:
        props['river_zone'] = bzone
    if eg:
        props['ems_grade'] = eg
    if report:
        props['report_status'], props['report_name'] = report[1], report[2]
        if report[0] is not None: props['report_dist_m'] = round(report[0])
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
for z, st in bridge_stats.items(): print(f'bridges {z:10s}', st)
print('copernicus:', ems_stats)
print(f'wrote {OUT} ({os.path.getsize(OUT)/1e3:.0f} KB)')
