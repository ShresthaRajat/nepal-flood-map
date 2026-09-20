# Daily refresh

`tools/daily_refresh.py` re-runs the parts of the data pipeline that can be
automated, once a day, from `.github/workflows/daily-refresh.yml`. It commits
the result straight to `main`, which is what GitHub Pages serves, so a green run
publishes itself.

It is stdlib-only and finds the repo from its own path, so the same command
works on a laptop, from cron, or in the workflow container.

```
python3 tools/daily_refresh.py --dry-run          # check upstream, change nothing
python3 tools/daily_refresh.py                    # run the daily steps, commit nothing
python3 tools/daily_refresh.py --with-imagery --push   # what CI runs
```

## Schedule

`0 11 * * *` — 11:00 UTC, 16:45 NPT. HOT re-exports the two HDX flood datasets
overnight; on 20 September 2026 the newest resources were stamped 03:05 and
10:06 UTC. Running at 11:00 clears the whole of that window on the same day.

`workflow_dispatch` takes four booleans: `force_hdx`, `with_cutoff`,
`with_places`, `dry_run`.

## Steps

They run in this order, and the order matters in two places: `waterways` has to
precede `hdx`, and everything that reads an HDX layer has to follow it.

| Step | Runs | Writes | Default |
| --- | --- | --- | --- |
| `ems` | `tools/build_ems_roads.py` | `data/hdx/derived/ems_road_grading.geojson` | on |
| `waterways` | `tools/build_waterways_tiles.sh` | `data/hdx/tiles/hotosm_npl_waterways/` + the gitignored clip | on |
| `hdx` | `tools/refresh_hdx.sh` | both dataset dirs, `data/hdx/tiles/`, `data/hdx/pmtiles/`, `app/config.js`, `README.md`, `docs/LICENSING.md` | on, skipped when unchanged |
| `admin_ward` | `tools/build_admin_ward.py` | `data/admin/admin_ward.geojson` | on |
| `hydropower` | `tools/build_hydropower_points.py` | `data/hdx/derived/hydropower_points.geojson` | on |
| `cutoff` | `build_roads_tiles.sh` then `build_cutoff_wards.py` | `data/hdx/tiles/hotosm_npl_roads/`, `data/hdx/derived/cutoff_wards.geojson` | **off** |
| `places` | `tools/build_places.py` | `data/hdx/derived/places.geojson` | **off** |
| `extent_munis` | `tools/list_flood_municipalities.py` | nothing — warns only | on |
| `sitrep` | HEAD probes against ndrrma.gov.np | nothing — warns only | on |
| `imagery` | `tools/imagery_watch.py --no-push` | `tiles/<layer>/`, `data/imagery.json` | off locally, **on** in CI |

`waterways` runs before `hdx` because it regenerates
`data/hdx/hotosm_npl_waterways/hotosm_npl_waterways_clip.geojson`, which is
gitignored and therefore absent on a fresh checkout, and which
`build_flooded_roads.py` reads from inside `refresh_hdx.sh`.

`cutoff` is off because `build_roads_tiles.sh` downloads 418 MB and
`build_cutoff_wards.py` then runs a long shortest-path analysis; the road
network does not change daily. `places` is off because it queries Overpass,
which is flaky, and silently produces a worse result when the gitignored
`work/hab.tif` is missing.

These are never run from here: `write_catalog.py` (it would delete the
watcher-added layers from `data/imagery.json`), `run_tiles.sh`, `retile*.py`,
`fix_box_layers.py`, `build_terrain.sh`, `build_collapse_origin.py`,
`build_vantor_item.py`.

## Skipping the HDX refresh

`refresh_hdx.sh` takes 20–30 minutes and rewrites tens of thousands of `.pbf`
files under `data/hdx/tiles/`, every one of which is committed. Running it when
nothing upstream changed would churn the repo for no benefit, so it is gated.

Before the step runs, `package_show` is fetched for both CKAN datasets and
fingerprinted: a SHA-256 over the package's `metadata_modified` plus the sorted
list of `(resource name, last_modified)`. Resources are keyed by name rather
than list position because HOT reorders them. The fingerprint is compared with
`data/hdx/refresh_state.json`, which is tracked and updated after a successful
refresh.

On the very first run there is no stored fingerprint, so the comparison falls
back to the newest `generated_utc` in the committed
`data/hdx/<dataset>/metadata_osm.json` — that is, to how old the data in the
repo actually is. `--force-hdx` bypasses the gate entirely.

