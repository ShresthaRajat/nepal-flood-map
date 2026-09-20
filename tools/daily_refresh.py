#!/usr/bin/env python3
"""daily_refresh.py -- one orchestrator that re-runs the data pipeline once a day.

Everything the Nepal flood map draws comes from upstream sources that keep
moving: HOT re-exports the two HDX flood datasets most nights, Copernicus EMS
adds grading products, new satellite scenes land in the open catalogues, and
NDRRMA publishes a new situation report most evenings.  This script runs the
pieces that can be automated, in the only order that is correct, and reports on
the two that cannot (the hand-pasted municipality list and the hand-edited
casualty figures) instead of guessing.

It is stdlib-only and derives the repo root from its own location, so it runs
the same from a laptop, from cron, or from the GitHub Actions workflow in
.github/workflows/daily-refresh.yml.

Steps, in order
---------------
ems          tools/build_ems_roads.py -- Copernicus EMS EMSR927 road/bridge
             damage grading -> data/hdx/derived/ems_road_grading.geojson.  The
             product versions are hardcoded upstream, so this is effectively
             static and cheap; it runs daily only so a new EMS product is
             picked up the day the hardcoded list is edited.
waterways    tools/build_waterways_tiles.sh -- re-fetches the national OSM
             waterways export, re-clips it to the four districts and re-tiles
             it.  This must run BEFORE the HDX refresh because it regenerates
             data/hdx/hotosm_npl_waterways/hotosm_npl_waterways_clip.geojson,
             which is gitignored (so absent in CI) and which
             build_flooded_roads.py -- run from inside refresh_hdx.sh -- reads.
hdx          tools/refresh_hdx.sh -- the expensive one, ~20-30 min.  Downloads
             both HOT datasets, re-tiles them, rebuilds the flooded-roads
             overlay and rewrites the counts and snapshot dates in
             app/config.js, README.md and docs/LICENSING.md.  It rm -rf's
             data/hdx/tiles/<dataset> and writes tens of thousands of .pbf
             files every run, so it is SKIPPED when the upstream CKAN metadata
             is unchanged since the last successful refresh (see --force-hdx).
admin_ward   tools/build_admin_ward.py -- rebuilds data/admin/admin_ward.geojson
             from the HRRP ward shapefile, re-joining flood_affected and the
             damage counts against the freshly downloaded HDX layers.  Needs
             `unar` and downloads a .rar into work/hrrp_wards/.
hydropower   tools/build_hydropower_points.py -- merges the HDX exposed
             hydropowers with the hand-geocoded extras.  Offline and
             deterministic, but it reads an HDX layer, so it follows the refresh.
bridge_status tools/build_bridge_status.py -- joins the HDX bridge ground
             reports, the OSM bridge spans and the hand-maintained repair status
             in data/bridge_status.json -> data/hdx/derived/bridge_status.geojson
             (bridge type per report, repair status where a SitRep or the press
             has said something HDX has not).  Offline and deterministic, and it
             reads two HDX layers, so it follows the refresh.  data/bridge_status.json
             itself is hand-edited and is never written by this script.
road_status  tools/build_road_status.py -- joins the hand-maintained corridor
             segments in data/road_status.json to the flood-extent roads and the
             Copernicus EMS grading -> data/hdx/derived/road_status.geojson, so
             the road overlays can be coloured by whether a vehicle gets through
             today rather than only by how bad the damage was.  Must follow
             `ems` and `hdx`, which write both of its inputs; data/road_status.json
             is hand-edited and is never written by this script.
cutoff       OPT-IN (--with-cutoff).  tools/build_roads_tiles.sh (a 418 MB
             download) followed by tools/build_cutoff_wards.py (a long
             shortest-path analysis).  Off in the daily workflow; run it by
             hand when the road network actually changes.
places       OPT-IN (--with-places).  tools/build_places.py.  Off by default:
             it queries Overpass, which is flaky, and it silently degrades to a
             worse result when the gitignored work/hab.tif is missing.
extent_munis DRIFT CHECK ONLY, never a write.  tools/list_flood_municipalities.py
             prints the local levels intersecting the observed flood extent.
             That list is hand-pasted into app/app.js as EXTENT_MUNIS, because
             the admin GeoJSON is fetched by MapLibre rather than by the app.
             We compare and warn on a difference; we do not edit app.js.
sitrep       PROBE ONLY, never a write.  data/reports.json holds the NDRRMA
             casualty figures and is hand-edited -- no parser exists for the
             PDFs.  We read the highest SitRep numbers already cited in it, then
             HEAD-request the next few numbers across the last week of dates and
             report the newest that exists, plus the age of reports.json.
             NDRRMA sometimes appends a random suffix to a filename, so a
             missing number is not a stopping condition: the whole window is
             scanned.
imagery      OPT-IN (--with-imagery), enabled in the workflow.
             tools/imagery_watch.py scans the open STAC catalogues, builds
             tiles/<layer>/ pyramids for the scenes that pass its quality gates
             and appends to data/imagery.json.  Its state lives in the
             gitignored work/imagery_watch/state.json; when that file is absent
             the watcher arms itself and builds nothing, which is the right
             behaviour for a cold CI cache (the workflow restores the state
             from actions/cache so this only happens once).  Always run with
             --no-push here: this script owns the push.

Never run from here
-------------------
tools/write_catalog.py (would delete the 16 watcher-added layers from
data/imagery.json), run_tiles.sh, retile*.py, fix_box_layers.py,
build_terrain.sh, build_collapse_origin.py, build_vantor_item.py.

Flags
-----
--only a,b        run just these steps (comma-separated names from the list above)
--skip a,b        run everything except these
--with-imagery    include the imagery watcher step
--with-cutoff     include the road-network / cut-off wards step
--with-places     include the Overpass places step
--force-hdx       run refresh_hdx.sh even when upstream looks unchanged
--dry-run         print the plan and do the read-only upstream checks; write nothing
--commit          git add the explicit output pathspecs and commit (default off)
--push            push to origin main; implies --commit

Exit status is non-zero if any step failed, but a failing step never aborts the
rest: every step writes independent tracked files, so whatever succeeded is
still committed.  The one exception is refresh_hdx.sh, which can leave
data/hdx/tiles/<dataset> half-written; if it fails, its tracked outputs are
restored with git checkout before the run continues.

Outputs
-------
work/daily_refresh/<step>.log   per-step combined stdout+stderr (gitignored)
data/refresh_status.json        tracked machine-readable summary of the run
data/hdx/refresh_state.json     tracked HDX fingerprints, drives the skip
$GITHUB_STEP_SUMMARY            the same summary as a markdown table, in CI
"""

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG_DIR = os.path.join(ROOT, 'work', 'daily_refresh')
STATUS = os.path.join(ROOT, 'data', 'refresh_status.json')
HDX_STATE = os.path.join(ROOT, 'data', 'hdx', 'refresh_state.json')
HDX_DATASETS = ('hot_flood_npl', 'hot_flood_npl_corridor')
CKAN = 'https://data.humdata.org/api/3/action/package_show?id='
NDRRMA = 'https://ndrrma.gov.np/mediafiles/publications/'
REPORTS = os.path.join(ROOT, 'data', 'reports.json')
APP_JS = os.path.join(ROOT, 'app', 'app.js')

