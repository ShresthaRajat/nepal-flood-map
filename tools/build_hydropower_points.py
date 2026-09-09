#!/usr/bin/env python3
"""Merge the HDX exposed-hydropower points with the extra geocoded plants.

HOT's `hot_flood_npl_exposed_hydropowers.geojson` carries 10 of the projects
data/reports.json describes; the rest were located by hand from OpenStreetMap,
Wikidata, the Global Energy Monitor hydropower tracker and Nominatim, and the
result is committed alongside as `hydropower_extra_src.geojson` so this build is
reproducible without a network call.

Output: `data/hdx/derived/hydropower_points.geojson`, one Point per plant, named
with the spellings data/reports.json uses so the sidebar join is exact.

Properties on every feature:

    name          the reports.json project name
    capacity_mw   installed capacity, or null
    river         watercourse, or null
    status        pre-flood status where the source gives one
    district      resolved from the point against the COD-AB layer
    municipality  resolved from the point against the COD-AB layer
    source        hdx | osm | wikidata | company | nominatim
    source_ref    a URL, an OSM way, a Wikidata Q-id or a query
    precision     exact | approximate | settlement-level
    location      a display string: "approximate (Global Energy Monitor)"
    notes         provenance and any caveat worth surfacing in the popup

`precision` drives the map styling: exact points draw solid, the rest draw
translucent with a pale ring, so a hand-geocoded plant never looks as certain
as a surveyed one.

Municipality and district are always resolved from the coordinate against
`data/admin/admin_municipality.geojson`, never copied from the source.  The HDX
export carries a `municipality` field that contradicts its own `adm3_name` on
several rows -- Devighat is "Panchakanya" there and Bidur in both `adm3_name`
and the boundary layer -- so that field is ignored.

    python3 tools/build_hydropower_points.py
    python3 tools/build_hydropower_points.py --check   # report, write nothing
"""

import argparse
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
HDX = os.path.join(ROOT, 'data', 'hdx', 'hot_flood_npl',
                   'hot_flood_npl_exposed_hydropowers.geojson')
EXTRA = os.path.join(ROOT, 'data', 'hdx', 'derived', 'hydropower_extra_src.geojson')
MUNI = os.path.join(ROOT, 'data', 'admin', 'admin_municipality.geojson')
OUT = os.path.join(ROOT, 'data', 'hdx', 'derived', 'hydropower_points.geojson')
REPORTS = os.path.join(ROOT, 'data', 'reports.json')

# Source spelling -> the name data/reports.json uses.  HDX writes the Trishuli
# cascade with spaces and keeps the HEP/HPP suffixes; the extra file names the
# solar plant by its district.
RENAME = {
    'Upper Trishuli 3A': 'Upper Trishuli-3A',
    'Upper Trishuli 3B': 'Upper Trishuli-3B',
    'Bhotekoshi Khola Hydropower Project': 'Bhotekoshi Khola',
    'Upper Trishuli-I Cascade HEP': 'Upper Trishuli-I Cascade',
    'NEA solar (Nuwakot)': 'NEA solar plant',
}

# Features in the extra file that must not become their own plant: the second
# Chilime candidate (kept as a note on the OSM point instead) and the Devighat
# anchor, which only existed to place the solar plant and is already in HDX.
DROP = [
    ('Chilime', 'wikidata'),
    ('Devighat Hydropower Station', 'wikidata'),
]

# Human-readable source names for the `location` display string.
SOURCE_LABEL = {
    'hdx': 'HOT via HDX', 'osm': 'OpenStreetMap', 'wikidata': 'Wikidata',
    'company': 'Global Energy Monitor', 'nominatim': 'Nominatim',
}

# Caveats found by checking each point against the OSM waterways export; see the
# --check output.  Appended to the feature's own notes.
RIVER_NOTES = {
    'Mailung Khola': ('The Wikipedia infobox coordinate sits about 8 km east of the Mailung Khola as '
                      'mapped in OpenStreetMap and about 1 km from the Trishuli, so it locates the '
                      'project only roughly.'),
    'Upper Mailung A': ('About 1.2 km west of the mapped Mailung Khola, consistent with an upper '
                        'intake but not on the channel itself.'),
    'Sanjen': ('The Sanjen Khola is not in the OSM waterways export; the nearest mapped watercourse '
               'is the Simlun Khola about 2 km away. Single-source point.'),
    'Sanjen Upper': ('Pinned to the Aamachhodingmo centre, about 1 km from the Chilime Khola, '
                     'matching the developer\'s "Simbu Village, Chilime" description rather than the '
                     'Sanjen Khola the project is named for.'),
}


