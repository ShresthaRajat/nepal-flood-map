#!/usr/bin/env python3
"""Merge Nepal BIPAD portal per-municipality incident sums into data/reports.json.

BIPAD (bipadportal.gov.np) is NDRRMA's official incident register.  A separate
extraction step turns its incident records into a per-municipality summary file;
this script joins that summary onto the `municipalities` array of
data/reports.json, matching on municipality name plus district through the alias
table below (the ward layer, the COD-AB layer and BIPAD each spell several of
these differently -- see data/admin/README.md).

The input file is OPTIONAL.  If it is absent the script says so and exits 0
without touching reports.json, so it is safe to wire into a refresh pipeline
before the extraction exists.

Input shape (tolerant -- either a bare list, or an object with a
`municipalities` / `results` key holding one):

    [ { "name": "Bidur", "district": "Nuwakot",
        "as_of": "2026-09-09",
        "deaths": 12, "missing": 40, "injured": 3,
        "families_affected": 210, "houses_destroyed": 88,
        "infrastructure_destroyed": 6,
        "incidents": [ {"id": 94189, "title": "...", "incident_on": "2026-09-09",
                        "url": "https://bipadportal.gov.np/incidents/94189"} ],
        "url": "https://bipadportal.gov.np/..." } ]

Metric key spellings are normalised, so `peopleDeathCount`, `people_death_count`
and `deaths` all land on the same field.

Usage
    python3 tools/merge_bipad_reports.py --bipad /path/to/bipad_municipality.json
    python3 tools/merge_bipad_reports.py --bipad ... --dry-run
    python3 tools/merge_bipad_reports.py --bipad ... --incidents-only
    python3 tools/merge_bipad_reports.py --bipad ... --overwrite

By default a BIPAD value is written only where reports.json has no value for
that metric, so a figure taken from a named situation report is never silently
replaced.  --overwrite reverses that.  --incidents-only attaches the incident
lists and writes no figures at all.

WHY NOTHING FROM BIPAD SHIPPED (9 Sep 2026)
-------------------------------------------
The extraction run of 9 September 2026 found that BIPAD's incident register does
not contain the Bhote Koshi / Trishuli event.  Across the eight corridor
districts for 26 Aug - 9 Sep 2026 it holds 45 incidents summing to 2 deaths and
15 injuries; a national unfiltered scan of the same window returns 557
incidents.  Rasuwa, the epicentre, has two unrelated "High Altitude" reports and
nothing about the flood.  NDRRMA tracked this disaster through its situation
reports and rescue lists instead of the BIPAD incident form.

Merging those totals would print "1 death, 1 injured, 2 families affected"
against Gosaikunda, a municipality where NDRRMA reports 3,702 households
isolated -- a real BIPAD number, but about a different hazard, attributed to
this flood.  So data/reports.json ships with no BIPAD figures.  The script stays
because BIPAD is the right source once NDRRMA backfills the register: point it
at a fresh extraction and re-run.
"""

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REPORTS = os.path.join(ROOT, 'data', 'reports.json')

# BIPAD source entry added to reports.json `sources` when a merge happens.
BIPAD_SOURCE_ID = 'bipad'
BIPAD_SOURCE = {
    'label': 'BIPAD portal - NDRRMA incident register',
    'url': 'https://bipadportal.gov.np/',
    'official': True,
}

# Name drift across the three spellings in play: the 2018 HRRP ward file, the
# 2024 OCHA COD-AB municipality layer, and BIPAD's own municipality titles.
# Keys are lowercased; values are the COD-AB `adm3_name`, which is what
# reports.json and the map layer join on.
ALIASES = {
    'parbati kunda': 'Aamachhodingmo',
    'parbatikunda': 'Aamachhodingmo',
    'amachhodingmo': 'Aamachhodingmo',
    'aamachhodingmo': 'Aamachhodingmo',
    'dupcheshwar': 'Dupcheshwor',
    'dupcheshwor': 'Dupcheshwor',
    'meghang': 'Myagang',
    'myagang': 'Myagang',
    'tarkeshwar': 'Tarakeshwor',
    'tarakeshwar': 'Tarakeshwor',
    'tarakeshwor': 'Tarakeshwor',
    'gosainkunda': 'Gosaikunda',
    'gosaikunda': 'Gosaikunda',
    'nilkantha': 'Nilkhantha',
    'nilkhantha': 'Nilkhantha',
    'dhunibesi': 'Dhunibenshi',
    'dhunibenshi': 'Dhunibenshi',
    'ichchhakamana': 'Ichchha Kamana',
    'ichchha kamana': 'Ichchha Kamana',
}

