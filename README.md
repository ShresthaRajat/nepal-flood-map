# Nepal Flood 2026 — Bhote Koshi & Trishuli

Interactive map of the 26 August 2026 glacier-collapse flood along the Lhende, Bhote Koshi and
Trishuli rivers, Nepal. Merges two sources:

- **Base layers**: open satellite imagery (Sentinel-1/2, PlanetScope, SkySat, Pelican, Vantor
  WorldView-2/3 and Legion) registered and tiled for before/after comparison, plus Copernicus
  GLO-30 contours. Carried over from the earlier `trisuli-flood-map` project.
- **Detail layers**: Humanitarian OpenStreetMap Team response data from HDX — flood extent,
  OSM/Overture features with Standing/Damaged/Destroyed status, fAIr AI damage, ground-reported
  bridge conditions.

Layout:

- `index.html` — the map (MapLibre GL, swipe compare)
- `tiles/<layer>/{z}/{x}/{y}.webp` — Web Mercator imagery pyramids; `tiles/contours/` vector tiles
- `data/imagery.json` — imagery catalogue read by the app
- `data/hdx/` — HDX downloads (GeoJSON + PMTiles), 5 Sep 2026 snapshot
- `tools/` — reproducible build scripts

## Licensing

The code in this repository (`index.html`, `app/`, `tools/`, `docs/`) is MIT
licensed, see [`LICENSE`](LICENSE). The imagery and data under `data/` and
`tiles/` are third-party works under their own terms — several imagery layers
are non-commercial (CC BY-NC 4.0) and vector data is ODbL. See
[`docs/LICENSING.md`](docs/LICENSING.md) for the full source-by-source
breakdown and what it means for reuse.

## Disclaimer

This is an independent volunteer visualisation, not an official government or
humanitarian source. Damage statuses (Standing / Damaged / Destroyed), fAIr
AI damage detections, and bridge ground reports are provisional remote and
crowd assessments as of the 5 September 2026 HDX snapshot, and may be wrong,
incomplete, or outdated. Do not use this map for navigation or operational
decision-making without independent verification. Imagery layers are
registered approximately; positions may be offset by tens of metres.
