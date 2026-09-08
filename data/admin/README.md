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
  earthquake; filtered here to Rasuwa and Nuwakot only (the two districts the
  flood corridor runs through), 117 wards.
- **Caveat — data vintage:** this is the only ward-level (admin4) boundary set
  found on HDX for Nepal; there is no current nationally-maintained COD-AB ward
  layer. It reflects the 2017 federal restructuring (new Gaunpalika/Nagarpalika
  ward numbering) as captured in 2018 and has not been revisited since — treat
  ward shapes and numbers as approximate/reference-only, not authoritative,
  and cross-check against current local-government sources before using for
  anything beyond visual orientation.
- Reprojected from the source shapefile's "Nepal_MUTM_Central_84_Everest_1830"
  CRS to WGS84 (EPSG:4326) with GDAL.
- **`flood_affected` field:** 1 for the 31 (of 117) ward polygons that intersect
  the observed flood extent (`data/hdx/hot_flood_npl/hot_flood_npl_flood_extent.geojson`,
  the same "Flood extent, observed 27 Aug 2026" polygon used elsewhere in the app),
  0 otherwise. Computed with GDAL/OGR `Intersects()` against the already-clipped/
  simplified ward geometry (not the original survey-precision shapefile), so it is
  a basemap-scale approximation, not a precise cadastral join. Drives the ward
  layer's green fill in `app/app.js` (`adminLayers('ward', ..., fillFilter)`).
- **`severity` field** (`"severe"` | `"affected"` | absent/null): a second, higher
  tier drawn in pink above the green, for wards that were severely hit rather than
  merely touched by the flood.

  **Method.** Per-ward count of HOT-recorded destroyed buildings (`status: Destroyed`,
  `feature_type: building`/`building part`, from the wider corridor dataset
  `data/hdx/hot_flood_npl_corridor/destroyed_features_osm.geojson`, point/centroid-in-ward).
  Across the 117 wards this count has a clean natural break: 8 wards have 84-415
  destroyed buildings, the next-highest ward has 33 (more than a 2.5x drop). Threshold:
  **>= 80 destroyed buildings**. Other signals considered but not needed for the final
  rule, since the building-count break already lined up cleanly with the named
  hard-hit settlements: bridge ground reports (`data/hdx/hot_flood_npl/hot_flood_npl_bridge_damage.geojson`,
  `status: Washed out`), Copernicus EMS road grading length per ward
  (`data/hdx/derived/ems_road_grading.geojson`, `grade: Destroyed`/`Damaged`, geometry
  intersection length in UTM 45N), and the analyst's locally edited damage collection
  (`data/edits/damage_edits.geojson`, `status: destroyed`).

  **Owner-directed additions.** Two of the named hard-hit settlements sit in wards the
  building-count rule does not flag — Bidur/Battar (ward Bidur/4: 0 destroyed buildings
  recorded, but 2.20 km of EMS-graded destroyed road) and Mailung (ward Uttargaya/1: 0
  destroyed buildings recorded, but 5 "Washed out" bridge ground reports). Both were
  added to the severe tier on owner direction rather than by the threshold, since the
  underlying OSM/EMS damage recording is evidently incomplete there, not because the
  wards were less affected.

  **Result — 10 severe wards** (district/municipality/ward number, destroyed-building
  count, notable settlement):
  | Ward | Destroyed buildings | Notable place |
  |---|---:|---|
  | RASUWA/Gosaikunda/2 | 415 | Timure, Rasuwagadhi |
  | NUWAKOT/Bidur/10 | 245 | Betrawati |
  | RASUWA/Gosaikunda/5 | 234 | Syabrubesi |
  | NUWAKOT/Bidur/9 | 170 | |
  | NUWAKOT/Bidur/7 | 137 | |
  | NUWAKOT/Bidur/1 | 114 | Trishuli Bazar |
  | NUWAKOT/Bidur/5 | 95 | Devighat |
  | RASUWA/Gosaikunda/1 | 84 | Thuman, Dalphedi, Dalgaun (upstream of Timure) |
  | RASUWA/Uttargaya/1 | 0 | Mailung — owner-directed |
  | NUWAKOT/Bidur/4 | 0 | Bidur/Battar — owner-directed |

  The remaining 21 flood-affected wards keep `severity: "affected"` (green only).
  Drives `admin_ward-fill-severe` / `admin_ward-line-severe` in `app/app.js`.

## Regenerating

No `tools/build_admin_boundaries.*` script exists yet; these were produced with
one-off `ogr2ogr`/GDAL-Python commands (`-clipsrc`/`-simplify`/`-t_srs`/`-where`/
`-lco COORDINATE_PRECISION=6`, plus small scripts computing `flood_affected` via
`ogr.Geometry.Intersects()` and `severity` via the destroyed-building count above)
run directly against the downloaded HDX sources and the app's own derived damage
files. If a future refresh needs the exact commands, see the commits that added
this directory ("add district/province/municipality/ward boundary toggle layers"),
the `flood_affected` field ("highlight only the flood-affected wards") and the
`severity` field ("ward layer: pink tier for severely hit wards").