# Explicit pathspecs.  Never `git add -A`: work/ is gitignored but tools/
# __pycache__ and any local scratch are not, and the repo already carries
# 221k tile files we must not churn by accident.
COMMIT_PATHS = [
    'data/hdx',                      # derived/, both dataset dirs, tiles/, pmtiles/, refresh_state.json
    'data/admin/admin_ward.geojson',
    'data/imagery.json',
    'data/refresh_status.json',
    'app/config.js',
    'README.md',
    'docs/LICENSING.md',
]

DEFAULT_GIT_NAME = 'nepal-flood-bot'
DEFAULT_GIT_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com'
TRAILERS = ('Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>\n'
            'Claude-Session: https://claude.ai/code/session_01P5vs1ydhgPMAckr4LSNuFX')


# --------------------------------------------------------------- plumbing
def log(msg):
    print(msg, flush=True)


def warn(msg):
    """A GitHub Actions annotation that is still readable in a plain terminal."""
    print(f'::warning::{msg}' if os.environ.get('GITHUB_ACTIONS') else f'WARNING: {msg}', flush=True)


def build_env():
    """The child environment: GDAL binaries resolved from PATH, git identity set.

    build_hdx_tiles.sh is the only tool that hardcodes a Homebrew path
    (/opt/homebrew/bin/ogr2ogr), so we always export the resolved binaries.
    imagery_watch.py commits on its own, so the identity has to be in the
    environment rather than on our git command line.
    """
    env = dict(os.environ)
    for var, exe in (('OGR2OGR', 'ogr2ogr'), ('OGRINFO', 'ogrinfo')):
        if not env.get(var):
            found = shutil.which(exe)
            if found:
                env[var] = found
    if not env.get('GDAL_BIN'):
        found = shutil.which('gdalwarp') or shutil.which('ogr2ogr')
        if found:
            env['GDAL_BIN'] = os.path.dirname(found)
    env.setdefault('PYTHONUNBUFFERED', '1')
    for var, default in (('GIT_AUTHOR_NAME', DEFAULT_GIT_NAME), ('GIT_COMMITTER_NAME', DEFAULT_GIT_NAME),
                         ('GIT_AUTHOR_EMAIL', DEFAULT_GIT_EMAIL), ('GIT_COMMITTER_EMAIL', DEFAULT_GIT_EMAIL)):
        env.setdefault(var, default)
    return env


