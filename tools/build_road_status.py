#!/usr/bin/env python3
"""Recolour the corridor's road layers by whether a vehicle can get through today.

The map already draws two red road overlays, and both of them answer the same
question: how bad was the damage when somebody last looked?

  * `roads_in_flood_extent.geojson` -- the HOT roads clipped to the observed
    27 Aug flood extent (tools/build_flooded_roads.py).  Exposure, mostly.
  * `ems_road_grading.geojson` -- the Copernicus EMS EMSR927 grades from
    0.3-0.7 m post-event imagery (tools/build_ems_roads.py).  An assessment.

Neither says whether the road is open now.  Four weeks after the flood that is
the question people actually have, and the answer only exists in the NDRRMA
situation reports and the press.  `data/road_status.json` holds that reading by
hand, as a small set of corridor segments, and this script joins it to the two
road layers.

Matching, and why it is deliberately cautious.  Each curated segment is a
polyline of a few waypoints; this densifies it to a point every DENSIFY_M and
takes a road feature as captured when its own vertices come within the buffer
(NEAR_M, widened to NEAR_TRUNK_M for trunk and primary features, which are
drawn wide and mapped as dual carriageways).  Distance alone is not enough: a
farm track crossing under a reopened highway would pick up the highway's
status and draw white, which would be a lie about a track nobody has
inspected.  So a feature is only recoloured to `restored` or `under_repair`
when it is also compatible:

  * its OSM `name`, if it has one, matches one of the segment's `match_names`,
    its `road`, or its `ref`; a named road that matches none of them is never
    recoloured by that segment, and
  * its highway class is road-like.  `track` counts only for a segment whose
    own `lane` is "track", and path/steps/footway/cycleway/bridleway never do.

Anything that matches nothing keeps `road_status = 'damaged'` and goes on
drawing red, so the curated file only ever needs the stretches somebody has
reported a change on.

Output: `data/hdx/derived/road_status.geojson`, with `feature_kind`:

    flooded   every feature of roads_in_flood_extent.geojson, recoloured
    ems       every feature of ems_road_grading.geojson, recoloured where
              `kind` is road; the graded bridges pass through untouched so the
              EMS layer still draws them
    segment   the curated polylines themselves, drawn as a wide translucent
              ribbon under the roads.  This is how the hill detour routes
              appear at all: they run outside the flood extent and the
              Copernicus areas, so there are no road features there to recolour.

Stdlib only; the repo root comes from this file's location.  Deterministic:
same inputs, byte-identical output.

    python3 tools/build_road_status.py
    python3 tools/build_road_status.py --check   # report, write nothing
"""
import argparse
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DERIVED = os.path.join(ROOT, 'data', 'hdx', 'derived')
FLOODED = os.path.join(DERIVED, 'roads_in_flood_extent.geojson')
EMS = os.path.join(DERIVED, 'ems_road_grading.geojson')
CURATED = os.path.join(ROOT, 'data', 'road_status.json')
OUT = os.path.join(DERIVED, 'road_status.geojson')

# A curated waypoint list is a corridor, not a survey: sampling it every 25 m
# keeps the buffer test honest on a long straight leg between two waypoints.
DENSIFY_M = 25.0
NEAR_M = 120.0
NEAR_TRUNK_M = 200.0
TRUNK_CLASSES = {'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link'}
# Road-like enough to inherit a curated status.  `track` is handled separately
# (only a track-lane segment may claim one) and the path classes never qualify.
ROADLIKE = {'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
            'secondary', 'secondary_link', 'tertiary', 'tertiary_link',
            'unclassified', 'residential', 'service', 'living_street', 'road'}
NEVER = {'footway', 'path', 'steps', 'cycleway', 'bridleway'}

STATUS_ORDER = ['restored', 'under_repair', 'damaged']
KIND_ORDER = ['flooded', 'ems', 'segment']


def load(path):
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def haversine(a, b):
    r = 6371000.0
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    h = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b[0] - a[0]) / 2) ** 2)
    return 2 * r * math.asin(math.sqrt(h))


def vertices(geom):
    t, c = geom.get('type'), geom.get('coordinates')
    if t == 'Point':
        return [c]
    if t in ('LineString', 'MultiPoint'):
        return list(c)
    if t in ('MultiLineString', 'Polygon'):
        return [p for part in c for p in part]
    if t == 'MultiPolygon':
        return [p for poly in c for ring in poly for p in ring]
    return []


