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

## Regenerating

No `tools/build_admin_boundaries.*` script exists yet; these were produced with
one-off `ogr2ogr` commands (`-clipsrc`/`-simplify`/`-t_srs`/`-where`/
`-lco COORDINATE_PRECISION=6`) run directly against the downloaded HDX sources.
If a future refresh needs the exact commands, see the commit that added this
directory ("add district/province/municipality/ward boundary toggle layers").