# District spelling drift (COD-AB says Chitawan, most reporting says Chitwan).
DISTRICT_ALIASES = {
    'chitwan': 'Chitawan',
    'chitawan': 'Chitawan',
    'nawalparasi east': 'Nawalparasi East',
    'nawalparasi west': 'Nawalparasi West',
    'tanahun': 'Tanahu',
    'tanahu': 'Tanahu',
}

# Suffixes BIPAD and the ward file append to a local-level name.
SUFFIXES = (' rural municipality', ' municipality', ' metropolitan city',
            ' sub-metropolitan city', ' gaunpalika', ' nagarpalika',
            ' rm', ' mun', ' np', ' gp')

# BIPAD metric -> reports.json figure key.  Several spellings per metric because
# the extraction may pass the portal's camelCase names straight through.
METRICS = {
    'deaths_bodies': ('deaths', 'death', 'deathcount', 'peopledeathcount',
                      'people_death_count', 'deaths_bodies'),
    'missing': ('missing', 'missingcount', 'peoplemissingcount',
                'people_missing_count'),
    'injured': ('injured', 'injuredcount', 'peopleinjuredcount',
                'people_injured_count'),
    'people_affected': ('people_affected', 'peopleaffectedcount',
                        'people_affected_count', 'affected'),
    'families_affected': ('families_affected', 'familyaffectedcount',
                          'family_affected_count', 'families', 'households_affected'),
    'houses_destroyed': ('houses_destroyed', 'infrastructuredestroyedhousecount',
                         'infrastructure_destroyed_house_count', 'houses'),
    'houses_affected': ('houses_affected', 'infrastructureaffectedhousecount',
                        'infrastructure_affected_house_count'),
    'infrastructure_destroyed': ('infrastructure_destroyed',
                                 'infrastructuredestroyedcount',
                                 'infrastructure_destroyed_count'),
}


def canon(name):
    """Lowercase, strip local-level suffixes, resolve through the alias table."""
    s = str(name or '').strip().lower()
    s = s.replace('–', '-').replace('_', ' ')
    while True:
        for suf in SUFFIXES:
            if s.endswith(suf):
                s = s[:-len(suf)].strip()
                break
        else:
            break
    s = ' '.join(s.split())
    return ALIASES.get(s, s)


def canon_district(name):
    s = ' '.join(str(name or '').strip().lower().split())
    return DISTRICT_ALIASES.get(s, s)


def key_of(name, district):
    return (canon(name).lower(), canon_district(district))


def norm_keys(rec):
    """A lookup of the record's keys, lowercased and stripped of separators.

    BIPAD nests the counts under `totals` (the per-municipality summary) or
    `loss` (a raw incident record), so those are flattened in alongside the
    top-level keys.  Top-level wins on a collision.
    """
    flat = {}
    for sub in ('totals', 'loss', 'sums'):
        v = rec.get(sub)
        if isinstance(v, dict):
            for k, x in v.items():
                flat[str(k).lower().replace('_', '').replace('-', '')] = x
    for k, v in rec.items():
        if k in ('totals', 'loss', 'sums'):
            continue
        flat[str(k).lower().replace('_', '').replace('-', '')] = v
    return flat


def pick(rec, spellings):
    flat = norm_keys(rec)
    for s in spellings:
        k = s.lower().replace('_', '').replace('-', '')
        if k in flat and flat[k] is not None:
            return flat[k]
    return None


