# Licensing and data sources

This project combines original code with third-party imagery, terrain, and
humanitarian vector data. Each has its own terms. This document is the single
authoritative list.

## Code

The code in this repository — `index.html`, `app/`, `tools/`, `docs/` — is
licensed under the MIT License. See [`LICENSE`](../LICENSE), copyright 2026
Rajat Shrestha.

Everything below (`data/`, `tiles/`) is **not** covered by the MIT license.
It is third-party data and imagery redistributed under the terms described
here.

## Imagery

| Provider | License | Attribution required |
|---|---|---|
| ESA Copernicus (Sentinel-1, Sentinel-2) | [Copernicus Sentinel Data terms](https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice) — free, full, open use with attribution | "Contains modified Copernicus Sentinel data 2026" |
| Planet Labs PBC (PlanetScope, SkySat, Pelican) | CC BY-NC 4.0, via the [Planet disaster data program](https://www.planet.com/disasterdata/) | © Planet Labs PBC, CC-BY-NC 4.0 |
| Vantor (formerly Maxar) (WorldView-2, WorldView-3, Legion) | CC BY-NC 4.0, via the [Vantor Open Data Program](https://www.maxar.com/open-data) (verify current program name/URL at vantor.com, given the Maxar→Vantor rebrand) | © Vantor, CC-BY-NC 4.0 |
| OpenAerialMap (mirror for two Vantor scenes) | Passes through the original provider's license; OpenAerialMap itself imposes no additional restriction — verify at [openaerialmap.org](https://openaerialmap.org/) | Per underlying provider (Vantor, CC-BY-NC 4.0 — applied here conservatively even where the OAM mirror record does not repeat the NC flag) |

### Imagery layers (15), from `data/imagery.json`

| id | provider | sensor | date | license |
|---|---|---|---|---|
| pre_s2_20260603 | ESA Copernicus | Sentinel-2 | 2026-06-03 | Copernicus Sentinel Data terms |
| pre_ps_20260527 | Planet Labs PBC | PlanetScope | 2026-05-27 | CC-BY-NC 4.0 |
| pre_legion_20260205 | Vantor (via OpenAerialMap) | Legion | 2026-02-05 | CC-BY-NC 4.0 |
| pre_s1_20260816 | ESA Copernicus / Microsoft Planetary Computer | Sentinel-1 RTC | 2026-08-16 | Copernicus Sentinel Data terms |
| post_s2_20260827 | ESA Copernicus | Sentinel-2 | 2026-08-27 | Copernicus Sentinel Data terms |
| post_ps_20260826 | Planet Labs PBC | PlanetScope | 2026-08-26 | CC-BY-NC 4.0 |
| post_ps26_mosaic | Planet Labs PBC | PlanetScope | 2026-08-26 | CC-BY-NC 4.0 |
| post_ps28_mosaic | Planet Labs PBC | PlanetScope | 2026-08-28 | CC-BY-NC 4.0 |
| post_s1_20260828 | ESA Copernicus / Microsoft Planetary Computer | Sentinel-1 RTC | 2026-08-28 | Copernicus Sentinel Data terms |
| post_wv02_20260828 | Vantor (via OpenAerialMap) | WorldView-2 | 2026-08-28 | CC-BY-NC 4.0 |
| post_skysat_20260831 | Planet Labs PBC | SkySat | 2026-08-31 | CC-BY-NC 4.0 |
| post_skysat_20260827 | Planet Labs PBC | SkySat | 2026-08-27 | CC-BY-NC 4.0 |
| post_wv3_20260827 | Vantor | WorldView-3 | 2026-08-27 | CC-BY-NC 4.0 |
| post_legion_20260901 | Vantor | Legion | 2026-09-01 | CC-BY-NC 4.0 |
| post_pelican_20260901 | Planet Labs PBC | Pelican | 2026-09-01 | CC-BY-NC 4.0 |

Imagery was re-tiled from the original `trisuli-flood-map` world-pixel grid to
Web Mercator XYZ with GDAL for this project; registration is preserved from
the source scenes (see `data/imagery.json`, `grid_note`). Re-tiling and
re-projection do not change the underlying license.

## Vector data

- **HOT / HDX response datasets** (ODbL). From the Humanitarian OpenStreetMap
  Team's "Nepal Flood 2026 Flood Affected Area, Bhote Koshi and Trishuli"
  dataset on [HDX](https://data.humdata.org/dataset/hot_flood_npl), snapshot
  **5 September 2026**. Underlying feature source is OpenStreetMap
  contributors, licensed [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/):
  - `data/hdx/hot_flood_npl/` — flood-affected area (buildings, roads,
    bridges, waterways, facilities, destroyed/damaged features), snapshot
    generated 2026-09-05 16:02 UTC
  - `data/hdx/hot_flood_npl_corridor/` — same catalogue over a wider 1 km
    river-corridor buffer, snapshot generated 2026-09-05 03:02 UTC
  - `data/hdx/hotosm_npl_waterways/` — country-wide OSM waterways, snapshot
    2026-08-09
  - `data/hdx/derived/roads_in_flood_extent.geojson` — derived here from the HOT
    flood-area roads and flood extent (both ODbL); as a derivative database it is
    ODbL too.
  - `data/hdx/tiles/hotosm_npl_roads/` — country-wide OSM roads (HDX
    `hotosm_npl_roads`, snapshot 9 Aug 2026), clipped to the corridor and filtered
    to motorway/trunk/primary/secondary/tertiary and named highways, shipped as
    vector tiles only. ODbL.
  - `data/hdx/hot_flood_npl_buildings_damage/` — fAIr AI building-damage
    detections (see below); no separate `README.txt` ships with this export,
    so its exact license line is unconfirmed — treat as ODbL/HOT terms
    consistent with the rest of the dataset and **verify at
    [data.humdata.org/dataset/hot_flood_npl](https://data.humdata.org/dataset/hot_flood_npl)**.
  - `data/hdx/gpkg/`, `data/hdx/tiles/`, `data/hdx/pmtiles/` — alternate
    formats (GeoPackage, vector tiles, PMTiles) of the same two exports
    above; same ODbL terms.
- **OpenStreetMap contributors** — [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
  The primary source feeding every HOT/HDX export above.
- **Overture Maps Foundation** — several categories in the app's layer
  catalogue (`app/config.js` `CATS`, e.g. `buildings/overture`,
  `education_facilities/overture`, `health_facilities/overture`,
  `points_of_interest/overture`) are Overture-sourced. The HDX export
  `README.txt` files in this repository only carry a single dataset-level
  `License: hdx-odc-odbl` line and do not break out per-source terms for the
  Overture-derived layers bundled into the same PMTiles/GeoJSON export.
  Overture Maps Foundation publishes its data dual-licensed as ODbL for
  OSM-derived themes and CDLA-Permissive-2.0 for others — **verify the
  applicable license per theme at
  [overturemaps.org/documentation/attribution](https://docs.overturemaps.org/attribution/)**
  before reuse.
- **NAXA and volunteer field reports** — credited alongside HOT/OSM/Overture
  in the app's `HDX_CREDIT` string; treat as part of the same HDX dataset
  terms above unless a more specific license is published.

## Terrain

- **Copernicus GLO-30 DEM** — © DLR e.V. 2010-2014 and © Airbus Defence and
  Space GmbH 2014-2018, provided under COPERNICUS by the European Union and
  the European Space Agency (ESA); all rights reserved. Free to use with
  that attribution. Used for the contour layers (`tiles/contours/`,
  `data/terrain.json`) and hillshade (`tiles/hillshade/`).

## Basemaps

- **OpenStreetMap raster tiles** — © OpenStreetMap contributors, ODbL,
  served subject to the [OSM Foundation tile usage
  policy](https://operations.osmfoundation.org/policies/tiles/).
- **Esri World Imagery** — © Esri and its imagery partners, per [Esri's
  terms of use](https://www.esri.com/en-us/legal/terms/full-master-agreement).

## Libraries

- **MapLibre GL JS** — [BSD-3-Clause](https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt)
- **pmtiles** — [BSD-3-Clause](https://github.com/protomaps/PMTiles/blob/main/LICENSE)

## What this means for reuse

- **The site as a whole is effectively non-commercial**, because several
  imagery layers (Planet Labs PBC and Vantor scenes — the majority of the
  sub-metre and 3 m imagery) are licensed CC BY-NC 4.0. You may not use those
  images, or a derivative product built on them, for commercial purposes.
- **Attribution must be kept** on every reuse: the Copernicus attribution
  line, the Planet/Vantor CC-BY-NC-4.0 credit, and the OSM/HOT ODbL
  attribution for any vector data you carry forward. See the "What this means
  for reuse" attribution check in the section above and the per-layer table
  for the exact credit line to keep with each imagery layer.
- **The code alone is MIT** — you may reuse `index.html`, `app/`, `tools/`
  and `docs/` for any purpose, including commercially, independent of the
  data restrictions, provided you do not redistribute the NC-licensed
  imagery or misrepresent ODbL vector data as public domain.
- Where this document says "verify at `<link>`," that means the exact terms
  could not be confirmed from files in this repository and should be checked
  against the provider's current published license before reuse.
