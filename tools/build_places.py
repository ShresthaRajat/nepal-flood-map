#!/usr/bin/env python3
"""Place-name labels for the basemap: cities, towns, villages and hamlets from
OpenStreetMap (Overpass API) across the map window, plus a featured list that
guarantees the settlements that matter for this flood are present, correctly
spelt and ranked, whatever OSM's place= tag says (Dhunche is tagged suburb,
Betrawati and Mugling hamlet, Rasuwagadhi hamlet, and so on); plus two
supplementary tiers of minor river-corridor settlements that have no OSM
place node at all: named HDX residential-area polygons, and a GeoNames
gazetteer pass restricted to the flood-affected reach.

Output: data/hdx/derived/places.geojson (tracked), fields
  name         English label (name:en, else the featured spelling, else name,
               else the GeoNames asciiname)
  name_ne      Nepali name where OSM has one
  tier         hq | city | town | village | hamlet | locality
  rank         0 hq/city, 1 town or featured, 2 village, 3 hamlet/suburb,
               4 locality (label priority, also the draw order)
  featured     true for the curated FEATURED list below
  source       osm | fallback (typed in from Nominatim when OSM has no place
               node) | geonames (GeoNames gazetteer, no OSM node)
  osm_id       OSM node id, where source is osm
  geonames_id  GeoNames geonameid, where source is geonames

The 'locality' tier (rank 4, source geonames) is a supplementary pass over
the GeoNames Nepal gazetteer (CC BY 4.0, https://www.geonames.org/),
restricted to points inside the fine flood AOI and either within 60 m height
above the local river surface or within 300 m of the mapped flood extent —
i.e. minor settlements along the river corridor that never got an OSM place
node. GeoNames' Nepal coordinates are gazetteer-grade: typically accurate to
within a few hundred metres, occasionally as much as ~1 km, so this tier is
drawn fainter and at a higher zoom than the OSM-sourced tiers above it.

Source data © OpenStreetMap contributors, ODbL. GeoNames, CC BY 4.0. Cached
in work/places/.
"""
import json
import math
import os
import re
import unicodedata
import urllib.parse
import urllib.request
import zipfile

from osgeo import gdal, ogr

gdal.UseExceptions()

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, 'work', 'places'); os.makedirs(WORK, exist_ok=True)
OUT = os.path.join(ROOT, 'data', 'hdx', 'derived', 'places.geojson')
BBOX = (27.60, 84.30, 28.55, 85.75)           # S, W, N, E (Overpass order): Mugling to Kathmandu, Galchhi to Kyirong
CACHE = os.path.join(WORK, 'overpass_places.json')

GEONAMES_TXT = os.path.join(WORK, 'NP.txt')
GEONAMES_ZIP_URL = 'https://download.geonames.org/export/dump/NP.zip'
RESIDENTIAL_PATH = os.path.join(ROOT, 'data', 'hdx', 'hot_flood_npl', 'residential_areas_osm.geojson')
AOI_PATH = os.path.join(ROOT, 'data', 'hdx', 'hot_flood_npl', 'hot_flood_npl_aoi.geojson')
FLOOD_EXTENT_PATH = os.path.join(ROOT, 'data', 'hdx', 'hot_flood_npl', 'hot_flood_npl_flood_extent.geojson')
HAB_TIF = os.path.join(ROOT, 'work', 'hab.tif')