def polys(g):
    if not g:
        return []
    if g['type'] == 'Polygon':
        return [g['coordinates']]
    if g['type'] == 'MultiPolygon':
        return g['coordinates']
    return []


def in_ring(pt, ring):
    x, y = pt
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[(i + 1) % n][0], ring[(i + 1) % n][1]
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            inside = not inside
    return inside


def locate(pt, muni):
    """Municipality and district containing a point, from the COD-AB layer."""
    for f in muni['features']:
        for poly in polys(f['geometry']):
            if in_ring(pt, poly[0]) and not any(in_ring(pt, h) for h in poly[1:]):
                p = f['properties']
                return p.get('adm3_name'), p.get('adm2_name')
    return None, None


def display_location(precision, source, source_ref):
    label = SOURCE_LABEL.get(source, source or 'unknown source')
    if precision == 'exact':
        return 'exact (%s)' % label
    if precision == 'settlement-level':
        return 'settlement-level only (%s)' % label
    return 'approximate (%s)' % label


def load(path):
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='report and write nothing')
    args = ap.parse_args()

    hdx = load(HDX)
    extra = load(EXTRA)
    muni = load(MUNI)

    out, seen = [], {}

    def add(name, geom, props):
        name = RENAME.get(name, name)
        if name in seen:
            print('   skip duplicate: %s (%s)' % (name, props.get('source')))
            return
        lon, lat = geom['coordinates'][0], geom['coordinates'][1]
        adm3, adm2 = locate((lon, lat), muni)
        note = props.get('notes') or ''
        if name in RIVER_NOTES:
            note = (note + ' ' if note else '') + RIVER_NOTES[name]
        rec = {
            'name': name,
            'capacity_mw': props.get('capacity_mw'),
            'river': props.get('river') or None,
            'status': props.get('status') or None,
            'district': adm2 or props.get('adm2_name'),
            'municipality': adm3 or props.get('adm3_name'),
            'source': props.get('source'),
            'source_ref': props.get('source_ref'),
            'precision': props.get('precision'),
            'location': display_location(props.get('precision'), props.get('source'),
                                        props.get('source_ref')),
            'notes': note or None,
        }
        seen[name] = rec
        out.append({'type': 'Feature', 'properties': rec,
                    'geometry': {'type': 'Point', 'coordinates': [round(lon, 6), round(lat, 6)]}})

    # HDX first: it is the surveyed layer, so it wins any name collision.
    for f in hdx['features']:
        p = dict(f['properties'] or {})
        p['source'] = 'hdx'
        p['source_ref'] = 'hot_flood_npl_exposed_hydropowers.geojson'
        p['precision'] = 'exact'
        p['notes'] = None
        add(p.get('name'), f['geometry'], p)

    dropped = 0
    for f in extra['features']:
        p = dict(f['properties'] or {})
        if (p.get('name'), p.get('source')) in DROP:
            dropped += 1
            continue
        add(p.get('name'), f['geometry'], p)

    fc = {'type': 'FeatureCollection',
          'name': 'hydropower_points',
          'note': ('HOT/HDX exposed hydropowers merged with hand-geocoded plants; '
                   'see tools/build_hydropower_points.py. `precision` says how far to trust '
                   'each position.'),
          'features': out}

    from collections import Counter
    prec = Counter(f['properties']['precision'] for f in out)
    src = Counter(f['properties']['source'] for f in out)
    print('build_hydropower_points: %d plants (%d from HDX, %d extra, %d dropped)'
          % (len(out), len(hdx['features']), len(extra['features']) - dropped, dropped))
    print('   precision %s' % dict(prec))
    print('   source    %s' % dict(src))

    # Cross-check the join against reports.json, which is what the sidebar does.
    try:
        rep = load(REPORTS)
        want = [p['name'] for p in rep['energy']['projects']]
        have = set(seen)
        missing = [n for n in want if n not in have]
        extra_names = [n for n in have if n not in want]
        print('   reports.json projects %d, located %d, unlocated %s'
              % (len(want), len(want) - len(missing), missing or 'none'))
        if extra_names:
            print('   points with no reports.json row: %s' % extra_names)
    except Exception as e:                                  # pragma: no cover
        print('   reports.json cross-check skipped: %s' % e)

    if args.check:
        print('build_hydropower_points: --check, nothing written.')
        return 0
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(fc, fh, ensure_ascii=False, indent=1)
        fh.write('\n')
    print('build_hydropower_points: wrote %s' % os.path.relpath(OUT, ROOT))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
