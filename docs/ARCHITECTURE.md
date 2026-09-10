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
| `tools/build_s2_tiles.sh` | imagery | Sentinel-2 true-colour pyramids at native 10 m (z8–14) straight from the AWS COG archive; used for `post_s2_20260827`. |
| `tools/build_roads_tiles.sh`, `build_waterways_tiles.sh` | vector | National OSM roads / waterways from HDX, clipped and tiled (MVT). |
| `tools/build_ems_roads.py`, `build_flooded_roads.py` | derived | Copernicus EMS road grades; roads inside the flood extent with bridge rules. |
| `tools/build_places.py`, `build_collapse_origin.py` | derived | Settlement labels (OSM/Overpass); UNOSAT detachment zone, barrier lakes, upstream AOI. |
| `tools/refresh_hdx.sh`, `update_hdx_counts.py` | data | Pull the latest HOT/HDX exports, retile, rebuild overlays, recompute counts and snapshot dates. |
| `tools/imagery_watch.py`, `build_cog_tiles.sh` | imagery | 6-hourly scan for new scenes (launchd); generic COG-to-tiles builder. |
| `tools/build_vantor_item.py` | imagery | Manual override: build one or more Vantor STAC item ids and add them to the catalogue, bypassing `imagery_watch.py`'s cloud/off-nadir/focus gates. Imports `imagery_watch` as a module and calls its `build_vantor`/`catalog_add` directly, so it reuses the same zoom range, CORRIDOR clip, and layer-id naming; run by hand, does not commit or push. |
| `docs/ARCHITECTURE.md` | app | This file. |
| `data/imagery.json` | retile agent | Imagery catalogue. |
| `data/terrain.json` | contours agent | Contour and hillshade tile descriptions. |
| `data/reports.json` | reports | Official casualty, municipality, energy and community figures with a source and an "as of" date on every number. Feeds the four report sections in the left rail. |
| `tools/merge_bipad_reports.py` | reports | Optional: merges a per-municipality summary extracted from Nepal's BIPAD incident portal into `data/reports.json`. |
| `tools/build_hydropower_points.py` | reports | Merges the 10 surveyed HDX hydropower points with 9 hand-geocoded plants into `data/hdx/derived/hydropower_points.geojson`. |
| `data/hdx/derived/hydropower_extra_src.geojson` | reports | The hand-geocoded plants as found, committed so the merge is reproducible offline. |
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
  "default_pre": "none", "default_post": "post_wv02_20260828" }
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
`ele` (metres), `idx` (1 for multiples of 100 m, drawn heavier), and `fade`
(0/1/2). `c50`/`c10` are clipped by height above river rather than the flood
AOI polygon, split into three bands so `fade` fades the line-opacity out with
distance from the valley floor instead of stopping at a hard boundary
(`tools/build_terrain.sh`); `c1000`/`c500`/`c100` always carry `fade`=0.
Elevation labels are symbol layers along the lines from zoom 13.

Both files are optional. Without `data/imagery.json` the app falls back to
`work/imagery.dev.json`, and without either it still renders basemaps and
overlays. Without `data/terrain.json` the contour group and the hillshade
toggle disappear.

`data/reports.json`

```json
{ "as_of": "2026-09-09",
  "sources": { "<id>": { "label": "…", "url": "…", "date": "YYYY-MM-DD", "official": true } },
  "casualties": {
    "headline": { "bodies_recovered": {"value":1358,"as_of":"2026-09-08","src":"<id>"},
                  "missing": {…}, "injured": {…}, "rescued": {…} },
    "series": [ {"as_of":"…","bodies_recovered":…,"missing":…,"injured":…,"rescued":…,"src":"<id>","note":"…"} ],
    "china": {"deaths":…,"missing":…,"as_of":"…","src":"<id>","earlier":{…},"detail":"…","note":"…"},
    "foreign_nationals": {"value":…,"as_of":"…","src":"<id>","alternates":[{"label":"…","value":…,"src":"<id>"}]},
    "notes": ["…"] },
  "municipalities": [ { "name": "…", "name_ne": "…", "aliases": ["…"], "district": "…",
                        "figures": { "<metric>": {"value":…,"as_of":"…","src":"<id>","detail":"…"} },
                        "wards_official": {"text":"1, 2, 3, 5","as_of":"…","src":"<id>"},
                        "summary": {"text":"…","src":"<id>"} } ],
  "downstream_bodies": [ {"district":"…","detail":"…",
                          "series":[{"as_of":"…","value":…,"src":"<id>"}]} ],
  "district_figures": [ {"district":"…","label":"houses fully damaged","value":…,
                         "as_of":"…","src":"<id>","detail":"…"} ],
  "energy": { "summary": {"generation_offline":{…,"sub":{…}}, "under_construction":{"conflict":[…]},
                          "projects_damaged":{…}},
              "projects": [ {"name":"…","mw":…,"owner":"…","status_before":"…",
                             "damage":"destroyed|severely damaged|damaged|unaffected|not reported",
                             "what":"…","workers_missing":"…","loss":"…","src":"<id>","hdx_name":"…"} ],
              "grid": [ {"element":"…","damage":"…","detail":"…","as_of":"…","src":"<id>"} ],
              "restoration": [ {"district":"…","pct":…,"households":…,"as_of":"…","src":"<id>"} ],
              "impact": [ {"text":"…","src":"<id>"} ] },
  "communities": {
    "settlements": [ { "name":"…", "name_ne":"…", "aliases":["…"], "municipality":"…", "district":"…",
                       "road": {"status":"cut|limited|restored|planned|not_reported","detail":"…",
                                "as_of":"…","src":"<id>","unofficial":true},
                       "power": {…}, "water": {…}, "telecom": {…}, "displacement_site": {…} } ],
    "corridor": [ {"text":"…","as_of":"…","src":"<id>"} ] } }
```

