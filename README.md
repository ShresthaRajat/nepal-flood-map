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