def densify(points, step=DENSIFY_M):
    """The waypoint polyline, resampled so consecutive points are <= step apart."""
    if len(points) < 2:
        return [list(p) for p in points]
    out = [list(points[0])]
    for a, b in zip(points, points[1:]):
        d = haversine(a, b)
        n = max(1, int(math.ceil(d / step)))
        for i in range(1, n + 1):
            t = i / n
            out.append([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    return out


def cell_index(points, size_deg=0.01):
    """A coarse lon/lat bucket index over the densified segment points.

    Every feature is tested against every segment, which is 2,154 features by 23
    segments by a few hundred sample points each -- fast enough only if the inner
    loop is bucketed.  0.01 degrees is roughly 1.1 km, comfortably wider than the
    200 m buffer, so a lookup of the feature cell and its eight neighbours cannot
    miss a point inside the buffer.
    """
    idx = {}
    for p in points:
        idx.setdefault((int(math.floor(p[0] / size_deg)), int(math.floor(p[1] / size_deg))), []).append(p)
    return idx


def min_dist(pt, idx, size_deg=0.01):
    cx, cy = int(math.floor(pt[0] / size_deg)), int(math.floor(pt[1] / size_deg))
    best = float('inf')
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for p in idx.get((cx + dx, cy + dy), ()):
                d = haversine(pt, p)
                if d < best:
                    best = d
    return best


def norm(s):
    return ''.join(ch for ch in str(s or '').lower() if ch.isalnum())


def name_ok(feat_name, seg):
    """Is this feature's name compatible with the segment's?

    An unnamed feature is compatible with anything -- most of the corridor's
    ways carry no name, and refusing them would leave almost nothing matchable.
    A named one has to match: a road that calls itself something else is a
    different road, whatever the distance says.
    """
    fn = norm(feat_name)
    if not fn:
        return True
    cands = [norm(n) for n in (seg.get('match_names') or [])]
    cands += [norm(seg.get('road')), norm(seg.get('ref'))]
    for c in cands:
        if c and (c in fn or fn in c):
            return True
    return False


def class_ok(highway, seg):
    """Is this highway class one a curated status may be applied to?"""
    hw = (highway or '').strip().lower()
    if hw in NEVER:
        return False
    if hw == 'track':
        return (seg.get('lane') or '') == 'track'
    if not hw:
        # The Copernicus features carry no highway tag, but every one of them is
        # a road or a bridge the analyst traced, so there is no side-track risk.
        return True
    return hw in ROADLIKE


def build():
    missing = [p for p in (FLOODED, EMS, CURATED) if not os.path.exists(p)]
    if missing:
        for p in missing:
            print('build_road_status: missing %s' % os.path.relpath(p, ROOT), file=sys.stderr)
        return None, 1

    curated = load(CURATED)
    segments = curated.get('segments', [])
    errs = []
    seen = set()
    for s in segments:
        sid = s.get('id')
        if not sid or sid in seen:
            errs.append('duplicate or missing id: %r' % sid)
        seen.add(sid)
        if s.get('status') not in STATUS_ORDER:
            errs.append('%s: unknown status %r' % (sid, s.get('status')))
        if len(s.get('waypoints') or []) < 1:
            errs.append('%s: no waypoints' % sid)

    prepared = []
    for s in segments:
        pts = densify(s.get('waypoints') or [])
        prepared.append((s, pts, cell_index(pts)))

    flooded = load(FLOODED)['features']
    ems = load(EMS)['features']
    print('build_road_status: %d flood-extent roads, %d Copernicus segments, %d curated segments'
          % (len(flooded), len(ems), len(segments)))

    captured = {s['id']: 0 for s in segments}
    out = []

    def assign(f, kind):
        p = dict(f.get('properties') or {})
        hw = p.get('highway')
        is_ems = kind == 'ems'
        # EMS bridges are left alone: the bridge repair layer is the place that
        # question is answered, and a graded deck is not a road stretch.
        eligible = (not is_ems) or (p.get('kind') == 'road')
        vs = vertices(f['geometry'])
        buf = NEAR_TRUNK_M if (hw or '').strip().lower() in TRUNK_CLASSES else NEAR_M
        best, bestd = None, buf
        if eligible and vs:
            for seg, _pts, idx in prepared:
                d = min(min_dist(v, idx) for v in vs)
                if d < bestd and name_ok(p.get('name'), seg) and class_ok(hw, seg):
                    best, bestd = seg, d
        props = {
            'name': p.get('name'), 'highway': hw,
            'road_status': best['status'] if best else 'damaged',
            'status_source': best['id'] if best else ('ems' if is_ems else 'hdx'),
            'segment_id': best['id'] if best else None,
            'segment_name': best['name'] if best else None,
            'lane': best.get('lane') if best else None,
            'status_detail': best.get('status_detail') if best else None,
            'as_of': best.get('as_of') if best else None,
            'source_url': best.get('source_url') if best else None,
            'source_title': best.get('source_title') if best else None,
            'confidence': best.get('confidence') if best else None,
            'match_m': round(bestd, 1) if best else None,
            'feature_kind': kind,
            # What the two upstream layers said, kept so the popup can show the
            # curated reading and the assessment it replaces side by side.
            'status_hdx': p.get('status'), 'grade_ems': p.get('grade'),
            'kind_ems': p.get('kind'), 'locality': p.get('locality'),
            'length_m': p.get('length_m'), 'surface': p.get('surface'),
            'bridge': p.get('bridge'), 'osm_id': p.get('id'),
        }
        if best:
            captured[best['id']] += 1
        return {'type': 'Feature', 'properties': props, 'geometry': f['geometry']}

    for f in flooded:
        out.append(assign(f, 'flooded'))
    for f in ems:
        out.append(assign(f, 'ems'))

    # The curated corridors themselves, so a stretch with no road features under
    # it (every hill detour) still says what it is.
    for s in segments:
        wp = s.get('waypoints') or []
        if len(wp) < 2:
            # A single waypoint is a point fix (a bridge site); a one-vertex line
            # is not drawable, so it is reported and skipped rather than emitted.
            print('   %-40s single waypoint, no ribbon drawn' % s['id'])
            continue
        out.append({'type': 'Feature', 'geometry': {'type': 'LineString', 'coordinates': [list(p) for p in wp]},
                    'properties': {
                        'name': s['name'], 'highway': None,
                        'road_status': s['status'], 'status_source': s['id'],
                        'segment_id': s['id'], 'segment_name': s['name'],
                        'lane': s.get('lane'), 'status_detail': s.get('status_detail'),
                        'as_of': s.get('as_of'), 'source_url': s.get('source_url'),
                        'source_title': s.get('source_title'), 'confidence': s.get('confidence'),
                        'match_m': None, 'feature_kind': 'segment',
                        'road': s.get('road'), 'ref': s.get('ref'),
                        'from': s.get('from'), 'to': s.get('to'),
                        'captured': captured[s['id']],
                        'status_hdx': None, 'grade_ems': None, 'kind_ems': None,
                        'locality': None, 'length_m': None, 'surface': None,
                        'bridge': None, 'osm_id': None}})

    # -- summary -------------------------------------------------------------
    grid = {}
    for f in out:
        k = (f['properties']['feature_kind'], f['properties']['road_status'])
        grid[k] = grid.get(k, 0) + 1
    w = max(len(s) for s in STATUS_ORDER)
    print('\n   features by kind x road status')
    print('   %-9s %s %6s' % ('', ' '.join('%*s' % (w, s) for s in STATUS_ORDER), 'total'))
    for k in KIND_ORDER:
        row = [grid.get((k, s), 0) for s in STATUS_ORDER]
        if sum(row):
            print('   %-9s %s %6d' % (k, ' '.join('%*d' % (w, n) for n in row), sum(row)))
    tot = [sum(grid.get((k, s), 0) for k in KIND_ORDER) for s in STATUS_ORDER]
    print('   %-9s %s %6d' % ('total', ' '.join('%*d' % (w, n) for n in tot), sum(tot)))

    print('\n   road features captured per curated segment')
    zero = []
    for s in segments:
        n = captured[s['id']]
        if n == 0:
            zero.append(s['id'])
        print('   %-42s %-13s %4d%s' % (s['id'], s['status'], n, '   <-- captured nothing' if n == 0 else ''))
    if zero:
        print('   %d of %d segments captured no road feature (expected for the hill detours,'
              ' which run outside the flood extent and the Copernicus areas)' % (len(zero), len(segments)))

    for e in errs:
        print('   ERROR %s' % e, file=sys.stderr)
    fc = {'type': 'FeatureCollection', 'name': 'road_status',
          'as_of': curated.get('as_of'), 'features': out}
    return fc, (1 if errs else 0)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--check', action='store_true', help='report and write nothing')
    args = ap.parse_args()
    fc, rc = build()
    if fc is None:
        return rc
    if args.check:
        print('\nbuild_road_status: --check, nothing written.')
        return rc
    if rc:
        print('build_road_status: refusing to write, fix the errors above.', file=sys.stderr)
        return rc
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(fc, fh, ensure_ascii=False, indent=1)
        fh.write('\n')
    print('\nbuild_road_status: wrote %s (%d features)' % (os.path.relpath(OUT, ROOT), len(fc['features'])))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
