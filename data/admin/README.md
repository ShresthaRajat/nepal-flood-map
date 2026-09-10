# Administrative boundaries (province / district / municipality / ward)

Reference layers for government coordination, toggled in the "Administrative boundaries"
sidebar group. All four files are clipped to roughly the map's maximum pan extent
(83.3-86.8°E, 26.7-29.5°N — the whole-corridor bounds in `app/config.js` PLACES.corridor
plus the 100 km pan margin added in `app/app.js` `makeMap()`, with a little more slack)
and simplified for basemap display, not survey use. Coordinates rounded to 6 decimal
places (~0.1 m).

## admin_province.geojson, admin_district.geojson, admin_municipality.geojson

- **Source:** OCHA Common Operational Dataset - Administrative Boundaries, Nepal
  (HDX dataset `cod-ab-npl`, "Nepal - Subnational Administrative Boundaries"),
  version v02, valid_on 2024-03-14. Downloaded 8 Sep 2026 from
  https://data.humdata.org/dataset/cod-ab-npl (`npl_admin_boundaries.geojson.zip`,
  layers `npl_admin1`/`npl_admin2`/`npl_admin3`).
- **Original source:** Survey Department of Nepal / UN Resident Coordinator's Office
  in Nepal.
- **License:** CC BY-IGO (Creative Commons Attribution for Intergovernmental
  Organisations) — http://creativecommons.org/licenses/by/3.0/igo/legalcode.
- **Levels:** admin1 = province (7 nationally, 6 kept after the bbox clip),
  admin2 = district (77 nationally, 42 kept), admin3 = municipality / local level
  ("Nagarpalika"/"Gaupalika", 753 nationally, 399 kept).
- **Currency:** this is the current (2024) federal structure — reflects any
  municipality mergers/renamings since 2017, unlike the ward file below.

## admin_ward.geojson

- **Source:** "Administrative Boundaries of Nepal" (HDX dataset
  `administrative-boundaries-of-nepal`), resource `Ward_Boundary_31_Districts.rar`,
  published by the Housing Recovery and Reconstruction Platform (HRRP) Nepal,
  last modified 2018-04-05. Downloaded 8 Sep 2026 from
  https://data.humdata.org/dataset/administrative-boundaries-of-nepal.
- **License:** CC0 / Public Domain.
- **Coverage:** originally the 31 districts affected by the 2015 Gorkha
  earthquake (2,594 wards); filtered here to the four districts the flood
  corridor runs through — Rasuwa (27), Nuwakot (90), Dhading (104) and Gorkha
  (94), **315 wards**. Extended from Rasuwa + Nuwakot (117) to all four on
  10 Sep 2026 on owner direction; the 117 original polygons are unchanged,
  vertex for vertex.
- **Field mapping:** `DISTRICT`, `GaPa_NaPa`, `Type_GN` and `NEW_WARD_N` come
  straight from the shapefile. The shapefile has no `WardCode` column — it is
  derived as `DAN + GaPa_NaPa + NEW_WARD_N` (`DAN` is the title-case district
  name, e.g. `"RasuwaParbati Kunda5"`). Every other source column (`OBJECTID`,
  `DCODE`, `DAS`, `OLD_VDCs`, `GN_CODE`, `DDGNWW`, `CENTER`, `TOT_POP1`,
  `31Dist`, `14Dist`) is dropped.
- **Caveat — data vintage:** this is the only ward-level (admin4) boundary set
  found on HDX for Nepal; there is no current nationally-maintained COD-AB ward
  layer. It reflects the 2017 federal restructuring (new Gaunpalika/Nagarpalika
  ward numbering) as captured in 2018 and has not been revisited since — treat
  ward shapes and numbers as approximate/reference-only, not authoritative,
  and cross-check against current local-government sources before using for
  anything beyond visual orientation.
- Reprojected from the source shapefile's "Nepal_MUTM_Central_84_Everest_1830"
  CRS to WGS84 (EPSG:4326) with GDAL, simplified at a tolerance of **0.0003°**
  (~33 m at this latitude) and written with `COORDINATE_PRECISION=6`. Those are
  the parameters that reproduce the hand-built 8 Sep file exactly — all 117
  Rasuwa/Nuwakot polygons came back geometry-identical when
  `tools/build_admin_ward.py` was checked against it before being committed.
  No bbox clip is applied: all four districts sit well inside the map's pan
  extent, so a clip would change nothing.
