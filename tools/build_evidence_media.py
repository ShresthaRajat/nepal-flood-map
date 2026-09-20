#!/usr/bin/env python3
"""Snapshot the Rasuwa Flood Evidence Map archive as a point layer.

archive.rasuwaflood.org is a VIVA-D instance: a public, crowd-sourced archive of
geotagged photographs and videos of the 26 August 2026 Bhote Koshi / Trishuli
flood.  Its one open endpoint returns every item at once:

    GET https://archive.rasuwaflood.org/api/items?all=1  ->  {"items": [...]}

The map reads that endpoint live in the browser, but the archive sends no
`Access-Control-Allow-Origin` header, so a cross-origin fetch from the GitHub
Pages origin fails today.  This builder is the fallback: an hourly server-side
snapshot (.github/workflows/refresh-evidence.yml) the page loads first and keeps
on screen whenever the live call is blocked.

Output: `data/hdx/derived/evidence_media.geojson`, one Point per published item,
sorted by item id, with top-level `generated` and `source` members.

Properties on every feature:

    id              the archive's item id, as an integer
    name            the item title, or "Photo/Video/Document #<id>" when untitled
    media_type      photo | video | document
    status          archive status; always "published" (nothing else is kept)
    description     the contributor's free-text account of what the media shows
    location_name   the archive's place string (usually a reverse-geocode)
    captured_at     capture date normalised to YYYY-MM-DD where parseable
    captured_at_raw the capture string exactly as the contributor typed it
    submitted_at    ISO timestamp the item was uploaded to the archive
    taken_by        photographer/videographer as credited
    owner           rights holder, where it differs from the photographer
    location_source Photo GPS | User-set | Approximate | Community update | ""
    precision       exact when location_source is "Photo GPS", else approximate
    source_url      the original Facebook/X post, for items imported from social
    source_platform facebook | x | "" for direct uploads
    media_url       the archived original in Google Cloud Storage
    thumb_url       absolute URL of the archive's thumbnail endpoint
    item_url        the archive itself (it has no per-item deep link, see below)
    community_notes moderator/community annotation, where one exists
    mime_type       the archived file's media type
    adm3_name       municipality resolved from the coordinate against COD-AB
    district        district resolved from the same polygon
    source          always "viva-d"
    source_ref      the endpoint this row came from

`precision` drives the map styling: a coordinate read out of the photograph's
own EXIF draws solid, a pin the uploader dropped by hand draws translucent, so a
roughly-placed item never looks as certain as a GPS-stamped one.  `media_type`
picks the icon.

The archive's `contact` field holds a personal email address for many items.  It
is never read into the output, and nothing downstream should reintroduce it.

The archive's front end has no URL routing at all -- no `?item=`, no `#item`, no
`/item/<id>` -- so `item_url` is the archive home page for every feature.  The
per-item record is reachable only as JSON at `/api/items/<id>`, which is not
something to send a popup reader to.

Items with a 0,0 placeholder coordinate are dropped, as are anything whose
status is not `published` (the archive keeps `failed` and `pending` rows in the
same feed).

Municipality and district are always resolved from the coordinate against
`data/admin/admin_municipality.geojson`, the same way
tools/build_hydropower_points.py does it; the archive carries no admin fields.

Output is deterministic apart from the `generated` timestamp, so the refresh
workflow can tell a real change from a no-op.

    python3 tools/build_evidence_media.py
    python3 tools/build_evidence_media.py --from evidence_raw.json   # offline
    python3 tools/build_evidence_media.py --check                    # report only
"""

import argparse
import datetime
import json
import os
import re
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MUNI = os.path.join(ROOT, 'data', 'admin', 'admin_municipality.geojson')
OUT = os.path.join(ROOT, 'data', 'hdx', 'derived', 'evidence_media.geojson')

API = 'https://archive.rasuwaflood.org/api/items?all=1'
ORIGIN = 'https://archive.rasuwaflood.org'
# Cloudflare sits in front of the archive and refuses a bare urllib User-Agent.
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')
TIMEOUT = 30

MEDIA_LABEL = {'photo': 'Photo', 'video': 'Video', 'document': 'Document'}