ENV = build_env()


def run_logged(step, cmd, capture_stdout=False):
    """Run cmd from ROOT, tee its combined output to work/daily_refresh/<step>.log.

    Returns (returncode, stdout_text).  stdout_text is only populated when
    capture_stdout is set, for the steps whose stdout we have to parse.
    """
    os.makedirs(LOG_DIR, exist_ok=True)
    path = os.path.join(LOG_DIR, f'{step}.log')
    out_lines = []
    with open(path, 'w') as fh:
        fh.write(f'$ {" ".join(cmd)}\n')
        proc = subprocess.Popen(cmd, cwd=ROOT, env=ENV, text=True, bufsize=1,
                                stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE if capture_stdout else subprocess.STDOUT)
        for line in proc.stdout:
            fh.write(line)
            if capture_stdout:
                out_lines.append(line)
            else:
                print(f'  | {line.rstrip()}', flush=True)
        stderr = proc.stderr.read() if capture_stdout else ''
        if stderr:
            fh.write(stderr)
            for line in stderr.splitlines():
                print(f'  | {line}', flush=True)
        rc = proc.wait()
        fh.write(f'\n[exit {rc}]\n')
    return rc, ''.join(out_lines)


def git(*args, check=True):
    return subprocess.run(['git', *args], cwd=ROOT, env=ENV, text=True,
                          capture_output=True, check=check)