`wards_official` is NDRRMA's own list of affected wards for that local level,
kept separate from the ward count the app derives by intersecting
`admin_ward.geojson` with the observed flood extent — the panel shows both,
because they answer different questions. `downstream_bodies` carries a `series`
so the district table renders one column per reporting date; a bare
`value`/`as_of`/`src` on the row still works and reads as a single column.
`district_figures` holds the numbers NDRRMA published at district level only,
which have no municipality row to sit on.

Every figure object carries `as_of` and `src`; `src` is a key into `sources`,
and `sources[id].official` decides whether the little `↗` anchor renders in the
accent blue (official) or amber (not official). Where no official figure exists
the field is `null` or absent and the panel renders "not reported" — nothing in
this file is estimated or interpolated.

`data/reports.json` is optional and is loaded once at startup alongside the
imagery catalogue (`loadReports()`). Without it the four report sections each
render a single "Reports not built" line and nothing throws.

Joins out of this file, all name-based and all tolerant of the spelling drift
documented in `data/admin/README.md`:

- `municipalities[].name` + `district` against `adm3_name` / `adm2_name` in
  `data/admin/admin_municipality.geojson`, for the click-to-zoom bbox and the
  flashed `report_hl` outline. `aliases` covers Parbati Kunda ↔ Aamachhodingmo,
  Dupcheshwar → Dupcheshwor, Meghang → Myagang and Tarkeshwar → Tarakeshwor.
- the same key against `GaPa_NaPa` in `admin_ward.geojson` for the
  flood-affected ward count (Rasuwa, Nuwakot, Dhading and Gorkha since 10 Sep
  2026; elsewhere "n/a"), and
  against `adm3_name` in `destroyed_features_osm.geojson` for the OSM-mapped
  sub-line.
- `municipalities[].wards_official.text` + `aliases`, joined the same way, to
  outline the officially-listed wards over the damage ramp — see "Administrative
  layers" below.
  `parseWardNumbers()` does the reading: that field is prose, so a number
  immediately followed by "ward(s)" is a count ("5 wards") and never a ward
  number, "Not specified" yields nothing, and values outside 1–40 are ignored.
- `energy.projects[].name` against `name` in
  `data/hdx/derived/hydropower_points.geojson`, which the build script already
  writes with the reports.json spellings, so the join is exact. `hydroKey()`
  still normalises both sides — it strips punctuation, the word "project" and
  the HEP/HPP suffixes — so a stale HDX spelling like "Upper Trishuli 3A" also
  resolves. The same join colours and labels the `hydro-point` layer. Nineteen
  of the twenty projects have a position; Upper Trishuli-2 has none and reads
  "not located".
- `communities.settlements[].name` / `aliases` against `name` in
  `data/hdx/derived/places.geojson` for the fly-to point and the Nepali name.

### Hydropower points

`data/hdx/derived/hydropower_points.geojson` is built by
`tools/build_hydropower_points.py` from two committed inputs, so it rebuilds
with no network access:

- `hot_flood_npl/hot_flood_npl_exposed_hydropowers.geojson` — HOT's 10 surveyed
  points, all `precision: exact`, `source: hdx`.
- `derived/hydropower_extra_src.geojson` — 11 hand-geocoded features, of which 9
  become plants. The second Chilime candidate (Wikidata, about 1.5 km from the
  OSM one) and the Devighat anchor (already in HDX; it existed only to place the
  adjacent solar plant) are dropped, and the Chilime alternative survives as a
  note on the OSM point.

Every output feature carries `name` (the reports.json spelling), `capacity_mw`,
`river`, `status`, `district`, `municipality`, `source`, `source_ref`,
`precision` and a display string `location`. `precision` is one of `exact`,
`approximate` or `settlement-level`, and drives both the table tag and the map
styling: anything but `exact` draws at 0.45 fill opacity inside a 2 px pale ring
rather than solid with a black one, so a village-centre pin never reads as a
survey. The popup states the location string and any caveat above the attribute
table.

