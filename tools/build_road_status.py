#!/usr/bin/env python3
"""Recolour the corridor's road layers by whether a vehicle can get through today.

The map already draws two red road overlays, and both of them answer the same
question: how bad was the damage when somebody last looked?

  * `roads_in_flood_extent.geojson` -- the HOT roads clipped to the observed
    27 Aug flood extent (tools/build_flooded_roads.py).  That build already
    carries a per-feature `ems_grade` for 467 of its 877 features, voted from
    the Copernicus lines within 25 m, sampled every 15 m, damage anywhere on a
    segment outranking "no damage" elsewhere on it.
  * `ems_road_grading.geojson` -- the Copernicus EMS EMSR927 grades from
    0.3-0.7 m post-event imagery (tools/build_ems_roads.py).

Neither says whether the road is open now.  Four weeks after the flood that is
the question people actually have, and the answer only exists in the NDRRMA
situation reports and the press.  `data/road_status.json` holds that reading by
hand, as a small set of corridor segments, and this script joins it to the two
road layers.

WHAT A CURATED SEGMENT IS, AND WHAT IT IS NOT.  A situation report saying
"traffic is operating from Galchhi through Devighat to Battar" is a claim about
a ROUTE, not about every piece of tarmac near it.  The route is open precisely
because it now diverts around the stretches the river took: those stretches are
still destroyed, and the traffic is going round them.  The first version of
this script matched on proximity alone and painted 82 Copernicus-Destroyed
segments white, drawing open road straight across the post-flood channel at
Devighat and Kashitar.  That was the bug.

So the rule is: THE PER-FEATURE DAMAGE GRADE COMES FIRST, and a curated route
can only ever upgrade what the imagery did not rule out.

    damage_grade Destroyed  ->  damaged (red), always, whatever the route says.
                                The route is open by diversion; this alignment
                                is not.
    damage_grade Damaged    ->  under_repair at best, and only on a route that
                                is itself restored or under repair.
    anything else           ->  may take the route's status, but only after
                                three tests that all have to pass.

The three tests exist so a route's status cannot bleed sideways:

  1. Tight buffer with high coverage.  40 m for a local road, 60 m for trunk,
     primary and secondary, 30 m for a point repair (a Bailey or Acrow bridge,
     where the claim is about one span and its approaches), and 25 m for a
     feature sitting inside the flood extent with no Copernicus grade at all.
     At least COVER_MIN of the feature's sampled vertices have to be inside it,
     so a side road that merely crosses the route picks up nothing.
  2. Highway class compatible with the kind of route.  A highway route upgrades
     trunk through unclassified; it does not upgrade a residential street, a
     service road or a farm track running beside it.  Footways, paths and steps
     are never upgraded.  A curated row can name an exception in `match_names`.
  3. Name compatible.  An unnamed feature is compatible with anything -- most
     corridor ways carry no name -- but a road that calls itself something else
     is a different road, whatever the distance says.

Where the three disagree the answer is red.  Red is also the default for every
feature no segment claims, so the colour never says more than a source did.

Output: `data/hdx/derived/road_status.geojson`, with `feature_kind`:

    flooded   every feature of roads_in_flood_extent.geojson, recoloured
    ems       every feature of ems_road_grading.geojson, recoloured where
              `kind` is road; the graded bridges pass through untouched so the
              EMS layer still draws them
    segment   the curated polylines themselves, drawn as a wide translucent
              ribbon at low zoom only.  This is what carries "the ROUTE through
              Devighat is open" while the alignment pieces under it stay red,
              and it is the only thing that says anything at all about the hill
              detour routes, which run outside the flood extent and the
              Copernicus areas and so have no road features to recolour.

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
HDX = os.path.join(ROOT, 'data', 'hdx')
DERIVED = os.path.join(HDX, 'derived')
FLOODED = os.path.join(DERIVED, 'roads_in_flood_extent.geojson')
EMS = os.path.join(DERIVED, 'ems_road_grading.geojson')
EXTENT = os.path.join(HDX, 'hot_flood_npl', 'hot_flood_npl_flood_extent.geojson')
DESTROYED = [os.path.join(HDX, 'hot_flood_npl_corridor', 'destroyed_features_osm.geojson'),
             os.path.join(HDX, 'hot_flood_npl', 'destroyed_features_osm.geojson')]
CURATED = os.path.join(ROOT, 'data', 'road_status.json')
OUT = os.path.join(DERIVED, 'road_status.geojson')

# A curated waypoint list is a corridor, not a survey: sampling it every 25 m
# keeps the buffer test honest on a long straight leg between two waypoints.
DENSIFY_M = 25.0
SAMPLE_M = 20.0          # along each road feature, for the coverage test
COVER_MIN = 0.70         # of a feature's samples must be inside the buffer
NEAR_LOCAL_M = 40.0
NEAR_MAIN_M = 60.0
NEAR_POINT_M = 30.0      # a curated point repair: one span and its approaches
NEAR_IN_CHANNEL_M = 25.0  # inside the flood extent with no Copernicus grade
POINT_REPAIR_M = 500.0   # a curated polyline shorter than this is a point repair
OSM_COINCIDE_M = 15.0    # a destroyed OSM way lying on top of a road feature
OSM_COINCIDE_MIN = 0.60
EXTENT_MIN = 0.50        # of samples inside the flood extent -> in_flood_extent

MAIN_CLASSES = {'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link'}
# What a highway route may upgrade: the through-road classes, nothing beside them.
HIGHWAY_UPGRADE = MAIN_CLASSES | {'tertiary', 'tertiary_link', 'unclassified'}
# What a local or detour route may upgrade, beyond that.
LOCAL_UPGRADE = HIGHWAY_UPGRADE | {'residential', 'service', 'road', 'living_street'}
NEVER = {'footway', 'path', 'steps', 'cycleway', 'bridleway'}

DESTROYED_WORDS = {'destroyed', 'washed out'}
DAMAGED_WORDS = {'damaged', 'major damage', 'major-damage'}

STATUS_ORDER = ['restored', 'under_repair', 'damaged']
KIND_ORDER = ['flooded', 'ems', 'segment']
GRADE_ORDER = ['Destroyed', 'Damaged', 'Possibly damaged', 'No visible damage', 'Not Analysed']


def load(path):
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def haversine(a, b):
    r = 6371000.0
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    h = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b[0] - a[0]) / 2) ** 2)
    return 2 * r * math.asin(math.sqrt(h))


def linestrings(geom):
    t, c = geom.get('type'), geom.get('coordinates')
    if t == 'LineString':
        return [c]
    if t == 'MultiLineString':
        return list(c)
    if t == 'Point':
        return [[c]]
    if t == 'MultiPoint':
        return [list(c)]
    return []


def vertices(geom):
    return [p for part in linestrings(geom) for p in part]


def densify(points, step):
    """A polyline resampled so consecutive points are <= step metres apart."""
    pts = [list(p) for p in points]
    if len(pts) < 2:
        return pts
    out = [list(pts[0])]
    for a, b in zip(pts, pts[1:]):
        n = max(1, int(math.ceil(haversine(a, b) / step)))
        for i in range(1, n + 1):
            t = i / n
            out.append([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    return out


def samples(geom, step=SAMPLE_M):
    """Points along a feature, dense enough that the coverage fraction means
    something on a long way as well as a short one."""
    out = []
    for part in linestrings(geom):
        out.extend(densify(part, step) if len(part) > 1 else [list(p) for p in part])
    return out


def polyline_length(points):
    return sum(haversine(a, b) for a, b in zip(points, points[1:]))


class Grid:
    """A coarse lon/lat bucket index.  Every feature is tested against every
    segment and against the destroyed-features layer, which is only affordable
    with the inner loop bucketed.  0.01 degrees is about 1.1 km, comfortably
    wider than any buffer here, so looking at a cell and its eight neighbours
    cannot miss a point inside the buffer."""

    SIZE = 0.01

    def __init__(self, points):
        self.d = {}
        for p in points:
            self.d.setdefault((int(math.floor(p[0] / self.SIZE)), int(math.floor(p[1] / self.SIZE))), []).append(p)

    def min_dist(self, pt):
        cx, cy = int(math.floor(pt[0] / self.SIZE)), int(math.floor(pt[1] / self.SIZE))
        best = float('inf')
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for p in self.d.get((cx + dx, cy + dy), ()):
                    d = haversine(pt, p)
                    if d < best:
                        best = d
        return best


def point_in_rings(pt, rings):
    """Ray casting: inside the outer ring and outside every hole."""
    def inside(ring):
        x, y = pt
        c = False
        for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-12) + x1:
                c = not c
        return c
    if not inside(rings[0]):
        return False
    return not any(inside(r) for r in rings[1:])


def norm(s):
    return ''.join(ch for ch in str(s or '').lower() if ch.isalnum())


def name_ok(feat_name, seg):
    """An unnamed feature is compatible with anything; a named one has to match."""
    fn = norm(feat_name)
    if not fn:
        return True
    for c in [norm(n) for n in (seg.get('match_names') or [])] + [norm(seg.get('road')), norm(seg.get('ref'))]:
        if c and (c in fn or fn in c):
            return True
    return False


def named_exactly(feat_name, seg):
    """Does the curated row name this feature outright?  The only way a class
    the route would not normally upgrade gets upgraded anyway."""
    fn = norm(feat_name)
    return bool(fn) and any(fn == norm(n) for n in (seg.get('match_names') or []))


def class_ok(highway, seg):
    hw = (highway or '').strip().lower()
    if not hw:
        # The Copernicus features carry no highway tag, and every one of them is
        # a road or a bridge an analyst traced, so there is no side-track risk.
        return True
    if hw in NEVER:
        return False
    allowed = HIGHWAY_UPGRADE if seg.get('_is_highway') else LOCAL_UPGRADE
    if (seg.get('lane') or '') == 'track':
        allowed = allowed | {'track'}
    return hw in allowed


def worst(grades):
    for g in GRADE_ORDER:
        if g in grades:
            return g
    return None


def grade_class(grade):
    g = (grade or '').strip().lower()
    if g in DESTROYED_WORDS:
        return 'destroyed'
    if g in DAMAGED_WORDS:
        return 'damaged'
    return None


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
        if not (s.get('waypoints') or []):
            errs.append('%s: no waypoints' % sid)
        # A route that names a highway reference, or whose road reads as one,
        # upgrades only through-road classes.
        blob = ' '.join(str(s.get(k) or '') for k in ('road', 'ref')).lower()
        s['_is_highway'] = bool(s.get('ref')) or 'highway' in blob or 'rajmarg' in blob
        pts = densify(s.get('waypoints') or [], DENSIFY_M)
        s['_pts'] = pts
        s['_grid'] = Grid(pts)
        # A one-span claim (an Acrow or Bailey bridge) gets the tightest buffer:
        # it is about that crossing and its approaches, not a corridor.
        s['_point_repair'] = polyline_length(s.get('waypoints') or []) < POINT_REPAIR_M

    flooded = load(FLOODED)['features']
    ems = load(EMS)['features']

    # -- the flood extent polygon, for the "no grade but in the channel" test --
    rings = []
    if os.path.exists(EXTENT):
        for f in load(EXTENT)['features']:
            g = f['geometry']
            if g['type'] == 'Polygon':
                rings.append(g['coordinates'])
            elif g['type'] == 'MultiPolygon':
                rings.extend(g['coordinates'])

    # -- destroyed / damaged OSM ways, for flood-extent roads with no EMS grade --
    # Indexed PER WAY, not as one merged cloud.  Merging them would mean a road
    # counted as coinciding with "some destroyed way" when its samples actually
    # brush several different ones in turn, which marked 429 extra features
    # destroyed the first time this was written.
    dest_by_id, dest_ways = {}, []
    for path in DESTROYED:
        if not os.path.exists(path):
            continue
        for f in load(path)['features']:
            p = f['properties']
            if p.get('feature_type') not in ('road', 'bridge'):
                continue
            cls = grade_class(p.get('status'))
            if not cls:
                continue
            if p.get('id'):
                dest_by_id.setdefault(p['id'], cls)
            pts = samples(f['geometry'])
            if pts:
                dest_ways.append((cls, Grid(pts)))
    # A cell index over the way index, so only the few ways near a feature are tested.
    dest_cells = {}
    for i, (_cls, g) in enumerate(dest_ways):
        for key in g.d:
            dest_cells.setdefault(key, set()).add(i)

    print('build_road_status: %d flood-extent roads, %d Copernicus segments, %d curated segments'
          % (len(flooded), len(ems), len(segments)))
    print('   %d destroyed/damaged OSM road and bridge ways available to inherit from'
          % len(dest_ways))

    captured = {s['id']: 0 for s in segments}
    held = {}
    blocked = {'destroyed': 0, 'damaged': 0, 'class': 0, 'name': 0}
    out = []

    def damage_of(p, kind, pts):
        """(grade, source) for one feature, before any curated status is applied."""
        if kind == 'ems':
            return p.get('grade'), 'ems'
        # build_flooded_roads.py already voted this from the Copernicus lines.
        if p.get('ems_grade'):
            return p['ems_grade'], 'ems-inherited'
        if grade_class(p.get('status')):
            return ('Destroyed' if grade_class(p['status']) == 'destroyed' else 'Damaged'), 'osm-status'
        if p.get('id') and p['id'] in dest_by_id:
            cls = dest_by_id[p['id']]
            return ('Destroyed' if cls == 'destroyed' else 'Damaged'), 'osm-destroyed-features'
        if pts:
            # One destroyed way has to lie along this feature on its own.
            near = set()
            for v in pts:
                cx, cy = int(math.floor(v[0] / Grid.SIZE)), int(math.floor(v[1] / Grid.SIZE))
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        near |= dest_cells.get((cx + dx, cy + dy), set())
            for i in sorted(near):
                cls, g = dest_ways[i]
                hit = sum(1 for v in pts if g.min_dist(v) <= OSM_COINCIDE_M)
                if hit / len(pts) >= OSM_COINCIDE_MIN:
                    return ('Destroyed' if cls == 'destroyed' else 'Damaged'), 'osm-destroyed-features'
        return None, None

    def assign(f, kind):
        p = dict(f.get('properties') or {})
        hw = (p.get('highway') or '').strip().lower()
        pts = samples(f['geometry'])
        grade, gsrc = damage_of(p, kind, pts)
        gcls = grade_class(grade)

        in_extent = False
        if rings and pts and not grade:
            hit = sum(1 for v in pts if any(point_in_rings(v, r) for r in rings))
            in_extent = (hit / len(pts)) >= EXTENT_MIN

        # An EMS bridge is the bridge layer's business, not a road stretch.
        eligible = (kind != 'ems') or (p.get('kind') == 'road')

        # The route is found first and the grade decides afterwards what it may
        # do, so a destroyed alignment on an open route can say WHY it is red.
        best, bestd = None, None
        if eligible and pts:
            if hw in MAIN_CLASSES or (not hw and norm(p.get('name')) and
                                      any(w in norm(p.get('name')) for w in ('rajmarg', 'highway'))):
                base = NEAR_MAIN_M
            else:
                base = NEAR_LOCAL_M
            if in_extent:
                base = min(base, NEAR_IN_CHANNEL_M)
            for seg in segments:
                buf = min(base, NEAR_POINT_M) if seg['_point_repair'] else base
                inside = sum(1 for v in pts if seg['_grid'].min_dist(v) <= buf)
                if inside / len(pts) < COVER_MIN:
                    continue
                if not name_ok(p.get('name'), seg):
                    blocked['name'] += 1
                    continue
                if not (class_ok(hw, seg) or named_exactly(p.get('name'), seg)):
                    blocked['class'] += 1
                    continue
                d = min(seg['_grid'].min_dist(v) for v in pts)
                if best is None or d < bestd:
                    best, bestd = seg, d

        status, note = 'damaged', None
        route = best['status'] if best else None
        if gcls == 'destroyed':
            # Destruction is never upgraded.  This is the whole correction: an
            # open route is open because it goes around this, not through it.
            status = 'damaged'
            blocked['destroyed'] += 1
            if route in ('restored', 'under_repair'):
                note = ('The route through here has reopened via a diversion, but this alignment '
                        'is destroyed (' + (gsrc == 'ems' and 'Copernicus EMSR927'
                                            or gsrc == 'ems-inherited' and 'Copernicus EMSR927'
                                            or 'OpenStreetMap') + '), so it is drawn as closed.')
                held[best['id']] = held.get(best['id'], 0) + 1
        elif gcls == 'damaged':
            # Graded damaged: work in progress at best, never open.
            status = 'under_repair' if route in ('restored', 'under_repair') else 'damaged'
            if route == 'restored':
                note = ('The route through here has reopened, but this alignment is graded Damaged, '
                        'so it is drawn as under repair rather than open.')
                blocked['damaged'] += 1
            if best:
                captured[best['id']] += 1
        elif best:
            status = route
            captured[best['id']] += 1

        props = {
            'name': p.get('name'), 'highway': p.get('highway'),
            'road_status': status,
            'damage_grade': grade, 'damage_source': gsrc,
            'in_flood_extent': in_extent or None,
            'status_source': best['id'] if best else (gsrc or ('ems' if kind == 'ems' else 'hdx')),
            'segment_id': best['id'] if best else None,
            'segment_name': best['name'] if best else None,
            'lane': best.get('lane') if best else None,
            'status_detail': best.get('status_detail') if best else None,
            'status_note': note,
            'as_of': best.get('as_of') if best else None,
            'source_url': best.get('source_url') if best else None,
            'source_title': best.get('source_title') if best else None,
            'confidence': best.get('confidence') if best else None,
            'match_m': round(bestd, 1) if best else None,
            'feature_kind': kind,
            'status_hdx': p.get('status'), 'grade_ems': p.get('grade') or p.get('ems_grade'),
            'kind_ems': p.get('kind'), 'locality': p.get('locality'),
            'length_m': p.get('length_m'), 'surface': p.get('surface'),
            'bridge': p.get('bridge'), 'osm_id': p.get('id'),
        }
        return {'type': 'Feature', 'properties': props, 'geometry': f['geometry']}

    for f in flooded:
        out.append(assign(f, 'flooded'))
    for f in ems:
        out.append(assign(f, 'ems'))

    for s in segments:
        wp = s.get('waypoints') or []
        if len(wp) < 2:
            print('   %-40s single waypoint, no ribbon drawn' % s['id'])
            continue
        out.append({'type': 'Feature',
                    'geometry': {'type': 'LineString', 'coordinates': [list(p) for p in wp]},
                    'properties': {
                        'name': s['name'], 'highway': None,
                        'road_status': s['status'],
                        'damage_grade': None, 'damage_source': None, 'in_flood_extent': None,
                        'status_source': s['id'], 'segment_id': s['id'], 'segment_name': s['name'],
                        'lane': s.get('lane'), 'status_detail': s.get('status_detail'),
                        'status_note': 'A route, not an alignment: the stretches the river took are '
                                       'drawn red underneath, and the traffic goes round them.',
                        'as_of': s.get('as_of'), 'source_url': s.get('source_url'),
                        'source_title': s.get('source_title'), 'confidence': s.get('confidence'),
                        'match_m': None, 'feature_kind': 'segment',
                        'road': s.get('road'), 'ref': s.get('ref'),
                        'from': s.get('from'), 'to': s.get('to'),
                        'captured': captured[s['id']],
                        'status_hdx': None, 'grade_ems': None, 'kind_ems': None,
                        'locality': None, 'length_m': None, 'surface': None,
                        'bridge': None, 'osm_id': None}})

    report(out, segments, captured, held, blocked)
    for e in errs:
        print('   ERROR %s' % e, file=sys.stderr)
    fc = {'type': 'FeatureCollection', 'name': 'road_status',
          'as_of': curated.get('as_of'), 'features': out}
    return fc, (1 if errs else 0)


def report(out, segments, captured, held, blocked):
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

    dg = {}
    for f in out:
        p = f['properties']
        if p['feature_kind'] == 'segment':
            continue
        dg[(p['damage_grade'] or 'no grade', p['road_status'])] = dg.get((p['damage_grade'] or 'no grade', p['road_status']), 0) + 1
    print('\n   road features by damage grade x road status')
    print('   %-18s %s %6s' % ('', ' '.join('%*s' % (w, s) for s in STATUS_ORDER), 'total'))
    for g in GRADE_ORDER + ['no grade']:
        row = [dg.get((g, s), 0) for s in STATUS_ORDER]
        if sum(row):
            print('   %-18s %s %6d' % (g, ' '.join('%*d' % (w, n) for n in row), sum(row)))
    print('   held at red because the alignment is graded Destroyed: %d' % blocked['destroyed'])
    print('   held at under repair because the alignment is graded Damaged: %d' % blocked['damaged'])
    print('   rejected on highway class: %d; on name: %d' % (blocked['class'], blocked['name']))

    print('\n   per curated segment: features recoloured, and features on the route')
    print('   %-42s %-13s %8s %6s' % ('', '', 'recolour', 'held'))
    zero = []
    for s in segments:
        n, h = captured[s['id']], held.get(s['id'], 0)
        if n == 0:
            zero.append(s['id'])
        print('   %-42s %-13s %8d %6d%s' % (s['id'], s['status'], n, h,
                                            '   <-- recoloured nothing' if n == 0 else ''))
    if zero:
        print('   %d of %d segments recoloured no road feature' % (len(zero), len(segments)))
    print('   "held" = features on that route whose own alignment is graded Destroyed, kept red')


def diff_against(old_path, fc):
    """Before/after against the previous derived file, keyed on geometry order."""
    if not os.path.exists(old_path):
        return
    try:
        old = load(old_path)['features']
    except Exception:
        return
    if len(old) != len(fc['features']):
        print('\n   previous file has %d features, this one %d; not comparable row by row'
              % (len(old), len(fc['features'])))
        return
    moves = {}
    for a, b in zip(old, fc['features']):
        pa, pb = a['properties'], b['properties']
        if pa.get('road_status') != pb.get('road_status'):
            moves[(pa.get('road_status'), pb.get('road_status'))] = moves.get((pa.get('road_status'), pb.get('road_status')), 0) + 1
    print('\n   change against the previous derived file')
    if not moves:
        print('   nothing changed')
        return
    for (a, b), n in sorted(moves.items(), key=lambda kv: -kv[1]):
        print('   %-13s -> %-13s %5d' % (a, b, n))
    print('   %d of %d features changed status' % (sum(moves.values()), len(old)))


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--check', action='store_true', help='report and write nothing')
    args = ap.parse_args()
    fc, rc = build()
    if fc is None:
        return rc
    diff_against(OUT, fc)
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