def fetch_json(url, timeout=60):
    req = urllib.request.Request(url, headers={'User-Agent': 'nepal-flood-map daily refresh'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def head_ok(url, timeout=20):
    req = urllib.request.Request(url, method='HEAD',
                                 headers={'User-Agent': 'nepal-flood-map daily refresh'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return 200 <= r.status < 300
    except (urllib.error.HTTPError, urllib.error.URLError, OSError):
        return False


# ------------------------------------------------------- HDX change detection
def hdx_fingerprint(pkg):
    """A stable digest of everything about the package that matters to us.

    CKAN's metadata_modified moves on edits that do not touch the data, and a
    resource can be re-uploaded without the package being touched, so both go
    in.  Resources are keyed by name, not by list position, which HOT reorders.
    """
    resources = sorted((r.get('name') or r.get('url', '').rsplit('/', 1)[-1],
                        r.get('last_modified') or r.get('created') or '')
                       for r in pkg.get('resources', []))
    blob = json.dumps({'metadata_modified': pkg.get('metadata_modified'), 'resources': resources},
                      sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def local_snapshot(ds):
    """The newest generated_utc in the dataset's committed metadata_osm.json.

    Used as the fallback comparison on the very first run, before
    data/hdx/refresh_state.json exists: it tells us how old the data actually
    in the repo is, which is the question the fingerprint answers afterwards.
    """
    path = os.path.join(ROOT, 'data', 'hdx', ds, 'metadata_osm.json')
    try:
        layers = json.load(open(path)).get('layers') or []
        return max((l['generated_utc'] for l in layers if l.get('generated_utc')), default=None)
    except (OSError, ValueError, KeyError):
        return None


def load_hdx_state():
    try:
        return json.load(open(HDX_STATE))
    except (OSError, ValueError):
        return {}


def check_hdx(force=False):
    """Decide whether refresh_hdx.sh has anything to do.  Read-only."""
    state = load_hdx_state()
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
    info, changed = {}, False
    for ds in HDX_DATASETS:
        entry = {'dataset': ds, 'checked_at': now}
        try:
            pkg = fetch_json(CKAN + ds)['result']
        except Exception as e:                       # a CKAN outage must not silently skip a refresh
            entry.update(error=f'{type(e).__name__}: {e}', changed=True)
            info[ds] = entry
            changed = True
            continue
        fp = hdx_fingerprint(pkg)
        prev = (state.get(ds) or {}).get('fingerprint')
        newest = max((r.get('last_modified') or r.get('created') or '') for r in pkg['resources'])
        snap = local_snapshot(ds)
        if prev is None:
            # No fingerprint recorded yet: fall back to the committed snapshot date.
            ds_changed = snap is None or newest > snap
            basis = f'no stored fingerprint; upstream {newest[:10]} vs repo snapshot {(snap or "?")[:10]}'
        else:
            ds_changed = fp != prev
            basis = 'fingerprint ' + ('differs' if ds_changed else 'matches')
        entry.update(fingerprint=fp, previous=prev, metadata_modified=pkg.get('metadata_modified'),
                     newest_resource=newest, repo_snapshot=snap, changed=ds_changed, basis=basis)
        info[ds] = entry
        changed = changed or ds_changed
    return {'datasets': info, 'changed': changed, 'forced': force, 'will_refresh': force or changed}


def save_hdx_state(check):
    state = load_hdx_state()
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
    for ds, entry in check['datasets'].items():
        if not entry.get('fingerprint'):
            continue
        state[ds] = {'fingerprint': entry['fingerprint'], 'checked_at': entry['checked_at'],
                     'refreshed_at': now, 'metadata_modified': entry.get('metadata_modified')}
    os.makedirs(os.path.dirname(HDX_STATE), exist_ok=True)
    with open(HDX_STATE, 'w') as fh:
        json.dump(state, fh, indent=1, sort_keys=True)
        fh.write('\n')


# -------------------------------------------------------------------- steps
def step_ems(ctx):
    rc, _ = run_logged('ems', [sys.executable, 'tools/build_ems_roads.py'])
    return rc, {}


def step_waterways(ctx):
    rc, _ = run_logged('waterways', ['bash', 'tools/build_waterways_tiles.sh'])
    return rc, {}


def step_hdx(ctx):
    check = ctx['hdx_check']
    for ds, e in check['datasets'].items():
        log(f'  {ds}: changed={"YES" if e.get("changed") else "no"} ({e.get("basis") or e.get("error")})')
    if not check['will_refresh']:
        log('  upstream unchanged since the last refresh; skipping refresh_hdx.sh (--force-hdx overrides)')
        return 0, {'refreshed': False, 'reason': 'unchanged'}
    if check['forced'] and not check['changed']:
        log('  --force-hdx: refreshing although upstream looks unchanged')
    rc, _ = run_logged('hdx', ['bash', 'tools/refresh_hdx.sh'])
    if rc != 0:
        # refresh_hdx.sh rm -rf's data/hdx/tiles/<ds> before re-tiling, so a
        # mid-way failure leaves the committed tiles half-deleted.  Put the
        # tracked HDX outputs back exactly as they were before marking failure.
        log('  refresh_hdx.sh failed; restoring the tracked HDX outputs')
        git('checkout', '--', 'data/hdx/tiles', *[f'data/hdx/{d}' for d in HDX_DATASETS], check=False)
        return rc, {'refreshed': False, 'reason': 'failed, tracked outputs restored'}
    save_hdx_state(check)
    return 0, {'refreshed': True, 'reason': 'upstream changed'}


def step_admin_ward(ctx):
    rc, _ = run_logged('admin_ward', [sys.executable, 'tools/build_admin_ward.py'])
    return rc, {}


def step_hydropower(ctx):
    rc, _ = run_logged('hydropower', [sys.executable, 'tools/build_hydropower_points.py'])
    return rc, {}


def step_bridge_status(ctx):
    rc, _ = run_logged('bridge_status', [sys.executable, 'tools/build_bridge_status.py'])
    return rc, {}


def step_road_status(ctx):
    rc, _ = run_logged('road_status', [sys.executable, 'tools/build_road_status.py'])
    return rc, {}


def step_cutoff(ctx):
    rc, _ = run_logged('cutoff_roads', ['bash', 'tools/build_roads_tiles.sh'])
    if rc != 0:
        return rc, {'stage': 'build_roads_tiles.sh'}
    rc, _ = run_logged('cutoff_wards', [sys.executable, 'tools/build_cutoff_wards.py'])
    return rc, {'stage': 'build_cutoff_wards.py' if rc else 'done'}


def step_places(ctx):
    rc, _ = run_logged('places', [sys.executable, 'tools/build_places.py'])
    return rc, {}


def step_extent_munis(ctx):
    """Compare the computed municipality list against EXTENT_MUNIS in app/app.js.

    Warn only.  app.js is hand-maintained prose-and-code; a script that rewrote
    a literal inside it would be a worse bet than a one-line annotation asking
    a human to look.
    """
    rc, out = run_logged('extent_munis', [sys.executable, 'tools/list_flood_municipalities.py'],
                         capture_stdout=True)
    if rc != 0:
        return rc, {'drift': None, 'error': 'list_flood_municipalities.py failed'}
    try:
        computed = json.loads(out.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return 1, {'drift': None, 'error': 'could not parse the municipality list'}
    src = open(APP_JS).read()
    m = re.search(r'const EXTENT_MUNIS\s*=\s*\[(.*?)\]', src, re.S)
    if not m:
        return 1, {'drift': None, 'error': 'EXTENT_MUNIS not found in app/app.js'}
    current = sorted(re.findall(r"'([^']+)'", m.group(1)))
    added = sorted(set(computed) - set(current))
    removed = sorted(set(current) - set(computed))
    res = {'computed': sorted(computed), 'in_app_js': current, 'added': added, 'removed': removed,
           'drift': bool(added or removed)}
    if res['drift']:
        warn('EXTENT_MUNIS drift in app/app.js: '
             + (f'add {added} ' if added else '') + (f'remove {removed}' if removed else '')
             + ' -- paste the new list from tools/list_flood_municipalities.py by hand')
    else:
        log(f'  EXTENT_MUNIS matches ({len(current)} local levels)')
    return 0, res


def step_sitrep(ctx):
    """Probe for an NDRRMA SitRep newer than the ones data/reports.json cites.

    reports.json is hand-edited -- the figures come out of a Nepali PDF and no
    parser exists -- so this only ever reports.  A missing number is not a stop
    condition: NDRRMA sometimes appends a random suffix to a filename
    (SitRep_24_NEP_14092026_rVK6Zae.pdf), so that number 404s at every date
    while later ones exist.  The whole window is scanned.
    """
    reports = json.load(open(REPORTS))
    sources = reports.get('sources') or {}
    nep = max((int(m.group(1)) for k in sources
               if (m := re.fullmatch(r'ndrrma_sitrep(\d+)', k))), default=0)
    eng = max((int(m.group(1)) for k in sources
               if (m := re.fullmatch(r'ndrrma_sitrep_en(?:g)?(\d+)', k))), default=0)
    today = dt.date.today()
    dates = [(today - dt.timedelta(days=i)).strftime('%d%m%Y') for i in range(7)]
    found = {}
    for lang, latest, pattern in (('nep', nep, 'SitRep_{n}_NEP_{d}.pdf'),
                                  ('eng', eng, 'SitRep_ENG_{n}_{d}.pdf')):
        best = None
        for n in range(latest + 1, latest + 7):
            for d in dates:
                url = NDRRMA + pattern.format(n=n, d=d)
                if head_ok(url):
                    iso = f'{d[4:]}-{d[2:4]}-{d[:2]}'
                    if best is None or (n, iso) > (best['number'], best['date']):
                        best = {'number': n, 'date': iso, 'url': url}
                    break
        found[lang] = best
        log(f'  {lang}: in reports.json #{latest}; '
            + (f'newest found #{best["number"]} ({best["date"]})' if best else 'nothing newer'))
    as_of = reports.get('as_of')
    age = None
    if as_of:
        try:
            age = (today - dt.date.fromisoformat(as_of)).days
        except ValueError:
            pass
    res = {'latest_in_repo': {'nep': nep, 'eng': eng}, 'newest_found': found,
           'reports_as_of': as_of, 'reports_age_days': age}
    newest = found.get('nep') or found.get('eng')
    if newest:
        warn(f'NDRRMA SitRep newer than data/reports.json: '
             f'NEP #{found["nep"]["number"] if found["nep"] else "-"} / '
             f'ENG #{found["eng"]["number"] if found["eng"] else "-"} -- {newest["url"]}')
    if age is not None and age > 3:
        warn(f'data/reports.json as_of is {as_of} ({age} days old); the casualty figures are stale')
    return 0, res


def step_imagery(ctx):
    """Run the imagery watcher, never letting it push -- this script owns the push.

    When work/imagery_watch/state.json is missing (a cold CI cache) the watcher
    already treats the run as its first and only arms itself, so passing --init
    changes nothing but makes the intent explicit in the log.  Without that, a
    cold cache would otherwise look like "every scene in the catalogue is new".
    """
    state = os.path.join(ROOT, 'work', 'imagery_watch', 'state.json')
    before = set(os.listdir(os.path.join(ROOT, 'tiles'))) if os.path.isdir(os.path.join(ROOT, 'tiles')) else set()
    cmd = [sys.executable, 'tools/imagery_watch.py', '--no-push']
    if not os.path.exists(state):
        log('  work/imagery_watch/state.json missing: arming the watcher (--init), building nothing')
        cmd.append('--init')
    rc, _ = run_logged('imagery', cmd)
    after = set(os.listdir(os.path.join(ROOT, 'tiles'))) if os.path.isdir(os.path.join(ROOT, 'tiles')) else set()
    added = sorted(after - before)
    if added:
        log(f'  new imagery layers: {", ".join(added)}')
    return rc, {'initialised': '--init' in cmd, 'layers_added': added}


STEPS = [
    ('ems', step_ems, True),
    ('waterways', step_waterways, True),
    ('hdx', step_hdx, True),
    ('admin_ward', step_admin_ward, True),
    ('hydropower', step_hydropower, True),
    ('bridge_status', step_bridge_status, True),
    ('road_status', step_road_status, True),
    ('cutoff', step_cutoff, False),
    ('places', step_places, False),
    ('extent_munis', step_extent_munis, True),
    ('sitrep', step_sitrep, True),
    ('imagery', step_imagery, False),
]
OPT_IN = {'cutoff': 'with_cutoff', 'places': 'with_places', 'imagery': 'with_imagery'}


def select_steps(args):
    names = []
    for name, _fn, default_on in STEPS:
        on = getattr(args, OPT_IN[name]) if name in OPT_IN else default_on
        if args.only:
            on = name in args.only
        elif name in args.skip:
            on = False
        if on:
            names.append(name)
    return names


# ------------------------------------------------------------------- commit
def dirty_paths():
    """The tracked-output pathspecs that actually changed, plus new tiles/ dirs.

    tiles/ is handled separately: the repo already holds 221k tile files and we
    only ever want the directories the imagery watcher just created, never a
    blanket `git add tiles`.
    """
    paths = [p for p in COMMIT_PATHS if os.path.exists(os.path.join(ROOT, p))]
    changed = []
    if paths:
        entries = [l[3:].strip().strip('"') for l in git('status', '--porcelain', '--', *paths).stdout.splitlines()]
        changed = [p for p in paths if any(e == p or e.startswith(p.rstrip('/') + '/') for e in entries)]
    tiles = []
    for line in git('status', '--porcelain', '--untracked-files=normal', '--', 'tiles').stdout.splitlines():
        if line.startswith('??'):
            tiles.append(line[3:].strip().strip('"').rstrip('/'))
    return changed, tiles


def commit(results):
    """Stage the explicit pathspecs and commit.  Returns a small result dict.

    The imagery watcher makes its own commit for data/imagery.json and the tile
    directory it created, so finding nothing to commit here does not mean there
    is nothing to push; main() decides on the push separately.
    """
    changed, tiles = dirty_paths()
    if not changed and not tiles:
        log('nothing to commit')
        return {'committed': False, 'reason': 'no changes'}
    git('add', '--', *(changed + tiles))
    staged = git('diff', '--cached', '--name-only').stdout.strip()
    if not staged:
        log('nothing staged after git add')
        return {'committed': False, 'reason': 'nothing staged'}

    hdx = results.get('hdx', {})
    hdx_word = 'refreshed' if hdx.get('detail', {}).get('refreshed') else 'unchanged'
    if hdx.get('status') == 'failed':
        hdx_word = 'failed'
    img = results.get('imagery', {}).get('detail', {}).get('layers_added') or []
    ward = results.get('admin_ward', {}).get('status', 'skipped')
    subject = (f'data: daily refresh {dt.date.today().isoformat()} '
               f'(hdx: {hdx_word}; imagery: +{len(img)}; wards {"ok" if ward == "ok" else ward})')
    body = 'Produced by tools/daily_refresh.py; see data/refresh_status.json.'
    git('commit', '-q', '-m', subject, '-m', body, '-m', TRAILERS)
    log(f'committed: {subject}')
    return {'committed': True, 'subject': subject}


def unpushed():
    """True when HEAD is ahead of origin/main, i.e. there is something to push."""
    git('fetch', '-q', 'origin', 'main', '--depth=50', check=False)
    p = git('rev-list', '--count', 'origin/main..HEAD', check=False)
    try:
        return int(p.stdout.strip()) > 0
    except ValueError:
        return True          # no origin/main ref locally: let the push decide


def do_push():
    p = git('push', 'origin', 'HEAD:main', check=False)
    if p.returncode == 0:
        log('pushed to origin main')
        return True
    log(f'push rejected, rebasing onto origin/main and retrying:\n{p.stderr.strip()[-400:]}')
    git('fetch', 'origin', 'main', '--depth=50', check=False)
    r = git('rebase', 'origin/main', check=False)
    if r.returncode != 0:
        git('rebase', '--abort', check=False)
        warn('daily refresh could not rebase onto origin/main; the commit is local only')
        return False
    p = git('push', 'origin', 'HEAD:main', check=False)
    if p.returncode == 0:
        log('pushed to origin main after rebase')
        return True
    warn(f'daily refresh could not push: {p.stderr.strip()[-200:]}')
    return False


# ------------------------------------------------------------------ summary
def write_summary(status):
    with open(STATUS, 'w') as fh:
        json.dump(status, fh, indent=1, sort_keys=True)
        fh.write('\n')
    log(f'wrote {os.path.relpath(STATUS, ROOT)}')


def step_summary(status):
    path = os.environ.get('GITHUB_STEP_SUMMARY')
    if not path:
        return
    rows = ['| Step | Status | Duration | Notes |', '| --- | --- | --- | --- |']
    for name, s in status['steps'].items():
        note = s.get('note', '')
        rows.append(f'| `{name}` | {s["status"]} | {s["duration_s"]}s | {note} |')
    lines = [f'## Daily refresh {status["started"][:10]}', '', *rows, '']
    hdx = status.get('hdx', {}).get('datasets', {})
    if hdx:
        lines += ['### HDX', '', '| Dataset | Changed | Upstream modified | Fingerprint |',
                  '| --- | --- | --- | --- |']
        for ds, e in hdx.items():
            lines.append(f'| `{ds}` | {"yes" if e.get("changed") else "no"} | '
                         f'{(e.get("metadata_modified") or "?")[:16]} | `{e.get("fingerprint", "-")}` |')
        lines.append('')
    sit = status.get('steps', {}).get('sitrep', {}).get('detail') or {}
    if sit:
        nf = sit.get('newest_found', {})
        lines += ['### NDRRMA SitRep', '',
                  f'- reports.json `as_of` {sit.get("reports_as_of")} ({sit.get("reports_age_days")} days old)',
                  f'- newest Nepali found: {nf.get("nep") and "#" + str(nf["nep"]["number"]) + " " + nf["nep"]["date"] or "none newer"}',
                  f'- newest English found: {nf.get("eng") and "#" + str(nf["eng"]["number"]) + " " + nf["eng"]["date"] or "none newer"}',
                  '']
    with open(path, 'a') as fh:
        fh.write('\n'.join(lines) + '\n')


# --------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--only', default='', help='comma-separated step names to run, to the exclusion of the rest')
    ap.add_argument('--skip', default='', help='comma-separated step names to leave out')
    ap.add_argument('--with-imagery', action='store_true', help='include the imagery watcher')
    ap.add_argument('--with-cutoff', action='store_true', help='include the road network and cut-off wards analysis')
    ap.add_argument('--with-places', action='store_true', help='include the Overpass places build')
    ap.add_argument('--force-hdx', action='store_true', help='refresh HDX even when upstream looks unchanged')
    ap.add_argument('--dry-run', action='store_true', help='print the plan, do the upstream checks, write nothing')
    ap.add_argument('--commit', action='store_true', help='commit the tracked outputs')
    ap.add_argument('--push', action='store_true', help='push to origin main (implies --commit)')
    args = ap.parse_args()
    args.only = [s.strip() for s in args.only.split(',') if s.strip()]
    args.skip = [s.strip() for s in args.skip.split(',') if s.strip()]
    known = {n for n, _, _ in STEPS}
    for bad in set(args.only + args.skip) - known:
        ap.error(f'unknown step {bad!r}; known steps: {", ".join(sorted(known))}')
    if args.push:
        args.commit = True

    selected = select_steps(args)
    started = dt.datetime.now(dt.timezone.utc)
    log(f'daily refresh {started.isoformat(timespec="seconds")}  root={ROOT}')
    log(f'steps: {", ".join(selected) or "(none)"}' + ('   [DRY RUN]' if args.dry_run else ''))
    log(f'gdal: ogr2ogr={ENV.get("OGR2OGR", "?")}  ogrinfo={ENV.get("OGRINFO", "?")}')

    # The HDX check is read-only, so it runs in a dry run too -- it is the single
    # most useful thing to see before committing 20-30 minutes to a refresh.
    hdx_check = check_hdx(force=args.force_hdx) if 'hdx' in selected else {}
    if hdx_check:
        for ds, e in hdx_check['datasets'].items():
            log(f'  hdx {ds}: changed={"YES" if e.get("changed") else "no"} -- {e.get("basis") or e.get("error")}')
        log(f'  refresh_hdx.sh would {"RUN" if hdx_check["will_refresh"] else "be SKIPPED"}')

    ctx = {'args': args, 'hdx_check': hdx_check}
    results, failures = {}, []
    for name, fn, _ in STEPS:
        if name not in selected:
            continue
        # The read-only checks still run in a dry run; the builders do not.
        if args.dry_run and name not in ('extent_munis', 'sitrep'):
            if name == 'hdx' and not hdx_check.get('will_refresh'):
                log('[hdx] would be skipped (upstream unchanged)')
            else:
                log(f'[{name}] would run (dry run)')
            results[name] = {'status': 'skipped', 'duration_s': 0, 'note': 'dry run'}
            continue
        log(f'[{name}] start')
        t0 = dt.datetime.now(dt.timezone.utc)
        try:
            rc, detail = fn(ctx)
        except Exception as e:
            rc, detail = 1, {'error': f'{type(e).__name__}: {e}'}
        secs = round((dt.datetime.now(dt.timezone.utc) - t0).total_seconds(), 1)
        ok = rc == 0
        if not ok:
            failures.append(name)
        note = detail.get('error') or detail.get('reason') or ''
        if name == 'extent_munis' and detail.get('drift') is not None:
            note = 'drift' if detail['drift'] else 'matches app/app.js'
        if name == 'imagery':
            note = 'armed (no state)' if detail.get('initialised') else f'+{len(detail.get("layers_added") or [])} layers'
        results[name] = {'status': 'ok' if ok else 'failed', 'duration_s': secs,
                         'exit_code': rc, 'note': note, 'detail': detail}
        log(f'[{name}] {"ok" if ok else "FAILED"} in {secs}s' + (f' -- {note}' if note else ''))

    status = {
        'started': started.isoformat(timespec='seconds'),
        'finished': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
        'dry_run': args.dry_run,
        'selected': selected,
        'steps': results,
        'failures': failures,
        'hdx': hdx_check,
        'git': {},
    }

    if args.dry_run:
        log('\ndry run: nothing written, nothing committed')
        log(json.dumps({k: v.get('status') for k, v in results.items()}, indent=1))
        step_summary(status)
        return 1 if failures else 0

    # The status file is itself committed, so it has to be final before the
    # commit.  What happened to the commit and the push therefore lives in the
    # log and the job summary, not in data/refresh_status.json.
    write_summary(status)
    if args.commit:
        status['git'] = commit(results)
        if args.push and unpushed():
            status['git']['pushed'] = do_push()
        elif args.push:
            log('nothing to push; origin/main is up to date')
    else:
        changed, tiles = dirty_paths()
        log(f'not committing (--commit off). changed pathspecs: {changed or "none"}; new tile dirs: {len(tiles)}')
    step_summary(status)

    if failures:
        warn(f'daily refresh: {len(failures)} step(s) failed: {", ".join(failures)}')
        return 1
    log('daily refresh: all steps ok')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
