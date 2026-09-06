#!/usr/bin/env python3
"""Imagery watch: scan the open catalogues for new satellite scenes over the
Bhote Koshi / Trishuli corridor, notify, and build + commit + push the ones
that pass the quality gates.

Runs every 6 h from launchd (see docs/ARCHITECTURE.md, "Imagery watch"), or by
hand:

    python3 tools/imagery_watch.py --dry-run     scan and notify, change nothing
    python3 tools/imagery_watch.py               scan, build, commit, push
    python3 tools/imagery_watch.py --init        mark everything currently listed as seen

Sources scanned
  Vantor open data   events/Nepal-Flooding-Aug-2026 STAC collection (CC-BY-NC 4.0)
  Sentinel-2 L2A     Earth Search STAC (AWS open data, 10 m)
  Sentinel-1 RTC     Planetary Computer STAC (notify only)
  OpenAerialMap      any upload over the corridor (notify only)

Auto-build gates (everything else is notify-only and logged)
  Sentinel-2   at least one tile over the corridor with cloud <= S2_MAX_CLOUD
  Vantor       cloud <= VANTOR_MAX_CLOUD and off-nadir <= VANTOR_MAX_OFF_NADIR;
               tiled z10-17 (the map is locked at z17.5) over the scene x corridor window
The first run only records what already exists; nothing is built.

State and logs live in work/imagery_watch/ (gitignored).  Commits touch only
the new tiles/<layer>/ directory and data/imagery.json, and the push is skipped
(with a notification) if local main is not a fast-forward of origin/main.
"""
import argparse
import datetime as dt
import fcntl
import json
import os
import re
import subprocess
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, 'work', 'imagery_watch')
STATE = os.path.join(WORK, 'state.json')
LOG = os.path.join(WORK, 'watch.log')
CATALOG = os.path.join(ROOT, 'data', 'imagery.json')

CORRIDOR = (84.375, 27.683528, 85.78125, 28.613459)       # the Sentinel-2 layer window
FOCUS = {'trisuli_bazar': (85.13, 27.90, 85.18, 27.95), 'betrawati': (85.135, 27.93, 85.235, 28.02),
         'upper_valley': (85.29, 28.11, 85.44, 28.37), 'mailung_gorge': (85.17, 28.01, 85.31, 28.12)}
EVENT_DATE = '2026-08-26'
S2_MAX_CLOUD = 40
VANTOR_MAX_CLOUD = 50
VANTOR_MAX_OFF_NADIR = 35
VANTOR_ZMAX = 17
VANTOR = 'https://vantor-opendata.s3.amazonaws.com/events/Nepal-Flooding-Aug-2026/'
EARTH_SEARCH = 'https://earth-search.aws.element84.com/v1/search'
PLANETARY = 'https://planetarycomputer.microsoft.com/api/stac/v1/search'
OAM = 'https://api.openaerialmap.org/meta'
SENSOR = {'B03': ('WorldView-2', 0.5), 'B04': ('WorldView-3', 0.3), 'B05': ('GeoEye-1', 0.4),
          '1030': ('WorldView-2', 0.5), '1040': ('WorldView-3', 0.3), '1050': ('GeoEye-1', 0.4)}


# ------------------------------------------------------------------ helpers
def log(msg):
    os.makedirs(WORK, exist_ok=True)
    line = f'{dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ")} {msg}'
    print(line)
    with open(LOG, 'a') as fh:
        fh.write(line + '\n')


def notify(title, body):
    """macOS toast; harmless elsewhere."""
    log(f'NOTIFY {title}: {body}')
    if sys.platform == 'darwin':
        safe = lambda s: s.replace('\\', '\\\\').replace('"', '\\"')
        subprocess.run(['osascript', '-e', f'display notification "{safe(body[:230])}" with title "{safe(title)}" sound name "Glass"'],
                       check=False, capture_output=True)