def load_bipad(path):
    with open(path, encoding='utf-8') as fh:
        j = json.load(fh)
    if isinstance(j, dict):
        for k in ('municipalities', 'results', 'rows', 'data'):
            if isinstance(j.get(k), list):
                return j[k], j.get('as_of')
        # a bare {key: record} mapping
        if all(isinstance(v, dict) for v in j.values()):
            return list(j.values()), j.get('as_of')
        raise SystemExit('bipad file: no municipality list found')
    if isinstance(j, list):
        return j, None
    raise SystemExit('bipad file: unexpected top-level type')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bipad', default=os.environ.get('BIPAD_MUNICIPALITY_JSON', ''),
                    help='path to bipad_municipality.json (optional; env BIPAD_MUNICIPALITY_JSON)')
    ap.add_argument('--reports', default=REPORTS)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--overwrite', action='store_true',
                    help='let BIPAD replace figures that already carry a value')
    ap.add_argument('--incidents-only', action='store_true',
                    help='attach incident lists but write no figures (see the module docstring)')
    args = ap.parse_args()

    if not args.bipad:
        print('merge_bipad_reports: no --bipad path given, nothing to merge.')
        return 0
    if not os.path.exists(args.bipad):
        print('merge_bipad_reports: %s not found, nothing to merge.' % args.bipad)
        return 0

    rows, file_as_of = load_bipad(args.bipad)
    with open(args.reports, encoding='utf-8') as fh:
        reports = json.load(fh)

    munis = reports.get('municipalities') or []
    index = {}
    for m in munis:
        index[key_of(m.get('name'), m.get('district'))] = m
        for a in (m.get('aliases') or []):
            index.setdefault(key_of(a, m.get('district')), m)

    written, skipped, unmatched, added, attached = 0, 0, [], 0, 0
    for rec in rows:
        name = pick(rec, ('name', 'municipality', 'title', 'adm3_name', 'gapa_napa'))
        district = pick(rec, ('district', 'adm2_name'))
        if not name:
            continue
        m = index.get(key_of(name, district))
        if m is None:
            unmatched.append('%s / %s' % (name, district))
            continue
        incidents = pick(rec, ('incidents', 'incident_list')) or []
        dates = [str(pick(i, ('date', 'incident_on', 'incidenton', 'as_of')) or '')[:10]
                 for i in incidents if isinstance(i, dict)]
        dates = [d for d in dates if len(d) == 10]
        as_of = pick(rec, ('as_of', 'asof', 'modified_on')) or (max(dates) if dates else None) \
            or file_as_of or reports.get('as_of')
        figures = m.setdefault('figures', {})
        for fkey, spellings in ({} if args.incidents_only else METRICS).items():
            v = pick(rec, spellings)
            if v is None:
                continue
            try:
                v = int(v)
            except (TypeError, ValueError):
                continue
            cur = figures.get(fkey)
            has = isinstance(cur, dict) and cur.get('value') is not None
            if has and not args.overwrite and cur.get('src') != BIPAD_SOURCE_ID:
                skipped += 1
                continue
            if fkey not in figures:
                added += 1
            figures[fkey] = {'value': v, 'as_of': as_of, 'src': BIPAD_SOURCE_ID}
            written += 1
        if incidents:
            attached += 1
            m['bipad'] = {
                'as_of': as_of,
                'url': pick(rec, ('url', 'source_url', 'portal_url')) or BIPAD_SOURCE['url'],
                'incidents': [{
                    'id': pick(i, ('id', 'incident_id')),
                    'title': pick(i, ('title', 'name')),
                    'title_ne': pick(i, ('title_ne', 'titlene')),
                    'as_of': pick(i, ('incident_on', 'incidenton', 'date', 'as_of')),
                    'url': pick(i, ('url', 'link')),
                } for i in incidents if isinstance(i, dict)],
            }

    if written:
        src = reports.setdefault('sources', {})
        entry = dict(BIPAD_SOURCE)
        entry['date'] = file_as_of or reports.get('as_of')
        src[BIPAD_SOURCE_ID] = entry

    print('merge_bipad_reports: %d rows read, %d figures written, %d new metric keys, '
          '%d kept from named reports, %d incident lists, %d unmatched'
          % (len(rows), written, added, skipped, attached, len(unmatched)))
    for u in unmatched[:20]:
        print('  unmatched: %s' % u)
    if len(unmatched) > 20:
        print('  ... and %d more' % (len(unmatched) - 20))

    if args.incidents_only and attached and not args.dry_run:
        with open(args.reports, 'w', encoding='utf-8') as fh:
            json.dump(reports, fh, ensure_ascii=False, indent=2)
            fh.write('\n')
        print('merge_bipad_reports: wrote %d incident lists to %s' % (attached, args.reports))
        return 0
    if args.dry_run:
        print('merge_bipad_reports: --dry-run, reports.json untouched.')
        return 0
    if not written:
        print('merge_bipad_reports: nothing to write.')
        return 0
    with open(args.reports, 'w', encoding='utf-8') as fh:
        json.dump(reports, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    print('merge_bipad_reports: wrote %s' % args.reports)
    return 0


if __name__ == '__main__':
    sys.exit(main())
