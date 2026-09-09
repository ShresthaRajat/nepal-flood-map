#!/usr/bin/env python3
"""Manual override: build specific Vantor Open Data STAC items and add them to
the map catalogue, bypassing tools/imagery_watch.py's auto-build quality gates
(VANTOR_MAX_CLOUD / VANTOR_MAX_OFF_NADIR).

Use this for scenes the watcher deliberately left as notify-only (see
work/imagery_watch/watch.log) that the owner wants on the map anyway as an
explicit override -- e.g. a scene too hazy or too off-nadir for the automatic
gates but still valuable.

Reuses tools/imagery_watch.py's own fetch/build/catalog functions unmodified:
fetches each STAC item the same way scan_vantor() does, then calls
build_vantor(item) and catalog_add(layer) directly, skipping the cloud/
off-nadir/focus check that guards the call in main(). Same CORRIDOR clip and
z10-VANTOR_ZMAX zoom range as the normal pipeline; layer ids come out in the
same naming style. Does not touch default_post, commit, or push -- do that by
hand once you have reviewed the result.

    python3 tools/build_vantor_item.py <ITEM_ID> [<ITEM_ID> ...]

data/imagery.json layers have no free-text notes/description field, and
app/config.js's SCENES prose notes are a separate file, so the cloud cover and
off-nadir angle are appended to the label instead, e.g.:

    8 Sep 2026 · Vantor WorldView-2 0.5 m (cloud 40%, off-nadir 39.7°, owner override)
"""
import subprocess
import sys
import time

import imagery_watch as iw


def fetch_item(iid):
    """Same shape as one entry of imagery_watch.scan_vantor()'s return list."""
    it = iw.fetch(iw.VANTOR + iid + '.json')
    p = it['properties']
    return {'id': iid, 'datetime': p.get('datetime', ''), 'cloud': p.get('eo:cloud_cover'),
            'off_nadir': p.get('view:off_nadir'), 'bbox': it['bbox'],
            'visual': (it.get('assets', {}).get('visual') or {}).get('href')}


def main(argv):
    if not argv:
        print('usage: build_vantor_item.py <ITEM_ID> [<ITEM_ID> ...]', file=sys.stderr)
        return 2

    results = []
    for iid in argv:
        iw.log(f'override: fetching {iid}')
        try:
            item = fetch_item(iid)
        except Exception as e:
            iw.log(f'override: {iid} fetch failed: {e}')
            results.append((iid, None, None, f'fetch failed: {e}'))
            continue
        if not item['visual']:
            iw.log(f'override: {iid} has no visual asset, skipping')
            results.append((iid, None, None, 'no visual asset'))
            continue

        t0 = time.monotonic()
        try:
            layer = iw.build_vantor(item)
        except subprocess.CalledProcessError as e:
            elapsed = time.monotonic() - t0
            err = (e.stderr or str(e))[-600:]
            iw.log(f'override: build failed for {iid} after {elapsed:.1f}s: {err}')
            results.append((iid, None, elapsed, err))
            continue
        elapsed = time.monotonic() - t0

        if not layer:
            iw.log(f'override: {iid} produced no layer (tiles already exist?)')
            results.append((iid, None, elapsed, 'no layer (tiles already exist?)'))
            continue

        cloud, off_nadir = item['cloud'], item['off_nadir']
        if cloud is not None and off_nadir is not None:
            layer['label'] += f' (cloud {cloud:.0f}%, off-nadir {off_nadir:.1f}°, owner override)'
        else:
            layer['label'] += ' (owner override)'

        added = iw.catalog_add(layer)
        iw.log(f'override: build_cog_tiles.sh for {layer["id"]} took {elapsed:.1f}s wall clock')
        if added:
            iw.log(f'override: added {layer["id"]} to data/imagery.json ({layer["size_mb"]} MB)')
            results.append((iid, layer, elapsed, None))
        else:
            iw.log(f'override: {layer["id"]} already present in catalog, not re-added')
            results.append((iid, layer, elapsed, 'already in catalog'))

    print()
    print(f'{"source_id":18} {"layer_id":30} {"size_mb":>8} {"tiling_s":>9}  status / label')
    for iid, layer, elapsed, err in results:
        lid = layer['id'] if layer else '-'
        size = layer['size_mb'] if layer else '-'
        t = f'{elapsed:.1f}' if elapsed is not None else '-'
        tail = err if err else layer['label']
        print(f'{iid:18} {lid:30} {str(size):>8} {t:>9}  {tail}')

    return 0 if all(err in (None, 'already in catalog') for _, _, _, err in results) else 1


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
