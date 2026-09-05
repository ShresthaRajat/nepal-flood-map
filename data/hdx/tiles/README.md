# HOT/HDX flood-response vector tiles (attribute-complete)

These are re-tiled Mapbox Vector Tiles (MVT) for the two HOT (Humanitarian
OpenStreetMap Team) HDX rapid-mapping datasets covering the 2026
Bhote Koshi-Trishuli flood. HOT's own PMTiles archives on HDX keep only
`category` / `source` / `name` per feature; these tiles are rebuilt from the
GeoPackage resources instead, so every original attribute survives, including
`status`, `highway`, `bridge_structure`, `building`, `damage_type`, `name`,
`amenity`, etc.

Rebuild with `tools/build_hdx_tiles.sh` (downloads the GeoPackages from HDX,
then re-tiles with GDAL's `ogr2ogr`/OGR Python API; no tippecanoe involved).

## Directories

- `hot_flood_npl/` - Kathmandu valley / upper catchment AOI
- `hot_flood_npl_corridor/` - Bhote Koshi-Trishuli river corridor AOI

Each is a `FORMAT=DIRECTORY` MVT tileset (`{z}/{x}/{y}.pbf`, uncompressed,
`metadata.json` at the root) spanning z8-z15. MapLibre GL overzooms past z15,
so no tiles are generated above that.

## Source layers

One MVT source-layer per HOT layer, named `<category>_<source>`:

| Source-layer | Geometry | Minzoom | Notes |
|---|---|---|---|
| `roads_osm` | line | 9 | |
| `bridges_osm` | line/point | 9 | |
| `waterways_osm` | line/polygon | 9 | |
| `destroyed_features_osm` | mixed | 9 | cross-cutting damage layer (destroyed roads/bridges/buildings/waterways/amenities) |
| `education_facilities_osm` / `_overture` | point/polygon | 10 | |
| `financial_services_osm` | point | 10 | |
| `health_facilities_osm` / `_overture` | point/polygon | 10 | |
| `helipads_osm` | point/line/polygon | 10 | |
| `open_spaces_osm` | point/line/polygon | 10 | |
| `points_of_interest_osm` / `_overture` | point/line/polygon | 10 | |
| `police_stations_osm` | point | 10 | |
| `populated_places_osm` | point/polygon | 10 | |
| `buildings_osm` / `_overture` | polygon | 12 | largest layers by feature count |
| `residential_areas_osm` | polygon | 12 | |

All layers run `minzoom`-15. Maxzoom is 15 dataset-wide (MapLibre overzooms
above that, so no tiles are cut past z15).

`hot_flood_npl_corridor` has the same 18 source-layers as `hot_flood_npl`;
there are no corridor-only Overture layers in the current HDX resource set
(both datasets expose Overture variants for buildings, education, health,
and points_of_interest, and nothing else).

## Fields kept

All original GeoPackage fields are kept **except** the four/five
`adm<N>_pcode` administrative pcode columns (`adm0_pcode`...`adm4_pcode`),
dropped to save bytes. The corresponding human-readable admin names
(`adm0_name`...`adm4_name`) are kept, along with `name_latin` (transliterated
name) and every category-specific field, e.g.:

- `roads_osm`: `status`, `highway`, `surface`, `smoothness`, `width`, `lanes`, `oneway`, `bridge`, `layer`, `source`, ...
- `bridges_osm`: `status`, `bridge`, `bridge_structure`, `highway`, `railway`, `waterway`, `man_made`, `layer`, `width`, `maxweight`, `source`, ...
- `buildings_osm`: `status`, `building`, `building_levels`, `building_materials`, `was_building_levels`, `damage_type`, `end_date`, `addr_full`, `addr_housenumber`, `addr_street`, `addr_city`, `office`, `source`, ...
- `destroyed_features_osm`: `status`, `feature_type`, `damage_type`, `damage_event`, `damage_date`, `end_date`, `was_building_levels`, `destroyed_building`, `destroyed_highway`, `destroyed_bridge`, `destroyed_waterway`, `destroyed_amenity`, `damaged_building`, `source`, ...

Overture-sourced layers (`*_overture`) carry Overture's own schema instead
(`class`/`subtype`/`category`, `height`, `num_floors`, `confidence`, `address`,
`phone`, `website`, ...).

## Verifying

```sh
# list layers + zoom ranges
python3 -c "import json; d=json.load(open('hot_flood_npl/metadata.json')); \
  j=json.loads(d['json']); [print(l['id'], l['minzoom'], l['maxzoom']) for l in j['vector_layers']]"

# decode a tile and inspect attributes
ogrinfo -al "MVT:hot_flood_npl/14/12067/6867.pbf" roads_osm
```

## Credit

© Humanitarian OpenStreetMap Team, OpenStreetMap contributors, Overture Maps
Foundation, NAXA and volunteer field reports (ODbL).
