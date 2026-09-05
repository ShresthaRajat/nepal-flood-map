# Architecture

A static site. No build step, no bundler, no npm dependencies — open `index.html`
over any HTTP server and it runs. MapLibre GL JS 4.7.1 and pmtiles 3.2.1 load
from unpkg.

## File layout

| Path | Owner | What it is |
| --- | --- | --- |
| `index.html` | app | Page shell: sidebar container, two map divs, divider, the two corner tags, readout. |
| `app/style.css` | app | All styling. Dark sidebar, swipe divider, mobile drawer. |
| `app/config.js` | app | Static catalogue: HOT category list, feature counts, palettes, zoom targets, per-scene imagery notes, the "Sources & notes" text. Defines `window.CFG`. |
| `app/app.js` | app | Everything else: style construction, the two synchronised maps, sidebar rendering, URL state, keyboard. |
| `tools/serve.py` | app | Dev server on port 1111 with HTTP Range support (PMTiles is read by byte range). |
| `docs/ARCHITECTURE.md` | app | This file. |
| `data/imagery.json` | retile agent | Imagery catalogue. |
| `data/terrain.json` | contours agent | Contour and hillshade tile descriptions. |
| `data/hdx/` | HDX snapshot | GeoJSON + PMTiles, 5 Sep 2026. |
| `tiles/<id>/{z}/{x}/{y}.webp` | retile agent | Imagery pyramids, 256 px, alpha. |
| `tiles/contours/`, `tiles/hillshade/` | contours agent | Vector and raster terrain tiles. |
| `work/` | scratch | Gitignored. Holds `serve.log` and `imagery.dev.json`. |

## Running it

```sh
python3 tools/serve.py            # http://127.0.0.1:1111/index.html
python3 tools/serve.py 8080       # another port
```

Range support matters: the PMTiles protocol issues `Range` requests, and a
server that ignores them returns whole 4–9 MB archives per tile fetch.

## Data contracts

`data/imagery.json`

```json
{ "layers": [ { "id": "post_wv02_20260828", "label": "…", "side": "pre|post",
                "date": "2026-08-28", "sensor": "…", "provider": "…", "gsd_m": 0.54,
                "bounds": [w, s, e, n], "minzoom": 8, "maxzoom": 19,
                "tiles": "tiles/<id>/{z}/{x}/{y}.webp", "attribution": "…",
                "coverage": "corridor|trisuli_bazar|upper_valley", "size_mb": 120 } ],
  "default_pre": "pre_legion_20260205", "default_post": "post_wv02_20260828" }
```

`tiles` may be a repo-relative path or an absolute URL; both are accepted.
Missing tiles are expected — imagery footprints are sparse and MapLibre treats a
404 as an empty tile. The app filters 403/404 out of its error handler so the
console stays readable.

`data/terrain.json`

```json
{ "contours": { "tiles": "tiles/contours/{z}/{x}/{y}.pbf", "minzoom": 8, "maxzoom": 14,
                "layers": { "c1000": {"minzoom":8,"maxzoom":22}, "c500": {}, "c100": {}, "c50": {}, "c10": {} },
                "attribution": "…" },
  "hillshade": { "tiles": "tiles/hillshade/{z}/{x}/{y}.webp", "minzoom": 6, "maxzoom": 14 } }
```

MVT source-layer names are `c1000`, `c500`, `c100`, `c50`, `c10`, with attributes
`ele` (metres) and `idx` (1 for multiples of 100 m, drawn heavier). Elevation
labels are symbol layers along the lines from zoom 13.

Both files are optional. Without `data/imagery.json` the app falls back to
`work/imagery.dev.json`, and without either it still renders basemaps and
overlays. Without `data/terrain.json` the contour group and the hillshade
toggle disappear.

`data/hdx/` is consumed exactly as the reference `hdx-explorer.html` did: two
PMTiles archives whose single source-layer (`hot_flood_npl`,
`hot_flood_npl_corridor`) holds every category, filtered by
`concat(category, "|", source)`, plus the loose GeoJSON files for flood extent,
bridge ground reports, exposed hydropowers, Tasking Manager boundaries and fAIr
damage.

## How the two maps work

`#mapPre` and `#mapPost` are two full-size MapLibre instances stacked in
`#stage`. Every layer definition is built once and handed to both, so overlays
stay pixel-aligned across the divider; only the `imagery` layer differs.

Movement is kept in step by a two-way `move` handler with a re-entrancy guard,
which `jumpTo`s the other map. The divider is a `clip-path: inset(0 0 0 N%)` on
the post map's **canvas container** — not on `#mapPost` itself, so the map
controls stay visible in Before-only mode. `clip-path` also clips hit testing,
which is what routes clicks on the left half through to the pre map;
`#mapPost { pointer-events: none }` stops the unclipped wrapper from swallowing
them.