# name -> (tier, aliases regex matched against any name* tag, fallback (lon, lat) or None)
FEATURED = {
    # district headquarters
    'Kathmandu':      ('hq', r'^Kathmandu$|^काठमाडौँ$', None),
    'Dhunche':        ('hq', r'Dhunche|Dunche|धुन्चे', None),
    'Bidur (Battar)': ('hq', r'^Bidur$|^बिदुर$|^Battar$|बटार', (85.1464, 27.8975)),
    'Dhading Besi':   ('hq', r'Dhading ?Besi|धादिंग बेंसी|^Nilakantha$|^नीलकण्ठ$', (84.8931, 27.9116)),   # anchored: "Nilakantha" also matches Budhanilkantha in Kathmandu
    'Gorkha':         ('hq', r'^Gorkha$|^गोरखा$', None),
    # the Trishuli / Bhote Koshi corridor, north to south
    'Rasuwagadhi':    ('town', r'Rasuwa ?Ga(dh|d)i|रसुवागढी', (85.3778, 28.2778)),
    'Timure':         ('town', r'^Timure$|टिमुरे', None),
    'Syabrubesi':     ('town', r'Shyaphru Bensi|Syabru ?Besi|Syaphru ?Besi|स्याफ्रु बेसी|स्याप्रु बेसी', (85.3427, 28.1646)),
    'Thulo Bharkhu':  ('village', r'Thulo Bharkhu|ठुलो भार्खु', None),
    'Kalikasthan':    ('town', r'Kalikasthan|कालिकास्थान', (85.2134, 28.0059)),
    'Ramche':         ('village', r'^Ramche$|^राम्चे$', (85.2192, 28.0326)),
    'Mailung':        ('village', r'^Mailung$|मैलुङ', None),
    'Dhaibung':       ('village', r'Dhaibung|धइबुङ', None),
    'Betrawati':      ('town', r'Betrawati|बेत्रावती', None),
    'Sole Bazar':     ('village', r'^Sole( Baza+r)?$|सोले( बजार)?', (85.18109, 27.98232)),
    'Trishuli Bazar': ('town', r'^Trishuli$|^Trisuli$|Trishuli Bazar|Trisuli Bazar|त्रिशुली बजार', (85.1480, 27.9232)),
    'Devighat':       ('village', r'Devighat|देवीघाट', None),
    'Kimtang':        ('village', r'^Kimtang|^Kintang$|किम्ताङ|किन्ताङ', (85.0340, 28.0180)),   # west-Nuwakot hill village, ~14 km from the river; included at the owner's request, not because it is riverside
    'Galchhi':        ('town', r'^Galchhi$|गल्छी', None),
    'Salyantar':      ('town', r'^Salyantar$|सल्यानटार', (84.8179, 28.0222)),
    'Khanikhola':     ('village', r'^Khanikhola$|खानीखोला', (85.1625, 27.7178)),
    'Gajuri':         ('village', r'^Gajuri$|गजुरी', None),
    'Malekhu':        ('town', r'^Malekhu$|^मलेखु$', None),
    'Benighat':       ('town', r'^Benighat$|^बेनीघाट$', None),
    'Manakamana':     ('village', r'^Manakamana$', (84.5689, 27.9087)),
    'Mugling':        ('town', r'^Mugling$|मुग्लिङ', None),
}
TIER_RANK = {'hq': 0, 'city': 0, 'town': 1, 'village': 2, 'hamlet': 3, 'suburb': 3, 'locality': 4}


def overpass():
    if os.path.exists(CACHE):
        return json.load(open(CACHE))
    q = ('[out:json][timeout:120];node["place"~"^(city|town|village|hamlet|suburb)$"]'
         f'({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});out body;')
    req = urllib.request.Request('https://overpass-api.de/api/interpreter', data=('data=' + urllib.parse.quote(q)).encode(),
                                 headers={'User-Agent': 'nepal-flood-map build_places.py'})
    with urllib.request.urlopen(req, timeout=180) as r:
        d = json.load(r)
    json.dump(d, open(CACHE, 'w'))
    return d


def ensure_geonames():
    if os.path.exists(GEONAMES_TXT):
        return
    zpath = os.path.join(WORK, 'NP.zip')
    if not os.path.exists(zpath):
        req = urllib.request.Request(GEONAMES_ZIP_URL, headers={'User-Agent': 'nepal-flood-map build_places.py'})
        with urllib.request.urlopen(req, timeout=180) as r, open(zpath, 'wb') as f:
            f.write(r.read())
    with zipfile.ZipFile(zpath) as z:
        z.extract('NP.txt', WORK)