def fetch(url, data=None):
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None,
                                 headers={'Content-Type': 'application/json', 'User-Agent': 'nepal-flood-map imagery watch'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def overlaps(b, c):
    return not (b[2] < c[0] or b[0] > c[2] or b[3] < c[1] or b[1] > c[3])


def clip(b, c):
    return (max(b[0], c[0]), max(b[1], c[1]), min(b[2], c[2]), min(b[3], c[3]))


def focus_hits(b):
    return [k for k, c in FOCUS.items() if overlaps(b, c)]


def run(cmd, **kw):
    log('$ ' + ' '.join(cmd))
    return subprocess.run(cmd, cwd=ROOT, check=True, text=True, capture_output=True, **kw)


def load_state():
    if os.path.exists(STATE):
        return json.load(open(STATE))
    return {'seen': {'vantor': [], 's2': [], 's1': [], 'oam': []}, 'runs': 0}


def save_state(st):
    os.makedirs(WORK, exist_ok=True)
    json.dump(st, open(STATE, 'w'), indent=1)


# ------------------------------------------------------------------ scanners
def scan_vantor():
    col = fetch(VANTOR + 'collection.json')
    out = []
    for l in col['links']:
        if l['rel'] != 'item':
            continue
        iid = l['href'].rsplit('/', 1)[-1][:-5]
        it = fetch(VANTOR + iid + '.json')
        p = it['properties']
        out.append({'id': iid, 'datetime': p.get('datetime', ''), 'cloud': p.get('eo:cloud_cover'),
                    'off_nadir': p.get('view:off_nadir'), 'bbox': it['bbox'],
                    'visual': (it.get('assets', {}).get('visual') or {}).get('href')})
    return out


def scan_s2(since):
    d = fetch(EARTH_SEARCH, {'collections': ['sentinel-2-l2a'], 'bbox': list(CORRIDOR),
                             'datetime': f'{since}T00:00:00Z/..', 'limit': 100})
    return [{'id': f['id'], 'datetime': f['properties']['datetime'], 'cloud': f['properties'].get('eo:cloud_cover'),
             'bbox': f['bbox'], 'tile': f['properties'].get('grid:code', '')} for f in d.get('features', [])]


def scan_s1(since):
    d = fetch(PLANETARY, {'collections': ['sentinel-1-rtc'], 'bbox': list(CORRIDOR),
                          'datetime': f'{since}T00:00:00Z/..', 'limit': 100})
    return [{'id': f['id'], 'datetime': f['properties']['datetime'], 'orbit': f['properties'].get('sat:orbit_state'),
             'rel_orbit': f['properties'].get('sat:relative_orbit'), 'bbox': f['bbox']} for f in d.get('features', [])]


def scan_oam(since):
    d = fetch(f'{OAM}?bbox={CORRIDOR[0]},{CORRIDOR[1]},{CORRIDOR[2]},{CORRIDOR[3]}&acquisition_from={since}&limit=100')
    return [{'id': r['_id'], 'datetime': r.get('acquisition_start', ''), 'provider': r.get('provider'),
             'title': r.get('title'), 'gsd': r.get('gsd'), 'bbox': r.get('bbox')} for r in d.get('results', [])]


# ------------------------------------------------------------------ building
def catalog_add(layer):
    cat = json.load(open(CATALOG))
    if any(l['id'] == layer['id'] for l in cat['layers']):
        return False
    cat['layers'].append(layer)
    cat['generated'] = dt.date.today().isoformat()
    with open(CATALOG, 'w') as fh:
        json.dump(cat, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    json.load(open(CATALOG))        # must still parse
    return True


def dir_size_mb(path):
    return round(sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(path) for f in fs) / 1e6, 1)


def nice_date(iso):
    d = dt.date.fromisoformat(iso[:10])
    return f'{d.day} {d.strftime("%b %Y")}'


def build_s2(date, ids):
    layer_id = f'post_s2_{date.replace("-", "")}'
    if os.path.isdir(os.path.join(ROOT, 'tiles', layer_id)):
        log(f'skip {layer_id}: tiles already exist'); return None
    run(['bash', os.path.join(ROOT, 'tools', 'build_s2_tiles.sh'), layer_id, date, *ids])
    layer = {'id': layer_id, 'label': f'{nice_date(date)} · Sentinel-2 10 m', 'side': 'post', 'date': date,
             'sensor': 'Sentinel-2', 'provider': 'ESA Copernicus / AWS open data', 'gsd_m': 10,
             'bounds': list(CORRIDOR), 'minzoom': 8, 'maxzoom': 14, 'tiles': f'tiles/{layer_id}/{{z}}/{{x}}/{{y}}.webp',
             'attribution': '© ESA Copernicus Sentinel data 2026', 'coverage': 'corridor',
             'size_mb': dir_size_mb(os.path.join(ROOT, 'tiles', layer_id)),
             'added_by': 'imagery_watch', 'source_ids': ids}
    return layer


def build_vantor(item):
    sensor, gsd = next((v for k, v in SENSOR.items() if item['id'].startswith(k)), ('Vantor', 0.5))
    if item['id'].startswith('B1'):
        sensor, gsd = 'Legion', 0.4
    date = item['datetime'][:10]
    code = re.sub(r'[^a-z0-9]', '', sensor.lower().replace('worldview-', 'wv0').replace('geoeye-', 'ge0'))
    layer_id = f'{"post" if date >= EVENT_DATE else "pre"}_{code}_{date.replace("-", "")}_{item["id"][-6:].lower()}'
    if os.path.isdir(os.path.join(ROOT, 'tiles', layer_id)):
        log(f'skip {layer_id}: tiles already exist'); return None
    w, s, e, n = clip(item['bbox'], CORRIDOR)
    hits = focus_hits((w, s, e, n))
    coverage = 'upper_valley' if 'upper_valley' in hits else 'trisuli_bazar' if hits and hits[0] in ('trisuli_bazar', 'betrawati') else 'corridor'
    run(['bash', os.path.join(ROOT, 'tools', 'build_cog_tiles.sh'), layer_id, '10', str(VANTOR_ZMAX),
         str(w), str(s), str(e), str(n), item['visual']])
    layer = {'id': layer_id, 'label': f'{nice_date(date)} · Vantor {sensor} {gsd} m', 'side': 'post' if date >= EVENT_DATE else 'pre',
             'date': date, 'sensor': sensor, 'provider': 'Vantor', 'gsd_m': gsd,
             'bounds': [round(w, 5), round(s, 5), round(e, 5), round(n, 5)], 'minzoom': 10, 'maxzoom': VANTOR_ZMAX,
             'tiles': f'tiles/{layer_id}/{{z}}/{{x}}/{{y}}.webp', 'attribution': '© 2026 Vantor, CC-BY-NC 4.0',
             'coverage': coverage, 'size_mb': dir_size_mb(os.path.join(ROOT, 'tiles', layer_id)),
             'cloud_pct': item['cloud'], 'added_by': 'imagery_watch', 'source_ids': [item['id']]}
    return layer


def commit_and_push(layers):
    paths = ["data/imagery.json"] + [f"tiles/{l['id']}" for l in layers]
    run(['git', 'add', '--', *paths])
    msg = 'imagery watch: add ' + ', '.join(l['label'] for l in layers)
    run(['git', 'commit', '-q', '-m', msg, '-m', 'Added automatically by tools/imagery_watch.py.', '--', *paths])
    run(['git', 'fetch', '-q', 'origin', 'main'])
    ff = subprocess.run(['git', 'merge-base', '--is-ancestor', 'origin/main', 'HEAD'], cwd=ROOT).returncode == 0
    if not ff:
        notify('Nepal flood map: not pushed', 'New imagery committed locally, but main has diverged from origin. Pull and push by hand.')
        return False
    run(['git', 'push', '-q', 'origin', 'HEAD:main'])
    return True


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true', help='scan and notify only')
    ap.add_argument('--init', action='store_true', help='record everything currently listed as seen, build nothing')
    args = ap.parse_args()

    os.makedirs(WORK, exist_ok=True)
    lock = open(os.path.join(WORK, 'lock'), 'w')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        log('another run is still going; exiting'); return

    st = load_state()
    first = st['runs'] == 0 or args.init
    since = (dt.date.today() - dt.timedelta(days=3)).isoformat()
    new = {'vantor': [], 's2': [], 's1': [], 'oam': []}
    try:
        for key, fn in (('vantor', scan_vantor), ('s2', lambda: scan_s2(since)), ('s1', lambda: scan_s1(since)), ('oam', lambda: scan_oam(since))):
            try:
                items = fn()
            except Exception as e:                       # one catalogue down must not stop the others
                log(f'{key}: scan failed: {e}'); continue
            seen = set(st['seen'].get(key, []))
            fresh = [i for i in items if i['id'] not in seen]
            new[key] = fresh
            st['seen'][key] = sorted(seen | {i['id'] for i in items})[-2000:]
        st['runs'] += 1
        st['last_run'] = dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
        save_state(st)

        total = sum(len(v) for v in new.values())
        if first:
            notify('Nepal flood map: imagery watch armed', f'Recorded {sum(len(st["seen"][k]) for k in st["seen"])} known scenes. Checking every 6 h.')
            log('initialised; nothing built on the first run'); return
        if not total:
            log('no new scenes'); return

        # ---- notify everything new
        lines = []
        for i in new['vantor']:
            lines.append(f'Vantor {i["id"]} {i["datetime"][:10]} cloud {i["cloud"]}% {",".join(focus_hits(i["bbox"])) or "corridor edge"}')
        for i in new['s2']:
            lines.append(f'Sentinel-2 {i["tile"] or i["id"]} {i["datetime"][:10]} cloud {round(i["cloud"] or 0)}%')
        for i in new['s1']:
            lines.append(f'Sentinel-1 {i["datetime"][:10]} {i["orbit"]} orbit {i["rel_orbit"]}')
        for i in new['oam']:
            lines.append(f'OpenAerialMap {i["provider"]} {i["datetime"][:10]} {i["title"]}')
        for l in lines:
            log('new: ' + l)
        notify(f'Nepal flood map: {total} new scene{"s" if total != 1 else ""}', ' · '.join(lines)[:230])
        if args.dry_run:
            log('dry run; not building'); return

        # ---- build what passes the gates
        built = []
        good_s2 = {}
        for i in new['s2']:
            if (i['cloud'] or 100) <= S2_MAX_CLOUD:
                good_s2.setdefault(i['datetime'][:10], []).append(i)
        for date, tiles in good_s2.items():
            # build every tile of that date over the corridor, not only the clear one, so the mosaic is complete
            ids = sorted({i['id'] for i in new['s2'] if i['datetime'][:10] == date})
            try:
                layer = build_s2(date, ids)
                if layer and catalog_add(layer): built.append(layer)
            except subprocess.CalledProcessError as e:
                log(f'S2 build failed for {date}: {e.stderr[-400:] if e.stderr else e}')
        for i in new['vantor']:
            ok = (i['cloud'] is not None and i['cloud'] <= VANTOR_MAX_CLOUD and (i['off_nadir'] or 0) <= VANTOR_MAX_OFF_NADIR
                  and i['visual'] and overlaps(i['bbox'], CORRIDOR) and focus_hits(i['bbox']))
            if not ok:
                log(f'Vantor {i["id"]}: notify only (cloud {i["cloud"]}, off-nadir {i["off_nadir"]}, focus {focus_hits(i["bbox"])})'); continue
            try:
                layer = build_vantor(i)
                if layer and catalog_add(layer): built.append(layer)
            except subprocess.CalledProcessError as e:
                log(f'Vantor build failed for {i["id"]}: {e.stderr[-400:] if e.stderr else e}')

        if not built:
            log('nothing passed the build gates'); return
        pushed = commit_and_push(built)
        notify('Nepal flood map: imagery ' + ('pushed' if pushed else 'committed'),
               ' · '.join(f'{l["label"]} ({l["size_mb"]} MB)' for l in built)[:230])
    except Exception as e:
        log(f'ERROR {type(e).__name__}: {e}')
        notify('Nepal flood map: imagery watch error', str(e)[:200])
        raise


if __name__ == '__main__':
    main()
