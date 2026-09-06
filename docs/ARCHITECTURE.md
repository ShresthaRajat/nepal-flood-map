# Architecture

A static site. No build step, no bundler, no npm dependencies — open `index.html`
over any HTTP server and it runs. MapLibre GL JS 4.7.1 and pmtiles 3.2.1 load
from unpkg.

## File layout

| Path | Owner | What it is |
| --- | --- | --- |
| `index.html` | app | Page shell: two rail containers, two map divs, divider, the two corner tags, readout. |
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

`data/hdx/` has two interchangeable vector back ends, chosen per category by
`resolve()` in `app/app.js`:

- **PMTiles (fallback).** `pmtiles/hot_flood_npl.pmtiles` and
  `pmtiles/hot_flood_npl_corridor.pmtiles`, each one source-layer named after the
  archive, every category filtered by `concat(category, "|", source)`. Carries
  only `category`, `source` and `name`.
- **Per-layer tiles (preferred).** `tiles/hot_flood_npl/{z}/{x}/{y}.pbf` and
  `tiles/hot_flood_npl_corridor/{z}/{x}/{y}.pbf`, one source-layer per HOT layer
  and no filter needed. Used automatically when the matching
  `tiles/<dataset>/metadata.json` is present.
- **Waterways of Nepal.** `tiles/hotosm_npl_waterways/{z}/{x}/{y}.pbf`, z8–13,
  one source-layer `waterways` with `name`, `waterway`, `natural_class`, `water`
  and `width`. Built from the national HDX `hotosm_npl_waterways` export by
  `tools/build_waterways_tiles.sh`; not part of the two HOT flood datasets, so
  it ignores the Extent switch.
- **Highways and main roads.** `tiles/hotosm_npl_roads/{z}/{x}/{y}.pbf`, z7–13,
  source-layer `roads` (`highway`, `name`, `name_en`, `name_latin`, `surface`,
  `bridge`; the export has no `ref`), motorway/trunk/primary/secondary/tertiary
  plus unclassified ways named Highway/Rajmarg/Lokmarg/Rajpath. Built from the
  national HDX `hotosm_npl_roads` export by `tools/build_roads_tiles.sh`, which
  downloads the 220 MB GeoPackage into `work/`. Shows the approach roads beyond
  the 1 km corridor, drawn *under* the HOT roads with the same casing and
  widths (tapered below z14), trunk/primary yellow and the rest white; highways
  and anything named "Highway" are labelled by name from a symbol layer placed
  above the HOT layers. HOT roads themselves are white, yellow for trunk/primary
  and red where `status` is damaged or destroyed, and are on by default.
- **Copernicus EMS road grading.** `data/hdx/derived/ems_road_grading.geojson`,
  1,221 road and bridge line segments from the EMSR927 grading GeoPackages
  (AOI01 Syapru Besi, AOI02 Timure, AOI03 Bidur monitoring 1, AOI05 Phosretar),
  merged by `tools/build_ems_roads.py`, which downloads the products into
  `work/ems/`. Fields `grade`, `kind` (road | bridge), `name`, `aoi`,
  `locality`, `product`, `post_event_date`, `method`. Rerun when Copernicus
  publishes a new version or an AOI04 product.
- **Roads inside the flood extent.** `data/hdx/derived/roads_in_flood_extent.geojson`,
  the HOT flood-area `roads_osm` clipped to the flood extent polygon by
  `tools/build_flooded_roads.py` (needs the GeoPackages from
  `build_hdx_tiles.sh` and the gitignored waterways GeoJSON for the river
  centreline). 879 segments, 175 km, fields `highway`, `name`, `status`,
  `length_m`, plus `river_zone`, `report_status`, `report_name` and
  `report_dist_m` on bridge segments. Bridges follow position along the
  stitched Trishuli / Bhote Koshi centreline: upstream of the BhimDhunga bridge
  every bridge is kept as destroyed unless a report says Intact; between BhimDhunga and Benighat the nearest
  `bridge_damage` report within 120 m decides; from Benighat downstream bridges
  are dropped unless a report says otherwise. Where a Copernicus grade matches
  the segment (sampled every 15 m, 12 m tolerance) it overrides all of that:
  Destroyed/Damaged keeps, No visible damage drops, recorded as `ems_grade`.
  Rebuild after refreshing the HDX snapshot or the EMS grading.

The switch is per category, not global, so a partial tile build still works: any
category whose source-layer is missing falls back to the PMTiles archive.
Source-layer names are matched against `<category>_<source>` first, then bare
`<category>` for OSM layers, so both `roads_osm` and `roads` resolve.
`metadata.json` is read loosely — a list under `vector_layers`, `layers` or
`sourceLayers`, or a bare array, of strings or objects with `id`/`name`, plus
optional `minzoom`/`maxzoom`.

The loose GeoJSON files supply flood extent, bridge ground reports, exposed
hydropowers, Tasking Manager boundaries and fAIr damage, and are also read
directly by the search, bridges and damage panels.

### Properties the styling reads

`highway` (OSM classes, for road and bridge width and dash class),
`bridge_structure` (`simple-suspension`, `suspension`, for footbridges),
`status` (`Standing`, `Damaged`, `Destroyed`; also `Intact` and `Washed out` in
the bridge reports), `category` and `source` (PMTiles back end only),
`name`, `name_ne`, `name_en`, `name_latin`, `adm3_name`, `feature_type`,
`damage_type`, `length_m`, `location`, `amenity`, `place`, `man_made`. Every one
has a fallback: a missing `highway` styles as the unknown width, solid white; a
missing `status` leaves the default palette in place.

## Roads and bridges