def norm_name(s):
    s = unicodedata.normalize('NFKD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'\s+', ' ', s).strip().lower()


def distance_m(a, b):
    """Flat-earth approximation good to a few metres at this scale and latitude."""
    dx = (a[0] - b[0]) * 98000.0
    dy = (a[1] - b[1]) * 111000.0
    return math.hypot(dx, dy)


nodes = [e for e in overpass()['elements'] if e['type'] == 'node' and e.get('tags', {}).get('name')]
features, used = [], set()

# featured first, so they win the dedupe
for canon, (tier, alias, fallback) in FEATURED.items():
    rx = re.compile(alias, re.I)
    hits = [n for n in nodes if any(rx.search(v) for k, v in n['tags'].items() if k.startswith('name'))]
    if fallback:   # prefer the node closest to the known position
        hits.sort(key=lambda n: (n['lon'] - fallback[0]) ** 2 + (n['lat'] - fallback[1]) ** 2)
    if hits:
        n = hits[0]; used.add(n['id'])
        features.append({'type': 'Feature', 'properties': {'name': canon, 'name_ne': n['tags'].get('name:ne') or (n['tags'].get('name') if re.search(r'[ऀ-ॿ]', n['tags'].get('name', '')) else None),
                          'tier': tier, 'rank': TIER_RANK[tier], 'featured': True, 'source': 'osm', 'osm_id': n['id']},
                         'geometry': {'type': 'Point', 'coordinates': [round(n['lon'], 5), round(n['lat'], 5)]}})
    elif fallback:
        features.append({'type': 'Feature', 'properties': {'name': canon, 'name_ne': None, 'tier': tier, 'rank': TIER_RANK[tier],
                          'featured': True, 'source': 'fallback'}, 'geometry': {'type': 'Point', 'coordinates': list(fallback)}})
    else:
        print(f'   featured place not found and no fallback: {canon}')

def close(a, b, km=1.5):
    return abs(a[0] - b[0]) * 98 < km and abs(a[1] - b[1]) * 111 < km

taken = [f['geometry']['coordinates'] for f in features]
for n in nodes:
    if n['id'] in used:
        continue
    t = n['tags']; place = t['place']
    name = t.get('name:en') or t['name']
    if not re.search(r'[A-Za-z]', name):
        continue                                          # no Latin-script name to show
    if any(close([n['lon'], n['lat']], c) for c in taken) and place in ('hamlet', 'suburb'):
        continue                                          # a featured place already labels this spot
    tier = 'hamlet' if place == 'suburb' else place
    features.append({'type': 'Feature', 'properties': {'name': name, 'name_ne': t.get('name:ne') or (t['name'] if re.search(r'[ऀ-ॿ]', t['name']) else None),
                      'tier': tier, 'rank': TIER_RANK[tier], 'featured': False, 'source': 'osm', 'osm_id': n['id'],
                      'population': int(t['population']) if str(t.get('population', '')).isdigit() else None},
                     'geometry': {'type': 'Point', 'coordinates': [round(n['lon'], 5), round(n['lat'], 5)]}})

# --- minor settlements along the river, part 1: named HDX residential-area polygons ---
# (centroid of each named landuse=residential polygon that has no OSM place node of its own)
CORRIDOR_RENAME = {
    'Keurintar Village Area': 'Keurintar',
    'Majuwa village': 'Majuwa',
    'Bairani Bazzar': 'Bairani Bazar',
    'ChiuriBhanjyang': 'Chiuri Bhanjyang',
}
res = json.load(open(RESIDENTIAL_PATH))
seen_corridor = set()
for f in res['features']:
    p = f['properties']
    name = p.get('name')
    if not name:
        continue
    if p.get('name_en') == 'Mastar Land Pooling Area':
        continue                                          # land-pooling scheme, not a settlement
    label = CORRIDOR_RENAME.get(name, name)
    if label in seen_corridor:
        continue                                          # dedupe the two ChiuriBhanjyang polygons
    geom = ogr.CreateGeometryFromJson(json.dumps(f['geometry']))
    c = geom.Centroid()
    pt = (round(c.GetX(), 5), round(c.GetY(), 5))
    nname = norm_name(label)
    if any(norm_name(g['properties']['name']) == nname and distance_m(pt, g['geometry']['coordinates']) < 700 for g in features):
        continue                                          # same place already labelled (e.g. by OSM)
    if any(distance_m(pt, g['geometry']['coordinates']) < 300 for g in features):
        continue                                          # too close to an existing label of any name
    seen_corridor.add(label)
    features.append({'type': 'Feature', 'properties': {'name': label, 'tier': 'hamlet', 'rank': TIER_RANK['hamlet'],
                      'featured': False, 'source': 'osm'}, 'geometry': {'type': 'Point', 'coordinates': list(pt)}})

# --- minor settlements along the river, part 2: GeoNames gazetteer localities ---
ensure_geonames()
aoi = json.load(open(AOI_PATH))
aoi_buffered = ogr.CreateGeometryFromJson(json.dumps(aoi['features'][0]['geometry'])).Buffer(0.005)
flood = json.load(open(FLOOD_EXTENT_PATH))
flood_buffered = ogr.CreateGeometryFromJson(json.dumps(flood['features'][0]['geometry'])).Buffer(300.0 / 111000.0)

hab_ds = gdal.Open(HAB_TIF)
hab_band = hab_ds.GetRasterBand(1)
hab_nodata = hab_band.GetNoDataValue()
hab_inv = gdal.InvGeoTransform(hab_ds.GetGeoTransform())
hab_xsize, hab_ysize = hab_ds.RasterXSize, hab_ds.RasterYSize

def height_above_river(lon, lat):
    px, py = gdal.ApplyGeoTransform(hab_inv, lon, lat)
    px, py = int(px), int(py)
    if px < 0 or py < 0 or px >= hab_xsize or py >= hab_ysize:
        return None
    v = float(hab_band.ReadAsArray(px, py, 1, 1)[0][0])
    return None if (hab_nodata is not None and v == hab_nodata) else v

DROP_GEONAMES = {'Distiltyank Bajar'}                      # garbled gazetteer entry
# any word of a featured label, normalised: a gazetteer point that repeats a featured name is never added as a locality
FEATURED_WORDS = {norm_name(w) for canon in FEATURED for w in re.split(r'[\s()/]+', canon) if w}
candidates = []
with open(GEONAMES_TXT, encoding='utf-8') as fh:
    for line in fh:
        cols = line.rstrip('\n').split('\t')
        if len(cols) < 8 or cols[6] != 'P':
            continue
        try:
            lat, lon = float(cols[4]), float(cols[5])
        except ValueError:
            continue
        if not (BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]):
            continue                                       # cheap bbox pre-filter before the polygon/raster checks
        asciiname = cols[2].strip()
        if not asciiname or asciiname in DROP_GEONAMES:
            continue
        pt = ogr.Geometry(ogr.wkbPoint); pt.AddPoint(lon, lat)
        if not aoi_buffered.Contains(pt):
            continue
        hab = height_above_river(lon, lat)
        if not ((hab is not None and hab <= 60) or flood_buffered.Contains(pt)):
            continue
        if any(distance_m((lon, lat), g['geometry']['coordinates']) < 500 for g in features):
            continue                                       # already labelled (featured, OSM or corridor supplement)
        label = asciiname if asciiname != asciiname.lower() else asciiname.title()
        if norm_name(label) in FEATURED_WORDS:
            continue                                       # e.g. a gazetteer 'Bidur' 4 km from the HQ label would re-create the Bidur/Battar confusion
        candidates.append({'id': cols[0], 'label': label, 'name_norm': norm_name(label), 'lon': lon, 'lat': lat, 'fcode': cols[7]})