If `refresh_hdx.sh` fails part-way it may have left `data/hdx/tiles/<dataset>`
half-deleted, since it clears the directory before re-tiling. The orchestrator
runs `git checkout --` on the tracked HDX paths in that case and marks the step
failed, so a broken run never gets committed.

## The two things it will not do for you

**`EXTENT_MUNIS`.** `tools/list_flood_municipalities.py` computes the local
levels whose polygon intersects the observed flood extent. That list is
hand-pasted into `app/app.js` because the admin GeoJSON is fetched by MapLibre,
not by the app. The orchestrator compares the computed list with the literal in
`app.js` and emits a `::warning::` naming what to add and remove. It does not
edit `app.js`: that file is hand-maintained code with comments explaining the
list, and a regex rewrite of a literal inside it is a worse bet than asking a
person.

**`data/reports.json`.** The NDRRMA casualty, displacement and damage figures
are transcribed by hand from a Nepali PDF. No parser exists. The orchestrator
reads the highest SitRep numbers already cited in the `sources` block
(`ndrrma_sitrep<n>` and `ndrrma_sitrep_en<n>`), then HEAD-requests the next six
numbers across the last seven days of dates and reports the newest that answers
200.

The whole window is scanned rather than stopping at the first 404, because
NDRRMA sometimes appends a random suffix to a filename
(`SitRep_24_NEP_14092026_rVK6Zae.pdf`), which makes that one number unreachable
at every date while later ones are fine. The workflow turns a hit into a GitHub
issue, de-duplicated on the title. It also warns when `as_of` is more than three
days old.

## Committing and pushing

Only explicit pathspecs are staged, never `git add -A`:

```
data/hdx  data/admin/admin_ward.geojson  data/imagery.json
data/refresh_status.json  app/config.js  README.md  docs/LICENSING.md
```

plus any directory under `tiles/` that `git status` reports as untracked, which
is how the imagery watcher's new layers get in without touching the 221k tile
files already committed. `git add` on a directory respects `.gitignore`, so
`data/hdx/gpkg/` and the waterways clip stay out.

The commit message looks like

```
data: daily refresh 2026-09-21 (hdx: refreshed; imagery: +1; wards ok)
```

The imagery watcher makes its own commit before this one, so "nothing to
commit" does not mean "nothing to push"; the push is decided separately from
`origin/main..HEAD`. A rejected push is retried once after
`git fetch --depth=50 && git rebase origin/main`.

Pushes made with `GITHUB_TOKEN` do trigger a Pages build here, because Pages
deploys from `main` directly rather than through a workflow, so nothing extra is
needed to publish.

## The workflow

Runs in `ghcr.io/osgeo/gdal:ubuntu-full-latest`, which supplies GDAL, the MVT
driver, `gdal2tiles` and the `osgeo` Python bindings. `git`, `unar`, `unzip` and
`curl` are apt-installed first — `git` before `actions/checkout`, or checkout
falls back to a tarball download and leaves no `.git` to commit into.

`fetch-depth: 1`: the pack is about 1.1 GB and there is no LFS.

Two caches:

- `work/imagery_watch` under `imagery-state-${{ github.run_id }}` with the
  `imagery-state-` restore prefix, so every run resumes from the newest saved
  state. Without it the watcher would arm itself and build nothing on every run,
  since a missing `state.json` is how it recognises a first run.
- `work/ems` and `work/hrrp_wards`, keyed on the hash of the two tools that name
  those downloads. Both are static sources.

`concurrency: daily-refresh` with `cancel-in-progress: false`: cancelling a run
mid-refresh would leave the tile directories half-written with nothing to
restore them. `timeout-minutes: 150`.

Per-step logs land in `work/daily_refresh/<step>.log` (gitignored) and are
uploaded as an artifact for 14 days, together with `data/refresh_status.json`.

## Reading the result

`data/refresh_status.json` is tracked and holds per-step status, duration and
exit code, the HDX fingerprints and what they were compared against, the
`EXTENT_MUNIS` comparison, the SitRep probe, and the imagery layers added. The
same summary is appended to `$GITHUB_STEP_SUMMARY` as a table when running in
Actions.

A failing step never aborts the rest — each step writes independent tracked
files, so whatever succeeded is still committed — but the job exits non-zero so
the run goes red.
