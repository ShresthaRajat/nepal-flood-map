#!/usr/bin/env python3
"""Join the bridge ground reports, the OSM bridge spans and the curated repair
status into one layer the map can draw.

Three things about a bridge are worth telling apart on the map, and no single
source carries all three:

  * WHERE it is and how bad the damage was -- the HDX ground reports
    (`hot_flood_npl_bridge_damage.geojson`, 58 points, status Washed out /
    Damaged / Intact).  The reports carry no bridge type at all.
  * WHAT KIND of bridge it is -- the OSM spans (`bridges_osm.geojson` in both
    the flood-area and the corridor dataset).  A footway/path/steps deck or a
    suspension structure that is not a road is a footbridge; a road-class deck
    or one with a maxweight is motorable; a span re-added after the flood with
    only `bridge=yes` and no highway tag is neither, and stays "unknown".
  * WHETHER it has been repaired since -- nothing in the open data says.  That
    comes from `data/bridge_status.json`, hand-compiled from the NDRRMA
    situation reports and the press, and it only holds the overrides.

Output: `data/hdx/derived/bridge_status.geojson`.  Three kinds of feature, told
apart by `feature_kind`:

    report    one per HDX ground report (Point).  bridge_type comes from the
              nearest OSM span within NEAR_SPAN_M; repair_status comes from a
              curated override if one matches, else from the HDX status.
    curated   one per curated entry that matched no ground report (Point), so a
              Bailey bridge or a temporary footbridge the ground survey never
              listed still appears.
    span      one per OSM span a curated entry names by osm_id (LineString), so
              the drawn bridge line recolours with its repair status and not
              only the marker above it.

Properties on every feature: name, bridge_type, repair_status, status_hdx,
status_detail, as_of, source_url, source_title, confidence, location, adm3,
length_m, feature_kind, matched_osm_id.

Stdlib only; the repo root comes from this file's location, so it runs the same
from a laptop, from cron or from the GitHub Actions workflow.  Deterministic:
same inputs, byte-identical output.

    python3 tools/build_bridge_status.py
    python3 tools/build_bridge_status.py --check   # report, write nothing
"""
import argparse
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HDX = os.path.join(ROOT, 'data', 'hdx')
REPORTS = os.path.join(HDX, 'hot_flood_npl', 'hot_flood_npl_bridge_damage.geojson')
SPANS = [os.path.join(HDX, 'hot_flood_npl_corridor', 'bridges_osm.geojson'),
         os.path.join(HDX, 'hot_flood_npl', 'bridges_osm.geojson')]
CURATED = os.path.join(ROOT, 'data', 'bridge_status.json')
OUT = os.path.join(HDX, 'derived', 'bridge_status.geojson')

# A ground report is a hand-dropped pin on a river crossing and the OSM span is a
# traced deck, so they never coincide exactly.  80 m is wide enough to reach the
# deck from a pin dropped on the bank and narrow enough not to jump to the next
# crossing, the closest pair of which (Trisuli Bazar old and new) are 158 m apart.
NEAR_SPAN_M = 80.0
# The fallback join for a curated entry that names no report.  Tighter, because a
# wrong match here silently repaints somebody else's bridge.
NEAR_REPORT_M = 60.0

# app/app.js HW: the same highway classes, kept in step by hand.  Any change here
# has to be mirrored in the IS_FOOTBRIDGE / IS_MOTORABLE expressions there, which
# classify the tiled spans in the browser.
HW_FOOT = {'footway', 'path', 'steps', 'bridleway', 'cycleway'}
HW_ROAD = {'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
           'secondary', 'secondary_link', 'tertiary', 'tertiary_link',
           'unclassified', 'residential', 'service', 'living_street', 'track'}
SUSPENSION = {'simple-suspension', 'suspension'}

# HDX ground-report status -> the repair status a bridge has when nothing is
# curated for it.  "Washed out" is HDX's spelling of destroyed.
FROM_HDX = {'washed out': 'destroyed', 'destroyed': 'destroyed',
            'damaged': 'damaged', 'intact': 'intact', 'standing': 'intact'}
STATUS_ORDER = ['repaired', 'under_repair', 'damaged', 'destroyed', 'intact', 'unknown']
TYPE_ORDER = ['motorable', 'foot', 'unknown']


def load(path):
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def haversine(a, b):
    """Metres between two [lon, lat] pairs."""
    r = 6371000.0
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dp = p2 - p1
    dl = math.radians(b[0] - a[0])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def vertices(geom):
    """Every [lon, lat] in a geometry, whatever its type."""
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


def centroid(geom):
    vs = vertices(geom)
    if not vs:
        return None
    return [sum(v[0] for v in vs) / len(vs), sum(v[1] for v in vs) / len(vs)]


def near(point, geom):
    """Distance from `point` to the nearest vertex of `geom`.

    Vertex distance rather than true point-to-segment distance: OSM traces a
    bridge deck with a vertex every few metres, so the two agree to well inside
    the tolerances above, and this keeps the build stdlib-only and obvious.
    """
    vs = vertices(geom)
    return min((haversine(point, v) for v in vs), default=float('inf'))