# self-dedupe: same normalised name within 500 m -> keep the PPL (populated place) over PPLL (populated locality), else the first
kept = []
for cand in candidates:
    dup = next((k for k in kept if k['name_norm'] == cand['name_norm'] and distance_m((cand['lon'], cand['lat']), (k['lon'], k['lat'])) < 500), None)
    if dup is None:
        kept.append(cand)
    elif cand['fcode'] == 'PPL' and dup['fcode'] != 'PPL':
        kept[kept.index(dup)] = cand

for cand in kept:
    features.append({'type': 'Feature', 'properties': {'name': cand['label'], 'tier': 'locality', 'rank': TIER_RANK['locality'],
                      'featured': False, 'source': 'geonames', 'geonames_id': cand['id']},
                     'geometry': {'type': 'Point', 'coordinates': [round(cand['lon'], 5), round(cand['lat'], 5)]}})

features = [{'type': f['type'], 'geometry': f['geometry'], 'properties': {k: v for k, v in f['properties'].items() if v is not None}} for f in features]
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump({'type': 'FeatureCollection', 'name': 'places',
           'description': 'Settlement labels from OpenStreetMap (Overpass) with a featured list for the flood corridor, plus GeoNames gazetteer localities along the river with no OSM place node. © OpenStreetMap contributors, ODbL; © GeoNames contributors, CC BY 4.0.',
           'features': features}, open(OUT, 'w'), separators=(',', ':'), ensure_ascii=False)
from collections import Counter
print(f'{len(features)} places:', dict(Counter(f["properties"]["tier"] for f in features)),
      f'| featured {sum(f["properties"]["featured"] for f in features)} ({sum(f["properties"]["source"] == "fallback" for f in features)} from fallback coordinates)',
      f'| source', dict(Counter(f["properties"]["source"] for f in features)))
print('wrote', OUT, f'{os.path.getsize(OUT)/1e3:.0f} KB')