- **`flood_affected` field:** 1 for the 57 (of 315) ward polygons that intersect
  the observed flood extent (`data/hdx/hot_flood_npl/hot_flood_npl_flood_extent.geojson`,
  the same "Flood extent, observed 27 Aug 2026" polygon used elsewhere in the app),
  0 otherwise. Computed with GDAL/OGR `Intersects()` against the already-clipped/
  simplified ward geometry (not the original survey-precision shapefile), so it is
  a basemap-scale approximation, not a precise cadastral join. Per district:
  Rasuwa 14, Nuwakot 17, Dhading 19, Gorkha 7. It is the fill *filter* in
  `app/app.js` (`adminLayers('ward', ..., fillFilter)`), unioned with the NDRRMA
  list; the ordinary dashed green ward outline still applies to every drawn ward
  regardless.
- **`dmg_destroyed` / `dmg_damaged` / `dmg_total` fields:** counts of features
  with `status` `Destroyed` / `Damaged` in
  `data/hdx/hot_flood_npl_corridor/destroyed_features_osm.geojson` (the corridor
  cut, 4,430 features — the wider of the two HOT destroyed-feature layers) that
  fall in the ward. Points are counted by containment, lines and polygons by
  intersection; a feature spanning several wards counts once in each and never
  twice in the same one. `dmg_total` is the sum of the two, and drives the
  transparent-to-brown fill ramp. 35 wards carry any damage at all; the distribution
  over those is min 1, p50 41, p85 344, max 534, which is where the ramp's
  40 / 340 / 534 breakpoints come from (a 5-feature stop below them keeps a
  lightly-hit ward visible). Gorkha's wards all score 0 — the HOT
  corridor layer records no destroyed or damaged feature in Gandaki or Sahid
  Lakhan — so those wards take no fill at all, only the ward outline.
- **`dmg_fair` field:** the same join against
  `data/hdx/hot_flood_npl_buildings_damage/hot_flood_npl_buildings_damage.geojson`,
  counting only buildings the fAIr model classed `destroyed` or `major-damage`
  (782 of 1,053). Not styled at present; carried for reference and for popups.
- **No casualty field.** No official source publishes casualties at ward level —
  NDRRMA reports bodies recovered by district — so the map's ramp reflects mapped
  damage only. Do not add one by inference.
- A `severity` field (`"severe"`/`"affected"`) briefly existed here for a two-tier
  pink/orange-affected split; it was dropped on owner direction in favour of a
  single orange tier for every flood-affected ward, and stripped from the file.
  See the commit that added it ("ward layer: pink tier for severely hit wards")
  and the one that reverted it ("ward layer: fill all flood-touching wards orange")
  if that method is ever wanted again.

## Regenerating

`admin_ward.geojson` has a script: **`tools/build_admin_ward.py`**. It downloads
and unpacks the HRRP `.rar` into `work/hrrp_wards/` if it is not already there
(needs `unar`), runs the `ogr2ogr` extraction described above, recomputes
`flood_affected` and the `dmg_*` counts, and rewrites the file. Requires GDAL
with the Python `osgeo` bindings.

```
python3 tools/build_admin_ward.py --dry-run   # print the per-district and damage stats
python3 tools/build_admin_ward.py             # rebuild data/admin/admin_ward.geojson
```

Re-run it after an HDX refresh moves the flood extent or the destroyed-feature
counts, then recheck the ramp breakpoints in `app/app.js` (`WARD_RAMP`) against
the quantiles the script prints.

The province / district / municipality files have no script yet; these were produced with
one-off `ogr2ogr`/GDAL-Python commands (`-clipsrc`/`-simplify`/`-t_srs`/`-where`/
`-lco COORDINATE_PRECISION=6`, plus a small script computing `flood_affected` via
`ogr.Geometry.Intersects()`) run directly against the downloaded HDX sources. If a
future refresh needs the exact commands, see the commit that added this directory
("add district/province/municipality/ward boundary toggle layers") and the one
that added `flood_affected` ("highlight only the flood-affected wards").