def classify(props):
    """foot | motorable | unknown for one OSM span.

    Order matters.  A path-class deck is a footbridge even when it also carries a
    suspension structure; a suspension deck that is not road-class is a
    footbridge; a road-class deck or one with a weight limit is motorable.  What
    is left -- overwhelmingly spans re-added after the flood with nothing but
    `bridge=yes` -- stays unknown and is never folded into motorable, because
    guessing there would claim vehicle access this data does not have.
    """
    hw = (props.get('highway') or '').strip()
    struct = (props.get('bridge_structure') or '').strip()
    if hw in HW_FOOT:
        return 'foot'
    if struct in SUSPENSION and hw not in HW_ROAD:
        return 'foot'
    if hw in HW_ROAD or props.get('maxweight'):
        return 'motorable'
    return 'unknown'


def load_spans():
    """Every OSM bridge span, deduped by OSM id, corridor first (it is the wider
    extract, so it wins where the two datasets disagree)."""
    spans = {}
    for path in SPANS:
        if not os.path.exists(path):
            print('   missing, skipped: %s' % os.path.relpath(path, ROOT))
            continue
        for f in load(path)['features']:
            oid = (f.get('properties') or {}).get('id')
            if oid and oid not in spans:
                spans[oid] = f
    return spans


def blank(props=None):
    """The property block every output feature carries, so the map never has to
    test for a missing key."""
    out = {'name': None, 'bridge_type': 'unknown', 'repair_status': 'unknown',
           'status_hdx': None, 'status_detail': None, 'as_of': None,
           'source_url': None, 'source_title': None, 'confidence': None,
           'location': None, 'adm3': None, 'length_m': None,
           'feature_kind': 'report', 'matched_osm_id': None}
    if props:
        out.update(props)
    return out


def apply_override(props, ov):
    props['repair_status'] = ov['status']
    props['status_detail'] = ov.get('status_detail')
    props['as_of'] = ov.get('as_of')
    props['source_url'] = ov.get('source_url')
    props['source_title'] = ov.get('source_title')
    props['confidence'] = ov.get('confidence')
    # A curated bridge_type is a human reading of a named structure; trust it
    # over the nearest-span guess, but only where the guess found nothing.
    ct = {'foot_suspension': 'foot', 'foot': 'foot',
          'motorable': 'motorable'}.get(ov.get('bridge_type'))
    if ct and props.get('bridge_type') in (None, 'unknown'):
        props['bridge_type'] = ct
    return props


