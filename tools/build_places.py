#!/usr/bin/env python3
"""Place-name labels for the basemap: cities, towns, villages and hamlets from
OpenStreetMap (Overpass API) across the map window, plus a featured list that
guarantees the settlements that matter for this flood are present, correctly
spelt and ranked, whatever OSM's place= tag says (Dhunche is tagged suburb,
Betrawati and Mugling hamlet, Rasuwagadhi hamlet, and so on).

Output: data/hdx/derived/places.geojson (tracked), fields
  name       English label (name:en, else the featured spelling, else name)
  name_ne    Nepali name where OSM has one
  tier       hq | city | town | village | hamlet   (hq = district headquarters)
  rank       0 hq/city, 1 town or featured, 2 village, 3 hamlet/suburb (label priority)
  featured   true for the curated list below
  source     osm | fallback (coordinates typed in from Nominatim when OSM has no place node)

Source data © OpenStreetMap contributors, ODbL.  Cached in work/places/.
"""
import json
import os
import re
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, 'work', 'places'); os.makedirs(WORK, exist_ok=True)
OUT = os.path.join(ROOT, 'data', 'hdx', 'derived', 'places.geojson')
BBOX = (27.60, 84.30, 28.55, 85.75)           # S, W, N, E (Overpass order): Mugling to Kathmandu, Galchhi to Kyirong
CACHE = os.path.join(WORK, 'overpass_places.json')

# name -> (tier, aliases regex matched against any name* tag, fallback (lon, lat) or None)
FEATURED = {
    # district headquarters
    'Kathmandu':    ('hq', r'^Kathmandu$|^काठमाडौँ$', None),
    'Dhunche':      ('hq', r'Dhunche|Dunche|धुन्चे', None),
    'Bidur':        ('hq', r'^Bidur$|^बिदुर$', None),
    'Dhading Besi': ('hq', r'Dhading ?Besi|धादिंग बेंसी|^Nilakantha$|^नीलकण्ठ$', (84.8931, 27.9116)),   # anchored: "Nilakantha" also matches Budhanilkantha in Kathmandu
    'Gorkha':       ('hq', r'^Gorkha$|^गोरखा$', None),
    # the Trishuli / Bhote Koshi corridor, north to south
    'Rasuwagadhi':  ('town', r'Rasuwa ?Ga(dh|d)i|रसुवागढी', (85.3778, 28.2778)),
    'Timure':       ('town', r'^Timure$|टिमुरे', None),
    'Syabrubesi':   ('town', r'Shyaphru Bensi|Syabru ?Besi|Syaphru ?Besi|स्याफ्रु बेसी|स्याप्रु बेसी', (85.3427, 28.1646)),
    'Thulo Bharkhu':('village', r'Thulo Bharkhu|ठुलो भार्खु', None),
    'Kalikasthan':  ('town', r'Kalikasthan|कालिकास्थान', (85.2134, 28.0059)),
    'Ramche':       ('village', r'^Ramche$|^राम्चे$', (85.2192, 28.0326)),
    'Mailung':      ('village', r'^Mailung$|मैलुङ', None),
    'Dhaibung':     ('village', r'Dhaibung|धइबुङ', None),
    'Betrawati':    ('town', r'Betrawati|बेत्रावती', None),
    'Trisuli Bazar':('town', r'^Trishuli$|^Trisuli$|Trisuli Bazar|त्रिशुली बजार', (85.1480, 27.9232)),
    'Battar':       ('town', r'^Battar$|बटार', (85.1463, 27.8983)),
    'Devighat':     ('village', r'Devighat|देवीघाट', None),
    'Galchhi':      ('town', r'^Galchhi$|गल्छी', None),
    'Salyantar':    ('town', r'^Salyantar$|सल्यानटार', (84.8179, 28.0222)),
    'Khanikhola':   ('village', r'^Khanikhola$|खानीखोला', (85.1625, 27.7178)),
    'Gajuri':       ('village', r'^Gajuri$|गजुरी', None),
    'Malekhu':      ('town', r'^Malekhu$|^मलेखु$', None),
    'Benighat':     ('town', r'^Benighat$|^बेनीघाट$', None),
    'Manakamana':   ('village', r'^Manakamana$', (84.5689, 27.9087)),
    'Mugling':      ('town', r'^Mugling$|मुग्लिङ', None),
}
TIER_RANK = {'hq': 0, 'city': 0, 'town': 1, 'village': 2, 'hamlet': 3, 'suburb': 3}


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

features = [{'type': f['type'], 'geometry': f['geometry'], 'properties': {k: v for k, v in f['properties'].items() if v is not None}} for f in features]
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump({'type': 'FeatureCollection', 'name': 'places',
           'description': 'Settlement labels from OpenStreetMap (Overpass) with a featured list for the flood corridor. © OpenStreetMap contributors, ODbL.',
           'features': features}, open(OUT, 'w'), separators=(',', ':'), ensure_ascii=False)
from collections import Counter
print(f'{len(features)} places:', dict(Counter(f["properties"]["tier"] for f in features)),
      f'| featured {sum(f["properties"]["featured"] for f in features)} ({sum(f["properties"]["source"] == "fallback" for f in features)} from fallback coordinates)')
print('wrote', OUT, f'{os.path.getsize(OUT)/1e3:.0f} KB')