`municipality` and `district` are resolved from the coordinate against
`admin_municipality.geojson`, never copied from the source: the HDX export's own
`municipality` field contradicts its `adm3_name` on several rows — Devighat is
"Panchakanya" there and Bidur in both `adm3_name` and the boundary layer.

Positions were checked against the OSM waterways export and three carry a note
about it: the Mailung Khola plant's Wikipedia coordinate sits about 8 km east of
the mapped Mailung Khola, Upper Mailung A is 1.2 km west of that channel, and
the Sanjen Khola is absent from the waterways data altogether.

`python3 tools/build_hydropower_points.py --check` reports the counts and the
reports.json cross-check without writing.

`tools/merge_bipad_reports.py` optionally tops the `municipalities` figures up
from Nepal's BIPAD incident portal (NDRRMA's official register). It takes
`--bipad <file>`, is a no-op when that file is absent, writes a BIPAD value only
where reports.json has no value for that metric unless `--overwrite` is given,
and adds a `bipad` entry to `sources` when it writes anything. `--dry-run`
prints what it would write; `--incidents-only` attaches the incident lists and
no figures.

**Nothing from BIPAD ships.** An extraction on 9 September 2026 found that the
register does not contain this event: 45 incidents across the eight corridor
districts for 26 Aug to 9 Sep, summing to 2 deaths and 15 injuries, against
NDRRMA's own 1,358 recovered and 5,326 missing; a national unfiltered scan of
the same window returns 557 incidents, so this is not a district-filter
artefact. Rasuwa, the epicentre, holds two unrelated "High Altitude" reports.
Merging those totals would attribute "1 death, 1 injured, 2 families affected"
to Gosaikunda, where NDRRMA reports 3,702 households isolated — a real BIPAD
number about a different hazard. The script is kept, and tested against the real
file shape, for the day the register is backfilled.

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
- **Waterways of Nepal.** `data/hdx/tiles/hotosm_npl_waterways/{z}/{x}/{y}.pbf`, z8–13,
  one source-layer `waterways` with `name`, `waterway`, `natural_class`, `water`
  and `width`. Built from the national HDX `hotosm_npl_waterways` export by
  `tools/build_waterways_tiles.sh`, clipped to Rasuwa, Nuwakot, Dhading and
  Gorkha districts; not part of the two HOT flood datasets, so it ignores the
  Extent switch.
- **Highways and main roads.** `data/hdx/tiles/hotosm_npl_roads/{z}/{x}/{y}.pbf`, z7–13,
  source-layer `roads` (`highway`, `name`, `name_en`, `name_latin`, `surface`,
  `bridge`; the export has no `ref`), motorway/trunk/primary/secondary/tertiary
  plus unclassified ways named Highway/Rajmarg/Lokmarg/Rajpath. Built from the
  national HDX `hotosm_npl_roads` export by `tools/build_roads_tiles.sh`, which
  downloads the 220 MB GeoPackage into `work/`, clipped to Rasuwa, Nuwakot,
  Dhading and Gorkha districts. Shows the approach roads beyond
  the 1 km corridor, drawn *under* the HOT roads with the same casing and
  widths (tapered below z14), trunk/primary yellow and the rest white; highways
  and anything named "Highway" are labelled by name from a symbol layer placed
  above the HOT layers. HOT roads themselves are white, yellow for trunk/primary
  and red where `status` is damaged or destroyed; like every HOT / Overture
  category they start off (owner direction, 7 Sep 2026).
- **Place names.** `data/hdx/derived/places.geojson`, settlement points from
  OpenStreetMap via the Overpass API (city/town/village/hamlet/suburb nodes in
  the map window) with a featured list that fixes tier and spelling for the
  corridor towns and district HQs, plus named HDX residential areas and GeoNames
  gazetteer localities (CC BY 4.0) along the river where OSM has no place node;
  built by `tools/build_places.py`. Fields `name`, `name_ne`, `tier`, `rank`,
  `featured`, `source`, `geonames_id`. Rendered as a basemap toggle (`pn=0` in
  the hash hides it), five symbol layers by rank (localities from z14).
