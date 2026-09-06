#!/usr/bin/env python3
"""Recompute the HOT category counts and snapshot dates after an HDX refresh.

  --snapshot FILE   write the counts currently in app/config.js (CFG.COUNTS) to FILE
  --apply           count features in data/hdx/gpkg/<dataset>/<layer>/*.gpkg, rewrite
                    the COUNTS block in app/config.js, and update the snapshot date
                    strings in app/config.js, README.md and docs/LICENSING.md from
                    the new data/hdx/*/README.txt; with --before FILE, print a diff table

Counts are `<category>|<source>` -> feature count, per dataset (flood, corridor),
matching what the app reads.  Categories with no GeoPackage (HOT ships some only in
the PMTiles archive) keep their previous count.
"""
import argparse
import glob
import json
import os
import re

from osgeo import ogr

ogr.UseExceptions()
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, 'app', 'config.js')
DS = {'flood': 'hot_flood_npl', 'corridor': 'hot_flood_npl_corridor'}


def current_counts():
    s = open(CONFIG).read()
    block = s[s.index('const COUNTS = {'):]
    block = block[:block.index('\n};') + 3]
    out = {}
    for ds in DS:
        m = re.search(ds + r":\s*\{(.*?)\}", block, re.S)
        out[ds] = {k: int(v) for k, v in re.findall(r"'([a-z_]+\|[a-z]+)':\s*(\d+)", m.group(1))} if m else {}
    return out, block


def gpkg_counts():
    out = {}
    for ds, folder in DS.items():
        out[ds] = {}
        for d in sorted(glob.glob(os.path.join(ROOT, 'data', 'hdx', 'gpkg', folder, '*'))):
            layer = os.path.basename(d)                       # e.g. bridges_osm, buildings_overture
            files = glob.glob(os.path.join(d, '*.gpkg'))
            if not files or '_' not in layer:
                continue
            cat, src = layer.rsplit('_', 1)
            lyr_ds = ogr.Open(files[0])
            out[ds][f'{cat}|{src}'] = sum(lyr_ds.GetLayer(i).GetFeatureCount() for i in range(lyr_ds.GetLayerCount()))
    return out


def fmt_block(counts):
    def one(ds):
        items = [f"'{k}':{v}" for k, v in sorted(counts[ds].items())]
        lines, cur = [], ''
        for it in items:
            if len(cur) + len(it) > 118:
                lines.append(cur.rstrip(',')); cur = ''
            cur += it + ','
        lines.append(cur.rstrip(','))
        return f"  {ds}: {{ " + ",\n    ".join(lines) + " },"
    return "const COUNTS = {\n" + one('flood') + "\n" + one('corridor') + "\n};"


def snapshot_dates():
    """(long date, short date, per-dataset 'YYYY-MM-DD HH:MM') from the refreshed README.txt files."""
    gen = {}
    for ds, folder in DS.items():
        p = os.path.join(ROOT, 'data', 'hdx', folder, 'README.txt')
        m = re.search(r'^Generated:\s+(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})', open(p).read(), re.M) if os.path.exists(p) else None
        if m:
            gen[ds] = (m.group(1), m.group(2))
    newest = max(gen.values())[0] if gen else None
    if not newest:
        return None
    y, mo, d = newest.split('-')
    import calendar
    return {'long': f'{int(d)} {calendar.month_name[int(mo)]} {y}', 'short': f'{int(d)} {calendar.month_abbr[int(mo)]} {y}',
            'iso': newest, 'per_ds': gen}


def apply_dates(dates):
    if not dates:
        return
    subs = [
        (CONFIG, r'// overview page \(\d+ \w+ \d{4}\)\.', f'// overview page ({dates["short"]}).'),
        (CONFIG, r'dataset on HDX, snapshot of \d+ \w+ \d{4}\.', f'dataset on HDX, snapshot of {dates["long"]}.'),
        (os.path.join(ROOT, 'README.md'), r'HDX downloads \(GeoJSON \+ PMTiles\), \d+ \w+ \d{4} snapshot', f'HDX downloads (GeoJSON + PMTiles), {dates["short"]} snapshot'),
        (os.path.join(ROOT, 'README.md'), r'as of the \d+ \w+ \d{4} HDX snapshot', f'as of the {dates["long"]} HDX snapshot'),
        (os.path.join(ROOT, 'docs', 'LICENSING.md'), r'\*\*\d+ \w+ \d{4}\*\*\. Underlying feature source', f'**{dates["long"]}**. Underlying feature source'),
    ]
    if 'flood' in dates['per_ds']:
        subs.append((os.path.join(ROOT, 'docs', 'LICENSING.md'), r'generated \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\n', f'generated {dates["per_ds"]["flood"][0]} {dates["per_ds"]["flood"][1]} UTC\n'))
    if 'corridor' in dates['per_ds']:
        subs.append((os.path.join(ROOT, 'docs', 'LICENSING.md'), r'river-corridor buffer, snapshot generated \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC', f'river-corridor buffer, snapshot generated {dates["per_ds"]["corridor"][0]} {dates["per_ds"]["corridor"][1]} UTC'))
    for path, pat, rep in subs:
        s = open(path).read()
        if not re.search(pat, s):
            print(f'   (no match for date pattern in {os.path.relpath(path, ROOT)}: {pat[:40]})'); continue
        s2 = re.sub(pat, rep, s, count=1)
        if s2 != s:
            open(path, 'w').write(s2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--snapshot'); ap.add_argument('--apply', action='store_true'); ap.add_argument('--before')
    a = ap.parse_args()
    if a.snapshot:
        cur, _ = current_counts()
        json.dump(cur, open(a.snapshot, 'w'), indent=1); print(f'   saved current counts ({sum(len(v) for v in cur.values())} keys)')
    if a.apply:
        new = gpkg_counts()
        cur, block = current_counts()
        before = json.load(open(a.before)) if a.before and os.path.exists(a.before) else cur
        # HOT ships some categories only inside the PMTiles archive (e.g. corridor Overture roads,
        # police stations, settlement names): no GeoPackage, so keep the previous count for those.
        for ds in new:
            for k, v in {**cur[ds], **before[ds]}.items():
                new[ds].setdefault(k, v)
        s = open(CONFIG).read()
        s = s.replace(block, fmt_block(new)); open(CONFIG, 'w').write(s)
        dates = snapshot_dates(); apply_dates(dates)
        print(f'   snapshot now {dates["iso"] if dates else "unknown"}')
        print(f'   {"category|source":34s} {"flood before":>12s} {"after":>7s} {"corridor before":>15s} {"after":>7s}')
        keys = sorted(set(before['flood']) | set(new['flood']) | set(before['corridor']) | set(new['corridor']))
        for k in keys:
            fb, fa = before['flood'].get(k), new['flood'].get(k)
            cb, ca = before['corridor'].get(k), new['corridor'].get(k)
            mark = ' *' if (fb != fa or cb != ca) else ''
            print(f'   {k:34s} {str(fb or "-"):>12s} {str(fa or "-"):>7s} {str(cb or "-"):>15s} {str(ca or "-"):>7s}{mark}')


if __name__ == '__main__':
    main()