White with a black casing at 0.35 opacity, casing width = line width + 1.5 (road
bridge spans + 2.5). Width interpolates over zoom, weighted by `highway`: trunk
and primary 3.2 to 6 px, secondary and tertiary 2.2 to 4.5, residential and
service 1.4 to 3, track 1.2 to 2.2, path 1.0 to 2.0, unknown 1.2 to 2.4, all
measured between zoom 14 and 18.

`line-dasharray` is **not** data-driven in MapLibre, so each dash class is its
own filtered layer: solid roads, dashed tracks `[4,2]`, dotted paths `[1,2]` with
round caps, and for bridges a solid span plus a dotted footbridge layer. Roads
stay white under colour-by-status unless the feature is Damaged or Destroyed;
bridges carry the status tint at all times, so a destroyed span always reads red.

Layers are emitted in three passes — all fills, then lines, then roads, then all
points — so roads always sit above building fills and below every point layer.

## Panels

Search, bridge reports and the damage summary read the GeoJSON in `data/hdx/`
directly, cached in `gjCache`, loaded lazily: search on first focus of the box,
the other two on first open of their `<details>`. All three fail soft — a missing
file leaves a short note in place of the panel. The damage summary keeps feature
centroids in memory and recounts what is in the viewport on `moveend` with a bbox
test.

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
overlays, search pin and selected-scene outline. New imagery is inserted with `addLayer(def,
IMAGERY_BEFORE)` where `IMAGERY_BEFORE` is the first hillshade/contour/HOT layer.

Only the two selected scenes exist as sources at any time. Switching a source
removes the old layer and source and adds the new one. Overlays that are off are
`visibility: none`, never removed, so toggling them costs nothing.

## Controls

Scenes are chosen from two `<select>` tags in the top corners of the stage,
green on the left for the before side and amber on the right for the after side.
Each opens with "None, basemap only", then that side's scenes grouped by
coverage, then a "View" group holding "<side> only" and "Compare (swipe)".
Choosing None adds no imagery source for that side and takes the OSM basemap on
that map to full opacity; it is carried in the hash as `pre=none` / `post=none`.
The two sides are independent, so one can show imagery while the other shows the
basemap. Picking a view option changes the mode
rather than the scene and the select snaps back to the current scene;
`refreshTags()` is the single place that re-reads state into both tags, ticks the
active view option and puts the white outline on whichever side is shown alone.
The mode buttons in the sidebar and the tags both route through `setMode()`, so
they can never disagree.

The sidebar has no scene selectors — that would be two controls for one piece of
state. It shows the selected scene's provider, resolution, coverage and licence
instead, refreshed by `updateMeta()`.

There are two rails. `#panel` on the left holds information: the title, search,
zoom-to chips, bridge ground reports, damage table, legend, notes and, at the
bottom, imagery metadata for the two selected scenes. `#controls` on the right holds
everything that changes what the map shows: view mode, basemap (with hillshade
and contours) and the overlay groups. Scenes are still chosen with the tags at
the top of the map, so the left rail describes them without controlling them. Both
collapse on desktop as well as mobile, by the same mechanism: the rail slides
out on `transform` and `#stage` reflows its `left` or `right`. On mobile an
open rail floats over the stage instead of pushing it. State lives in
`localStorage` under `nf26.sidebar` and `nf26.controls`, with the hash taking
precedence when it carries `sb` or `sc`. Maps are resized after the CSS
transition finishes.

## URL state

Everything lives in the hash, written with `replaceState` on every change:

```
#m=swipe&pre=<id>&post=<id>&c=<lng>,<lat>&z=<zoom>&s=<swipe %>&b=osm&hs=1&ct=0&cb=status&sb=0&sc=0&hx=corridor&ov=+key,-key
```

`ov` is a **diff against the default overlay set**, not the full list, which
keeps the URL short. `+key` turns one on, `-key` turns one off. `hx` is the
HOT category list's extent switch (`flood` | `corridor`), omitted at its default.
OSM categories are keyed `hot_<cat>` and Overture ones `ovt_<cat>`; the two are
separate overlay groups. Older links carrying `ho=overture` (from when source
was a switch) are read and their `hot_` keys remapped to `ovt_`.

## Keyboard

Arrows pan (hold shift for a larger step), `+`/`-` zoom, `[` and `]` move the
divider, `B` hides and shows the left info panel, `C` the right layer-controls rail. In the search box, up and down move
through results, Enter flies to one and Escape clears. MapLibre's own keyboard handler is
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

No other change is needed — the corner tags, sidebar metadata, selected-scene
footprint outline and notes list are all generated from the catalogue.

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
- `data/hdx/hotosm_npl_waterways/hotosm_npl_waterways_clip.geojson` (8 MB) is
  also gitignored, but the "Waterways of Nepal" overlay does not read it: it
  draws from the tracked vector tiles in `data/hdx/tiles/hotosm_npl_waterways/`
  (z8–13, source-layer `waterways`), rebuilt from that GeoJSON by
  `tools/build_waterways_tiles.sh`.

## Known limitations

- The PMTiles build of the HOT catalogue carries only `category`, `source` and
  `name`, so while it is the active back end neither `status` nor `highway` is
  readable: colour-by-status greys buildings and paints the
  `destroyed_features` category red, and every road draws at the unknown width,
  solid white. The per-layer tile build fixes both with no app change — the
  expressions already read `status`, `highway` and `bridge_structure` first and
  only fall back. The bridge ground-report layer, which is GeoJSON, carries true
  per-feature status today.
- Two WebGL contexts is heavier than one. It is the price of overlays that stay
  aligned across the divider without redrawing them per frame.
- Glyphs for the contour labels come from
  `demotiles.maplibre.org`, so those labels need network access.