- **Glacier collapse origin and upstream AOI.** `data/hdx/derived/collapse_origin.geojson`
  (detachment zone polygon, its centroid as the origin point, two barrier lakes)
  and `data/hdx/derived/aoi_upstream_extension.geojson` (UNOSAT flood extent
  buffered 200 m for the Lende Khola beyond HOT's AOI), both from the UNOSAT
  FL20260826NPL geodatabase via `tools/build_collapse_origin.py`. The upstream
  outline is drawn dotted with the HOT AOI outline. `CFG.HOME` was widened to
  85.62 E / 28.40 N so the pan limit reaches the glacier.
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

The left rail runs: title and intro, the reports "as of" strip, search, Zoom to,
**Casualties** (open by default), **Municipality reports**, **Hydropower &
grid**, **Communities affected**, bridge ground reports, legend, Sources &
notes, then imagery metadata. The four report sections are built from
`data/reports.json`; the first renders eagerly, the other three on first open.

Search, bridge reports and the municipality report section read the GeoJSON in `data/hdx/`
directly, cached in `gjCache`, loaded lazily: search on first focus of the box,
the others on first open of their `<details>`. All fail soft — a missing file
leaves a short note in place of the panel. The destroyed-feature counts keep
feature centroids in memory and recount what is in the viewport on `moveend`
with a bbox test.

## How the two maps work

`#mapPre` and `#mapPost` are two full-size MapLibre instances stacked in
`#stage`. Every layer definition is built once and handed to both, so overlays
stay pixel-aligned across the divider; only the imagery stack differs.

Movement is kept in step by a two-way `move` handler with a re-entrancy guard,
which `jumpTo`s the other map. The divider is a `clip-path: inset(0 0 0 N%)` on
the post map's **canvas container** — not on `#mapPost` itself, so the map
controls stay visible in Before-only mode. `clip-path` also clips hit testing,
which is what routes clicks on the left half through to the pre map;
`#mapPost { pointer-events: none }` stops the unclipped wrapper from swallowing
them.

Layer order, bottom to top: basemap, imagery, hillshade, contours, HOT
overlays, search pin and selected-scene outline. Every selected scene gets its
own raster source and layer, both named `imagery:<layer id>`, inserted with
`addLayer(def, IMAGERY_BEFORE)` where `IMAGERY_BEFORE` is the first
hillshade/contour/HOT layer.

Each side can carry any number of scenes at once. Within the imagery stack the
order is by ground sample distance, **coarsest at the bottom and finest on top**
(`selectedLayers()` sorts by `gsd_m` descending, ties in catalogue order, a
missing `gsd_m` counted as finest), so a 0.4 m frame reads over the 10 m scene it
sits inside. `applyImagery(side)` reconciles rather than rebuilds: it removes
only the layers and sources of scenes that were unticked, adds the new ones at
the right insertion point and calls `moveLayer` only when the survivors are
genuinely out of order, so ticking a second scene never reloads the first one's
tiles. Only the selected scenes exist as sources at any time. Overlays that are
off are `visibility: none`, never removed, so toggling them costs nothing.

## Controls

Scenes are chosen from two tags in the top corners of the stage, green on the
left for the before side and amber on the right for the after side. Each is a
button plus a pop-up menu: a "None, basemap only" item, then that side's scenes
as **checkbox rows** grouped by coverage, then a "View" group holding
"<side> only" and "Compare (swipe)". Any number of rows can be ticked, so a side
holds an ordered set of scene ids rather than one; the menu stays open while
rows are ticked and closes on Escape, an outside click or a view choice. The
button reads the single scene's `label` when one is on, "N scenes" when several
and "None, basemap only" when none. Row text is the catalogue `label` field,
falling back to date/sensor/GSD for an entry without one.

Choosing None empties that side's set, adds no imagery source for it and takes
the basemap (Esri World Imagery by default, `b=` in the hash) on that map to
full opacity; it is carried in the hash as `pre=none` / `post=none`. The two
sides are independent, so one can show three scenes while the other shows the
basemap. Picking a view option changes the mode rather than the selection;
`refreshTags()` is the single place that re-reads state into both tags, re-ticks
the boxes, ticks the active view option and puts the white outline on whichever
side is shown alone. The mode buttons in the sidebar and the tags both route
through `setMode()`, so they can never disagree.

The sidebar has no scene selectors — that would be two controls for one piece of
state. It shows one metadata block per selected scene instead (label, date,
sensor, provider, GSD, coverage, size, licence and that scene's `CFG.SCENES`
note), in stacking order, refreshed by `updateMeta()`.

There are two rails. `#panel` on the left holds information: the title, search,
zoom-to chips, bridge ground reports, damage table, legend, notes and, at the
bottom, imagery metadata for the selected scenes. `#controls` on the right holds
everything that changes what the map shows: basemap (with hillshade and
contours) and the overlay groups. Scenes are still chosen with the tags at
the top of the map, so the left rail describes them without controlling them. Both
collapse on desktop as well as mobile, by the same mechanism: the rail slides
out on `transform` and `#stage` reflows its `left` or `right`. On mobile an
open rail floats over the stage instead of pushing it. State lives in
`localStorage` under `nf26.sidebar` and `nf26.controls`, with the hash taking
precedence when it carries `sb` or `sc`. Maps are resized after the CSS
transition finishes.

### Right rail layout

Restructured on 10 Sep 2026 (owner direction: "overhaul the right ui and make it
much more user friendly"). Basemap is two rows — a segmented control for the base
image (OpenStreetMap / Esri imagery / None) and a row of toggle chips for
hillshade, contours and place names. The chips are real checkboxes inside styled
`<label>`s, so they keep checkbox semantics and the same `hs` / `ct` / `pn` state
and hash keys; hillshade and contours still render disabled and marked
"(not built)" when `data/terrain.json` has no such layer.

Overlays then run in this order, each an ordinary `<details>`:

| Group | `gid` | Open | Rows |
| --- | --- | --- | --- |
| Administrative boundaries | `admin` | yes | 2 |
| Flood & damage | `flood` | yes | 10 |
| Infrastructure & rivers | `infra` | yes | 3 |
| Mapped features, HOT / OpenStreetMap | `hot` | no | 8 |
| Overture Maps, pre-flood | `overture` | no | 3 |

The order is applied by sorting `groups` against `GROUP_ORDER` at the end of
`buildDefs()`, not by moving the `groups.push()` calls: those calls are
interleaved with the `push()` calls that build the style layer array, and *that*
order is the map's draw order. Sidebar order is cosmetic; layer order is not.

Each group header carries its title, a count badge and a compact `all` / `none`
pair inside the `<summary>` itself (a click on those cancels the summary's own
activation so the group does not open and close under the pointer). Rows are a
checkbox, a colour swatch, a label that wraps rather than truncating, an optional
muted sub-caption where the shortened label dropped something worth keeping, and
a right-aligned tabular count. Full provenance lives in each row's `title`
tooltip and in the Sources & notes drawer.

"Infrastructure & rivers" was split out of the flood group in the same pass and
holds hydropower, the national highways and the waterways: context, not damage.
No entry key, default or hash token changed, so `ov=` links written before the
split resolve identically.

### Administrative layers

Rewritten 10 Sep 2026 (owner direction). There is **no province layer** — no
source, no style layers, no overlay key; the event touches three districts, so a
province outline said nothing. Old `ov=` links carrying `+admin_province` or
`-admin_district` load without them: `applyOverlayDiff()` names both keys and
skips them.

The **district outline** is a fixed reference layer rather than a toggle: bright
green `#4ade80`, drawn on both maps at all times, filtered to
`adm2_name in ['Rasuwa', 'Nuwakot', 'Dhading', 'Gorkha']` (COD-AB v02 spellings). It has no
row and no `ENTRY` key, so nothing can switch it off; it reaches the group
opacity slider through the group's `fixed` list, which `opacityGroupIds()`
collects alongside the entry ids, and `admin_district-line` is excluded from
`QUERY_IDS` so an always-on line does not win popups from the damage features
under it. Municipality stays an ordinary toggle, off by default.

It is also the **last** admin level pushed, so it draws over the municipality
outline, the ward outlines and the ward damage fill. The three levels share long
stretches of border, and whichever is pushed last wins those pixels; before
10 Sep 2026 the district went in first and the ward outlines broke it up
(owner direction: "still district boundary gets hidden, maybe make it appear on
top of the municipality and ward boundary").

Its weight was raised in the same pass ("make the district boundary more
apparent ... so it's easier to view and not disappear"). The flat
1.5 px became a zoom ramp — 2.2 px at z6, 3.2 at z10, 4.2 at z14 — at full
opacity, over a new `admin_district-casing` line in `rgba(8,12,18,.5)` 2.6 px
wider, so the outline holds up over the light OSM basemap, dark imagery and the
ward damage ramp alike. Both widths come from one `districtWidth(delta)` helper
and so cannot drift apart. `adminLayers()` gained a `casing` option that emits
the layer *before* the line; `-casing` ids are already filtered out of
`QUERY_IDS`, so it never wins a click, and the casing id is listed in the
group's `fixed` entry so the opacity slider still reaches it.

**Ward coverage.** `data/admin/admin_ward.geojson` was extended on 10 Sep 2026
from Rasuwa and Nuwakot to all four corridor districts — 315 wards, of which 108
fall inside the fourteen local levels the flood extent touches and are therefore
drawn. `tools/build_admin_ward.py` is the reproducible build: it pulls the 2018
HRRP ward shapefile from HDX into `work/hrrp_wards/`, reprojects to WGS84,
simplifies at 0.0003° with coordinates at 6 dp (the parameters that reproduce the
earlier 117 polygons vertex for vertex), and joins `flood_affected` plus the
`dmg_*` counts. `WARD_MUNI_FILTER` lists the 2018 HRRP `GaPa_NaPa` spellings,
four of which differ from the COD-AB names in `EXTENT_MUNIS`: Parbati Kunda =
Aamachhodingmo, Tarkeshwar = Tarakeshwor, Galchi = Galchhi, Sahid Lakhan =
Shahid Lakhan.

The **ward fill is a transparent-to-brown damage ramp** (owner direction, 10 Sep 2026),
replacing the two flat tiers. `build_admin_ward.py` spatially joins the HOT
corridor layer `destroyed_features_osm.geojson` (4,430 features) to each ward —
points by containment, lines and polygons by intersection, each feature counted
once per ward it touches — and writes `dmg_destroyed`, `dmg_damaged`, `dmg_total`
and `dmg_fair` (fAIr buildings classed destroyed or major-damage) onto every ward.
`WARD_PAINT` interpolates linearly on `dmg_total` for both colour and opacity,
from one `WARD_RAMP` table of `[value, colour, opacity]` stops:

| `dmg_total` | Colour | Opacity |
| --- | --- | --- |
| 0 | `#eeddc4` | 0 (no fill) |
| 5 | `#e6c9a0` | 0.18 |
| 40 (p50) | `#d9a066` | 0.42 |
| 340 (p85) | `#a0522d` | 0.6 |
| 534 (max) | `#5c2e0e` | 0.7 |

Opacity carries the low end rather than colour (owner direction, 10 Sep 2026:
"make the less affected wards transparent instead of white"). The first cut ran
from near-white, which read as a white haze over the basemap on wards that had
barely been touched; a ward with nothing mapped in it now takes no fill at all
and the ramp stays in the brown family throughout. The 5-feature stop is what
keeps a lightly-hit ward from vanishing along with the empty ones. The value
breakpoints are quantiles of `dmg_total` over the 35 wards that carry any mapped
damage, printed by `python3 tools/build_admin_ward.py --dry-run`; recheck them
after an HDX refresh. `applyGroupOpacity()` scales the opacity expression as
`['*', base, k]`, the same path the roads' case expression takes. **The ramp is mapped damage, not casualties** — no
official source publishes casualty figures at ward level, NDRRMA reports bodies
recovered by district — so a deep-brown ward is one volunteers have mapped
heavily, which is not the same as the worst hit.

The NDRRMA tier survives as an **outline**, not a second fill colour, so it stays
legible over the ramp. `ndrrmaWardKeys()` reads `municipalities[*].wards_official`
out of `data/reports.json` (NDRRMA SitRep 01, 1 Sep 2026), expands each local
level's names and aliases — plus the `HRRP_ALIAS` table, which bridges the two
Dhading/Gorkha spellings `reports.json` does not carry itself (Galchhi → Galchi,
Shahid Lakhan → Sahid Lakhan), since that file is hand-maintained — and returns
`"<name>|<ward number>"` keys; `buildDefs()`
turns that into an `in` expression against a lower-cased `GaPa_NaPa|NEW_WARD_N`
key and feeds it to a `case` on `admin_ward-line`'s colour, width and opacity
(`#7c2d12` at 1.6 px against the ordinary `#86efac` at 1.1 px), via the new
`linePaint` option on `adminLayers()`. The same expression floors the ramp input
at the first visible stop (5) for an NDRRMA ward with no mapped damage, so the
official tier never reads as "nothing here" now that zero means no fill — five
are in that position (Galchi 2, Tarkeshwar 6, Uttargaya 2/3/4).
Twenty-four of the 108 drawn wards carry the outline: 11 Rasuwa, 8 Nuwakot,
5 Dhading; Gorkha has none, as SitRep 01 lists no wards there.

The fill filter is still the **union** of the two tests, not `flood_affected = 1`:
two NDRRMA-listed wards (Uttargaya 3, Tarkeshwar 6) do not intersect the mapped
extent, because the situation report counts isolation and road closure as well as
inundation. `reports.json` is optional, so with no list the ramp stands alone and
the outline falls back to the ordinary green. Fill and outline are data-driven
expressions, which the group opacity slider scales as `['*', base, k]` like any
other expression base. The rail row and the legend both show the ramp as a
horizontal gradient swatch (`.sw.ramp` in `app/style.css`), its gradient built
inline from `WARD_RAMP` so the two cannot drift apart.

`buildDefs()` runs after the `Promise.all` in `main()` that awaits
`loadReports()`, so the tier can be baked into the style at build time and needs
no patching once the maps exist.

### Group opacity

The "Flood & damage" and "Infrastructure & rivers" groups carry a master opacity
slider, one compact row under the group header, so the whole damage and
ground-report stack can be faded back to read the imagery through it without
unticking thirteen rows. Administrative boundaries carry their own, independent
one. `OV_BASE` snapshots every layer's own opacity as `buildDefs()`
writes it, and `applyOverlayOpacity()` sets `base * slider` on both maps, so a
0.35 fill stays a wash under a 1.0 outline instead of the two flattening
together. A data-driven base (the roads' damaged/undamaged case expression) is
scaled inside the expression as `['*', base, k]`; at 100% the original value
goes back verbatim, so nothing is left wrapped. A group is marked
`opacity: true` in its `groups.push()` entry, and the two `hot` rows in the flood
group — destroyed features and the AOI outline — have their layer ids resolved
the same way `applyHot()` resolves them. The value lives in `localStorage` under
`nf26.ov_opacity` and in the hash as `oo=<percent>`, omitted at 100%.

**Opacity-key decision.** "Flood & damage" and "Infrastructure & rivers"
deliberately share `opacityKey: 'flood'` rather than the new group taking a key
of its own, so `oo=` and `nf26.ov_opacity` still fade exactly the set of style
layers they faded when the two were one group — an old link fades an old link's
worth of map, and no new hash key was added. `opacityGroupIds()` therefore
collects every group carrying the key (a filter, not a find), both groups show a
slider bound to the one `state.ovOpacity`, and `syncGroupOpacityUI()` keeps the
two sliders reading the same number when either is moved.

### Local editing tools

Two owner-only tools live at the bottom of the right rail. Neither talks to a
server and neither writes a committed file; both keep their working state in
`localStorage` and export it for you to commit by hand.

The **Damage editor** (`#dmgEd`, `EDIT_KEY = nf26.damage_edits`) is hidden
from the right rail by default since 10 Sep 2026 (owner direction: the
volunteer edits are done); `?edit=1` or `?tools=1` shows it. The editor is
still constructed so its keyboard handlers and working-copy layer keep working;
only the sidebar block is withheld. It builds an analyst's own damage layer: pick an OSM or Overture building footprint off the
map or draw a polygon freehand, grade it Destroyed / Damaged / Possibly damaged,
and export the lot as GeoJSON. The working copy is layered over the committed
file at `CFG.DAMAGE_EDITS_URL` by feature id; a 404 there just means nothing has
been published yet. While a mode is on, `editorActive()` gates the normal
feature popups so a click records an edit instead of opening one.

A selected footprint can also be moved and reshaped, in Pick mode rather than a
mode of its own: a Reshape mode would need a second way of choosing a feature
and Pick already has one, so the gestures simply attach to whatever is selected.
One polygon selected puts an amber handle on every ring vertex and a smaller
blue one at every edge midpoint, styled and hit-tested like Image align's grab
points; dragging a vertex moves it, dragging a midpoint turns it into a real
vertex and carries it, and a double-click or Alt-click drops one, refusing to
leave a ring with fewer than three. A GeoJSON ring repeats its first point last,
so the closing copy follows its twin, and a MultiPolygon is handled ring by
ring. Dragging inside the shape instead of on a handle translates it, and with
several features selected there are no handles and a drag inside any of them
moves the whole set. The arrow keys nudge the selection by one screen pixel, ten
with Shift; both tools want those keys, and the damage editor takes them while
it is on and holding a selection, because that is the more specific state. All
of it runs on screen-pixel deltas through `project`/`unproject`, so a shape
stays rigid under a drag and a nudge means the same distance at any zoom, and
`dragPan` stands down for the duration so the map does not slide with it. A
feature already in the collection keeps its new shape the moment the drag ends —
`refreshEdits()` writes the working copy to `localStorage` exactly as a status
change does, which is also how an edited baseline feature becomes a local
override — while a candidate that has not been saved yet carries its geometry to
Save. Each completed gesture pushes onto a 50-deep geometry undo stack, and a
run of arrow presses coalesces into one step; **Undo geometry** in the panel
walks it back.

**Image align** (`#imgAl`, `IMGALIGN_KEY = nf26.imgalign`) hand-fits an
ungeoreferenced photograph over the imagery. It is a fitting aid rather than
part of the published map, and since 10 Sep 2026 it is hidden by default
(owner direction); `?align=1` or `?tools=1` builds it. Without the flag the
section is not built and the overlay never draws, since there would be no
control to turn it off. A saved fit in
`localStorage` is left alone either way, so the tool comes back exactly as it
was left. It adds a MapLibre `image` source
to both maps at `IMAGERY_BEFORE`, just above the whole imagery stack, so the photo can be checked against
either side of the divider and against the basemap, and `setCoordinates()`
pushes every change straight to the GPU. Turning the tool on takes the pointer
from the damage editor and the popups. It can carry a warp mesh: at 1x1 the photo is one
`image` source over four corners, and at a denser setting each cell becomes its
own `image` source over its own four vertices, sliced out of the file in a
canvas at load time and handed over as a data URL. A single `image` source
takes four corners and no more, so cells are the only way to bend the middle of
a photo. Adjacent cells share vertices, so the sheet stays joined; a flat 4x6
mesh reassembles to within 9 pixels of the plain quad. Dragging one vertex moves
only the cells touching it, which is what lets a canal or a road bend be fitted
without disturbing the rest. Changing the density resamples the current mesh
bilinearly, so the fit already dialled in survives; Flatten pulls the interior
back onto the outer quad without moving the corners.

In Move mode a drag inside the
quadrilateral translates it and a shift-drag rotates it about its centre. In
Stretch mode a 1x1 mesh is a transform box of eight grab points: four amber corner
handles that drag independently, and four smaller blue handles at the edge
midpoints that carry both of that side's corners, so a side can be pushed in or
out while the opposite one stays put. Between them the quad can be stretched or
skewed into any shape an `image` source accepts. Both kinds move by the pointer
delta rather than snapping to the cursor, so grabbing a handle off-centre does
not jolt the photo, and a corner wins a hit test against an edge handle
crowding it once the quad is dragged small. Buttons give 0.5 degrees of
rotation, 1% of uniform scale and 1% of stretch along the image's own width and
height axes, and the arrow keys nudge by one screen pixel, ten with Shift. All
of the geometry runs in Web Mercator metres rather than degrees, so a rotation
stays rigid instead of shearing with latitude. Undo walks back an 80-deep
snapshot stack and Reset returns to the automatic fit the layer was built from.
The read-only box shows the current corners in image order — top-left,
top-right, bottom-right, bottom-left — and Copy or Download hands them over as
`drone_align.json` for the retile pipeline. A denser mesh also exports
`mesh.grid`, its vertices row-major from the top-left, each one a ground control
point at image pixel (ix/nx x width, iy/ny x height) - the input a thin-plate-spline
rewarp needs. It was added to correct
`post_drone_trisuli_202609`, whose source photograph sits at
`work/drone_trisuli/photo_clean.png`, but the image URL field takes any path the
dev server serves.

## URL state

Everything lives in the hash, written with `replaceState` on every change:

```
#m=swipe&pre=<id>,<id>&post=<id>,<id>&c=<lng>,<lat>&z=<zoom>&s=<swipe %>&b=osm&hs=1&ct=0&pn=0&cb=status&sb=0&sc=0&hx=corridor&oo=45&ov=+key,-key
```

`pre` and `post` are **comma-separated lists** of catalogue layer ids, in the
order the scenes were ticked, or the literal `none` for a side showing only the
basemap. A single id — every link written before September 2026 — parses as a
one-element list, so old links keep working; ids that are no longer in the
catalogue are dropped. Both keys are always written. A side the hash says
nothing about is seeded from `default_<side>` in `data/imagery.json`, which
stays a single id. Commas are written verbatim rather than percent-encoded.

`ov` is a **diff against the default overlay set**, not the full list, which
keeps the URL short. `+key` turns one on, `-key` turns one off. `hx` is the
HOT category list's extent switch (`flood` | `corridor`), omitted at its default.
`oo` is the damage group's opacity as a percentage, omitted at 100 and taking
precedence over the `nf26.ov_opacity` fallback the same way `sb` and `sc` do.
OSM categories are keyed `hot_<cat>` and Overture ones `ovt_<cat>`; the two are
separate overlay groups. Entry keys and defaults survived the 10 Sep 2026 rail
reorder untouched — moving a row between groups changes neither — so every `ov=`
link written before it still resolves to the same layers. Older links carrying `ho=overture` (from when source
was a switch) are read and their `hot_` keys remapped to `ovt_`.

## Keyboard

Arrows pan (hold shift for a larger step) — or nudge the photo when the Image
align tool is on — `+`/`-` zoom, `[` and `]` move the
divider, `B` hides and shows the left info panel, `C` the right layer-controls rail. In the search box, up and down move
through results, Enter flies to one and Escape clears. MapLibre's own keyboard handler is
disabled on both maps so the two never disagree.

## Adding an imagery layer

1. Produce `tiles/<id>/{z}/{x}/{y}.webp`.
2. Append an entry to `data/imagery.json` following the contract above. The
   `coverage` value groups it in the corner tag; add a new one and it will appear
   as its own heading, labelled by `CFG.COVERAGE_LABEL` (add a label there for a
   readable name). `gsd_m` decides where the scene sits in the imagery stack when
   several are on at once.
3. Add a paragraph to `SCENES` in `app/config.js` keyed by the same id. It shows
   as the menu row's tooltip, in the sidebar metadata block while the scene is
   selected, and in the "Sources & notes" drawer. Without it the drawer falls
   back to the entry's `attribution`.

No other change is needed — the corner tags, sidebar metadata, selected-scene
footprint outlines (one per selected scene, drawn as the union) and notes list
are all generated from the catalogue.

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

## Imagery watch

`tools/imagery_watch.py` runs every 6 hours from a launchd agent
(`~/Library/LaunchAgents/com.rajat.nepal-flood-imagery-watch.plist`, owner's
Mac only). It scans the Vantor open-data event collection, Earth Search
(Sentinel-2 L2A), the Planetary Computer (Sentinel-1 RTC) and OpenAerialMap for
scenes over the corridor, posts a macOS notification for anything new, and
auto-builds the ones that pass the quality gates: Sentinel-2 with a corridor
tile at ≤ 40 % cloud (`build_s2_tiles.sh`, z8–14) and Vantor scenes at ≤ 50 %
cloud and ≤ 35° off-nadir over a focus box (`build_cog_tiles.sh`, z10–17, the
map being locked at z17.5). Sentinel-1 and OpenAerialMap are notify-only. A
successful build appends a layer to `data/imagery.json` (marked
`added_by: imagery_watch`), commits only that layer's tiles plus the catalogue,
and pushes to `main` if local main is a fast-forward of origin; otherwise it
notifies and leaves the commit local. The first run only records what already
exists. State and logs: `work/imagery_watch/`. Stop it with
`launchctl bootout gui/$(id -u)/com.rajat.nepal-flood-imagery-watch`; dry run
with `python3 tools/imagery_watch.py --dry-run`.

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