MONTHS = {m: i + 1 for i, m in enumerate(
    ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'])}


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


def norm_date(raw):
    """YYYY-MM-DD from the capture strings contributors actually type.

    The archive's capture field is free text, so the feed carries "2026-08-30",
    "Aug 28, 2026, 2:10 pm", "Sep19 ,2026" and "sep 19,2026" side by side.  Only
    the date is kept; a string that parses to nothing is left to the caller to
    fall back on the raw value.
    """
    s = (raw or '').strip()
    if not s:
        return None
    m = re.match(r'^(\d{4})-(\d{1,2})-(\d{1,2})', s)
    if m:
        y, mo, d = (int(x) for x in m.groups())
    else:
        m = re.match(r'^\s*([A-Za-z]{3,9})\s*(\d{1,2})\s*,?\s*(\d{4})', s)
        if not m:
            return None
        mo = MONTHS.get(m.group(1)[:3].lower())
        if not mo:
            return None
        d, y = int(m.group(2)), int(m.group(3))
    try:
        return datetime.date(y, mo, d).isoformat()
    except ValueError:
        return None


def clean(v):
    """Empty strings out of the archive become nulls, so the popup can skip them."""
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def abs_url(v):
    """The archive returns `thumbnailUrl` relative to its own origin."""
    s = clean(v)
    if not s:
        return None
    return s if s.startswith('http') else ORIGIN + s


def item_to_feature(it, muni):
    """One archive item -> one GeoJSON Point, or None if it must be dropped.

    Kept in step with evidenceItemToFeature() in app/app.js, which does the same
    mapping in the browser when the live fetch succeeds.
    """
    if (it.get('status') or '') != 'published':
        return None
    try:
        lat, lng = float(it.get('lat')), float(it.get('lng'))
    except (TypeError, ValueError):
        return None
    if lat == 0 and lng == 0:
        return None

    iid = int(it.get('id'))
    title = clean(it.get('title'))
    kind = clean(it.get('media_type')) or 'photo'
    raw_date = clean(it.get('captured_at'))
    loc_src = (it.get('location_source') or '').strip()
    adm3, adm2 = locate((lng, lat), muni)

    props = {
        'id': iid,
        'name': title or '%s #%d' % (MEDIA_LABEL.get(kind, 'Item'), iid),
        'media_type': kind,
        'status': 'published',
        'description': clean(it.get('description')),
        'location_name': clean(it.get('location_name')),
        'captured_at': norm_date(raw_date) or raw_date,
        'captured_at_raw': raw_date,
        'submitted_at': clean(it.get('submitted_at')),
        'taken_by': clean(it.get('taken_by')),
        'owner': clean(it.get('owner')),
        'location_source': loc_src or None,
        'precision': 'exact' if loc_src == 'Photo GPS' else 'approximate',
        'source_url': clean(it.get('source_url')),
        'source_platform': clean(it.get('source_platform')),
        'media_url': clean(it.get('drive_url')) or clean(it.get('previewUrl')),
        'thumb_url': abs_url(it.get('thumbnailUrl')),
        'item_url': ORIGIN + '/',
        'community_notes': clean(it.get('community_notes')),
        'mime_type': clean(it.get('mime_type')),
        'adm3_name': adm3,
        'district': adm2,
        'source': 'viva-d',
        'source_ref': API,
    }
    return {'type': 'Feature', 'id': iid, 'properties': props,
            'geometry': {'type': 'Point', 'coordinates': [round(lng, 6), round(lat, 6)]}}


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read().decode('utf-8'))


def load(path):
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--from', dest='src', metavar='FILE',
                    help='read a saved copy of the endpoint instead of fetching')
    ap.add_argument('--check', action='store_true', help='report and write nothing')
    args = ap.parse_args()

    raw = load(args.src) if args.src else fetch(API)
    items = raw.get('items') if isinstance(raw, dict) else raw
    items = items or []
    muni = load(MUNI)

    published = [it for it in items if (it.get('status') or '') == 'published']
    out = [f for f in (item_to_feature(it, muni) for it in items) if f]
    out.sort(key=lambda f: f['id'])
    dropped_zero = len(published) - len(out)

    from collections import Counter
    kinds = Counter(f['properties']['media_type'] for f in out)
    locsrc = Counter(f['properties']['location_source'] or '(blank)' for f in out)
    dists = Counter(f['properties']['district'] or '(outside COD-AB)' for f in out)
    dates = sorted(d for d in (f['properties']['captured_at'] for f in out)
                   if d and re.match(r'^\d{4}-\d{2}-\d{2}$', d))
    unparsed = sum(1 for f in out if not (f['properties']['captured_at'] or '').startswith('20')
                   or len(f['properties']['captured_at'] or '') != 10)

    print('build_evidence_media: %d features (%d items in feed, %d published, %d at 0,0 dropped)'
          % (len(out), len(items), len(published), dropped_zero))
    print('   media_type      %s' % dict(kinds))
    print('   location_source %s' % dict(locsrc))
    print('   district        %s' % dict(dists))
    print('   captured_at     %s .. %s (%d parsed, %d unparsed or blank)'
          % (dates[0] if dates else '-', dates[-1] if dates else '-', len(dates), unparsed))

    fc = {'type': 'FeatureCollection',
          'name': 'evidence_media',
          'generated': datetime.datetime.now(datetime.timezone.utc)
                               .replace(microsecond=0).isoformat().replace('+00:00', 'Z'),
          'source': API,
          'note': ('Published items from the Rasuwa Flood Evidence Map (VIVA-D); see '
                   'tools/build_evidence_media.py. Crowd-sourced: `precision` says whether the '
                   'coordinate is the photograph\'s own GPS or a pin the uploader dropped. '
                   'Rights stay with the photographers; contact details are not carried here.'),
          'features': out}

    if args.check:
        print('build_evidence_media: --check, nothing written.')
        return 0
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(fc, fh, ensure_ascii=False, indent=1)
        fh.write('\n')
    print('build_evidence_media: wrote %s' % os.path.relpath(OUT, ROOT))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
