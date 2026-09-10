#!/usr/bin/env python3
"""Rebuild data/admin/admin_ward.geojson from the 2018 HRRP ward shapefile.

Source (see data/admin/README.md for provenance and licence):
    HDX dataset `administrative-boundaries-of-nepal`, resource
    `Ward_Boundary_31_Districts.rar` (HRRP Nepal, last modified 2018-04-05).
    2,594 wards across the 31 districts affected by the 2015 Gorkha earthquake,
    in "Nepal_MUTM_Central_84_Everest_1830".

What this script does
    1. Downloads + unpacks the .rar into work/hrrp_wards/ if it is not there yet
       (needs `unar`; brew install unar).
    2. Extracts the wards of the four districts the flood corridor runs through
       (Rasuwa, Nuwakot, Dhading, Gorkha) with ogr2ogr, reprojecting to WGS84
       and simplifying at 0.0003 deg (~33 m) with coordinates rounded to 6 dp.
       Those are exactly the parameters that reproduce, vertex for vertex, the
       117 Rasuwa+Nuwakot wards written by hand on 8 Sep 2026 -- verified with a
       geometry-equality check against the previous file before this script was
       committed, so re-running it does not move any existing ward.
    3. Keeps only the five source/derived fields the app reads, and adds the
       joined fields below.

Fields written
    DISTRICT, GaPa_NaPa, Type_GN, NEW_WARD_N   verbatim from the shapefile
    WardCode                                   derived: DAN + GaPa_NaPa + NEW_WARD_N
                                               (the shapefile has no WardCode column;
                                                DAN is the title-case district name)
    flood_affected  1 if the simplified ward polygon intersects the observed
                    flood extent (data/hdx/hot_flood_npl/hot_flood_npl_flood_extent.geojson),
                    else 0.
    dmg_destroyed / dmg_damaged / dmg_total
                    OSM-mapped features with status Destroyed / Damaged from
                    data/hdx/hot_flood_npl_corridor/destroyed_features_osm.geojson
                    (the corridor cut, the wider of the two). Points are counted
                    by containment, lines and polygons by intersection; a feature
                    that spans several wards counts once in each, never twice in
                    the same one.
    dmg_fair        fAIr AI-detected buildings classed destroyed or major-damage
                    (data/hdx/hot_flood_npl_buildings_damage/...), same rule.

    There is no casualty field: no official source publishes casualties at ward
    level (NDRRMA reports bodies recovered by district), so the map's brown ramp
    reflects mapped damage only.

Usage
    python3 tools/build_admin_ward.py            # rebuild in place
    python3 tools/build_admin_ward.py --dry-run  # print the stats, write nothing
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request

from osgeo import ogr

ogr.UseExceptions()

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, 'work', 'hrrp_wards')
RAR = os.path.join(WORK, 'ward_boundary_31_districts.rar')
SHP = os.path.join(WORK, 'ward_boundary_31_districts',
                   'Ward_Boundary_31_Districts.shp')
RAR_URL = ('https://data.humdata.org/dataset/b2d819dc-4b07-435e-9f4a-3a717a2bf205/'
           'resource/79a65725-33d7-4021-9c44-dca73dd60fd7/download/'
           'ward_boundary_31_districts.rar')

OUT = os.path.join(ROOT, 'data', 'admin', 'admin_ward.geojson')
FLOOD = os.path.join(ROOT, 'data', 'hdx', 'hot_flood_npl',
                     'hot_flood_npl_flood_extent.geojson')
DAMAGE = os.path.join(ROOT, 'data', 'hdx', 'hot_flood_npl_corridor',
                      'destroyed_features_osm.geojson')
FAIR = os.path.join(ROOT, 'data', 'hdx', 'hot_flood_npl_buildings_damage',
                    'hot_flood_npl_buildings_damage.geojson')

# The four districts the Trishuli / Bhote Koshi corridor runs through. HRRP
# spells them upper case; COD-AB (admin_district.geojson adm2_name) title case.
DISTRICTS = ['RASUWA', 'NUWAKOT', 'DHADING', 'GORKHA']
SIMPLIFY = 0.0003     # degrees, ~33 m at this latitude
PRECISION = 6         # decimal places, ~0.1 m
FIELDS = ['DISTRICT', 'GaPa_NaPa', 'Type_GN', 'NEW_WARD_N', 'WardCode']
FAIR_DMG = ('destroyed', 'major-damage')


def fetch_source():
    """Download and unpack the HRRP shapefile if work/ does not already hold it."""
    if os.path.exists(SHP):
        return
    os.makedirs(WORK, exist_ok=True)
    if not os.path.exists(RAR):
        print('downloading %s' % RAR_URL, file=sys.stderr)
        urllib.request.urlretrieve(RAR_URL, RAR)
    if not shutil.which('unar'):
        sys.exit('unar not found (brew install unar); unpack %s by hand' % RAR)
    subprocess.run(['unar', '-q', '-f', '-o', WORK, RAR], check=True)
    if not os.path.exists(SHP):
        sys.exit('unpacked %s but %s is missing' % (RAR, SHP))


def extract_wards():
    """ogr2ogr the four districts to WGS84 GeoJSON; return the parsed dict."""
    where = "DISTRICT IN (%s)" % ','.join("'%s'" % d for d in DISTRICTS)
    tmp = os.path.join(tempfile.mkdtemp(prefix='admin_ward_'), 'wards.geojson')
    subprocess.run([
        'ogr2ogr', '-f', 'GeoJSON', tmp, SHP,
        '-t_srs', 'EPSG:4326',
        '-simplify', str(SIMPLIFY),
        '-where', where,
        '-lco', 'COORDINATE_PRECISION=%d' % PRECISION,
    ], check=True)
    with open(tmp) as fh:
        g = json.load(fh)
    shutil.rmtree(os.path.dirname(tmp), ignore_errors=True)
    return g


def load_geoms(path, keep=None):
    """Read a GeoJSON file into a list of (ogr.Geometry, properties).

    The DataSource is kept alive in the returned tuple: OGR geometries borrow
    from it, and dropping it mid-read segfaults.
    """
    ds = ogr.Open(path)
    if ds is None:
        sys.exit('cannot open %s' % path)
    layer = ds.GetLayer(0)
    out = []
    for feat in layer:
        geom = feat.GetGeometryRef()
        if geom is None:
            continue
        props = feat.items()
        if keep and not keep(props):
            continue
        out.append((geom.Clone(), props))
    return out, ds


def tally(wards, items, bucket):
    """Add each item to every ward it touches. `bucket(props)` names the counter."""
    for geom, props in items:
        key = bucket(props)
        if key is None:
            continue
        env = geom.GetEnvelope()   # minx, maxx, miny, maxy
        for ward in wards:
            w = ward['env']
            if env[0] > w[1] or env[1] < w[0] or env[2] > w[3] or env[3] < w[2]:
                continue
            if ward['geom'].Intersects(geom):
                ward['counts'][key] = ward['counts'].get(key, 0) + 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true',
                    help='report the counts, do not write the GeoJSON')
    args = ap.parse_args()

    fetch_source()
    raw = extract_wards()

    wards = []
    for feat in raw['features']:
        p = feat['properties']
        geom = ogr.CreateGeometryFromJson(json.dumps(feat['geometry']))
        if not geom.IsValid():
            geom = geom.Buffer(0)
        wards.append({
            'geometry': feat['geometry'],
            'geom': geom,
            'env': geom.GetEnvelope(),
            'counts': {},
            'props': {
                'DISTRICT': p['DISTRICT'],
                'GaPa_NaPa': p['GaPa_NaPa'],
                'Type_GN': p['Type_GN'],
                'NEW_WARD_N': p['NEW_WARD_N'],
                'WardCode': '%s%s%s' % (p['DAN'], p['GaPa_NaPa'], p['NEW_WARD_N']),
            },
        })

    flood, flood_ds = load_geoms(FLOOD)
    tally(wards, flood, lambda p: 'flood')
    del flood, flood_ds

    damage, dmg_ds = load_geoms(DAMAGE)
    tally(wards, damage, lambda p: {'Destroyed': 'destroyed',
                                    'Damaged': 'damaged'}.get(p.get('status')))
    del damage, dmg_ds

    if os.path.exists(FAIR):
        fair, fair_ds = load_geoms(
            FAIR, keep=lambda p: p.get('damage') in FAIR_DMG)
        tally(wards, fair, lambda p: 'fair')
        del fair, fair_ds

    feats = []
    for w in wards:
        c = w['counts']
        d, dm = c.get('destroyed', 0), c.get('damaged', 0)
        w['props'].update({
            'flood_affected': 1 if c.get('flood') else 0,
            'dmg_destroyed': d,
            'dmg_damaged': dm,
            'dmg_total': d + dm,
            'dmg_fair': c.get('fair', 0),
        })
        feats.append({'type': 'Feature', 'properties': w['props'],
                      'geometry': w['geometry']})

    feats.sort(key=lambda f: (f['properties']['DISTRICT'],
                              f['properties']['GaPa_NaPa'],
                              f['properties']['NEW_WARD_N']))

    by_district = {}
    for f in feats:
        p = f['properties']
        b = by_district.setdefault(p['DISTRICT'], [0, 0, 0])
        b[0] += 1
        b[1] += p['flood_affected']
        b[2] += p['dmg_total']
    print('wards: %d' % len(feats))
    for d in DISTRICTS:
        n, aff, dmg = by_district.get(d, [0, 0, 0])
        print('  %-8s %3d wards, %2d flood-affected, %5d damaged features'
              % (d, n, aff, dmg))
    totals = sorted(f['properties']['dmg_total'] for f in feats
                    if f['properties']['dmg_total'] > 0)
    if totals:
        def q(x):
            return totals[min(len(totals) - 1, int(round(x * (len(totals) - 1))))]
        print('dmg_total over the %d wards with any damage: min %d, p50 %d, '
              'p85 %d, max %d' % (len(totals), totals[0], q(.5), q(.85), totals[-1]))

    if args.dry_run:
        return

    out = {'type': 'FeatureCollection', 'name': 'admin_ward',
           'crs': {'type': 'name',
                   'properties': {'name': 'urn:ogc:def:crs:OGC:1.3:CRS84'}},
           'features': feats}
    with open(OUT, 'w') as fh:
        json.dump(out, fh, separators=(',', ':'))
        fh.write('\n')
    print('wrote %s (%.1f MB)' % (OUT, os.path.getsize(OUT) / 1e6))


if __name__ == '__main__':
    main()