def build(check=False):
    if not os.path.exists(REPORTS):
        print('build_bridge_status: missing %s' % os.path.relpath(REPORTS, ROOT), file=sys.stderr)
        return None, 1
    reports = load(REPORTS)['features']
    spans = load_spans()
    curated = load(CURATED)
    overrides = curated.get('bridges', [])
    print('build_bridge_status: %d ground reports, %d OSM spans, %d curated overrides'
          % (len(reports), len(spans), len(overrides)))

    errs = []
    # -- validate the curated file against the sources it points at ----------
    report_by_name = {}
    for f in reports:
        nm = (f.get('properties') or {}).get('name')
        if nm is not None:
            report_by_name.setdefault(nm, f)
    seen_ids = set()
    for ov in overrides:
        oid = ov.get('id')
        if not oid or oid in seen_ids:
            errs.append('duplicate or missing id: %r' % oid)
        seen_ids.add(oid)
        if ov.get('status') not in STATUS_ORDER:
            errs.append('%s: unknown status %r' % (oid, ov.get('status')))
        m = ov.get('match') or {}
        rn = m.get('report_name')
        if rn is not None and rn not in report_by_name:
            errs.append('%s: match.report_name %r is not a name in the bridge_damage layer' % (oid, rn))
        wid = m.get('osm_id')
        if wid is not None and wid not in spans:
            errs.append('%s: match.osm_id %r is not in either bridges_osm export' % (oid, wid))

    # -- bind each override to a report -------------------------------------
    # A named binding wins and locks that report: a report claimed by name is out
    # of the distance fallback's reach, so two entries at one crossing (a washed
    # out span and its Bailey replacement) cannot collide.
    bound = {}          # report name -> override
    for ov in overrides:
        rn = (ov.get('match') or {}).get('report_name')
        if rn and rn in report_by_name:
            if rn in bound:
                errs.append('%s: report %r already claimed by %s' % (ov['id'], rn, bound[rn]['id']))
            else:
                bound[rn] = ov
    matched = {ov['id'] for ov in bound.values()}
    for ov in overrides:
        if ov['id'] in matched or ov.get('lat') is None or ov.get('lon') is None:
            continue
        pt = [ov['lon'], ov['lat']]
        best, bestd = None, NEAR_REPORT_M
        for f in reports:
            nm = (f.get('properties') or {}).get('name')
            if nm in bound:                      # claimed by name, hands off
                continue
            d = near(pt, f['geometry'])
            if d < bestd:
                best, bestd = nm, d
        if best is not None:
            bound[best] = ov
            matched.add(ov['id'])
            print('   %-28s joined to report %r by distance (%.0f m)' % (ov['id'], best, bestd))

    out = []
    # -- one feature per ground report --------------------------------------
    for f in sorted(reports, key=lambda f: (f['properties'].get('name') or '')):
        p = f['properties']
        c = centroid(f['geometry'])
        btype, oid = 'unknown', None
        if c:
            bd = NEAR_SPAN_M
            for sid, sf in spans.items():
                d = near(c, sf['geometry'])
                if d < bd:
                    bd, btype, oid = d, classify(sf['properties']), sid
        props = blank({
            'name': p.get('name'), 'bridge_type': btype,
            'repair_status': FROM_HDX.get(str(p.get('status') or '').strip().lower(), 'unknown'),
            'status_hdx': p.get('status'), 'location': p.get('location'),
            'adm3': p.get('adm3_name'), 'length_m': p.get('length_m'),
            'feature_kind': 'report', 'matched_osm_id': oid,
        })
        ov = bound.get(p.get('name'))
        if ov:
            props = apply_override(props, ov)
            if (ov.get('match') or {}).get('osm_id'):
                props['matched_osm_id'] = ov['match']['osm_id']
        out.append({'type': 'Feature', 'properties': props, 'geometry': f['geometry']})

    # -- one feature per curated entry that matched no report ----------------
    for ov in sorted(overrides, key=lambda o: o['id']):
        if ov['id'] in matched:
            continue
        if ov.get('lat') is None or ov.get('lon') is None:
            print('   %-28s no coordinates, not placed on the map' % ov['id'])
            continue
        wid = (ov.get('match') or {}).get('osm_id')
        props = apply_override(blank({
            'name': ov.get('name'), 'location': ov.get('location'),
            'feature_kind': 'curated', 'matched_osm_id': wid,
            'bridge_type': 'unknown',
        }), ov)
        out.append({'type': 'Feature', 'properties': props,
                    'geometry': {'type': 'Point', 'coordinates': [ov['lon'], ov['lat']]}})

    # -- one feature per OSM span a curated entry names -----------------------
    # Deduped by osm id: two entries can name the same span (the old and the new
    # Kolpu Khola bridge are one deck), and the first in id order wins.
    span_done = set()
    for ov in sorted(overrides, key=lambda o: o['id']):
        wid = (ov.get('match') or {}).get('osm_id')
        if not wid or wid in span_done or wid not in spans:
            continue
        span_done.add(wid)
        sf = spans[wid]
        props = apply_override(blank({
            'name': sf['properties'].get('name') or ov.get('name'),
            'location': ov.get('location'), 'status_hdx': sf['properties'].get('status'),
            'adm3': sf['properties'].get('adm3_name'),
            'bridge_type': classify(sf['properties']),
            'feature_kind': 'span', 'matched_osm_id': wid,
        }), ov)
        out.append({'type': 'Feature', 'properties': props, 'geometry': sf['geometry']})

    # -- summary -------------------------------------------------------------
    points = [f for f in out if f['properties']['feature_kind'] != 'span']
    grid = {}
    for f in points:
        p = f['properties']
        grid[(p['bridge_type'], p['repair_status'])] = grid.get((p['bridge_type'], p['repair_status']), 0) + 1
    statuses = [s for s in STATUS_ORDER if any(k[1] == s for k in grid)]
    w = max([9] + [len(s) for s in statuses])
    print('\n   points by type x repair status')
    print('   %-10s %s %6s' % ('', ' '.join('%*s' % (w, s) for s in statuses), 'total'))
    for t in TYPE_ORDER:
        if not any(k[0] == t for k in grid):
            continue
        row = [grid.get((t, s), 0) for s in statuses]
        print('   %-10s %s %6d' % (t, ' '.join('%*d' % (w, n) for n in row), sum(row)))
    tot = [sum(grid.get((t, s), 0) for t in TYPE_ORDER) for s in statuses]
    print('   %-10s %s %6d' % ('total', ' '.join('%*d' % (w, n) for n in tot), sum(tot)))
    print('   %d report points, %d curated points, %d recoloured spans'
          % (sum(1 for f in out if f['properties']['feature_kind'] == 'report'),
             sum(1 for f in out if f['properties']['feature_kind'] == 'curated'),
             len(span_done)))

    for e in errs:
        print('   ERROR %s' % e, file=sys.stderr)
    fc = {'type': 'FeatureCollection',
          'name': 'bridge_status',
          'as_of': curated.get('as_of'),
          'features': out}
    return fc, (1 if errs else 0)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--check', action='store_true', help='report and write nothing')
    args = ap.parse_args()
    fc, rc = build(check=args.check)
    if fc is None:
        return rc
    if args.check:
        print('build_bridge_status: --check, nothing written.')
        return rc
    if rc:
        print('build_bridge_status: refusing to write, fix the errors above.', file=sys.stderr)
        return rc
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(fc, fh, ensure_ascii=False, indent=1)
        fh.write('\n')
    print('build_bridge_status: wrote %s (%d features)' % (os.path.relpath(OUT, ROOT), len(fc['features'])))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