Layer order, bottom to top: basemap, imagery, hillshade, contours, HOT
overlays, imagery footprints. New imagery is inserted with `addLayer(def,
IMAGERY_BEFORE)` where `IMAGERY_BEFORE` is the first hillshade/contour/HOT layer.

Only the two selected scenes exist as sources at any time. Switching a source
removes the old layer and source and adds the new one. Overlays that are off are
`visibility: none`, never removed, so toggling them costs nothing.

## Controls

Scenes are chosen from two `<select>` tags in the top corners of the stage,
green on the left for the before side and amber on the right for the after side.
Each lists that side's scenes grouped by coverage, then a "View" group holding
"<side> only" and "Compare (swipe)". Picking a view option changes the mode
rather than the scene and the select snaps back to the current scene;
`refreshTags()` is the single place that re-reads state into both tags, ticks the
active view option and puts the white outline on whichever side is shown alone.
The mode buttons in the sidebar and the tags both route through `setMode()`, so
they can never disagree.

The sidebar has no scene selectors — that would be two controls for one piece of
state. It shows the selected scene's provider, resolution, coverage and licence
instead, refreshed by `updateMeta()`.

The sidebar collapses on desktop as well as mobile, by the same mechanism: the
panel slides out on `transform` and `#stage` reflows its `left`. The difference
is only that on mobile the open panel floats over the stage instead of pushing
it. State lives in `localStorage` under `nf26.sidebar`, with the hash taking
precedence when it carries `sb`. Maps are resized after the CSS transition
finishes.

## URL state

Everything lives in the hash, written with `replaceState` on every change:

```
#m=swipe&pre=<id>&post=<id>&c=<lng>,<lat>&z=<zoom>&s=<swipe %>&b=osm&hs=1&cb=status&sb=0&ov=+key,-key
```

`ov` is a **diff against the default overlay set**, not the full list, which
keeps the URL short. `+key` turns one on, `-key` turns one off.

## Keyboard

Arrows pan (hold shift for a larger step), `+`/`-` zoom, `[` and `]` move the
divider, `B` hides and shows the sidebar. MapLibre's own keyboard handler is
disabled on both maps so the two never disagree.

## Adding an imagery layer

1. Produce `tiles/<id>/{z}/{x}/{y}.webp`.
2. Append an entry to `data/imagery.json` following the contract above. The
   `coverage` value groups it in the corner tag; add a new one and it will appear
   as its own optgroup, labelled by `CFG.COVERAGE_LABEL` (add a label there for a
   readable name).
3. Add a paragraph to `SCENES` in `app/config.js` keyed by the same id. It shows
   as the option tooltip and in the "Sources & notes" drawer. Without it the
   drawer falls back to the entry's `attribution`.

No other change is needed — the corner tags, sidebar metadata, footprint
outlines, footprint overlay and notes list are all generated from the catalogue.

## Refreshing the HDX data

The snapshot in `data/hdx/` came from the HDX dataset
<https://data.humdata.org/dataset/hot_flood_npl>. To refresh, re-download it,
rebuild the two PMTiles archives with the same source-layer names, and update the
`COUNTS` table in `app/config.js` from HOT's own overview page. Counts are
cosmetic — they only annotate the sidebar rows — so a stale count degrades
gracefully, but an entry in `CFG.CATS` with no matching count is skipped
entirely.

## Publishing

GitHub Pages from `main`, serving the repository root. `index.html` is at the
root and all paths are relative, so no configuration is needed. Two caveats:

- `work/` is gitignored, so the development catalogue never ships. If
  `data/imagery.json` is missing from a published build the page will show its
  "no imagery catalogue" warning.
- `data/hdx/hotosm_npl_waterways/hotosm_npl_waterways_clip.geojson` is also
  gitignored. Its overlay is off by default and will simply stay empty on Pages.

## Known limitations

- The PMTiles build of the HOT catalogue carries only `category`, `source` and
  `name`. `status` was dropped, so "colour by status" cannot read a real status
  for buildings and roads: it greys them and paints the `destroyed_features`
  category red. The bridge ground-report layer, which is GeoJSON, does carry
  true per-feature status. Re-tiling the HDX data with `status` retained would
  make the switch fully accurate with no app change — the expression already
  reads `status` first and only falls back to `category`.
- Two WebGL contexts is heavier than one. It is the price of overlays that stay
  aligned across the divider without redrawing them per frame.
- Glyphs for the contour and footprint labels come from
  `demotiles.maplibre.org`, so those labels need network access.
