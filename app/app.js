/* Nepal Flood 2026 — Bhote Koshi & Trishuli.
 * Two synchronised MapLibre maps with a clip-path swipe divider.  The left map
 * carries the PRE imagery, the right map the POST imagery; every overlay is
 * added to both maps so features stay aligned across the divider. */
(function () {
'use strict';

const CFG = window.CFG;
const QS = new URLSearchParams(location.search);
// The Image align tool (owner fitting aid) is always built; ?align=0 hides it.
// A saved fit in localStorage is untouched either way, so the tool comes back
// exactly as it was left.
const ALIGN_TOOL = QS.get('align') !== '0';
const BASE = location.origin + location.pathname.replace(/[^/]*$/, '');
const GLYPHS = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';
const FONT = ['Noto Sans Regular'];

const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const fmtCount = n => n >= 1000 ? Math.round(n / 1000) + 'k' : String(n);
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtDate(d) {
  if (!d) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d));
  return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : String(d);
}
const abs = u => /^(https?:)?\/\//.test(u) ? u : BASE + String(u).replace(/^\.?\//, '');

// --------------------------------------------------------------- app state
const state = {
  // pre / post are ordered lists of catalogue layer ids — any number of scenes
  // can be on per side; [] means "basemap only" (carried as `none` in the hash).
  mode: 'swipe', pre: [], post: [], swipe: 50,
  base: 'esri', hillshade: false, contours: false, placeNames: true, colorBy: 'layer',
  footprintOutline: false,  // dashed outline of the selected scenes; off, reachable only via #fo=1
  hotExtent: 'flood',       // 'flood' | 'corridor' — which HOT dataset the category list shows
  sidebar: null,            // left rail (info): resolved from hash, then localStorage, then viewport
  controls: null,           // right rail (layer controls): same resolution
  overlays: null,           // Set of enabled entry keys
  ovOpacity: 1,             // 0-1 master transparency for the damage / ground-report overlay group
  adminOpacity: 1,          // 0-1 master transparency for the administrative boundaries group
  center: null, zoom: null,
};

let catalog = { layers: [], default_pre: null, default_post: null };
let terrain = null;
let hotTiles = null;        // {flood:Set<sourceLayer>, corridor:Set, minzoom, maxzoom} once built
let aoiFlood = null;        // flood-affected AOI geometry, for colouring settlement names inside it
let catalogNote = '';
let reports = null;         // data/reports.json: official casualty, municipality, energy and community figures
let GROUPS = [];            // sidebar model
let ENTRY = {};             // key -> entry
let LABEL_OF = {};          // style layer id -> human label
let CONTOUR_IDS = [];       // contour line + label style layer ids (one basemap-style toggle)
let PLACE_IDS = [];         // settlement label layers (basemap-style toggle)
let HOT_LAYERS = [];        // {ds, s, cat, ids} — every HOT dataset × source × category layer set
let HOT_CATS = [];          // [{cat, label, color}] one row per category, shared by both datasets and sources
let HOT_MINZ = {};          // 'cat|src' -> zoom the per-layer tile build starts at, for the sidebar hint
let hotRefresh = null;      // sidebar callback: re-read counts after an extent/source switch
let QUERY_IDS = [];         // style layer ids that answer clicks
let PAINT_TARGETS = [];     // {id, prop, def} for the colour-by-status switch
let IMAGERY_BEFORE = null;  // style layer id the imagery layer is inserted before
let OV_BASE = {};           // style layer id -> {paint prop: opacity as first built}, for the group slider
const maps = {};            // {pre, post}
const tagEl = {};           // {pre, post} corner <select> tags over the map

// ------------------------------------------------------------- catalogue IO
async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(url + ' -> ' + r.status);
  return r.json();
}
async function loadCatalog() {
  const asked = QS.get('catalog');
  const tries = asked ? [asked] : ['data/imagery.json', 'work/imagery.dev.json'];
  for (const t of tries) {
    try {
      const j = await getJSON(t);
      if (t !== 'data/imagery.json') catalogNote = 'Imagery catalogue: <code>' + t + '</code> (development stand-in).';
      return j;
    } catch (e) { /* try next */ }
  }
  catalogNote = 'No imagery catalogue found — <code>data/imagery.json</code> has not been built yet. Basemaps and overlays still work.';
  return { layers: [], default_pre: null, default_post: null };
}
async function loadTerrain() {
  try { return await getJSON('data/terrain.json'); } catch (e) { return null; }
}

/* Official report figures, built by hand from named situation reports and
 * optionally topped up from the BIPAD portal by tools/merge_bipad_reports.py.
 * Optional like every other data file: without it the four report sections in
 * the left rail each render a one-line note and nothing throws. */
async function loadReports() {
  try {
    const j = await getJSON('data/reports.json');
    return (j && typeof j === 'object') ? j : null;
  } catch (e) { return null; }
}

/* Attribute-complete per-layer vector tiles, if the data agent has built them.
 * metadata.json shape is not pinned down, so accept the usual spellings. */
function metaLayerNames(j) {
  // tippecanoe/mbutil nest vector_layers inside a stringified `json` field.
  if (j && typeof j.json === 'string' && !j.vector_layers) {
    try { j = { ...j, ...JSON.parse(j.json) }; } catch (e) { /* fall through */ }
  }
  const raw = j && (j.vector_layers || j.layers || j.sourceLayers || (Array.isArray(j) ? j : null));
  if (!raw) return null;
  // A Map, not a Set: it still answers .has() for resolve(), and carries each
  // layer's own minzoom so the sidebar can say where a category starts.
  const names = new Map();
  for (const x of (Array.isArray(raw) ? raw : Object.keys(raw))) {
    const id = typeof x === 'string' ? x : (x && (x.id || x.name));
    if (id) names.set(id, x && x.minzoom != null ? +x.minzoom : null);
  }
  return names.size ? names : null;
}
async function loadAoi() {
  try {
    const g = await getJSON(HDX + 'hot_flood_npl/hot_flood_npl_aoi.geojson');
    const f = g && g.features && g.features[0];
    return f && f.geometry ? f.geometry : null;
  } catch (e) { return null; }
}
async function loadHotTiles() {
  const out = { minzoom: 0, maxzoom: 15 };
  for (const [ds, dir] of [['flood', 'hot_flood_npl'], ['corridor', 'hot_flood_npl_corridor']]) {
    try {
      const j = await getJSON(HDX + 'tiles/' + dir + '/metadata.json');
      const names = metaLayerNames(j);
      if (!names) continue;
      out[ds] = names;
      if (j.minzoom != null) out.minzoom = +j.minzoom;
      if (j.maxzoom != null) out.maxzoom = +j.maxzoom;
    } catch (e) { /* not built yet */ }
  }
  return (out.flood || out.corridor) ? out : null;
}

const NO_IMAGERY = 'none';
const IMG_PREFIX = 'imagery:';                 // source and layer id per selected scene
const imgLayerId = id => IMG_PREFIX + id;
const layersFor = side => catalog.layers.filter(l => l.side === side);
const byId = id => catalog.layers.find(l => l.id === id) || null;
const selIds = side => state[side] || [];
const isSel = (side, id) => selIds(side).indexOf(id) >= 0;
const hasImagery = side => selIds(side).length > 0;
/* Selected scenes in draw order: `state[side]` itself IS the stacking order,
 * index 0 at the bottom and the last entry on top.  `toggleScene` picks a
 * sensible spot for a newly-ticked scene (see `insertIndexForGsd`); after
 * that, the Stacking rows in the tag menu let it be moved by hand, and this
 * function just reflects whatever order the state list is in. */
function selectedLayers(side) {
  return selIds(side).map(byId).filter(Boolean);
}
const gsdOf = l => (l && l.gsd_m != null) ? +l.gsd_m : 0;   // no gsd_m -> treated as finest
/* Where a newly-ticked scene should land in an existing (possibly hand-
 * reordered) stack: as if the whole list were coarsest-first/finest-last,
 * but only this one scene is being placed, so ties land after (on top of)
 * scenes already at that same gsd rather than reshuffling anything else. */
function insertIndexForGsd(list, l) {
  const g = gsdOf(l);
  for (let i = 0; i < list.length; i++) if (gsdOf(byId(list[i])) < g) return i;
  return list.length;
}
/* Toggle one scene on a side.  Ticking on inserts it where a gsd sort would
 * put it (finest on top); the manual order set via the Stacking rows is
 * otherwise left untouched.  Unticking just removes it. */
function toggleScene(side, id, on) {
  const list = selIds(side).slice();
  const at = list.indexOf(id);
  if (on && at < 0) {
    const l = byId(id);
    list.splice(l ? insertIndexForGsd(list, l) : list.length, 0, id);
  } else if (!on && at >= 0) list.splice(at, 1);
  state[side] = list;
}
/* Move one scene one step towards the top (dir=1) or the bottom (dir=-1) of
 * the stack; a no-op past either end (the Stacking rows disable those
 * buttons instead of relying on this to clamp). */
function reorderScene(side, id, dir) {
  const list = selIds(side).slice();
  const at = list.indexOf(id);
  const to = at + dir;
  if (at < 0 || to < 0 || to >= list.length) return;
  const tmp = list[at]; list[at] = list[to]; list[to] = tmp;
  state[side] = list;
  applyImagery(side);
  writeHash();
}

// --------------------------------------------------------- style definition
/* Feature status.  `status` is absent from the current PMTiles build, so each
 * expression carries a per-category fallback rather than reading `category`. */
const statusExpr = fallback => ['match', ['to-string', ['get', 'status']],
  ['Standing', 'Intact', 'standing', 'intact'], CFG.STATUS.standing,
  ['Damaged', 'damaged', 'major-damage', 'Major Damage'], CFG.STATUS.damaged,
  ['Destroyed', 'destroyed', 'Washed out', 'washed out'], CFG.STATUS.destroyed,
  fallback];
const statusExprFor = cat => statusExpr(cat === 'destroyed_features' ? CFG.STATUS.destroyed : CFG.STATUS.standing);
const STATUS_EXPR = statusExprFor('');

/* Roads and bridges: white with a thin dark casing, weighted by OSM highway
 * class.  line-dasharray is not data-driven in MapLibre, so the dashed and
 * dotted classes have to be separate layers with their own filters. */
const ROAD_WHITE = '#ffffff';
const DAMAGE_ROAD_RED = '#ef4444';
const HW_YELLOW = '#fbbf24';       // national highways (motorway/trunk/primary)
const IS_DAMAGED = ['match', ['to-string', ['get', 'status']],
  ['Damaged', 'damaged', 'Destroyed', 'destroyed', 'Washed out', 'washed out', 'Major Damage', 'major-damage'], true, false];
const HW = {
  trunk: ['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link'],
  sec: ['secondary', 'secondary_link', 'tertiary', 'tertiary_link'],
  minor: ['unclassified', 'residential', 'service', 'living_street'],
  track: ['track'],
  path: ['footway', 'path', 'steps', 'bridleway', 'cycleway'],
};
const HW_ROADLIKE = [...HW.trunk, ...HW.sec, ...HW.minor, ...HW.track];
const inHw = list => ['in', ['to-string', ['get', 'highway']], ['literal', list]];
/* Width by class, interpolated over zoom.  `add` widens every stop, for casings.
 * `taper` adds thinner stops at z7 and z11 for layers shown at corridor scale
 * (the national roads).  Zoom stops must stay at the top level of the expression:
 * MapLibre rejects a ["zoom"] nested inside arithmetic, and one bad expression
 * fails the whole style. */
function hwWidth(add, taper) {
  const at = (t, sc, m, tr, pa, unk, k = 1) => ['match', ['to-string', ['get', 'highway']],
    HW.trunk, (t + add) * k, HW.sec, (sc + add) * k, HW.minor, (m + add) * k,
    HW.track, (tr + add) * k, HW.path, (pa + add) * k, (unk + add) * k];
  const z14 = [3.2, 2.2, 1.4, 1.2, 1.0, 1.2], z18 = [6, 4.5, 3, 2.2, 2.0, 2.4];
  return ['interpolate', ['linear'], ['zoom'],
    ...(taper ? [7, at(...z14, 0.35), 11, at(...z14, 0.6)] : []),
    14, at(...z14),
    18, at(...z18)];
}
/* White unless the feature is recorded as damaged or destroyed. */
const ROAD_STATUS = ['match', ['to-string', ['get', 'status']],
  ['Damaged', 'damaged'], CFG.STATUS.damaged,
  ['Destroyed', 'destroyed', 'Washed out', 'washed out'], CFG.STATUS.destroyed,
  ROAD_WHITE];
/* A footbridge is a path-class span, or a suspension deck that is not a road. */
const IS_FOOTBRIDGE = ['any', inHw(HW.path),
  ['all', ['in', ['to-string', ['get', 'bridge_structure']], ['literal', ['simple-suspension', 'suspension']]],
          ['!', inHw(HW_ROADLIKE)]]];
const gt = t => ['==', ['geometry-type'], t];
const andF = (...fs) => ['all', ...fs.filter(Boolean)];

const HDX = 'data/hdx/';
const ATTR_HDX = CFG.HDX_CREDIT + ' via <a href="' + CFG.HDX_URL + '" target="_blank" rel="noopener">HDX</a>';
const ADMIN = 'data/admin/';
// Province/district/municipality: OCHA COD-AB Nepal, v02 (2024-03-14), CC BY-IGO.
const ATTR_ADMIN_COD = 'Survey Department of Nepal / UN RCO Nepal via OCHA COD-AB, CC BY-IGO';
// Ward: HRRP Nepal 2018 ward boundaries for the 31 earthquake districts, filtered to
// Rasuwa/Nuwakot; the only ward-level (admin4) source found for Nepal -- see data/admin/README.md.
const ATTR_ADMIN_WARD = 'HRRP Nepal (2018), CC0 -- reference only, see data/admin/README.md';

/* One outline feature per selected scene — the union of the footprints. */
function boundsFC(list) {
  const features = [];
  for (const l of (list || [])) {
    if (!l || !l.bounds) continue;
    features.push({ type: 'Feature', properties: { label: l.label },
      geometry: { type: 'Polygon', coordinates: [[[l.bounds[0], l.bounds[1]], [l.bounds[2], l.bounds[1]],
        [l.bounds[2], l.bounds[3]], [l.bounds[0], l.bounds[3]], [l.bounds[0], l.bounds[1]]]] } });
  }
  return { type: 'FeatureCollection', features };
}
function imagerySource(l) {
  if (!l) return null;
  const s = { type: 'raster', tiles: [abs(l.tiles)], tileSize: 256,
    attribution: l.attribution || '', maxzoom: l.maxzoom != null ? l.maxzoom : 19 };
  if (l.minzoom != null) s.minzoom = l.minzoom;
  if (l.bounds) s.bounds = l.bounds;
  return s;
}

/* Builds sources + layers + the sidebar model.  Called once, then the same
 * definitions are handed to both maps (only the imagery layer differs). */
/* Damage-status palette for the report sections and the hydropower points.
 * Deliberately clear of CFG.STATUS and CFG.FAIR so a red hydropower dot is not
 * mistaken for a destroyed OSM building. */
const DMG_COLOR = {
  'destroyed': '#b91c1c', 'severely damaged': '#ea580c', 'damaged': '#ca8a04',
  'unaffected': '#059669', 'not reported': '#facc15',
};
const DMG_CLASS = {
  'destroyed': 'destroyed', 'severely damaged': 'severe', 'damaged': 'damaged',
  'unaffected': 'unaffected', 'not reported': 'nr',
};
const dmgColor = v => DMG_COLOR[String(v || '').toLowerCase()] || DMG_COLOR['not reported'];

/* HDX spells a few projects differently from the reports ("Upper Trishuli 3A"
 * vs "Upper Trishuli-3A", "Bhotekoshi Khola Hydropower Project" vs "Bhotekoshi
 * Khola").  Normalising away punctuation, the word "project" and the HEP/HPP
 * suffixes makes the join tolerant in both directions. */
const hydroKey = n => String(n || '').toLowerCase()
  .replace(/[\u2010-\u2015]/g, '-')
  .replace(/\b(hydropower|hydroelectric|hydel)\b/g, ' ')
  .replace(/\b(project|projects|hep|hpp|hydro)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').trim();

/* name -> project row, for both the map paint expression and the sidebar. */
function hydroProjects() {
  const out = new Map();
  for (const pr of ((reports && reports.energy && reports.energy.projects) || [])) {
    out.set(hydroKey(pr.name), pr);
    if (pr.hdx_name) out.set(hydroKey(pr.hdx_name), pr);
  }
  return out;
}

function buildDefs() {
  const sources = {
    osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256,
           maxzoom: 19, attribution: '© OpenStreetMap contributors' },
    esri: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256, maxzoom: 19, attribution: 'Esri World Imagery' },
    flood: { type: 'vector', url: 'pmtiles://' + BASE + HDX + 'pmtiles/hot_flood_npl.pmtiles', attribution: ATTR_HDX },
    corridor: { type: 'vector', url: 'pmtiles://' + BASE + HDX + 'pmtiles/hot_flood_npl_corridor.pmtiles', attribution: ATTR_HDX },
    aoi_flood: { type: 'geojson', data: HDX + 'hot_flood_npl/hot_flood_npl_aoi.geojson' },
    aoi_corridor: { type: 'geojson', data: HDX + 'hot_flood_npl_corridor/hot_flood_npl_corridor_aoi.geojson' },
    aoi_upstream: { type: 'geojson', data: HDX + 'derived/aoi_upstream_extension.geojson',
      attribution: 'UNOSAT (CC BY-SA)' },
    collapse: { type: 'geojson', data: HDX + 'derived/collapse_origin.geojson', attribution: 'UNOSAT (CC BY-SA)' },
    places: { type: 'geojson', data: HDX + 'derived/places.geojson', attribution: '© OpenStreetMap contributors' },
    flood_extent: { type: 'geojson', data: HDX + 'hot_flood_npl/hot_flood_npl_flood_extent.geojson' },
    bridge_damage: { type: 'geojson', data: HDX + 'hot_flood_npl/hot_flood_npl_bridge_damage.geojson' },
    hydro: { type: 'geojson', data: HDX + 'hot_flood_npl/hot_flood_npl_exposed_hydropowers.geojson' },
    fair: { type: 'geojson', data: HDX + 'hot_flood_npl_buildings_damage/hot_flood_npl_buildings_damage.geojson' },
    fair_aoi: { type: 'geojson', data: HDX + 'hot_flood_npl_buildings_damage/hot_flood_npl_buildings_damage_analyzed_aoi.geojson' },
    // National OSM waterways, pre-tiled by tools/build_waterways_tiles.sh (the 8 MB
    // source GeoJSON is gitignored; only the tiles ship).  Overzoomed above z13.
    waterways_np: { type: 'vector', tiles: [abs(HDX + 'tiles/hotosm_npl_waterways/{z}/{x}/{y}.pbf')],
      minzoom: 8, maxzoom: 13, bounds: [84.2738, 27.434, 86.0755, 28.5237],
      attribution: '© OpenStreetMap contributors (ODbL) via HDX' },
    // Copernicus EMS EMSR927 road/bridge damage grades (tools/build_ems_roads.py).
    ems_roads: { type: 'geojson', data: HDX + 'derived/ems_road_grading.geojson',
      attribution: 'Copernicus Emergency Management Service (© 2026 European Union), EMSR927, CC BY 4.0' },
    // HOT flood-area roads clipped to the observed flood extent (tools/build_flooded_roads.py).
    flooded_roads: { type: 'geojson', data: HDX + 'derived/roads_in_flood_extent.geojson', attribution: ATTR_HDX },
    // National OSM highways, pre-tiled by tools/build_roads_tiles.sh: context beyond the 1 km corridor.
    roads_np: { type: 'vector', tiles: [abs(HDX + 'tiles/hotosm_npl_roads/{z}/{x}/{y}.pbf')],
      minzoom: 7, maxzoom: 13, bounds: [84.27, 27.43, 86.08, 28.52],
      attribution: '© OpenStreetMap contributors (ODbL) via HDX' },
    // Administrative boundaries (province/district/municipality/ward), clipped to roughly the map's
    // max pan extent -- see data/admin/README.md for sources, licenses and the ward-data caveat.
    admin_province: { type: 'geojson', data: ADMIN + 'admin_province.geojson', attribution: ATTR_ADMIN_COD },
    admin_district: { type: 'geojson', data: ADMIN + 'admin_district.geojson', attribution: ATTR_ADMIN_COD },
    admin_municipality: { type: 'geojson', data: ADMIN + 'admin_municipality.geojson', attribution: ATTR_ADMIN_COD },
    admin_ward: { type: 'geojson', data: ADMIN + 'admin_ward.geojson', attribution: ATTR_ADMIN_WARD },
    search_pin: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    report_hl: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    sel_footprint: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    // Damage editor: the analyst's own collection, the highlighted selection and
    // the in-progress ring.  All three start empty and are fed from localStorage.
    edits: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    edit_sel: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    edit_draw: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    // Vertex and midpoint grab points for the selected polygon (Damage editor, reshape).
    edit_handles: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
  };
  if (hotTiles) {
    for (const [ds, dir] of [['flood', 'hot_flood_npl'], ['corridor', 'hot_flood_npl_corridor']]) {
      if (!hotTiles[ds]) continue;
      sources[ds + '_mvt'] = { type: 'vector', tiles: [abs(HDX + 'tiles/' + dir + '/{z}/{x}/{y}.pbf')],
        minzoom: hotTiles.minzoom, maxzoom: hotTiles.maxzoom, attribution: ATTR_HDX };
    }
  }
  if (terrain && terrain.contours) {
    sources.contours = { type: 'vector', tiles: [abs(terrain.contours.tiles)],
      minzoom: terrain.contours.minzoom != null ? terrain.contours.minzoom : 8,
      maxzoom: terrain.contours.maxzoom != null ? terrain.contours.maxzoom : 14,
      attribution: terrain.contours.attribution || 'Copernicus GLO-30 DEM © ESA / Airbus' };
  }
  if (terrain && terrain.hillshade) {
    sources.hillshade = { type: 'raster', tiles: [abs(terrain.hillshade.tiles)], tileSize: 256,
      minzoom: terrain.hillshade.minzoom != null ? terrain.hillshade.minzoom : 6,
      maxzoom: terrain.hillshade.maxzoom != null ? terrain.hillshade.maxzoom : 14,
      attribution: 'Copernicus GLO-30 DEM © ESA / Airbus' };
  }

  const layers = [];
  const groups = [];
  const push = (...ls) => layers.push(...ls);

  // 1. basemaps ------------------------------------------------------------
  // Esri World Imagery is the default basemap (owner direction, 7 Sep 2026); applyBase() re-applies state.base.
  push({ id: 'base-osm', type: 'raster', source: 'osm', layout: { visibility: state.base === 'osm' ? 'visible' : 'none' } },
       { id: 'base-esri', type: 'raster', source: 'esri', layout: { visibility: state.base === 'esri' ? 'visible' : 'none' } });

  // 2. imagery placeholder — real layer is inserted at runtime -------------
  // 3. hillshade -----------------------------------------------------------
  if (sources.hillshade) push({ id: 'hillshade', type: 'raster', source: 'hillshade',
    layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.35 } });

  // 4. contours ------------------------------------------------------------
  CONTOUR_IDS = [];
  if (sources.contours) {
    const order = ['c1000', 'c500', 'c100', 'c50', 'c10'];
    const defs = terrain.contours.layers || {};
    const srcMax = terrain.contours.maxzoom != null ? terrain.contours.maxzoom : 14;
    const labelIds = [], lineIds = [];
    // A class maxzoom that reaches the tile source's own maxzoom means "all the
    // way up": the source overzooms past it, so capping the style layer there
    // would make the contours vanish at high zoom.  Only honour a real cap.
    const capOf = d => (d.maxzoom != null && d.maxzoom < srcMax) ? d.maxzoom : 22;
    // Per-class base opacity (owner direction, 6 Sep 2026: c10 reads slightly
    // fainter than the other classes); fade 1/2 scale down from that base
    // rather than stopping abruptly at the old polygon-clip edge.
    const DEFAULT_OPACITY = { base: 0.55, fade1: 0.35, fade2: 0.18 };
    const CONTOUR_OPACITY = { c10: { base: 0.4, fade1: 0.25, fade2: 0.12 } };
    for (const cls of order) {
      const d = defs[cls]; if (!d) continue;
      const iv = cls.slice(1);
      const lid = 'contour-' + cls;
      const op = CONTOUR_OPACITY[cls] || DEFAULT_OPACITY;
      push({ id: lid, type: 'line', source: 'contours', 'source-layer': cls,
        minzoom: d.minzoom != null ? d.minzoom : 8, maxzoom: capOf(d),
        layout: { 'line-join': 'round', visibility: 'none' },
        // Olive, green-leaning gold so the lines sit apart from the amber highways and the
        // damage reds (owner direction, 6 Sep 2026); index lines lighter, all slightly translucent.
        paint: { 'line-color': ['case', ['==', ['get', 'idx'], 1], '#d3d47a', '#a9b45c'],
                 'line-width': ['interpolate', ['linear'], ['zoom'], 10, ['case', ['==', ['get', 'idx'], 1], 0.9, 0.45],
                                                                    16, ['case', ['==', ['get', 'idx'], 1], 1.8, ['==', ['get', 'fade'], 2], 0.7, 0.9]],
                 // c10/c50 fade out past the HAND-clipped near-river band (fade 0) rather
                 // than stopping abruptly at a polygon edge (owner direction, 6 Sep 2026).
                 'line-opacity': ['match', ['get', 'fade'], 1, op.fade1, 2, op.fade2, op.base] } });
      lineIds.push(lid);
      // Labels only on 100 m multiples (c1000/c500/c100); labelling every 10 m line is too busy.
      if (cls === 'c50' || cls === 'c10') continue;
      const tid = lid + '-label';
      push({ id: tid, type: 'symbol', source: 'contours', 'source-layer': cls,
        minzoom: Math.max(13, d.minzoom != null ? d.minzoom : 8), maxzoom: capOf(d),
        layout: { visibility: 'none', 'symbol-placement': 'line', 'text-field': ['concat', ['to-string', ['get', 'ele']], ' m'],
                  'text-font': FONT, 'text-size': 10, 'symbol-spacing': 320, 'text-max-angle': 25, 'text-padding': 4 },
        paint: { 'text-color': '#e9e8b0', 'text-opacity': 0.85, 'text-halo-color': 'rgba(20,24,12,.85)', 'text-halo-width': 1.4 } });
      labelIds.push(tid);
    }
    // One switch for all contour classes and their labels (a checkbox in the
    // Basemap block, like hillshade); the classes only decide which lines
    // reveal at which zoom.
    CONTOUR_IDS = [...lineIds, ...labelIds];
  }

  // 5. HOT / HDX -----------------------------------------------------------
  const AOI_GREY = '#cbd5e1';
  push({ id: 'aoi_flood-line', type: 'line', source: 'aoi_flood', layout: { visibility: 'none' },
         paint: { 'line-color': AOI_GREY, 'line-opacity': 0.45, 'line-width': 1.5 } },
       { id: 'aoi_corridor-line', type: 'line', source: 'aoi_corridor', layout: { visibility: 'none' },
         paint: { 'line-color': AOI_GREY, 'line-opacity': 0.45, 'line-width': 1.5, 'line-dasharray': [3, 2] } },
       // Beyond HOT's AOI: the Lende Khola from Rasuwagadhi to the glacier, from the UNOSAT extent.
       { id: 'aoi_upstream-line', type: 'line', source: 'aoi_upstream', layout: { visibility: 'none' },
         paint: { 'line-color': AOI_GREY, 'line-opacity': 0.45, 'line-width': 1.5, 'line-dasharray': [1, 1.5] } });

  /* Where a category's features live.  The PMTiles build packs every category
   * into one source-layer keyed by category|source; the per-layer tile build
   * gives each HOT layer its own source-layer and needs no filter. */
  function resolve(ds, cat, src) {
    const pm = { source: ds, sl: ds === 'corridor' ? 'hot_flood_npl_corridor' : 'hot_flood_npl',
                 filter: ['==', ['concat', ['get', 'category'], '|', ['get', 'source']], cat + '|' + src] };
    const names = hotTiles && hotTiles[ds];
    if (!names) return pm;
    const hit = [cat + '_' + src, src === 'osm' ? cat : null].filter(Boolean).find(n => names.has(n));
    return hit ? { source: ds + '_mvt', sl: hit, filter: null, minz: names.get(hit) } : pm;
  }

  /* Roads and bridges get a casing + white line per dash class. */
  function roadLayers(id, r, isBridge) {
    const specs = isBridge
      ? [['span', ['!', IS_FOOTBRIDGE], 2.5, null, 'butt'],
         ['foot', IS_FOOTBRIDGE, 1.5, [1, 2], 'round']]
      : [['road', ['!', ['any', inHw(HW.track), inHw(HW.path)]], 1.5, null, 'butt'],
         ['track', inHw(HW.track), 1.5, [4, 2], 'butt'],
         ['path', inHw(HW.path), 1.5, [1, 2], 'round']];
    const out = [];
    for (const [suffix, extra, casingAdd, dash, cap] of specs) {
      const filter = andF(gt('LineString'), r.filter, extra);
      const casing = { id: id + '-' + suffix + '-casing', type: 'line', source: r.source, 'source-layer': r.sl,
        filter, layout: { visibility: 'none', 'line-join': 'round', 'line-cap': cap },
        paint: { 'line-color': '#000000', 'line-opacity': 0.2, 'line-width': hwWidth(casingAdd) } };
      // Roads: white, national highways yellow, flood-damaged stretches (HOT status) always red.
      const roadColor = isBridge ? ROAD_STATUS : ['case', IS_DAMAGED, DAMAGE_ROAD_RED, inHw(HW.trunk), HW_YELLOW, ROAD_WHITE];
      const line = { id: id + '-' + suffix, type: 'line', source: r.source, 'source-layer': r.sl,
        filter, layout: { visibility: 'none', 'line-join': 'round', 'line-cap': cap },
        paint: { 'line-color': roadColor, 'line-opacity': ['case', IS_DAMAGED, 0.95, 0.7], 'line-width': hwWidth(0) } };
      if (dash) { casing.paint['line-dasharray'] = dash; line.paint['line-dasharray'] = dash; }
      out.push(casing, line);
      PAINT_TARGETS.push({ id: line.id, prop: 'line-color', def: roadColor, status: ROAD_STATUS });
    }
    return out;
  }

  /* One row per category in the sidebar; the extent (flood AOI / 1 km corridor)
   * and source (OSM / Overture) switches pick which of the underlying layer
   * sets is shown, so the same category is never listed four times. */
  // Not shown: HOT's per-AOI waterways duplicate the national "Waterways of Nepal"
  // layer below; financial services, health facilities, helipads and open spaces
  // add little for this map (owner direction, 6 Sep 2026).
  const HOT_SKIP = ['waterways', 'financial_services', 'health_facilities', 'helipads', 'open_spaces'];
  const hotCats = CFG.CATS.filter(([cat]) => !HOT_SKIP.includes(cat));
  HOT_CATS = [];
  for (const [cat, , label, color] of hotCats) if (!HOT_CATS.some(c => c.cat === cat))
    HOT_CATS.push({ cat, label: label.replace(/\s*\((OSM|Overture)\)$/, ''), color });
  const HOT_DEFAULT_ON = [];   // every OSM / Overture feature category starts off (owner direction, 7 Sep 2026)
  const SETTLEMENT_RED = '#f87171';
  // Volunteer-recorded destroyed/damaged features read as damage, not as a
  // mapped-feature class: dark red outline over a translucent dark red fill,
  // listed with the flood extent rather than with the OSM/Overture catalogue.
  const DAMAGE_RED = CFG.CATS.find(([cat]) => cat === 'destroyed_features')[3];
  const damageCat = cat => cat === 'destroyed_features';

  function vectorGroup(ds) {
    // Three passes so roads always sit above building fills and below points.
    const fills = [], lines = [], roads = [], points = [];
    for (const [cat, s, , color] of hotCats) {
      const key = cat + '|' + s;
      const count = CFG.COUNTS[ds][key];
      if (count === undefined) continue;
      const id = ds + '-' + cat + '-' + s;
      const label = HOT_CATS.find(c => c.cat === cat).label + ' (' + (s === 'osm' ? 'OSM' : 'Overture') + ', ' +
        (ds === 'flood' ? 'flood area' : '1 km corridor') + ')';
      const r = resolve(ds, cat, s);
      // The per-layer tile build starts buildings and residential areas at z12
      // and most point categories at z10, where the PMTiles archive carried
      // every zoom.  Remember the floor so the sidebar can say so.
      if (r.minz != null) HOT_MINZ[key] = Math.max(HOT_MINZ[key] || 0, r.minz);
      const roadish = cat === 'roads' || cat === 'bridges';
      const ids = [];
      fills.push({ id: id + '-fill', type: 'fill', source: r.source, 'source-layer': r.sl,
        layout: { visibility: 'none' }, filter: andF(gt('Polygon'), r.filter),
        paint: { 'fill-color': roadish ? ROAD_WHITE : color, 'fill-opacity': roadish ? 0.25 : damageCat(cat) ? 0.3 : 0.12,
                 'fill-outline-color': roadish ? '#000000' : color } });
      ids.push(id + '-fill');
      if (roadish) {
        for (const l of roadLayers(id, r, cat === 'bridges')) { roads.push(l); ids.push(l.id); }
      } else {
        if (cat === 'buildings') {
          // fill-outline-color inherits the faint fill opacity, so buildings get a
          // dedicated outline pass that reads against imagery.
          lines.push({ id: id + '-outline', type: 'line', source: r.source, 'source-layer': r.sl,
            layout: { visibility: 'none', 'line-join': 'round' }, filter: andF(gt('Polygon'), r.filter),
            paint: { 'line-color': color, 'line-opacity': 0.55, 'line-width': 0.9 } });
          ids.push(id + '-outline');
          PAINT_TARGETS.push({ id: id + '-outline', prop: 'line-color', def: color, status: statusExprFor(cat) });
        }
        lines.push({ id: id + '-line', type: 'line', source: r.source, 'source-layer': r.sl,
          layout: { visibility: 'none', 'line-join': 'round' }, filter: andF(gt('LineString'), r.filter),
          paint: { 'line-color': color, 'line-opacity': damageCat(cat) ? 0.95 : 0.8, 'line-width': damageCat(cat) ? 1.6 : 1.3 } });
        ids.push(id + '-line');
        PAINT_TARGETS.push({ id: id + '-line', prop: 'line-color', def: color, status: statusExprFor(cat) });
      }
      if (cat === 'populated_places') {
        // Settlement names as translucent text, not dots.  Red when the place
        // lies inside the flood-affected AOI: every feature of the flood
        // dataset does; in the corridor dataset a point-in-polygon test decides.
        const inAoi = ds === 'flood' ? true
          : (aoiFlood ? ['all', ['==', ['geometry-type'], 'Point'], ['within', aoiFlood]] : false);
        points.push({ id: id + '-name', type: 'symbol', source: r.source, 'source-layer': r.sl,
          filter: andF(gt('Point'), r.filter),
          minzoom: 10, layout: { visibility: 'none',
            'text-field': ['coalesce', ['get', 'name_latin'], ['get', 'name_en'], ['get', 'name']],
            'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 15, 13],
            'text-max-width': 8, 'text-padding': 3, 'text-letter-spacing': 0.02 },
          paint: { 'text-color': ['case', inAoi, SETTLEMENT_RED, '#f1f5f9'], 'text-opacity': 0.85,
                   'text-halo-color': 'rgba(8,12,18,.6)', 'text-halo-width': 1.6, 'text-halo-blur': 0.4 } });
        ids.push(id + '-name');
      } else {
        points.push({ id: id + '-point', type: 'circle', source: r.source, 'source-layer': r.sl,
          layout: { visibility: 'none' }, filter: andF(gt('Point'), r.filter),
          paint: { 'circle-color': color, 'circle-radius': damageCat(cat) ? 4 : 3, 'circle-stroke-width': damageCat(cat) ? 1 : 0.5,
                   'circle-stroke-color': damageCat(cat) ? '#fecaca' : '#fff' } });
        ids.push(id + '-point');
        PAINT_TARGETS.push({ id: id + '-point', prop: 'circle-color', def: color, status: statusExprFor(cat) });
      }
      if (!roadish) PAINT_TARGETS.push(
        { id: id + '-fill', prop: 'fill-color', def: color, status: statusExprFor(cat) },
        { id: id + '-fill', prop: 'fill-outline-color', def: color, status: statusExprFor(cat) });
      for (const i of ids) LABEL_OF[i] = label;
      HOT_LAYERS.push({ ds, s, cat, ids });
    }
    push(...fills, ...lines, ...roads, ...points);
  }
  // Flood extent goes under the HOT features so the dark red damage outlines stay crisp on top.
  push(
    { id: 'flood_extent-fill', type: 'fill', source: 'flood_extent', layout: { visibility: 'none' },
      paint: { 'fill-color': '#7f1d1d', 'fill-opacity': 0.2 } },
    { id: 'flood_extent-line', type: 'line', source: 'flood_extent', layout: { visibility: 'none' },
      paint: { 'line-color': '#991b1b', 'line-width': 1.2 } },
  );
  // National roads (HDX hotosm_npl_roads, trunk to tertiary plus named highways) beyond the
  // 1 km corridor.  Same casing and widths as the HOT roads and drawn underneath them, so
  // inside the corridor HOT's roads (white, yellow for trunk/primary, red where damaged) win
  // and outside it this layer continues the network.  Widths taper below z14 so the valley
  // does not clog at corridor scale.
  const HW_MAIN = ['match', ['to-string', ['get', 'highway']], HW.trunk, true, false];
  const HW_NAME = ['coalesce', ['get', 'name_en'], ['get', 'name_latin'], ['get', 'name'], ''];
  const HW_NAMED = ['any', HW_MAIN, ...['ighway', 'Rajmarg', 'Lokmarg', 'Rajpath'].map(k => ['in', k, HW_NAME])];
  const npLine = (suffix, filter, color, opacity) => [
    { id: 'roads_np-' + suffix + '-casing', type: 'line', source: 'roads_np', 'source-layer': 'roads', filter,
      layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'butt' },
      paint: { 'line-color': '#000000', 'line-opacity': 0.2, 'line-width': hwWidth(1.5, true) } },
    { id: 'roads_np-' + suffix, type: 'line', source: 'roads_np', 'source-layer': 'roads', filter,
      layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'butt' },
      paint: { 'line-color': color, 'line-opacity': opacity, 'line-width': hwWidth(0, true) } },
  ];
  push(...npLine('other', ['!', HW_MAIN], ROAD_WHITE, 0.7),
       ...npLine('hw', HW_MAIN, HW_YELLOW, 0.9));

  HOT_LAYERS = [];
  HOT_MINZ = {};
  vectorGroup('flood');
  vectorGroup('corridor');

  // hot: entries have no fixed ids — applyHot() resolves them from the Extent switch
  // and the entry's source.  OSM and Overture are separate sections (owner direction,
  // 6 Sep 2026): Overture predates the flood and carries no damage status.
  const swatch = (cat, color) => (cat === 'roads' || cat === 'bridges') ? ROAD_WHITE : cat === 'populated_places' ? '#f1f5f9' : color;
  groups.push({ title: 'Mapped features (HOT / OpenStreetMap)', hot: true, extent: true, open: true, entries: [
    ...HOT_CATS.filter(c => !damageCat(c.cat)).map(c => ({ key: 'hot_' + c.cat, cat: c.cat, src: 'osm', label: c.label, hot: true, ids: [],
      color: swatch(c.cat, c.color), on: HOT_DEFAULT_ON.includes(c.cat) })),
  ] });
  // What Overture is and why it has no damage status is explained in the Sources & notes drawer.
  groups.push({ title: 'Overture Maps (pre-flood)', hot: true, open: false,
    noAll: true,
    // Only categories with data in the flood area; police, roads and settlement names are corridor-only (owner direction).
    entries: hotCats.filter(([cat, s]) => s === 'overture' && ['buildings', 'education_facilities', 'points_of_interest'].includes(cat)).map(([cat, , , color]) => ({
      key: 'ovt_' + cat, cat, src: 'overture', label: HOT_CATS.find(c => c.cat === cat).label, hot: true, ids: [],
      color: swatch(cat, color), on: false })),
  });

  const fairColor = ['match', ['get', 'damage'],
    'destroyed', CFG.FAIR['destroyed'], 'major-damage', CFG.FAIR['major-damage'],
    'minor-damage', CFG.FAIR['minor-damage'], 'no-damage', CFG.FAIR['no-damage'], CFG.FAIR['no-data']];
  const bridgeColor = ['match', ['get', 'status'],
    ['Destroyed', 'Washed out'], CFG.STATUS.destroyed, 'Damaged', CFG.STATUS.damaged, '#2ca25f'];

  push(
    { id: 'waterways_np-fill', type: 'fill', source: 'waterways_np', 'source-layer': 'waterways', layout: { visibility: 'none' },
      filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#0ea5e9', 'fill-opacity': 0.2 } },
    { id: 'waterways_np-line', type: 'line', source: 'waterways_np', 'source-layer': 'waterways', layout: { visibility: 'none' },
      filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#0ea5e9', 'line-width': 0.8 } },
    { id: 'fair_aoi-line', type: 'line', source: 'fair_aoi', layout: { visibility: 'none' },
      paint: { 'line-color': '#f8fafc', 'line-width': 1.5, 'line-dasharray': [2, 2] } },
    { id: 'fair-fill', type: 'fill', source: 'fair', layout: { visibility: 'none' }, paint: { 'fill-color': fairColor, 'fill-opacity': 0.35 } },
    { id: 'fair-line', type: 'line', source: 'fair', layout: { visibility: 'none' }, paint: { 'line-color': '#333', 'line-width': 0.4 } },
    // Glacier collapse: detachment zone (violet), barrier lakes (ice blue), origin point with a label.
    { id: 'collapse-zone-fill', type: 'fill', source: 'collapse', layout: { visibility: 'none' },
      filter: ['==', ['get', 'kind'], 'detachment_zone'], paint: { 'fill-color': '#c084fc', 'fill-opacity': 0.3 } },
    { id: 'collapse-zone-line', type: 'line', source: 'collapse', layout: { visibility: 'none' },
      filter: ['==', ['get', 'kind'], 'detachment_zone'], paint: { 'line-color': '#c084fc', 'line-width': 1.6 } },
    { id: 'collapse-lake-fill', type: 'fill', source: 'collapse', layout: { visibility: 'none' },
      filter: ['==', ['get', 'kind'], 'barrier_lake'], paint: { 'fill-color': '#7dd3fc', 'fill-opacity': 0.55 } },
    { id: 'collapse-lake-line', type: 'line', source: 'collapse', layout: { visibility: 'none' },
      filter: ['==', ['get', 'kind'], 'barrier_lake'], paint: { 'line-color': '#e0f2fe', 'line-width': 1 } },
    { id: 'collapse-origin-point', type: 'circle', source: 'collapse', layout: { visibility: 'none' },
      filter: ['==', ['get', 'kind'], 'origin'],
      paint: { 'circle-color': '#c084fc', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 5, 14, 9],
               'circle-stroke-width': 2, 'circle-stroke-color': '#1e1b4b' } },
    { id: 'collapse-origin-label', type: 'symbol', source: 'collapse', layout: { visibility: 'none',
        'text-field': ['get', 'label'], 'text-font': FONT, 'text-size': 12, 'text-offset': [0, 1.4], 'text-anchor': 'top',
        'text-allow-overlap': true },
      filter: ['==', ['get', 'kind'], 'origin'],
      paint: { 'text-color': '#f5f3ff', 'text-halo-color': 'rgba(30,27,75,.9)', 'text-halo-width': 1.6 } },
    { id: 'hydro-point', type: 'circle', source: 'hydro', layout: { visibility: 'none' },
      paint: { 'circle-color': '#facc15', 'circle-radius': 6, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#000' } },
    { id: 'bridge_damage-point', type: 'circle', source: 'bridge_damage', layout: { visibility: 'none' },
      paint: { 'circle-color': bridgeColor, 'circle-radius': 6, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff' } },
  );
  PAINT_TARGETS.push({ id: 'bridge_damage-point', prop: 'circle-color', def: bridgeColor });

  // Roads that lie inside the mapped water, computed by clipping the HOT roads to the flood
  // extent polygon: red with the road casing, on top of the roads so the affected stretches
  // read even where HOT has not recorded a status yet (616 of 879 segments are still "Standing").
  // Where Copernicus EMS graded a segment its grade wins: Destroyed/Damaged kept, No visible damage dropped.
  // Bridges are decided by river position and the ground reports in tools/build_flooded_roads.py, not by
  // the polygon (a deck always intersects it): upstream of BhimDhunga every bridge is red unless a report says Intact;
  // BhimDhunga to Benighat the nearest report decides; Benighat and downstream is unaffected.
  push(
    { id: 'flooded_roads-casing', type: 'line', source: 'flooded_roads', layout: { visibility: 'none', 'line-join': 'round' },
      paint: { 'line-color': '#000000', 'line-opacity': 0.25, 'line-width': hwWidth(1.5) } },
    { id: 'flooded_roads-line', type: 'line', source: 'flooded_roads', layout: { visibility: 'none', 'line-join': 'round' },
      paint: { 'line-color': DAMAGE_ROAD_RED, 'line-opacity': 0.95, 'line-width': hwWidth(0) } },
  );

  // Copernicus EMS grading, segment by segment from 0.3–0.7 m post-event imagery: the closest thing
  // to an authoritative road condition.  Only damage is drawn: solid for Destroyed / Damaged, dashed
  // for "Possibly damaged" (line-dasharray is not data-driven, hence two layers).  "No visible damage"
  // and "Not Analysed" segments stay in the file (build_flooded_roads.py uses the former to clear the
  // computed overlay) but are not drawn (owner direction, 6 Sep 2026).
  const EMS_COLOR = ['match', ['get', 'grade'],
    'Destroyed', DAMAGE_ROAD_RED, 'Damaged', '#f97316', '#f59e0b'];
  const EMS_W = ['interpolate', ['linear'], ['zoom'], 10, 1.4, 14, 2.8, 17, 4.6];
  const EMS_SHOWN = ['match', ['get', 'grade'], ['Destroyed', 'Damaged', 'Possibly damaged'], true, false];
  const EMS_FIRM = ['match', ['get', 'grade'], ['Destroyed', 'Damaged'], true, false];
  push(
    { id: 'ems_roads-casing', type: 'line', source: 'ems_roads', filter: EMS_SHOWN, layout: { visibility: 'none', 'line-join': 'round' },
      paint: { 'line-color': '#000000', 'line-opacity': 0.3, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.6, 14, 4.4, 17, 6.8] } },
    { id: 'ems_roads-solid', type: 'line', source: 'ems_roads', filter: EMS_FIRM, layout: { visibility: 'none', 'line-join': 'round' },
      paint: { 'line-color': EMS_COLOR, 'line-opacity': 0.95, 'line-width': EMS_W } },
    { id: 'ems_roads-dashed', type: 'line', source: 'ems_roads', filter: ['all', EMS_SHOWN, ['!', EMS_FIRM]], layout: { visibility: 'none', 'line-join': 'round' },
      paint: { 'line-color': EMS_COLOR, 'line-opacity': 0.95, 'line-width': EMS_W, 'line-dasharray': [2, 1.5] } },
  );

  // Settlement labels (tools/build_places.py): district HQs and cities from z7, towns and the
  // featured corridor places from z8, villages from z11, hamlets from z13, gazetteer localities
  // (GeoNames, no OSM node) from z14.  A basemap toggle.
  const PLACE_NAME = ['get', 'name'];
  const PLACE_HALO = { 'text-halo-color': 'rgba(8,12,18,.9)', 'text-halo-width': 1.6, 'text-halo-blur': 0.4 };
  const placeLayer = (id, filter, minzoom, size, font, color, dot) => {
    const layers = [{ id, type: 'symbol', source: 'places', filter, minzoom,
      layout: { visibility: 'none', 'text-field': PLACE_NAME, 'text-font': font, 'text-size': size,
                'text-anchor': dot ? 'top' : 'center', 'text-offset': dot ? [0, 0.5] : [0, 0], 'text-max-width': 8,
                'text-padding': 3, 'symbol-sort-key': ['get', 'rank'], 'text-letter-spacing': 0.02 },
      paint: { 'text-color': color, ...PLACE_HALO } }];
    if (dot) layers.unshift({ id: id + '-dot', type: 'circle', source: 'places', filter, minzoom,
      layout: { visibility: 'none' }, paint: { 'circle-radius': 3, 'circle-color': color, 'circle-stroke-width': 1.2, 'circle-stroke-color': 'rgba(8,12,18,.9)' } });
    return layers;
  };
  const placeLayers = [
    ...placeLayer('places-hq', ['==', ['get', 'rank'], 0], 7, ['interpolate', ['linear'], ['zoom'], 7, 12, 12, 15], ['Noto Sans Bold'], '#ffffff', true),
    ...placeLayer('places-town', ['==', ['get', 'rank'], 1], 8, ['interpolate', ['linear'], ['zoom'], 8, 11, 13, 13.5], ['Noto Sans Bold'], '#f8fafc', true),
    ...placeLayer('places-village', ['==', ['get', 'rank'], 2], 11, ['interpolate', ['linear'], ['zoom'], 11, 10.5, 15, 12], FONT, '#e2e8f0', false),
    ...placeLayer('places-hamlet', ['==', ['get', 'rank'], 3], 13, 10.5, FONT, '#cbd5e1', false),
    ...placeLayer('places-locality', ['==', ['get', 'rank'], 4], 14, 10, FONT, '#94a3b8', false),
  ];
  PLACE_IDS = placeLayers.map(l => l.id);

  // Highway name labels sit above every HOT layer so roads do not overdraw them.  Labelled by
  // name (the HDX export has no ref): highways, and any road whose name says Highway / Rajmarg /
  // Lokmarg / Rajpath, e.g. the tertiary-tagged stretches of the Pasang Lhamu Highway.  Bend limit
  // is loose because these roads switchback; a tight limit suppressed every label in the hills.
  push({ id: 'roads_np-label', type: 'symbol', source: 'roads_np', 'source-layer': 'roads', filter: HW_NAMED, minzoom: 9,
    layout: { visibility: 'none', 'symbol-placement': 'line', 'symbol-spacing': 260,
      'text-field': HW_NAME, 'text-font': FONT,
      'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 14, 12.5],
      'text-letter-spacing': 0.04, 'text-padding': 2, 'text-max-angle': 60, 'text-keep-upright': true },
    paint: { 'text-color': '#fde68a', 'text-halo-color': 'rgba(8,12,18,.85)', 'text-halo-width': 1.6, 'text-halo-blur': 0.3 } });
  push(...placeLayers);

  // `opacity: true` gives this group the master transparency slider; the damage
  // and ground-report layers are the ones an analyst reads the imagery through.
  groups.push({ title: 'Flood extent, damage & ground reports', opacity: true, opacityKey: 'flood', entries: [
    { key: 'flood_extent', label: 'Flood extent, observed 27 Aug 2026', color: '#7f1d1d', ids: ['flood_extent-fill', 'flood_extent-line'], on: true, count: 1 },
    { key: 'collapse', label: 'Glacier collapse origin & barrier lakes (UNOSAT)', color: '#c084fc',
      ids: ['collapse-zone-fill', 'collapse-zone-line', 'collapse-lake-fill', 'collapse-lake-line', 'collapse-origin-point', 'collapse-origin-label'],
      on: true, count: 3 },
    // hot: ids resolved by applyHot(); follows the Extent switch, always the OSM source.
    { key: 'hot_destroyed_features', cat: 'destroyed_features', src: 'osm', label: 'Destroyed and damaged features (volunteer-recorded)',
      color: DAMAGE_RED, hot: true, ids: [], on: true },
    { key: 'bridge_damage', label: 'Bridge damage (ground reports)', color: CFG.STATUS.destroyed, ids: ['bridge_damage-point'], on: true, count: 58 },
    { key: 'hydro', label: 'Exposed hydropowers', color: '#facc15', ids: ['hydro-point'], on: true, count: 10 },
    { key: 'fair', label: 'fAIr building damage (AI)', color: CFG.FAIR['destroyed'], ids: ['fair-fill', 'fair-line'], on: true, count: 1053 },
    { key: 'fair_aoi', label: 'fAIr analysed tile', color: '#f8fafc', ids: ['fair_aoi-line'], on: true, outline: true },
    // The analyst's graded buildings: the committed export at CFG.DAMAGE_EDITS_URL plus this browser's
    // working copy from the Damage editor (owner direction, 7 Sep 2026: viewable as its own layer).
    { key: 'damage_edits', label: 'Building damage grading (analyst edits)', color: '#f97316', ids: ['edits-fill', 'edits-line'], on: true, count: 65 },
    { key: 'waterways_np', label: 'Waterways of Nepal (OSM)', color: '#0ea5e9', ids: ['waterways_np-line', 'waterways_np-fill'], on: false },
    { key: 'roads_np', label: 'Highways and main roads (OSM, national)', color: HW_YELLOW,
      ids: ['roads_np-other-casing', 'roads_np-other', 'roads_np-hw-casing', 'roads_np-hw', 'roads_np-label'], on: true },
    { key: 'ems_roads', label: 'Road damage grading (Copernicus EMS, 27–31 Aug)', color: DAMAGE_ROAD_RED,
      ids: ['ems_roads-casing', 'ems_roads-solid', 'ems_roads-dashed'], on: true, count: 548 },
    { key: 'flooded_roads', label: 'Roads inside the flood extent (computed)', color: DAMAGE_ROAD_RED,
      ids: ['flooded_roads-casing', 'flooded_roads-line'], on: false, count: 879 },
    // hot: applyHot() shows the flood or corridor outline to match the Extent switch.
    { key: 'hot_aoi', label: 'Area of interest outline (HOT + upstream to the glacier)', color: 'rgba(203,213,225,.6)', outline: true, hot: true, ids: [], on: true },
  ] });

  // 5a. Administrative boundaries (province/district/municipality/ward) ----
  // Reference layers for government coordination: line + name label per level (ward also
  // gets a light fill so the ward area itself reads, not just its edge), off by default so
  // they don't clutter the imagery until asked for. All four in shades of green, darkest
  // and thickest for province down to lightest and thinnest for ward -- a shared hue keeps
  // them reading as one "administrative" family, distinct from the reds/oranges/yellows used
  // for damage and roads. `opacity: true` on the group below gives it its own fade slider,
  // separate from the flood/damage group's. Province/district/municipality come from OCHA
  // COD-AB (current, 2024); ward is a 2018 source limited to Rasuwa and Nuwakot -- see
  // data/admin/README.md for provenance, licenses and caveats. Every flood-touching ward
  // (`flood_affected`, 31 of 117, precomputed -- see data/admin/README.md) gets an orange
  // fill with a darker orange fill-outline; the ordinary green ward outline still applies to
  // every ward regardless (owner direction, 8 Sep 2026: a single orange tier, no severity split).
  const ADMIN_COLOR = { province: '#14532d', district: '#15803d', municipality: '#22c55e', ward: '#86efac' };
  const ADMIN_DASH  = { province: [4, 2], district: [3, 2], municipality: [2, 1.5], ward: [1, 1.5] };
  const ADMIN_WIDTH = { province: 2.6, district: 1.9, municipality: 1.4, ward: 1.1 };
  const WARD_FILL = '#ff8c1a', WARD_FILL_OUTLINE = '#b45309';
  function adminLayers(level, nameExpr, minLabelZoom, fillFilter) {
    const color = ADMIN_COLOR[level];
    const out = [];
    if (fillFilter) out.push({ id: 'admin_' + level + '-fill', type: 'fill', source: 'admin_' + level,
      filter: fillFilter, layout: { visibility: 'none' },
      paint: level === 'ward'
        ? { 'fill-color': WARD_FILL, 'fill-opacity': 0.4, 'fill-outline-color': WARD_FILL_OUTLINE }
        : { 'fill-color': color, 'fill-opacity': 0.35 } });
    out.push(
      { id: 'admin_' + level + '-line', type: 'line', source: 'admin_' + level,
        layout: { visibility: 'none', 'line-join': 'round' },
        paint: { 'line-color': color, 'line-width': ADMIN_WIDTH[level], 'line-opacity': 0.85, 'line-dasharray': ADMIN_DASH[level] } },
      { id: 'admin_' + level + '-label', type: 'symbol', source: 'admin_' + level, minzoom: minLabelZoom,
        layout: { visibility: 'none', 'text-field': nameExpr, 'text-font': FONT,
          'text-size': ['interpolate', ['linear'], ['zoom'], minLabelZoom, 10, minLabelZoom + 4, 12.5],
          'text-max-width': 8, 'text-padding': 3 },
        paint: { 'text-color': color, 'text-halo-color': 'rgba(8,12,18,.85)', 'text-halo-width': 1.5, 'text-halo-blur': 0.3 } });
    return out;
  }
  push(
    ...adminLayers('province', ['get', 'adm1_name'], 6),
    ...adminLayers('district', ['get', 'adm2_name'], 8),
    ...adminLayers('municipality', ['get', 'adm3_name'], 10),
    ...adminLayers('ward', ['concat', 'Ward ', ['to-string', ['get', 'NEW_WARD_N']]], 12, ['==', ['get', 'flood_affected'], 1]),
  );
  groups.push({ title: 'Administrative boundaries', opacity: true, opacityKey: 'admin', entries: [
    { key: 'admin_province', label: 'Province', color: ADMIN_COLOR.province,
      ids: ['admin_province-line', 'admin_province-label'], on: false, count: 6 },
    { key: 'admin_district', label: 'District', color: ADMIN_COLOR.district,
      ids: ['admin_district-line', 'admin_district-label'], on: false, count: 42 },
    { key: 'admin_municipality', label: 'Municipality / local level', color: ADMIN_COLOR.municipality,
      ids: ['admin_municipality-line', 'admin_municipality-label'], on: false, count: 399 },
    { key: 'admin_ward', label: 'Ward (Rasuwa & Nuwakot only, 2018 reference; orange fill highlights the 31 flood-affected wards)', color: WARD_FILL,
      ids: ['admin_ward-fill', 'admin_ward-line', 'admin_ward-label'], on: false, count: 117 },
  ] });

  // 6. search pin + selected-scene outline + report highlight ----------------
  push(
    // Municipality outline flashed when a report row is clicked; cleared after
    // a few seconds by highlightMuni().
    { id: 'report_hl-fill', type: 'fill', source: 'report_hl',
      paint: { 'fill-color': '#5eb0ff', 'fill-opacity': 0.1 } },
    { id: 'report_hl-line', type: 'line', source: 'report_hl',
      paint: { 'line-color': '#8ecbff', 'line-width': 2.2, 'line-opacity': 0.95 } },
    { id: 'search_pin-halo', type: 'circle', source: 'search_pin',
      paint: { 'circle-radius': 13, 'circle-color': '#5eb0ff', 'circle-opacity': 0.28,
               'circle-stroke-width': 1.5, 'circle-stroke-color': '#5eb0ff' } },
    { id: 'search_pin-dot', type: 'circle', source: 'search_pin',
      paint: { 'circle-radius': 4.5, 'circle-color': '#5eb0ff', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } },
    { id: 'sel_footprint-line', type: 'line', source: 'sel_footprint',
      paint: { 'line-color': '#ffffff', 'line-width': 1.6, 'line-dasharray': [6, 3], 'line-opacity': 0.9 } },
  );

  // 7. damage editor --------------------------------------------------------
  // Last in the array, so the analyst's own polygons sit above every HOT and
  // Overture layer and stay legible over the imagery.
  push(
    { id: 'edits-fill', type: 'fill', source: 'edits',
      paint: { 'fill-color': EDIT_COLOR, 'fill-opacity': 0.35 } },
    { id: 'edits-line', type: 'line', source: 'edits',
      paint: { 'line-color': EDIT_COLOR, 'line-width': 1.8, 'line-opacity': 0.95 } },
    { id: 'edit_sel-fill', type: 'fill', source: 'edit_sel',
      paint: { 'fill-color': '#5eb0ff', 'fill-opacity': 0.25 } },
    { id: 'edit_sel-line', type: 'line', source: 'edit_sel',
      paint: { 'line-color': '#ffffff', 'line-width': 2.4, 'line-opacity': 0.95 } },
    { id: 'edit_draw-fill', type: 'fill', source: 'edit_draw',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': '#5eb0ff', 'fill-opacity': 0.2 } },
    { id: 'edit_draw-line', type: 'line', source: 'edit_draw',
      filter: ['!=', ['geometry-type'], 'Point'],
      paint: { 'line-color': '#5eb0ff', 'line-width': 2, 'line-dasharray': [3, 2] } },
    { id: 'edit_draw-point', type: 'circle', source: 'edit_draw',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': 4, 'circle-color': '#5eb0ff', 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff' } },
    // Reshape handles, topmost of the lot: amber vertices and smaller blue edge
    // midpoints, styled to match the Image align tool's grab points.
    { id: 'edit_handles-pt', type: 'circle', source: 'edit_handles',
      paint: {
        'circle-radius': ['match', ['get', 'k'], 'v', 6, 4.5],
        'circle-color': ['match', ['get', 'k'], 'v', '#ffb64d', '#5eb0ff'],
        'circle-stroke-color': '#12161c', 'circle-stroke-width': 2,
      } },
  );


  // registry ---------------------------------------------------------------
  for (const g of groups) for (const e of g.entries) {
    ENTRY[e.key] = e;
    for (const id of e.ids) LABEL_OF[id] = e.label;
  }
  QUERY_IDS = Object.keys(LABEL_OF).filter(id =>
    !id.startsWith('aoi_') && !id.startsWith('contour-') && !id.endsWith('-label') && !id.endsWith('-casing'));

  IMAGERY_BEFORE = (sources.hillshade ? 'hillshade' : null)
    || (CONTOUR_IDS.length ? CONTOUR_IDS[0] : null)
    || 'aoi_flood-line';

  // Snapshot each layer's own opacity before anything scales it, so the group
  // slider can multiply rather than overwrite and the relative styling holds.
  OV_BASE = {};
  for (const l of layers) {
    const props = OV_OPACITY_PROPS[l.type];
    if (!props) continue;
    const paint = l.paint || {};
    const rec = {};
    for (const k of props) rec[k] = paint[k] !== undefined ? paint[k] : 1;
    OV_BASE[l.id] = rec;
  }

  GROUPS = groups;
  return { sources, layers };
}

// --------------------------------------------------------------- map set-up
function makeMap(container, defs, side) {
  const style = { version: 8, glyphs: GLYPHS,
    sources: JSON.parse(JSON.stringify(defs.sources)),
    layers: JSON.parse(JSON.stringify(defs.layers)) };
  // Pin the view to the corridor frame (whole-corridor bounds) plus a 100 km pan
  // margin on every side, so imagery at the edges can be dragged into the middle
  // of the screen (owner direction, 8 Sep 2026). The corridor frame itself is unchanged.
  const [w, s0, e, n] = [CFG.HOME[0][0], CFG.HOME[0][1], CFG.HOME[1][0], CFG.HOME[1][1]];
  const PAN_KM = 100, midLat = (s0 + n) / 2;
  const my = PAN_KM / 111.32, mx = PAN_KM / (111.32 * Math.cos(midLat * Math.PI / 180));
  const m = new maplibregl.Map({
    // Zoom stops at 17.49: past that Esri serves "Map data not yet available" tiles here and
    // the page looks broken (owner direction, 6 Sep 2026).
    container, style, maxZoom: 17.49, minZoom: 5, keyboard: false,
    maxBounds: [[w - mx, s0 - my], [e + mx, n + my]],
    attributionControl: { compact: true },
    center: state.center || [85.15, 27.99], zoom: state.zoom != null ? state.zoom : 9,
  });
  m.__side = side;
  // MapLibre opens the compact attribution expanded the first time it has text; start it collapsed to its
  // (i) button so the bottom strip does not obstruct a first look at the map (owner direction, 7 Sep 2026).
  // Watch the class list rather than the load event: the auto-open can come later than 'load'. One click expands it.
  const attrib = m.getContainer().querySelector('.maplibregl-ctrl-attrib');
  if (attrib) {
    const SHOW = 'maplibregl-compact-show';
    const collapse = () => { attrib.classList.remove(SHOW); attrib.removeAttribute('open'); };
    if (attrib.classList.contains(SHOW)) collapse();
    else {
      const mo = new MutationObserver(() => { if (attrib.classList.contains(SHOW)) { collapse(); mo.disconnect(); } });
      mo.observe(attrib, { attributes: true, attributeFilter: ['class'] });
    }
  }
  m.on('error', ev => {
    const msg = (ev && ev.error && ev.error.message) || '';
    if (/40[34]|Failed to fetch|NetworkError|AbortError/i.test(msg)) return;   // sparse tiles / missing optional data
    console.warn('[map:' + side + ']', msg || ev);
    // Anything else (a style that failed validation, a bad expression, a missing source-layer)
    // otherwise shows as a silently black map.  Surface it once so it can be reported.
    if (!m._shownError) { m._shownError = true; toast('Map error (' + side + '): ' + (msg || 'see console').slice(0, 160)); }
  });
  return m;
}

/* Reconciles one map's imagery stack with that side's selection.  Scenes that
 * are already on keep their source and their loaded tiles: only what changed is
 * added or removed, so ticking a second scene does not flicker the first. */
function applyImagery(side) {
  const m = maps[side]; if (!m) return;
  // The style can still be settling right after 'load' (GeoJSON/PMTiles sources
  // fetching); never drop the request silently, re-run once the map is idle.
  if (!m.isStyleLoaded()) { m.once('idle', () => applyImagery(side)); return; }
  const want = selectedLayers(side);                 // bottom first, top last
  const wantIds = want.map(l => l.id);
  const style = m.getStyle();
  const isImg = id => id.indexOf(IMG_PREFIX) === 0;
  const sceneOf = id => id.slice(IMG_PREFIX.length);
  const present = (style.layers || []).map(l => l.id).filter(isImg);

  // 1. drop the scenes that were unticked, layer before source.
  for (const lid of present) if (wantIds.indexOf(sceneOf(lid)) < 0) m.removeLayer(lid);
  for (const sid of Object.keys(style.sources || {}))
    if (isImg(sid) && wantIds.indexOf(sceneOf(sid)) < 0 && m.getSource(sid)) m.removeSource(sid);

  // 2. reorder only if the survivors are no longer in stacking order.
  const kept = present.filter(lid => wantIds.indexOf(sceneOf(lid)) >= 0);
  const kSet = kept.map(sceneOf);
  const target = wantIds.filter(id => kSet.indexOf(id) >= 0);
  const reorder = kSet.join(',') !== target.join(',');

  // 3. add or move, finest first, so each layer's `before` anchor already exists.
  const anchor = m.getLayer(IMAGERY_BEFORE) ? IMAGERY_BEFORE : undefined;
  for (let i = want.length - 1; i >= 0; i--) {
    const lid = imgLayerId(want[i].id);
    const next = i + 1 < want.length ? imgLayerId(want[i + 1].id) : null;
    const before = next && m.getLayer(next) ? next : anchor;
    if (!m.getLayer(lid)) {
      if (!m.getSource(lid)) m.addSource(lid, imagerySource(want[i]));
      m.addLayer({ id: lid, type: 'raster', source: lid, paint: { 'raster-fade-duration': 120 } }, before);
    } else if (reorder) {
      m.moveLayer(lid, before);
    }
  }
  // The photo overlay sits just above the imagery stack; re-adding imagery would bury it.
  if (imgAlign.on) imgAlignEnsureOn(m);
  const fp = m.getSource('sel_footprint');
  if (fp) fp.setData(boundsFC(state.footprintOutline ? want : []));
  refreshTags();
  updateMeta(side);
  setTimeout(() => debugReport('applyImagery:' + side), 1500);
  setTimeout(() => debugReport('applyImagery+6s:' + side), 6000);
}

function setVis(ids, on) {
  for (const side of ['pre', 'post']) {
    const m = maps[side]; if (!m) continue;
    for (const id of ids) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }
}
function eachMap(fn) { for (const side of ['pre', 'post']) if (maps[side]) fn(maps[side], side); }

function applyOverlays() {
  for (const g of GROUPS) for (const e of g.entries) if (!e.hot) setVis(e.ids, state.overlays.has(e.key));
  editor.visible = state.overlays.has('damage_edits');   // the edits layer is toggled from Overlays, not the editor
  applyHot();
}
/* HOT layers: visible when their dataset and source match the switches and the
 * category is ticked.  The AOI outline follows the extent switch. */
function applyHot() {
  for (const h of HOT_LAYERS)
    setVis(h.ids, h.ds === state.hotExtent && state.overlays.has((h.s === 'overture' ? 'ovt_' : 'hot_') + h.cat));
  const aoiOn = state.overlays.has('hot_aoi');
  setVis(['aoi_flood-line'], aoiOn && state.hotExtent === 'flood');
  setVis(['aoi_corridor-line'], aoiOn && state.hotExtent === 'corridor');
  setVis(['aoi_upstream-line'], aoiOn);
  if (hotRefresh) hotRefresh();
}
const hotCount = e => CFG.COUNTS[state.hotExtent][e.cat + '|' + e.src];
function applyBase() {
  setVis(['base-osm'], state.base === 'osm');
  setVis(['base-esri'], state.base === 'esri');
  setVis(['hillshade'], state.hillshade);
  setVis(CONTOUR_IDS, state.contours);
  setVis(PLACE_IDS, state.placeNames);
}
// ------------------------------------------------- group transparency
/* One slider fades the whole damage / ground-report group so the imagery
 * underneath can be read.  Opacity is the only paint property with a natural
 * "scale" — multiplying each layer's own value keeps a 0.35 fill reading as a
 * wash under a 1.0 outline instead of flattening the two together. */
const OV_OPACITY_PROPS = {
  fill: ['fill-opacity'],
  line: ['line-opacity'],
  circle: ['circle-opacity', 'circle-stroke-opacity'],
  symbol: ['icon-opacity', 'text-opacity'],
  raster: ['raster-opacity'],
};
/* Every style layer behind one opacity-slider group, found by its `opacityKey`
 * (so more than one group can carry its own independent slider). The two `hot`
 * rows in the flood group carry no ids of their own — applyHot() resolves them
 * — so expand them the same way. */
function opacityGroupIds(key) {
  const g = (GROUPS || []).find(x => x.opacity && (x.opacityKey || 'flood') === key);
  if (!g) return [];
  const out = [];
  for (const e of g.entries) {
    if (!e.hot) { out.push(...e.ids); continue; }
    if (e.cat) { for (const h of HOT_LAYERS) if (h.cat === e.cat && h.s === e.src) out.push(...h.ids); }
    else out.push('aoi_flood-line', 'aoi_corridor-line', 'aoi_upstream-line');
  }
  return out;
}
function applyGroupOpacity(key, k) {
  const ids = opacityGroupIds(key);
  eachMap(m => {
    for (const id of ids) {
      const base = OV_BASE[id];
      if (!base || !m.getLayer(id)) continue;
      for (const prop of Object.keys(base)) {
        const b = base[prop];
        // A data-driven base (the roads' damaged/undamaged case expression) is
        // scaled inside the expression; at 100 % the original value goes back
        // verbatim so nothing is left wrapped.
        const v = k >= 1 ? b : (Array.isArray(b) ? ['*', b, k] : b * k);
        try { m.setPaintProperty(id, prop, v); } catch (e) { /* layer type has no such prop */ }
      }
    }
  });
}
function storedGroupOpacity(storageKey) {
  try {
    const v = parseFloat(localStorage.getItem(storageKey));
    if (isFinite(v) && v >= 0 && v <= 1) return v;
  } catch (e) { /* private mode */ }
  return 1;
}
function applyOverlayOpacity() { applyGroupOpacity('flood', state.ovOpacity); }
function setOverlayOpacity(v, persist) {
  state.ovOpacity = Math.max(0, Math.min(1, v));
  applyOverlayOpacity();
  if (persist !== false) {
    try { localStorage.setItem('nf26.ov_opacity', String(state.ovOpacity)); } catch (e) { /* private mode */ }
    writeHash();
  }
}
function storedOverlayOpacity() { return storedGroupOpacity('nf26.ov_opacity'); }
function applyAdminOpacity() { applyGroupOpacity('admin', state.adminOpacity); }
function setAdminOpacity(v, persist) {
  state.adminOpacity = Math.max(0, Math.min(1, v));
  applyAdminOpacity();
  if (persist !== false) {
    try { localStorage.setItem('nf26.admin_opacity', String(state.adminOpacity)); } catch (e) { /* private mode */ }
    writeHash();
  }
}
function storedAdminOpacity() { return storedGroupOpacity('nf26.admin_opacity'); }

function applyColorBy() {
  const useStatus = state.colorBy === 'status';
  eachMap(m => {
    for (const t of PAINT_TARGETS) {
      if (!m.getLayer(t.id)) continue;
      try { m.setPaintProperty(t.id, t.prop, useStatus ? (t.status || STATUS_EXPR) : t.def); } catch (e) { /* ignore */ }
    }
  });
}

// ------------------------------------------------------------ swipe divider
function setSwipe(p, write) {
  state.swipe = Math.max(1, Math.min(99, p));
  $('#divider').style.left = state.swipe + '%';
  applyMode();
  if (write !== false) writeHash();
}
function setMode(m) { state.mode = m; applyMode(); refreshTags(); writeHash(); }
function applyMode() {
  document.body.dataset.mode = state.mode;
  const clip = state.mode === 'pre' ? 'inset(0 0 0 100%)'
    : state.mode === 'post' ? 'inset(0 0 0 0)'
    : 'inset(0 0 0 ' + state.swipe + '%)';
  // Clip the canvas container rather than #mapPost itself: the map controls live
  // in a sibling container, so they stay visible and clickable in every mode.
  // clip-path also clips hit testing, which is what routes clicks on the left
  // half to the PRE map.
  const post = $('#mapPost');
  const canvas = post.querySelector ? post.querySelector('.maplibregl-canvas-container') : null;
  (canvas || post).style.clipPath = clip;
  for (const b of document.querySelectorAll('#modeSeg button'))
    b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode));
}

function wireDivider() {
  const d = $('#divider'), stage = $('#stage');
  let dragging = false;
  const move = ev => {
    if (!dragging) return;
    const r = stage.getBoundingClientRect();
    const x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
    setSwipe((x / r.width) * 100, false);
    ev.preventDefault();
  };
  const up = () => { if (dragging) { dragging = false; writeHash(); } };
  d.addEventListener('pointerdown', ev => { dragging = true; d.setPointerCapture(ev.pointerId); ev.preventDefault(); });
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

// ------------------------------------------------------------ sidebar rail
/* Two rails: #panel on the left (info, search, reports, legend, notes, imagery) and #controls
 * on the right (view, basemap, overlays).  Each remembers its own
 * open state; on a phone both default closed and float over the map. */
function storedRail(key) {
  try { const v = localStorage.getItem('nf26.' + key); if (v !== null) return v === '1'; } catch (e) { /* private mode */ }
  try { if (window.matchMedia) return !window.matchMedia('(max-width: 780px)').matches; } catch (e) { /* no matchMedia */ }
  return true;
}
function applySidebar(persist) {
  document.body.classList.toggle('sidebar-open', state.sidebar);
  document.body.classList.toggle('controls-open', state.controls);
  const b = $('#sidebarToggle');
  if (b) {
    b.textContent = state.sidebar ? '\u25c2' : '\u25b8';
    b.setAttribute('aria-expanded', String(state.sidebar));
    b.setAttribute('title', (state.sidebar ? 'Hide' : 'Show') + ' the info panel (B)');
  }
  const cb = $('#controlsToggle');
  if (cb) {
    cb.textContent = state.controls ? '\u25b8' : '\u25c2';
    cb.setAttribute('aria-expanded', String(state.controls));
    cb.setAttribute('title', (state.controls ? 'Hide' : 'Show') + ' the layer controls (C)');
  }
  if (persist !== false) {
    try { localStorage.setItem('nf26.sidebar', state.sidebar ? '1' : '0'); localStorage.setItem('nf26.controls', state.controls ? '1' : '0'); }
    catch (e) { /* private mode */ }
  }
  setTimeout(() => eachMap(m => m.resize()), 220);   // after the CSS transition
}
function toggleSidebar() { state.sidebar = !state.sidebar; applySidebar(); writeHash(); }
function toggleControls() { state.controls = !state.controls; applySidebar(); writeHash(); }

// -------------------------------------------------------------- hash state
let hashWriting = false;
function serialiseOverlays() {
  const diff = [];
  for (const g of GROUPS) for (const e of g.entries) {
    const on = state.overlays.has(e.key);
    if (on !== !!e.on) diff.push((on ? '+' : '-') + e.key);
  }
  return diff.join(',');
}
function writeHash() {
  if (!maps.post) return;
  const c = maps.post.getCenter(), z = maps.post.getZoom();
  const p = new URLSearchParams();
  p.set('m', state.mode);
  p.set('pre', selIds('pre').join(',') || NO_IMAGERY);
  p.set('post', selIds('post').join(',') || NO_IMAGERY);
  p.set('c', c.lng.toFixed(5) + ',' + c.lat.toFixed(5));
  p.set('z', z.toFixed(2));
  p.set('s', state.swipe.toFixed(1));
  p.set('b', state.base);
  if (state.hillshade) p.set('hs', '1');
  if (state.contours) p.set('ct', '1');   // off by default; ct=0 in old links still parses
  if (!state.placeNames) p.set('pn', '0');
  if (state.colorBy !== 'layer') p.set('cb', state.colorBy);
  if (state.footprintOutline) p.set('fo', '1');
  if (state.hotExtent !== 'flood') p.set('hx', state.hotExtent);
  if (state.ovOpacity < 1) p.set('oo', Math.round(state.ovOpacity * 100));
  if (state.adminOpacity < 1) p.set('oa', Math.round(state.adminOpacity * 100));
  if (!state.sidebar) p.set('sb', '0');
  if (!state.controls) p.set('sc', '0');
  const ov = serialiseOverlays();
  if (ov) p.set('ov', ov);
  hashWriting = true;
  // Commas separate the scene lists, the centre pair and the overlay diff; they
  // are legal in a fragment, so put them back verbatim for a readable link.
  history.replaceState(null, '', '#' + p.toString().replace(/%2C/g, ','));
  setTimeout(() => { hashWriting = false; }, 0);
}
function readHash() {
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (p.get('m')) state.mode = p.get('m');
  // `pre` / `post` are comma-separated id lists; a single id (every link
  // written before Sep 2026) parses as a one-element list, `none` as empty.
  // The order is the stacking order (index 0 = bottom, last = top): keep it
  // exactly as given, don't resort it.
  for (const side of ['pre', 'post']) {
    const v = p.get(side);
    if (v === null) continue;
    state[side] = v.split(',').map(x => x.trim()).filter(x => x && x !== NO_IMAGERY);
    hashHadSide[side] = true;
  }
  if (p.get('s')) state.swipe = parseFloat(p.get('s'));
  if (p.get('b')) state.base = p.get('b');
  if (p.get('hs')) state.hillshade = p.get('hs') === '1';
  if (p.get('ct')) state.contours = p.get('ct') !== '0';
  if (p.get('pn')) state.placeNames = p.get('pn') !== '0';
  legacyAoiOff = p.get('ao') === '0';   // pre-Sep-2026 links; the outline is an overlay entry now
  if (p.get('cb')) state.colorBy = p.get('cb');
  if (p.get('fo')) state.footprintOutline = p.get('fo') === '1';
  if (['flood', 'corridor'].includes(p.get('hx'))) state.hotExtent = p.get('hx');
  // oo/oa are percentages; the hash wins over localStorage, as it does for the rails.
  const oo = p.get('oo') !== null ? parseFloat(p.get('oo')) : NaN;
  state.ovOpacity = isFinite(oo) ? Math.max(0, Math.min(1, oo / 100)) : storedOverlayOpacity();
  const oa = p.get('oa') !== null ? parseFloat(p.get('oa')) : NaN;
  state.adminOpacity = isFinite(oa) ? Math.max(0, Math.min(1, oa / 100)) : storedAdminOpacity();
  legacyOverture = p.get('ho') === 'overture';   // links from when OSM/Overture was a switch
  state.sidebar = p.get('sb') ? p.get('sb') !== '0' : storedRail('sidebar');
  state.controls = p.get('sc') ? p.get('sc') !== '0' : storedRail('controls');
  const c = p.get('c');
  if (c && /^-?[\d.]+,-?[\d.]+$/.test(c)) state.center = c.split(',').map(Number);
  if (p.get('z')) state.zoom = parseFloat(p.get('z'));
  return p.get('ov');
}
let legacyAoiOff = false, legacyOverture = false;
const hashHadSide = { pre: false, post: false };   // seed the defaults only when the hash is silent
function applyOverlayDiff(ov) {
  state.overlays = new Set();
  for (const g of GROUPS) for (const e of g.entries) if (e.on) state.overlays.add(e.key);
  if (legacyAoiOff) state.overlays.delete('hot_aoi');
  if (legacyOverture) for (const k of [...state.overlays]) {
    const o = k.replace(/^hot_/, 'ovt_');
    if (o !== k && ENTRY[o]) { state.overlays.delete(k); state.overlays.add(o); }
  }
  if (!ov) return;
  for (const tok of ov.split(',')) {
    let k = tok.slice(1);
    // Links from before the HOT groups were merged: flood-<cat>-osm → hot_<cat>
    const old = /^(flood|corridor)-(.+)-(osm|overture)$/.exec(k);
    if (old) { k = (old[3] === 'overture' ? 'ovt_' : 'hot_') + old[2]; if (tok[0] === '+') state.hotExtent = old[1]; }
    if (k === 'aoi_flood' || k === 'aoi_corridor') k = 'hot_aoi';   // older per-extent keys
    if (k.startsWith('ct_') || k === 'contours') { if (tok[0] === '-') state.contours = false; continue; }
    if (!ENTRY[k]) continue;
    if (tok[0] === '+') state.overlays.add(k); else state.overlays.delete(k);
  }
}

// ----------------------------------------------------------------- sidebar
/* Row text for the corner menus: the catalogue `label` ("28 Aug 2026 · Vantor
 * WorldView-2 0.54 m") when the entry has one, else built from its fields. */
const sceneText = l => l.label ||
  (fmtDate(l.date) + ' \u00b7 ' + (l.sensor || '') + (l.gsd_m ? ' ' + l.gsd_m + ' m' : '')).trim();

const COVERAGE_ORDER = ['trisuli_bazar', 'upper_valley', 'corridor'];
/* This side's scenes grouped by coverage, in the corner menu's display order. */
function scenesByCoverage(side) {
  const byCov = {};
  for (const l of layersFor(side)) (byCov[l.coverage || 'corridor'] ||= []).push(l);
  return Object.keys(byCov)
    .sort((a, b) => COVERAGE_ORDER.indexOf(a) - COVERAGE_ORDER.indexOf(b))
    .map(cov => [CFG.COVERAGE_LABEL[cov] || cov, byCov[cov]]);
}

/* The two corner tags.  Each is a button carrying the current selection plus a
 * pop-up menu of checkbox rows: any number of scenes can be on per side.  The
 * menu stays open while rows are ticked and closes on Escape, an outside click
 * or a view choice. */
function buildTags() {
  for (const side of ['pre', 'post']) {
    const wrap = $('#tag' + (side === 'pre' ? 'Pre' : 'Post'));
    if (!wrap) continue;
    const btn = wrap.querySelector('.tag');
    const menu = wrap.querySelector('.tagmenu');
    const t = { wrap, btn, menu, boxes: [], only: null };
    tagEl[side] = t;

    const none = el('button', 'tm-item tm-none', 'None \u00b7 basemap only');
    none.type = 'button';
    none.addEventListener('click', () => { state[side] = []; applyImagery(side); writeHash(); });
    menu.appendChild(none);
    t.none = none;

    const groups = scenesByCoverage(side);
    if (!groups.length) menu.appendChild(el('div', 'tm-empty', '(no ' + side + ' imagery in catalogue)'));
    for (const [label, list] of groups) {
      menu.appendChild(el('div', 'tm-hd', label));
      for (const l of list) {
        const row = el('label', 'tm-row');
        const cb = el('input'); cb.type = 'checkbox'; cb.checked = isSel(side, l.id);
        row.title = CFG.SCENES[l.id] || l.label || '';
        row.append(cb, el('span', 't', sceneText(l)));
        cb.addEventListener('change', () => { toggleScene(side, l.id, cb.checked); applyImagery(side); writeHash(); });
        t.boxes.push({ id: l.id, cb });
        menu.appendChild(row);
      }
    }

    const stack = el('div', 'tm-stack');
    menu.appendChild(stack);
    t.stack = stack;

    menu.appendChild(el('div', 'tm-hd', 'View'));
    const only = el('button', 'tm-item', side === 'pre' ? 'Pre only' : 'Post only');
    only.type = 'button';
    only.addEventListener('click', () => { closeTagMenus(); setMode(state.mode === side ? 'swipe' : side); });
    const both = el('button', 'tm-item', 'Compare (swipe)');
    both.type = 'button';
    both.addEventListener('click', () => { closeTagMenus(); setMode('swipe'); });
    menu.append(only, both);
    t.only = only;

    btn.addEventListener('click', ev => { ev.stopPropagation(); openTagMenu(menu.hidden ? side : null); });
    menu.addEventListener('click', ev => ev.stopPropagation());
    wrap.addEventListener('keydown', ev => {
      if (ev.key !== 'Escape' || menu.hidden) return;
      closeTagMenus(); btn.focus(); ev.stopPropagation();
    });
  }
  document.addEventListener('click', () => closeTagMenus());
  refreshTags();
}
function openTagMenu(side) {
  for (const s2 of ['pre', 'post']) {
    const t = tagEl[s2]; if (!t) continue;
    const on = s2 === side;
    t.menu.hidden = !on;
    t.btn.setAttribute('aria-expanded', String(on));
    t.wrap.classList.toggle('open', on);
  }
}
const closeTagMenus = () => openTagMenu(null);

/* Keeps both tags showing their current selection, ticks the active view option
 * and outlines the side that is being shown alone. */
function refreshTags() {
  for (const side of ['pre', 'post']) {
    const t = tagEl[side];
    if (!t) continue;
    const ids = selIds(side);
    t.only.textContent = (state.mode === side ? '\u2713 ' : '') + (side === 'pre' ? 'Pre only' : 'Post only');
    t.none.textContent = (ids.length ? '' : '\u2713 ') + 'None \u00b7 basemap only';
    const one = ids.length === 1 ? byId(ids[0]) : null;
    t.btn.textContent = !ids.length ? 'None \u00b7 basemap only'
      : one ? sceneText(one) : ids.length + ' scenes';
    t.btn.title = ids.length > 1 ? selectedLayers(side).map(sceneText).join('\n') : '';
    for (const b of t.boxes) b.cb.checked = isSel(side, b.id);
    t.btn.classList.toggle('only', state.mode === side);
    renderStack(side);
  }
}
/* Rebuilds the "Stacking" rows for one side's tag menu: only shown once two
 * or more scenes are selected there, listed top-most first, each with \u25b2/\u25bc
 * buttons that step it one place towards the top or bottom of the stack.
 * Called from refreshTags so it always matches the current selection and
 * order (including right after a reorder, so the menu stays in sync and
 * open). */
function renderStack(side) {
  const t = tagEl[side];
  if (!t || !t.stack) return;
  const wrap = t.stack;
  wrap.innerHTML = '';
  const list = selIds(side);               // bottom -> top
  if (list.length < 2) return;
  wrap.appendChild(el('div', 'tm-hd', 'Stacking \u00b7 top first'));
  for (let i = list.length - 1; i >= 0; i--) {
    const l = byId(list[i]);
    if (!l) continue;
    const id = list[i];
    const row = el('div', 'tm-row tm-stackrow');
    row.appendChild(el('span', 't', sceneText(l)));
    const up = el('button', 'tm-arrow', '\u25b2');
    up.type = 'button'; up.title = 'Bring up'; up.disabled = i === list.length - 1;
    up.setAttribute('aria-label', 'Bring ' + sceneText(l) + ' up');
    const down = el('button', 'tm-arrow', '\u25bc');
    down.type = 'button'; down.title = 'Send down'; down.disabled = i === 0;
    down.setAttribute('aria-label', 'Send ' + sceneText(l) + ' down');
    up.addEventListener('click', ev => { ev.stopPropagation(); reorderScene(side, id, 1); });
    down.addEventListener('click', ev => { ev.stopPropagation(); reorderScene(side, id, -1); });
    row.append(up, down);
    wrap.appendChild(row);
  }
}
function updateMeta(side) {
  const n = document.querySelector('#meta' + side);
  if (n) n.innerHTML = describeSide(side);
}
/* Sidebar metadata: one block per selected scene, in stacking order, top of
 * the stack first — matching the Stacking rows in the tag menu. */
function describeSide(side) {
  const list = selectedLayers(side).slice().reverse();
  if (!list.length) return 'No imagery, basemap only';
  return list.map(describe).join('<div class="metasep"></div>');
}
function describe(l) {
  if (!l) return '<i>no layer selected</i>';
  const bits = [];
  bits.push('<b>' + (l.label || l.id) + '</b>');
  const facts = [fmtDate(l.date), l.sensor, l.provider, l.gsd_m ? l.gsd_m + ' m GSD' : null,
                 CFG.COVERAGE_LABEL[l.coverage] || l.coverage,
                 l.size_mb ? l.size_mb + ' MB' : null].filter(Boolean);
  if (facts.length) bits.push(facts.join(' \u00b7 '));
  if (l.attribution) bits.push(l.attribution);
  const note = CFG.SCENES[l.id];
  if (note) bits.push('<span class="scenenote">' + note + '</span>');
  return bits.join('<br>');
}

/* The group transparency slider, sitting under that group's all on / all off
 * row.  Live on input so the fade can be judged against the imagery, and only
 * persisted on release so a sweep does not write eighty hash entries. */
const OPACITY_GROUP_UI = {
  flood: { get: () => state.ovOpacity, set: setOverlayOpacity, aria: 'Opacity of the flood extent, damage and ground report layers' },
  admin: { get: () => state.adminOpacity, set: setAdminOpacity, aria: 'Opacity of the administrative boundary layers' },
};
function buildGroupOpacity(opacityKey) {
  const cfg = OPACITY_GROUP_UI[opacityKey || 'flood'];
  const f = el('div', 'field ovop');
  const lab = el('label', null, 'Layer opacity, whole group <span class="ovop-n"></span>');
  const n = lab.querySelector('.ovop-n');
  const sl = el('input');
  sl.type = 'range'; sl.min = '0'; sl.max = '100'; sl.step = '1';
  sl.value = String(Math.round(cfg.get() * 100));
  sl.title = 'Fade every layer in this group together, keeping their relative styling';
  sl.setAttribute('aria-label', cfg.aria);
  const show = () => { n.textContent = sl.value + '%'; };
  show();
  sl.addEventListener('input', () => { show(); cfg.set(+sl.value / 100, false); });
  sl.addEventListener('change', () => { show(); cfg.set(+sl.value / 100); });
  f.append(lab, sl);
  return f;
}

function renderSidebar() {
  const pad = $('#panel .pad');            // left: info, search, reports, legend, notes, imagery
  const cpad = $('#controls .pad');        // right: view, basemap, overlays

  // a. as-of strip, directly under the static title and intro ---------------
  renderAsOf(pad);

  // b. search --------------------------------------------------------------
  renderSearch(pad);

  // mode ------------------------------------------------------------------
  const modeBlock = el('div', 'block', '<h2>View</h2>');
  const seg = el('div', 'seg'); seg.id = 'modeSeg';
  for (const [m, t] of [['pre', 'Before'], ['swipe', 'Swipe'], ['post', 'After']]) {
    const b = el('button', null, t); b.dataset.mode = m;
    b.addEventListener('click', () => setMode(m));
    seg.appendChild(b);
  }
  modeBlock.appendChild(seg);
  cpad.appendChild(modeBlock);

  // imagery selectors -----------------------------------------------------
  const imgBlock = el('div', 'block', '<h2>Imagery</h2>');
  imgBlock.appendChild(el('p', 'note', 'Choose scenes with the tags at the top of the map \u2014 tick as many as you like per side; finer scenes go on top by default, and the Stacking rows in the menu let you reorder overlapping scenes.'));
  for (const side of ['pre', 'post']) {
    const f = el('div', 'field');
    f.appendChild(el('label', null, side === 'pre' ? 'Before (left)' : 'After (right)'));
    const meta = el('p', 'meta side-' + side);
    meta.id = 'meta' + side;
    meta.innerHTML = describeSide(side);
    f.appendChild(meta);
    imgBlock.appendChild(f);
  }
  if (catalogNote) imgBlock.appendChild(el('p', 'warn', catalogNote));
  // appended to the left rail last, after the notes (see below)

  // basemap ---------------------------------------------------------------
  const bmBlock = el('div', 'block', '<h2>Basemap</h2>');
  for (const [v, t] of [['osm', 'OpenStreetMap'], ['esri', 'Esri World Imagery'], ['none', 'None (black)']]) {
    const r = el('label', 'row');
    const i = el('input'); i.type = 'radio'; i.name = 'bm'; i.value = v; i.checked = state.base === v;
    i.addEventListener('change', () => { state.base = v; applyBase(); writeHash(); });
    r.append(i, el('span', 't', t));
    bmBlock.appendChild(r);
  }
  const hs = el('label', 'row');
  const hsCb = el('input'); hsCb.type = 'checkbox'; hsCb.checked = state.hillshade;
  hsCb.disabled = !(terrain && terrain.hillshade);
  hsCb.addEventListener('change', () => { state.hillshade = hsCb.checked; applyBase(); writeHash(); });
  hs.append(hsCb, el('span', 't', 'Hillshade' + (hsCb.disabled ? ' (not built)' : '')));
  bmBlock.appendChild(hs);
  const ct = el('label', 'row');
  const ctCb = el('input'); ctCb.type = 'checkbox'; ctCb.checked = state.contours;
  ctCb.disabled = !CONTOUR_IDS.length;
  ctCb.addEventListener('change', () => { state.contours = ctCb.checked; applyBase(); writeHash(); });
  ct.append(ctCb, el('span', 't', ctCb.disabled ? 'Contours (not built)' : 'Contours'));
  ct.title = 'Copernicus GLO-30: 10–50 m intervals in the flood area, 100 m to 2 km beyond it, 500 m and 1000 m to 10 km';
  bmBlock.appendChild(ct);
  const pn = el('label', 'row');
  const pnCb = el('input'); pnCb.type = 'checkbox'; pnCb.checked = state.placeNames;
  pnCb.addEventListener('change', () => { state.placeNames = pnCb.checked; applyBase(); writeHash(); });
  pn.append(pnCb, el('span', 't', 'Place names'));
  pn.title = 'Settlements from OpenStreetMap: district headquarters and towns from zoom 8, villages from 11, hamlets from 13';
  bmBlock.appendChild(pn);
  cpad.appendChild(bmBlock);

  // zoom to ---------------------------------------------------------------
  const zBlock = el('div', 'block', '<h2>Zoom to</h2>');
  const chips = el('div', 'chips');
  for (const p of CFG.PLACES) {
    const b = el('button', null, p.label);
    b.addEventListener('click', () => maps.post.fitBounds(p.bounds, { padding: 30 }));
    chips.appendChild(b);
  }
  zBlock.appendChild(chips);
  const share = el('button', null, 'Copy link to this view');
  share.style.marginTop = '6px';
  share.addEventListener('click', async () => {
    const url = location.href || (location.origin + location.pathname + location.search + location.hash);
    try { await navigator.clipboard.writeText(url); toast('Link copied'); }
    catch (e) { toast('Copy failed — the link is in the address bar'); }
  });
  zBlock.appendChild(share);
  pad.appendChild(zBlock);

  // Collapsible sections whose body is built on first open.  `cls` adds a
  // class to the body so the report panels can carry a taller scroll cap.
  const lazy = (title, note, fill, cls) => {
    const b = el('div', 'block');
    const det = el('details');
    det.appendChild(el('summary', null, title));
    const body = el('div', 'lazy' + (cls ? ' ' + cls : ''), '<p class="note">' + note + '</p>');
    det.appendChild(body);
    let done = false;
    det.addEventListener('toggle', () => { if (done) return; done = true; fill(det, body); });
    b.appendChild(det);
    pad.appendChild(b);
    return det;
  };
  // c. casualties — rendered straight away and open by default -------------
  renderCasualties(pad);

  // d-f. the three remaining report sections, each loaded on first open -----
  lazy('Municipality reports', 'Loading…', renderMunicipalities, 'rep');
  lazy('Hydropower &amp; grid', 'Loading…', renderEnergy, 'rep');
  lazy('Communities affected', 'Loading…', renderCommunities, 'rep');

  // g. bridge ground reports, then legend, notes and imagery ---------------
  lazy('Bridge ground reports', 'Loading…', renderBridges);

  // overlays --------------------------------------------------------------
  const oBlock = el('div', 'block', '<h2>Overlays</h2>');
  const cbRow = el('div', 'field');
  cbRow.appendChild(el('label', null, 'Colour features by'));
  const cbSeg = el('div', 'seg');
  for (const [v, t] of [['layer', 'Layer palette'], ['status', 'Status']]) {
    const b = el('button', null, t); b.dataset.cb = v;
    b.setAttribute('aria-pressed', String(state.colorBy === v));
    b.addEventListener('click', () => {
      state.colorBy = v; applyColorBy(); writeHash();
      for (const x of cbSeg.children) x.setAttribute('aria-pressed', String(x.dataset.cb === v));
    });
    cbSeg.appendChild(b);
  }
  cbRow.appendChild(cbSeg);
  oBlock.appendChild(cbRow);

  const segField = (label, key, opts, onPick) => {
    const f = el('div', 'field hotseg');
    f.appendChild(el('label', null, label));
    const seg = el('div', 'seg');
    for (const [v, t] of opts) {
      const b = el('button', null, t); b.dataset.v = v;
      b.setAttribute('aria-pressed', String(state[key] === v));
      b.addEventListener('click', () => {
        state[key] = v; onPick();
        for (const x of seg.children) x.setAttribute('aria-pressed', String(x.dataset.v === v));
      });
      seg.appendChild(b);
    }
    f.appendChild(seg);
    return f;
  };

  const hotRows = [];
  for (const g of GROUPS) {
    const det = el('details');
    det.open = g.open !== undefined ? g.open : (g.entries.some(e => state.overlays.has(e.key)) && g.entries.length < 12);
    const sum = el('summary', null, g.title + (g.entries.length > 1 ? ' <span class="n">' + g.entries.length + '</span>' : ''));
    det.appendChild(sum);
    if (g.extent) {
      det.appendChild(segField('Extent', 'hotExtent',
        [['flood', 'Flood area (+200 m)'], ['corridor', 'River corridor (1 km)']], () => { applyHot(); writeHash(); }));
    }
    const ctl = el('div', 'grp', '<button data-all="1">all on</button><button data-all="0">all off</button>');
    if (g.entries.length > 1 && !g.noAll) det.appendChild(ctl);
    if (g.opacity) det.appendChild(buildGroupOpacity(g.opacityKey));
    const boxes = [], rows = [];
    for (const e of g.entries) {
      const row = el('label', 'row');
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = state.overlays.has(e.key);
      cb.dataset.ovkey = e.key;      // so a report row can switch its own layer on
      const sw = el('span', 'sw' + (e.outline ? ' outline' : ''));
      sw.style.background = e.color; sw.style.borderColor = e.color;
      row.append(cb, sw, el('span', 't', e.label));
      const cnt = el('span', 'cnt', e.count !== undefined ? fmtCount(e.count) : '');
      row.appendChild(cnt);
      cb.addEventListener('change', () => {
        if (cb.checked) state.overlays.add(e.key); else state.overlays.delete(e.key);
        if (e.hot) applyHot(); else setVis(e.ids, cb.checked);
        writeHash();
      });
      // A category whose tiles start above the corridor view draws nothing until
      // you zoom in; say so rather than leave a ticked box with an empty map.
      const minz = e.hot && e.cat ? HOT_MINZ[e.cat + '|' + e.src] : null;
      if (minz != null && minz > 9) row.title = e.label + ' — in the tiles from zoom ' + minz + ' down; the count column reads z' + minz + '+ while the view is above it';
      boxes.push([cb, e]); rows.push({ e, row, cb, sw, cnt });
      if (e.hot) hotRows.push({ e, row, cb, cnt, minz });
      det.appendChild(row);
    }
    ctl.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      const on = b.dataset.all === '1';
      for (const [cb, e] of boxes) {
        if (cb.disabled) continue;
        cb.checked = on; if (on) state.overlays.add(e.key); else state.overlays.delete(e.key);
        if (!e.hot) setVis(e.ids, on);
      }
      if (boxes.some(([, e]) => e.hot)) applyHot();
      writeHash();
    }));
    oBlock.appendChild(det);
  }
  // Counts follow the Extent switch; a category the current extent does not carry is hidden.
  hotRefresh = () => {
    const z = maps.post ? maps.post.getZoom() : 99;
    for (const r of hotRows) {
      if (!r.e.cat) continue;
      const n = hotCount(r.e);
      const gated = r.minz != null && z < r.minz;
      r.cnt.textContent = n === undefined ? '' : gated ? 'z' + r.minz + '+' : fmtCount(n);
      r.cb.disabled = n === undefined;
      r.row.hidden = n === undefined;      // e.g. Overture roads exist only in the corridor dataset
    }
  };
  hotRefresh();
  cpad.appendChild(oBlock);

  // damage editor ---------------------------------------------------------
  cpad.appendChild(buildDamageEditor());

  // image align (local owner tool, ?align=1 only) ---------------------------
  if (ALIGN_TOOL) cpad.appendChild(buildImageAlign());

  // legend ----------------------------------------------------------------
  const lBlock = el('div', 'block', '<h2>Legend</h2>');
  const lg = el('div', 'legend');
  const add = (color, text, outline) => {
    const sw = el('span', 'sw' + (outline ? ' outline' : ''));
    sw.style.background = color; sw.style.borderColor = color;
    lg.append(sw, el('span', null, text));
  };
  lg.appendChild(el('div', 'hd', 'OSM feature status'));
  add(CFG.STATUS.standing, 'Standing');
  add(CFG.STATUS.damaged, 'Damaged');
  add(CFG.STATUS.destroyed, 'Destroyed');
  lg.appendChild(el('div', 'hd', 'fAIr AI damage class'));
  add(CFG.FAIR['destroyed'], 'Destroyed');
  add(CFG.FAIR['major-damage'], 'Major damage');
  add(CFG.FAIR['minor-damage'], 'Minor damage');
  add(CFG.FAIR['no-damage'], 'No damage');
  add(CFG.FAIR['no-data'], 'No data');
  lg.appendChild(el('div', 'hd', 'Areas'));
  add('#7f1d1d', 'Flood extent, 27 Aug 2026');
  add(CFG.CATS.find(([cat]) => cat === 'destroyed_features')[3], 'Destroyed and damaged features (volunteer-recorded, OSM)');
  add('rgba(203,213,225,.6)', 'Area of interest (HOT flood area solid, corridor dashed, upstream Lende Khola dotted)', true);
  add('#c084fc', 'Glacier / rock detachment zone and collapse origin (UNOSAT, Landsat-9 26 Aug)');
  add('#7dd3fc', 'Barrier lakes formed by the collapse (UNOSAT, Cartosat-3 28 Aug)');
  add('#f87171', 'Settlement name inside the flood-affected area (others white)');
  lBlock.appendChild(lg);

  const roadLg = el('div', 'roadlg');
  roadLg.innerHTML =
    '<div class="hd">Roads and bridges (white, dark casing)</div>' +
    '<div class="r"><i class="rl w4 hw"></i>Trunk and primary (national highway, labelled by name)</div>' +
    '<div class="r"><i class="rl w3"></i>Secondary and tertiary</div>' +
    '<div class="r"><i class="rl w2"></i>Residential, service</div>' +
    '<div class="r"><i class="rl w2 dash"></i>Track</div>' +
    '<div class="r"><i class="rl w1 dot"></i>Path, steps, footbridge</div>' +
    '<div class="r"><i class="rl w4 heavy"></i>Road bridge span</div>' +
    '<div class="r"><i class="rl w3 red"></i>Flood-damaged road (HOT status) or inside the observed flood extent</div>' +
    '<div class="r"><span class="note">Beyond the 1 km corridor, roads come from the national OSM export (trunk to tertiary only).</span></div>' +
    '<div class="hd">Copernicus EMS road grading (EMSR927)</div>' +
    '<div class="r"><i class="rl w3 ems-destroyed"></i>Destroyed</div>' +
    '<div class="r"><i class="rl w3 ems-damaged"></i>Damaged</div>' +
    '<div class="r"><i class="rl w2 ems-possible dash"></i>Possibly damaged</div>' +
    '<div class="hd">Contours (GLO-30)</div>' +
    '<div class="r"><i class="rl ct idx"></i>Index line, multiple of 100 m</div>' +
    '<div class="r"><i class="rl ct"></i>Intermediate line</div>';
  lBlock.appendChild(roadLg);
  lBlock.appendChild(el('p', 'note',
    'The PMTiles build of the HOT catalogue carries only <code>category</code>, <code>source</code> and <code>name</code>, ' +
    'so in status colouring its buildings and roads fall back to grey and the “destroyed and damaged features” category to red. ' +
    'The bridge ground-report layer carries true per-feature status.'));
  pad.appendChild(lBlock);

  // notes -----------------------------------------------------------------
  const nBlock = el('div', 'block');
  const det = el('details'); det.id = 'notes';
  det.appendChild(el('summary', null, 'Sources &amp; notes'));
  const body = el('div', null, CFG.NOTES_HTML);
  det.appendChild(body);
  nBlock.appendChild(det);
  pad.appendChild(nBlock);
  pad.appendChild(imgBlock);               // imagery metadata sits at the bottom of the info rail
  const dl = body.querySelector('#sceneList');
  const ids = catalog.layers.length ? catalog.layers.map(l => l.id) : Object.keys(CFG.SCENES);
  for (const id of ids) {
    const l = byId(id);
    const title = l ? `${l.label || id} — ${fmtDate(l.date)}` : id;
    dl.appendChild(el('dt', null, title));
    dl.appendChild(el('dd', null, CFG.SCENES[id] || (l && l.attribution) || ''));
  }
}

// ------------------------------------------------------- local dataset help
const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gjCache = {};
async function gj(file) {
  if (gjCache[file] !== undefined) return gjCache[file];
  try { gjCache[file] = await getJSON(HDX + file); } catch (e) { gjCache[file] = null; }
  return gjCache[file];
}
/* Mean of a feature's coordinates — good enough to fly to and to bbox-test. */
function centroid(g) {
  if (!g || !g.coordinates) return null;
  const pts = [];
  (function walk(c) {
    if (typeof c[0] === 'number') { pts.push(c); return; }
    for (const x of c) { if (pts.length > 400) return; walk(x); }
  })(g.coordinates);
  if (!pts.length) return null;
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}
const STATUS_COLOUR = {
  standing: CFG.STATUS.standing, intact: '#2ca25f',   // matches the bridge ground-report circles
  damaged: CFG.STATUS.damaged, 'major damage': CFG.STATUS.damaged,
  destroyed: CFG.STATUS.destroyed, 'washed out': CFG.STATUS.destroyed,
};
const statusColour = v => STATUS_COLOUR[String(v || '').toLowerCase()] || '#64748b';

function dropPin(lngLat, zoom) {
  const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {},
    geometry: { type: 'Point', coordinates: lngLat } }] };
  eachMap(m => { const src = m.getSource('search_pin'); if (src) src.setData(fc); });
  if (maps.post) maps.post.flyTo({ center: lngLat, zoom: zoom || Math.max(maps.post.getZoom(), 15), duration: 900 });
}
function toast(msg) {
  let t = $('#toast');
  if (!t) { t = el('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = 'show';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = ''; }, 2200);
}

// ------------------------------------------------------------ place search
const SEARCH_FILES = [
  ['hot_flood_npl_corridor/populated_places_osm.geojson', 'Settlement'],
  ['hot_flood_npl_corridor/points_of_interest_osm.geojson', 'Point of interest'],
  ['hot_flood_npl_corridor/education_facilities_osm.geojson', 'Education'],
  ['hot_flood_npl_corridor/health_facilities_osm.geojson', 'Health'],
  ['hot_flood_npl_corridor/police_stations_osm.geojson', 'Police'],
  ['hot_flood_npl_corridor/bridges_osm.geojson', 'Bridge'],
  ['hot_flood_npl/hot_flood_npl_bridge_damage.geojson', 'Bridge report'],
];
let searchIndex = null, searchLoading = null;
function buildSearchIndex() {
  if (searchIndex) return Promise.resolve(searchIndex);
  if (searchLoading) return searchLoading;
  searchLoading = (async () => {
    const out = [], seen = new Set();
    for (const [file, kind] of SEARCH_FILES) {
      const d = await gj(file);
      if (!d || !d.features) continue;
      for (const f of d.features) {
        const p = f.properties || {};
        const name = p.name || p.name_en || p.name_latin || p.name_ne;
        if (!name) continue;
        const c = centroid(f.geometry);
        if (!c) continue;
        const k = name + '@' + c[0].toFixed(3) + ',' + c[1].toFixed(3);
        if (seen.has(k)) continue;
        seen.add(k);
        const type = [p.amenity, p.place, p.man_made, p.shop, p.tourism, p.bridge_structure, p.feature_type]
          .find(v => v && v !== 'yes');
        out.push({ name: String(name), ne: p.name_ne && p.name_ne !== name ? String(p.name_ne) : '',
          kind, type: type ? String(type).replace(/_/g, ' ') : kind.toLowerCase(),
          adm3: p.adm3_name || '', status: p.status || '', c, props: p, label: kind });
      }
    }
    for (const r of out) r.hay = (r.name + ' ' + r.ne + ' ' + r.adm3).toLowerCase();
    searchIndex = out;
    return out;
  })();
  return searchLoading;
}
function searchQuery(q) {
  const t = q.trim().toLowerCase();
  if (!t || !searchIndex) return [];
  const hits = [];
  for (const r of searchIndex) {
    const i = r.hay.indexOf(t);
    if (i < 0) continue;
    const score = r.name.toLowerCase().startsWith(t) ? 0 : (i === 0 || r.hay[i - 1] === ' ') ? 1 : 2;
    hits.push([score, r]);
  }
  hits.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name));
  return hits.slice(0, 12).map(h => h[1]);
}

function renderSearch(parent) {
  const box = el('div', 'search');
  const input = el('input');
  input.type = 'search'; input.id = 'searchInput'; input.placeholder = 'Search places, schools, bridges…';
  input.setAttribute('autocomplete', 'off'); input.setAttribute('aria-label', 'Search places');
  const list = el('div', 'results'); list.id = 'searchResults';
  box.append(input, list);
  parent.appendChild(box);

  let rows = [], sel = -1;
  const draw = () => {
    list.innerHTML = '';
    sel = rows.length ? 0 : -1;
    rows.forEach((r, i) => {
      const row = el('div', 'res' + (i === 0 ? ' on' : ''));
      row.innerHTML = '<b>' + esc(r.name) + '</b>' + (r.ne ? ' <span class="ne">' + esc(r.ne) + '</span>' : '') +
        '<span class="sub">' + esc(r.type) + (r.adm3 ? ' · ' + esc(r.adm3) : '') + '</span>';
      row.addEventListener('click', () => go(r));
      list.appendChild(row);
    });
  };
  const mark = () => [...list.children].forEach((c, i) => { c.className = 'res' + (i === sel ? ' on' : ''); });
  const go = r => {
    dropPin(r.c);
    if (maps.post) new maplibregl.Popup({ maxWidth: '340px' })
      .setLngLat(r.c).setHTML(popupHTML(r.label, r.props)).addTo(maps.post);
    list.innerHTML = ''; rows = [];
  };
  input.addEventListener('focus', () => buildSearchIndex().then(() => { if (input.value) { rows = searchQuery(input.value); draw(); } }));
  input.addEventListener('input', () => {
    if (!searchIndex) { buildSearchIndex().then(() => { rows = searchQuery(input.value); draw(); }); return; }
    rows = searchQuery(input.value); draw();
  });
  input.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowDown') { sel = Math.min(sel + 1, rows.length - 1); mark(); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); mark(); ev.preventDefault(); }
    else if (ev.key === 'Enter') { if (rows[sel]) go(rows[sel]); ev.preventDefault(); }
    else if (ev.key === 'Escape') { list.innerHTML = ''; rows = []; input.value = ''; }
    ev.stopPropagation();
  });
}

// ----------------------------------------------------------- bridges panel
const BRIDGE_ORDER = ['Washed out', 'Damaged', 'Intact'];
async function renderBridges(det, body) {
  const d = await gj('hot_flood_npl/hot_flood_npl_bridge_damage.geojson');
  if (!d || !d.features) { body.innerHTML = '<p class="note">Bridge ground reports not available.</p>'; return; }
  const rows = d.features.map(f => ({ p: f.properties || {}, c: centroid(f.geometry) })).filter(r => r.c);
  const counts = {};
  for (const r of rows) counts[r.p.status || 'Unknown'] = (counts[r.p.status || 'Unknown'] || 0) + 1;
  const rank = st => { const i = BRIDGE_ORDER.indexOf(st); return i < 0 ? 99 : i; };
  rows.sort((a, b) => rank(a.p.status) - rank(b.p.status) || String(a.p.name).localeCompare(String(b.p.name)));
  const head = det.querySelector('summary');
  if (head) head.innerHTML = 'Bridge ground reports <span class="n">' +
    Object.keys(counts).sort((a, b) => rank(a) - rank(b))
      .map(k => '<i class="chip" style="background:' + statusColour(k) + '"></i>' + counts[k]).join(' ') + '</span>';
  body.innerHTML = '';
  for (const r of rows) {
    const row = el('div', 'brow');
    row.innerHTML = '<i class="chip" style="background:' + statusColour(r.p.status) + '"></i>' +
      '<span class="t"><b>' + esc(r.p.name || 'Unnamed bridge') + '</b>' +
      '<span class="sub">' + esc(r.p.status || '') + (r.p.location ? ' · ' + esc(r.p.location) : '') +
      (r.p.adm3_name ? ' · ' + esc(r.p.adm3_name) : '') +
      (r.p.length_m ? ' · ' + esc(r.p.length_m) + ' m' : '') + '</span></span>';
    row.addEventListener('click', () => {
      dropPin(r.c, 15);
      if (maps.post) new maplibregl.Popup({ maxWidth: '340px' })
        .setLngLat(r.c).setHTML(popupHTML('Bridge ground report', r.p)).addTo(maps.post);
    });
    body.appendChild(row);
  }
}

// -------------------------------------- destroyed-feature counts (OSM)
/* The per-municipality aggregation moved into the Municipality reports section
 * (loadDamageByMuni); this keeps the classifier and the in-view recount that
 * runs on every moveend. */
const DAMAGE_CLASS = { building: 'buildings', 'building part': 'buildings', road: 'roads',
  tunnel: 'roads', bridge: 'bridges' };
let damageRows = null;
function updateDamageInView() {
  const out = document.querySelector('#dmgInView');
  if (!out || !damageRows || !maps.post) return;
  const b = maps.post.getBounds();
  if (!b) return;
  const w = b.getWest ? b.getWest() : b[0][0], e = b.getEast ? b.getEast() : b[1][0];
  const s2 = b.getSouth ? b.getSouth() : b[0][1], n = b.getNorth ? b.getNorth() : b[1][1];
  const m = { buildings: 0, roads: 0, bridges: 0, other: 0, total: 0 };
  for (const r of damageRows) {
    if (r.c[0] < w || r.c[0] > e || r.c[1] < s2 || r.c[1] > n) continue;
    m[r.cls]++; m.total++;
  }
  out.innerHTML = '<b>In current view:</b> ' + m.total + ' recorded — ' + m.buildings +
    ' buildings, ' + m.roads + ' roads, ' + m.bridges + ' bridges, ' + m.other + ' other.';
}

// ========================================================== report sections
/* Casualties, municipality reports, hydropower & grid and communities affected,
 * all fed by data/reports.json (see docs/ARCHITECTURE.md).  Every figure in
 * these panels carries an "as of" date and a clickable source; where no
 * official figure exists the cell says "not reported" rather than estimating.
 * reports.json is optional — each section degrades to a one-line note. */

const REP_NA = '<span class="none">not reported</span>';
const REP_MISSING = '<p class="note">Reports not built. <code>data/reports.json</code> is absent or unreadable.</p>';

const repSrc = id => (reports && reports.sources && reports.sources[id]) || null;

/* Tiny superscript anchor; the source label and date live in the tooltip. */
function srcLink(id) {
  const s = repSrc(id);
  if (!s) return '';
  const t = s.label + (s.date ? ' · ' + fmtDate(s.date) : '') + (s.official ? '' : ' (not an official source)');
  return '<a class="src' + (s.official ? '' : ' unoff') + '" href="' + esc(s.url) + '" target="_blank" rel="noopener"' +
    ' title="' + esc(t) + '">↗</a>';
}
const repNum = v => (v == null || v === '') ? null : Number(v).toLocaleString('en-US');
/* "2026-09-08" -> "8 Sep".  fmtDate() gives the long form for tooltips. */
function shortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? (+m[3]) + ' ' + MONTHS[+m[2] - 1] : '';
}
/* A {value, as_of, src} figure object as a table cell body. */
function figCell(f) {
  if (!f || f.value == null) return REP_NA;
  return '<b>' + repNum(f.value) + '</b>' + srcLink(f.src) +
    (f.as_of ? '<span class="sub">' + shortDate(f.as_of) + '</span>' : '');
}
/* A service-status object as a pill.  Unknown or absent reads "not reported". */
function stChip(o) {
  const st = (o && o.status) || 'not_reported';
  const cls = st === 'not_reported' ? 'nr' : esc(st);
  const label = st === 'not_reported' ? 'not reported' : st;
  const bits = [];
  if (o && o.detail) bits.push(o.detail);
  if (o && o.as_of) bits.push('as of ' + fmtDate(o.as_of));
  const s = o && o.src ? repSrc(o.src) : null;
  if (s) bits.push(s.label + (s.official ? '' : ' (not an official source)'));
  return '<span class="st ' + cls + '"' + (bits.length ? ' title="' + esc(bits.join(' — ')) + '"' : '') + '>' +
    esc(label) + '</span>' + (o && o.src ? srcLink(o.src) : '');
}
/* Project damage status as a pill, using the DMG_CLASS palette. */
function dmgChip(v) {
  const k = String(v || 'not reported').toLowerCase();
  const cls = DMG_CLASS[k] || 'nr';
  return '<span class="st ' + cls + '">' + esc(k === 'not reported' ? 'not reported' : k) + '</span>';
}

/* Fetch and memoise a repo-relative JSON file by full path.  gj() is rooted at
 * data/hdx/; the admin boundaries and reports live elsewhere. */
const jsonCache = {};
async function cachedJSON(url) {
  if (jsonCache[url] !== undefined) return jsonCache[url];
  try { jsonCache[url] = await getJSON(url); } catch (e) { jsonCache[url] = null; }
  return jsonCache[url];
}

// ------------------------------------------------------- a. as-of strip
function renderAsOf(pad) {
  if (!reports) return;
  const p = el('p', 'asof');
  const ids = Object.keys(reports.sources || {}).filter(k => (reports.sources[k] || {}).official);
  const named = ['NDRRMA', 'MoFA', 'OCHA', 'NEA'];
  p.innerHTML = 'Official figures as of <b>' + esc(fmtDate(reports.as_of)) + '</b> · sources: ' +
    named.join(', ') + ' and named news reports · ' + ids.length + ' official of ' +
    Object.keys(reports.sources || {}).length + ' cited';
  p.title = 'Every figure in the report sections below carries its own date and source link.';
  pad.appendChild(p);
}

// ----------------------------------------------------------- c. casualties
function renderCasualties(pad) {
  const b = el('div', 'block');
  const det = el('details'); det.open = true;
  det.appendChild(el('summary', null, 'Casualties'));
  const body = el('div', null, '');
  det.appendChild(body); b.appendChild(det); pad.appendChild(b);
  if (!reports || !reports.casualties) { body.innerHTML = REP_MISSING; return; }
  const c = reports.casualties;
  const h = c.headline || {};

  const tiles = el('div', 'tiles');
  const tile = (label, f, sub) => {
    const t = el('div', 'tile');
    t.innerHTML = '<span class="k">' + esc(label) + '</span>' +
      '<span class="v">' + (f && f.value != null ? repNum(f.value) : '—') + srcLink(f && f.src) + '</span>' +
      '<span class="d">' + (f && f.as_of ? 'as of ' + shortDate(f.as_of) : 'not reported') + '</span>' +
      (sub ? '<span class="sub">' + sub + '</span>' : '');
    tiles.appendChild(t);
  };
  // "Bodies recovered", never "Deaths": these are remains located, most of them
  // not yet identified (owner direction, 9 Sep 2026).
  tile('Bodies recovered', h.bodies_recovered, 'located, mostly not yet identified');
  tile('Missing', h.missing, 'a separate count, not presumed dead');
  tile('Injured', h.injured, 'not restated in later updates');
  tile('Rescued', h.rescued);
  body.appendChild(tiles);

  // time series
  if ((c.series || []).length) {
    body.appendChild(el('div', 'subhd', 'How the count moved'));
    const wrap = el('div', 'scrollx');
    let html = '<table class="rep"><thead><tr><th>As of</th><th class="n">Bodies</th>' +
      '<th class="n">Missing</th><th class="n">Injured</th><th class="n">Rescued</th></tr></thead><tbody>';
    for (const r of c.series) {
      const cell = v => v == null ? '<span class="none">—</span>' : repNum(v);
      html += '<tr' + (r.note ? ' title="' + esc(r.note) + '"' : '') + '><td>' + esc(shortDate(r.as_of)) +
        srcLink(r.src) + '</td><td class="n">' + cell(r.bodies_recovered) + '</td><td class="n">' +
        cell(r.missing) + '</td><td class="n">' + cell(r.injured) + '</td><td class="n">' +
        cell(r.rescued) + '</td></tr>';
    }
    html += '</tbody></table>';
    wrap.innerHTML = html;
    body.appendChild(wrap);
  }

  // China (counted separately) and foreign nationals
  if (c.china) {
    const r = el('div', 'reprow');
    r.innerHTML = '<b>China, Gyirong county (Tibet)</b>' + srcLink(c.china.src) +
      '<span class="sub">' + repNum(c.china.deaths) + ' dead, ' + repNum(c.china.missing) +
      ' missing as of ' + esc(shortDate(c.china.as_of)) + '. ' + esc(c.china.note || '') + '</span>';
    r.title = c.china.detail || '';
    body.appendChild(r);
  }
  if (c.foreign_nationals) {
    const f = c.foreign_nationals;
    const alt = (f.alternates || []).map(a => esc(a.label) + ' ' + repNum(a.value) + srcLink(a.src)).join(', ');
    const r = el('div', 'reprow');
    r.innerHTML = '<b>Foreign nationals missing</b>' + srcLink(f.src) +
      '<span class="sub">MoFA about ' + repNum(f.value) + ' from 35 countries as of ' +
      esc(shortDate(f.as_of)) + (alt ? '. Other agencies: ' + alt : '') + '. ' + esc(f.note || '') + '</span>';
    body.appendChild(r);
  }

  if ((c.notes || []).length) {
    const ul = el('ul', 'prov');
    for (const n of c.notes) ul.appendChild(el('li', null, esc(n)));
    body.appendChild(el('div', 'subhd', 'What these numbers are'));
    body.appendChild(ul);
  }
}

// ------------------------------------------------ d. municipality reports
/* COD-AB (2024) is the join key; the 2018 ward file and the reports spell four
 * of these differently.  See data/admin/README.md and reports.json aliases. */
const muniKey = n => String(n || '').toLowerCase()
  .replace(/\b(rural municipality|municipality|metropolitan city|sub-metropolitan city|gaunpalika|nagarpalika|rm|np)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, '').trim();
const DIST_KEY = { chitwan: 'chitawan', tanahun: 'tanahu' };
const distKey = d => { const k = String(d || '').toLowerCase().trim(); return DIST_KEY[k] || k; };

let damageRowsLoaded = null;
/* Buckets destroyed_features_osm.geojson by municipality; also fills the
 * module-level damageRows that updateDamageInView() recounts on moveend. */
async function loadDamageByMuni() {
  if (damageRowsLoaded) return damageRowsLoaded;
  const d = await gj('hot_flood_npl/destroyed_features_osm.geojson');
  const by = {};
  if (d && d.features) {
    damageRows = d.features.map(f => {
      const p = f.properties || {};
      return { adm3: p.adm3_name || 'Unknown', cls: DAMAGE_CLASS[p.feature_type] || 'other',
               status: p.status || '', c: centroid(f.geometry) };
    }).filter(r => r.c);
    for (const r of damageRows) {
      const m = (by[muniKey(r.adm3)] ||= { name: r.adm3, buildings: 0, roads: 0, bridges: 0, other: 0, total: 0 });
      m[r.cls]++; m.total++;
    }
  }
  damageRowsLoaded = by;
  return by;
}

/* Flood-affected ward counts per municipality, Rasuwa and Nuwakot only. */
async function loadWardCounts() {
  const g = await cachedJSON(ADMIN + 'admin_ward.geojson');
  const out = {};
  if (!g || !g.features) return null;
  for (const f of g.features) {
    const p = f.properties || {};
    const k = muniKey(p.GaPa_NaPa);
    const rec = (out[k] ||= { wards: 0, affected: 0, district: p.DISTRICT || '' });
    rec.wards++;
    if (p.flood_affected === 1) rec.affected++;
  }
  return out;
}

/* Municipality polygons keyed by name, with a bbox for fitBounds. */
async function loadMuniShapes() {
  const g = await cachedJSON(ADMIN + 'admin_municipality.geojson');
  const out = {};
  if (!g || !g.features) return out;
  for (const f of g.features) {
    const p = f.properties || {};
    const k = muniKey(p.adm3_name) + '|' + distKey(p.adm2_name);
    let w = 180, s = 90, e = -180, n = -90;
    eachCoord(f.geometry, ([x, y]) => {
      if (x < w) w = x; if (x > e) e = x;
      if (y < s) s = y; if (y > n) n = y;
    });
    if (w > e) continue;
    (out[k] ||= { bbox: [[w, s], [e, n]], features: [] }).features.push(f);
    const b = out[k].bbox;
    b[0][0] = Math.min(b[0][0], w); b[0][1] = Math.min(b[0][1], s);
    b[1][0] = Math.max(b[1][0], e); b[1][1] = Math.max(b[1][1], n);
  }
  return out;
}

let hlTimer = null;
/* Fit both maps to a municipality and flash its outline for three seconds. */
function highlightMuni(shape) {
  if (!shape || !maps.post) return;
  const fc = { type: 'FeatureCollection', features: shape.features };
  eachMap(m => { const src = m.getSource('report_hl'); if (src) src.setData(fc); });
  maps.post.fitBounds(shape.bbox, { padding: 40, duration: 900 });
  clearTimeout(hlTimer);
  hlTimer = setTimeout(() => eachMap(m => {
    const src = m.getSource('report_hl');
    if (src) src.setData({ type: 'FeatureCollection', features: [] });
  }), 3200);
}

const MUNI_METRICS = [
  ['deaths_bodies', 'bodies'], ['missing', 'missing'], ['injured', 'injured'],
  ['people_affected', 'people affected'], ['families_affected', 'families affected'],
  ['households_isolated', 'households isolated'], ['people_isolated', 'people isolated'],
  ['houses_destroyed', 'houses destroyed'], ['houses_affected', 'houses affected'],
  ['infrastructure_destroyed', 'infrastructure destroyed'],
];

async function renderMunicipalities(det, body) {
  if (!reports || !(reports.municipalities || []).length) { body.innerHTML = REP_MISSING; return; }
  const [byDamage, wards, shapes] = await Promise.all([loadDamageByMuni(), loadWardCounts(), loadMuniShapes()]);
  const rows = reports.municipalities.map(m => {
    const keys = [muniKey(m.name), ...(m.aliases || []).map(muniKey)];
    const dmg = keys.map(k => byDamage[k]).find(Boolean) || null;
    const wc = wards ? keys.map(k => wards[k]).find(Boolean) || null : null;
    const shape = shapes[muniKey(m.name) + '|' + distKey(m.district)] || null;
    const fig = m.figures || {};
    const off = ['deaths_bodies', 'missing'].reduce((a, k) => a + ((fig[k] && fig[k].value) || 0), 0);
    return { m, dmg, wc, shape, off };
  });
  rows.sort((a, b) => b.off - a.off || (b.dmg ? b.dmg.total : 0) - (a.dmg ? a.dmg.total : 0) ||
    a.m.name.localeCompare(b.m.name));

  const head = det.querySelector('summary');
  if (head) head.innerHTML = 'Municipality reports <span class="n">' + rows.length + '</span>';

  body.innerHTML = '';
  body.appendChild(el('p', 'note',
    'Official figures where they exist, at the level they were published. No NDRRMA or MoFA source publishes a ' +
    'municipality-level casualty table, so most casualty cells read "not reported" rather than an estimate. ' +
    'Click a row to zoom the map to that municipality.'));
  for (const r of rows) {
    const m = r.m, fig = m.figures || {};
    const figs = MUNI_METRICS.filter(([k]) => fig[k] && fig[k].value != null)
      .map(([k, label]) => '<b>' + repNum(fig[k].value) + '</b> ' + esc(label) +
        ' <span class="d">' + esc(shortDate(fig[k].as_of)) + '</span>' + srcLink(fig[k].src));
    const osm = r.dmg
      ? 'OSM-mapped: ' + r.dmg.buildings + ' buildings, ' + r.dmg.roads + ' roads, ' + r.dmg.bridges +
        ' bridges' + (r.dmg.other ? ', ' + r.dmg.other + ' other' : '')
      : 'OSM-mapped: none recorded';
    const wtxt = r.wc ? r.wc.affected + ' of ' + r.wc.wards + ' wards flood-affected'
      : 'flood-affected wards: n/a (ward data covers Rasuwa and Nuwakot only)';
    const row = el('div', 'reprow' + (r.shape ? ' pick' : ''));
    row.innerHTML = '<b>' + esc(m.name) + '</b>' + (m.name_ne ? ' <span class="ne">' + esc(m.name_ne) + '</span>' : '') +
      ' <span class="sub" style="display:inline">' + esc(m.district) + '</span>' +
      '<span class="sub">' + (figs.length ? figs.join(' · ') : REP_NA) + '</span>' +
      '<span class="sub">' + esc(osm) + ' · ' + esc(wtxt) + '</span>' +
      (m.summary && m.summary.text ? '<span class="sub">' + esc(m.summary.text) + srcLink(m.summary.src) + '</span>' : '');
    if (r.shape) {
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => highlightMuni(r.shape));
    }
    body.appendChild(row);
  }

  // Bodies recovered by district, downstream of the corridor.
  if ((reports.downstream_bodies || []).length) {
    body.appendChild(el('div', 'subhd', 'Bodies recovered downstream, by district'));
    const wrap = el('div', 'scrollx');
    let html = '<table class="rep"><thead><tr><th>District</th><th class="n">Bodies recovered</th><th>As of</th></tr></thead><tbody>';
    for (const d of reports.downstream_bodies) {
      html += '<tr' + (d.detail ? ' title="' + esc(d.detail) + '"' : '') + '><td>' + esc(d.district) +
        '</td><td class="n">' + repNum(d.value) + srcLink(d.src) + '</td><td>' + esc(shortDate(d.as_of)) + '</td></tr>';
    }
    html += '</tbody></table>';
    wrap.innerHTML = html;
    body.appendChild(wrap);
    body.appendChild(el('p', 'note',
      'These counts are where remains were found, not where people lived. Bodies travelled up to 240 km down the ' +
      'Trishuli and Narayani, which is why Chitwan and Nawalparasi exceed the upstream districts.'));
  }
  body.appendChild(el('p', 'inview', ''));
  body.querySelector('.inview').id = 'dmgInView';
  body.appendChild(el('p', 'note', 'OSM-mapped counts are volunteer-recorded in OpenStreetMap and not field-verified.'));
  updateDamageInView();
}

// ------------------------------------------------------- e. hydropower & grid
async function renderEnergy(det, body) {
  if (!reports || !reports.energy) { body.innerHTML = REP_MISSING; return; }
  const en = reports.energy;
  const located = new Map();
  const hp = await gj('hot_flood_npl/hot_flood_npl_exposed_hydropowers.geojson');
  if (hp && hp.features) for (const f of hp.features) {
    const c = centroid(f.geometry);
    if (c) located.set(hydroKey((f.properties || {}).name), { c, p: f.properties || {} });
  }
  const head = det.querySelector('summary');
  if (head) head.innerHTML = 'Hydropower &amp; grid <span class="n">' + (en.projects || []).length + '</span>';
  body.innerHTML = '';

  // summary tiles
  const s = en.summary || {};
  const tiles = el('div', 'tiles');
  if (s.generation_offline) {
    const g = s.generation_offline, sub = g.sub;
    const t = el('div', 'tile');
    t.innerHTML = '<span class="k">Generation offline</span><span class="v">' + repNum(g.value) + ' ' +
      esc(g.unit || 'MW') + srcLink(g.src) + '</span><span class="d">as of ' + esc(shortDate(g.as_of)) + '</span>' +
      (sub ? '<span class="sub">' + esc(sub.label || 'earlier') + ' ' + repNum(sub.value) + ' ' +
        esc(sub.unit || 'MW') + ', ' + esc(shortDate(sub.as_of)) + srcLink(sub.src) + '</span>' : '');
    if (g.note) t.title = g.note;
    tiles.appendChild(t);
  }
  if (s.projects_damaged) {
    const p = s.projects_damaged;
    const t = el('div', 'tile');
    t.innerHTML = '<span class="k">Projects damaged</span><span class="v">' + repNum(p.value) + srcLink(p.src) +
      '</span><span class="d">as of ' + esc(shortDate(p.as_of)) + '</span>' +
      (p.note ? '<span class="sub">' + esc(p.note) + '</span>' : '');
    tiles.appendChild(t);
  }
  if (s.under_construction && (s.under_construction.conflict || []).length) {
    const u = s.under_construction;
    const t = el('div', 'tile wide');
    t.innerHTML = '<span class="k">Under construction affected</span><span class="v">' +
      u.conflict.map(x => repNum(x.value) + ' ' + esc(x.unit || 'MW') + srcLink(x.src)).join(' or ') +
      '</span><span class="d">sources conflict, ' +
      u.conflict.map(x => shortDate(x.as_of)).join(' and ') + '</span>' +
      (u.note ? '<span class="sub">' + esc(u.note) + '</span>' : '');
    tiles.appendChild(t);
  }
  body.appendChild(tiles);

  // project table
  const wrap = el('div', 'scrollx');
  let html = '<table class="rep"><thead><tr><th>Project</th><th class="n">MW</th><th>Damage</th>' +
    '<th>Workers missing</th></tr></thead><tbody>';
  const nl = v => (v == null || String(v).toLowerCase() === 'not reported' || v === '') ? REP_NA : esc(v);
  for (const pr of (en.projects || [])) {
    const loc = located.get(hydroKey(pr.name)) || (pr.hdx_name ? located.get(hydroKey(pr.hdx_name)) : null);
    const idAttr = loc ? ' class="pick" data-hydro="' + esc(hydroKey(pr.name)) + '"' : '';
    html += '<tr' + idAttr + '><td><span class="nm">' + esc(pr.name) + '</span>' + srcLink(pr.src) +
      '<span class="sub">' + nl(pr.owner) + '</span>' +
      '<span class="sub">' + nl(pr.status_before) + (loc ? '' : ' · not located') + '</span>' +
      (pr.note ? '<span class="sub">' + esc(pr.note) + '</span>' : '') +
      '</td><td class="n">' + (pr.mw == null ? REP_NA : esc(pr.mw)) + '</td><td>' + dmgChip(pr.damage) +
      '<span class="sub">' + nl(pr.what) + '</span>' +
      (pr.loss ? '<span class="sub">' + esc(pr.loss) + '</span>' : '') +
      '</td><td>' + nl(pr.workers_missing) + '</td></tr>';
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;
  body.appendChild(wrap);
  for (const tr of wrap.querySelectorAll('tr.pick')) {
    tr.addEventListener('click', () => {
      const loc = located.get(tr.dataset.hydro);
      if (!loc) { toast('Not located in the exposed-hydropower layer'); return; }
      // Click the Overlays checkbox rather than mutating state, so the tick,
      // the layer and the hash all stay in step.
      const cb = document.querySelector('#controls input[data-ovkey="hydro"]');
      if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
      dropPin(loc.c, 13);
      if (maps.post) new maplibregl.Popup({ maxWidth: '340px' })
        .setLngLat(loc.c).setHTML(popupHTML('Exposed hydropower', loc.p)).addTo(maps.post);
    });
  }
  body.appendChild(el('p', 'note',
    'Missing-worker counts were revised downward as rescue and contact progressed; each figure is a snapshot of ' +
    'its reporting date, not a settled total. Projects with a location join the yellow "Exposed hydropowers" ' +
    'overlay by name; the rest are not in that dataset.'));

  // grid
  if ((en.grid || []).length) {
    body.appendChild(el('div', 'subhd', 'Grid'));
    for (const g of en.grid) {
      const r = el('div', 'reprow');
      r.innerHTML = '<b>' + esc(g.element) + '</b> ' + dmgChip(g.damage) + (g.src ? srcLink(g.src) : '') +
        '<span class="sub">' + esc(g.detail || '') + (g.as_of ? ' (as of ' + esc(shortDate(g.as_of)) + ')' : '') + '</span>';
      body.appendChild(r);
    }
  }
  if ((en.restoration || []).length) {
    body.appendChild(el('div', 'subhd', 'Distribution restored'));
    const w2 = el('div', 'scrollx');
    let h2 = '<table class="rep"><thead><tr><th>District</th><th class="n">Restored</th>' +
      '<th class="n">Households</th><th>As of</th></tr></thead><tbody>';
    for (const r of en.restoration) {
      h2 += '<tr' + (r.note || r.detail ? ' title="' + esc(r.note || r.detail) + '"' : '') + '><td>' +
        esc(r.district) + (r.detail ? '<span class="sub">' + esc(r.detail) + '</span>' : '') +
        '</td><td class="n">' + (r.pct == null ? REP_NA : esc(r.pct) + '%') + srcLink(r.src) +
        '</td><td class="n">' + (r.households == null ? REP_NA : repNum(r.households)) +
        '</td><td>' + esc(shortDate(r.as_of)) + '</td></tr>';
    }
    h2 += '</tbody></table>';
    w2.innerHTML = h2;
    body.appendChild(w2);
  }
  if ((en.impact || []).length) {
    body.appendChild(el('div', 'subhd', 'System impact'));
    for (const i of en.impact) {
      const p = el('p', 'note');
      p.innerHTML = esc(i.text) + srcLink(i.src);
      body.appendChild(p);
    }
  }
}

// --------------------------------------------------- f. communities affected
async function renderCommunities(det, body) {
  if (!reports || !reports.communities) { body.innerHTML = REP_MISSING; return; }
  const co = reports.communities;
  const places = await gj('derived/places.geojson');
  const byName = new Map();
  if (places && places.features) for (const f of places.features) {
    const p = f.properties || {};
    const c = centroid(f.geometry);
    if (!c || !p.name) continue;
    const k = String(p.name).toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (!byName.has(k)) byName.set(k, { c, name: p.name, ne: p.name_ne || '' });
  }
  const findPlace = st => {
    for (const n of [st.name, ...(st.aliases || [])]) {
      const k = String(n).toLowerCase().replace(/[^a-z0-9]+/g, '');
      if (byName.has(k)) return byName.get(k);
    }
    return null;
  };

  const head = det.querySelector('summary');
  if (head) head.innerHTML = 'Communities affected <span class="n">' + (co.settlements || []).length + '</span>';
  body.innerHTML = '';
  body.appendChild(el('p', 'note',
    'Road, power and water status per settlement. Every chip carries its date and source in its tooltip. ' +
    '"planned" means a Bailey bridge is planned or being installed while the crossing is still out. ' +
    'Click a settlement to fly to it.'));

  const wrap = el('div', 'scrollx');
  let html = '<table class="rep"><thead><tr><th>Settlement</th><th>Road</th><th>Power</th><th>Water</th>' +
    '<th>Site</th></tr></thead><tbody>';
  const rows = [];
  for (const st of (co.settlements || [])) {
    const pl = findPlace(st);
    rows.push({ st, pl });
    const ne = st.name_ne || (pl && pl.ne) || '';
    html += '<tr' + (pl ? ' class="pick"' : '') + '><td><span class="nm">' + esc(st.name) + '</span>' +
      (ne ? ' <span class="ne">' + esc(ne) + '</span>' : '') +
      '<span class="sub">' + esc(st.municipality || '') + (st.district ? ', ' + esc(st.district) : '') +
      (pl ? '' : ' · not located') + '</span></td>' +
      '<td>' + stChip(st.road) + '</td><td>' + stChip(st.power) + '</td><td>' + stChip(st.water) + '</td>' +
      '<td>' + stChip(st.displacement_site) + (st.telecom ? '<span class="sub">telecom ' + stChip(st.telecom) + '</span>' : '') +
      '</td></tr>';
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;
  body.appendChild(wrap);
  const trs = wrap.querySelectorAll('tbody tr');
  rows.forEach((r, i) => {
    const tr = trs[i];
    if (!tr || !r.pl) return;
    tr.addEventListener('click', () => dropPin(r.pl.c, 13));
  });

  if ((co.corridor || []).length) {
    body.appendChild(el('div', 'subhd', 'Corridor'));
    for (const c of co.corridor) {
      const p = el('div', 'reprow');
      p.innerHTML = '<span class="sub" style="font-size:11px;color:#b9c4d2">' + esc(c.text) +
        (c.as_of ? ' <span class="d">(as of ' + esc(shortDate(c.as_of)) + ')</span>' : '') + srcLink(c.src) + '</span>';
      body.appendChild(p);
    }
  }
  const unoff = (co.settlements || []).some(st =>
    ['road', 'power', 'water', 'telecom', 'displacement_site'].some(k => st[k] && st[k].unofficial));
  if (unoff) body.appendChild(el('p', 'warn',
    'One row cites the community-run Rasuwa Flood Bulletin, which is not an official source. It is used only where ' +
    'every official cell for that settlement would otherwise read "not reported", and its chips are marked with an ' +
    'amber source link.'));
}

// -------------------------------------------------------------- popup body
function popupHTML(label, props) {
  const p = props || {};
  const name = p.name || p.name_en || p.name_latin || '';
  const ne = p.name_ne && p.name_ne !== name ? p.name_ne : '';
  const type = [p.feature_type, p.amenity, p.highway, p.man_made, p.place, p.bridge_structure,
                p.building, p.shop, p.tourism].find(v => v && v !== 'yes');
  let h = '<div class="pop-h">' + esc(name || label) + (ne ? ' <span class="ne">' + esc(ne) + '</span>' : '') + '</div>';
  const meta = [];
  if (name) meta.push(esc(label));
  if (type) meta.push(esc(String(type).replace(/_/g, ' ')));
  if (p.adm3_name) meta.push(esc(p.adm3_name));
  if (p.damage_type) meta.push(esc(p.damage_type));
  if (meta.length) h += '<div class="pop-m">' + meta.join(' · ') + '</div>';
  if (p.status) h += '<div><span class="chip lg" style="background:' + statusColour(p.status) + '">' + esc(p.status) + '</span></div>';
  const rows = Object.entries(p)
    .filter(([, v]) => v !== null && v !== '' && v !== 'null' && v !== undefined)
    .map(([k, v]) => '<tr><th>' + esc(k) + '</th><td>' +
      (/^https?:\/\//.test(String(v)) ? '<a href="' + esc(v) + '" target="_blank" rel="noopener">' + esc(v) + '</a>' : esc(v)) +
      '</td></tr>').join('');
  h += '<details class="pop-all"><summary>All attributes</summary><table class="popup">' + rows + '</table></details>';
  return h;
}

// --------------------------------------------------------------- behaviour
function wirePopups(m) {
  const live = () => QUERY_IDS.filter(id => m.getLayer(id) && m.getLayoutProperty(id, 'visibility') !== 'none');
  m.on('click', ev => {
    if (imgAlign.on) return;             // the image-align tool owns the pointer while it is on
    if (editorActive()) return;          // the damage editor owns clicks while a mode is on
    const hits = m.queryRenderedFeatures(ev.point, { layers: live() });
    if (!hits.length) return;
    const html = hits.slice(0, 4)
      .map(h => popupHTML(LABEL_OF[h.layer.id] || h.layer.id, h.properties)).join('<hr>');
    new maplibregl.Popup({ maxWidth: '340px' }).setLngLat(ev.lngLat).setHTML(html).addTo(m);
  });
  let hoverTimer = 0;
  m.on('mousemove', ev => {
    $('#readout').textContent = ev.lngLat.lat.toFixed(5) + '°N, ' + ev.lngLat.lng.toFixed(5) + '°E · z' + m.getZoom().toFixed(1);
    if (imgAlign.on) { m.getCanvas().style.cursor = imgAlignCursor(m, ev.point); return; }
    if (editorActive()) { m.getCanvas().style.cursor = editorCursor(m, ev.point); return; }
    if (hoverTimer) return;
    hoverTimer = setTimeout(() => {
      hoverTimer = 0;
      const hit = m.queryRenderedFeatures(ev.point, { layers: live() })[0];
      m.getCanvas().style.cursor = hit ? 'pointer' : '';
    }, 60);
  });
}

function syncMaps(a, b) {
  let busy = false;
  const link = (from, to) => from.on('move', () => {
    if (busy) return;
    busy = true;
    to.jumpTo({ center: from.getCenter(), zoom: from.getZoom(), bearing: from.getBearing(), pitch: from.getPitch() });
    busy = false;
  });
  link(a, b); link(b, a);
}

function wireKeyboard() {
  window.addEventListener('keydown', ev => {
    const t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const m = maps.post; if (!m) return;
    // Two tools want the arrows.  The damage editor takes them while it is on
    // and holding a selection, because that is the more specific state; Image
    // align gets them otherwise, and neither is a pan.
    if (editorActive() && editor.sel.length && /^Arrow/.test(ev.key)) {
      const d = ev.shiftKey ? 10 : 1;
      if (ev.key === 'ArrowLeft') nudgeSel(-d, 0);
      else if (ev.key === 'ArrowRight') nudgeSel(d, 0);
      else if (ev.key === 'ArrowUp') nudgeSel(0, -d);
      else nudgeSel(0, d);
      ev.preventDefault();
      return;
    }
    // With Image align on the arrows are a fine positioning control for the
    // photo, not a pan: one screen pixel, ten with Shift.
    if (imgAlign.on && /^Arrow/.test(ev.key)) {
      const d = ev.shiftKey ? 10 : 1;
      if (ev.key === 'ArrowLeft') imgAlignNudge(-d, 0);
      else if (ev.key === 'ArrowRight') imgAlignNudge(d, 0);
      else if (ev.key === 'ArrowUp') imgAlignNudge(0, -d);
      else imgAlignNudge(0, d);
      ev.preventDefault();
      return;
    }
    const step = ev.shiftKey ? 400 : 120;
    switch (ev.key) {
      case 'ArrowLeft':  m.panBy([-step, 0]); break;
      case 'ArrowRight': m.panBy([step, 0]); break;
      case 'ArrowUp':    m.panBy([0, -step]); break;
      case 'ArrowDown':  m.panBy([0, step]); break;
      case '+': case '=': m.zoomIn(); break;
      case '-': case '_': m.zoomOut(); break;
      case 'b': case 'B': toggleSidebar(); break;
      case 'c': case 'C': toggleControls(); break;
      case '[': setSwipe(state.swipe - (ev.shiftKey ? 10 : 2)); break;
      case ']': setSwipe(state.swipe + (ev.shiftKey ? 10 : 2)); break;
      default: return;
    }
    ev.preventDefault();
  });
}

// ======================================================================== //
// Damage editor                                                            //
// ------------------------------------------------------------------------ //
// The HOT / NAXA damage record is incomplete, so an analyst can build their
// own layer here: pick an OSM or Overture building footprint off the map, or
// draw a polygon freehand, grade it Destroyed / Damaged / Possibly damaged
// and export the lot as GeoJSON.  The working copy lives in localStorage and
// is layered over the committed file at CFG.DAMAGE_EDITS_URL; nothing here
// talks to a server.  Both maps carry the same `edits` source, so an edit
// stays put across the swipe divider.
// ======================================================================== //

const EDIT_KEY = 'nf26.damage_edits';
const EDIT_FILE = 'data/edits/damage_edits.geojson';
// Same palette as the Copernicus road grading legend (.roadlg .ems-*).
const EDIT_STATUS = [
  { key: 'destroyed', label: 'Destroyed',        color: DAMAGE_ROAD_RED },
  { key: 'damaged',   label: 'Damaged',          color: '#f97316' },
  { key: 'possible',  label: 'Possibly damaged', color: '#f59e0b' },
];
const EDIT_COLOR = ['match', ['to-string', ['get', 'status']],
  'destroyed', EDIT_STATUS[0].color, 'damaged', EDIT_STATUS[1].color,
  'possible', EDIT_STATUS[2].color, '#94a3b8'];
// Ctrl-click is a secondary click on macOS and never reaches the map, so name
// the modifier the reader's platform actually honours.  Both are accepted.
const EDIT_MOD = /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent) ? 'Cmd' : 'Ctrl';
const editLabel = k => (EDIT_STATUS.find(s => s.key === k) || {}).label || k || 'ungraded';
const editColor = k => (EDIT_STATUS.find(s => s.key === k) || {}).color || '#94a3b8';

const editor = {
  mode: 'off',           // 'off' | 'pick' | 'draw'
  visible: true,         // the edits layer switch
  features: [],          // working collection
  baseIds: new Set(),    // ids that came from the committed file
  deleted: new Set(),    // base ids the analyst removed (so a reload does not resurrect them)
  sel: [],               // selected candidates: {id, geometry, source, src_id, name, status, note, existing}
  ring: [],              // in-progress polygon vertices
  ui: {},                // sidebar nodes, filled by buildDamageEditor()
  lastClick: null,       // for swallowing the second click of a double-click
  drag: null,            // in-progress geometry drag: {m, kind, p, r, i, sels, last, moved}
  dragEnd: 0,            // when the last drag finished, so its trailing click is ignored
  nudgeAt: 0,            // when the last arrow-key nudge landed (a run is one undo step)
  geomHist: [],          // geometry undo stack, newest last
};
const editorActive = () => editor.mode !== 'off';

// ------------------------------------------------------------ collection IO
function editId(f) {
  if (!f.properties) f.properties = {};
  const p = f.properties;
  if (!p.id) p.id = f.id != null ? String(f.id)
    : 'manual:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  f.id = p.id;
  return p.id;
}
const editFC = () => ({ type: 'FeatureCollection', features: editor.features });
const editById = id => editor.features.find(f => f.properties && f.properties.id === id) || null;

function saveEdits() {
  try {
    localStorage.setItem(EDIT_KEY, JSON.stringify({
      v: 1, saved_at: new Date().toISOString(),
      deleted: [...editor.deleted], features: editor.features,
    }));
  } catch (e) { toast('Could not save edits locally (storage full or blocked)'); }
}
function readStoredEdits() {
  try {
    const raw = localStorage.getItem(EDIT_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    return j && Array.isArray(j.features) ? j : null;
  } catch (e) { return null; }
}

/* Committed file first, then the local working copy on top of it by id.
 * A 404 (nothing published yet) is not an error. */
async function initDamageEdits() {
  let base = [];
  try {
    const r = await fetch((CFG.DAMAGE_EDITS_URL || EDIT_FILE), { cache: 'no-cache' });
    if (r.ok) {
      const j = await r.json();
      if (j && Array.isArray(j.features)) base = j.features.filter(f => f && f.geometry);
    }
  } catch (e) { /* not published yet */ }
  base.forEach(editId);
  editor.baseIds = new Set(base.map(f => f.properties.id));
  const local = readStoredEdits();
  let out = base;
  if (local) {
    editor.deleted = new Set(local.deleted || []);
    out = out.filter(f => !editor.deleted.has(f.properties.id));
    for (const f of local.features) {
      if (!f || !f.geometry) continue;
      editId(f);
      const i = out.findIndex(x => x.properties.id === f.properties.id);
      if (i >= 0) out[i] = f; else out.push(f);
    }
  }
  editor.features = out;
  refreshEdits(false);
}

/* Push the collection to both maps and redraw the sidebar. */
function refreshEdits(persist) {
  eachMap(m => { const s = m.getSource('edits'); if (s) s.setData(editFC()); });
  renderEditList();
  if (persist !== false) saveEdits();
}

// --------------------------------------------------------------- selection
/* The selection is always a list.  One click replaces it, Shift- or Ctrl-click
 * adds to it (and clicking a selected footprint again drops it), so a whole
 * row of gutted houses can be graded in one go. */
function setSelGeom(list) {
  const fc = { type: 'FeatureCollection',
    features: (list || []).filter(s => s.geometry)
      .map(s => ({ type: 'Feature', properties: {}, geometry: s.geometry })) };
  eachMap(m => { const s = m.getSource('edit_sel'); if (s) s.setData(fc); });
}
function syncSel() { setSelGeom(editor.sel); syncHandles(); renderEditForm(); markSelRows(); }
function clearSel() { editor.sel = []; syncSel(); }
const selHas = id => editor.sel.some(s => s.id === id);

/* Put a candidate in the selection.  `additive` toggles rather than replaces. */
function addSel(cand, additive) {
  if (!additive) { editor.sel = [cand]; syncSel(); return; }
  const i = editor.sel.findIndex(s => s.id === cand.id);
  if (i >= 0) { editor.sel.splice(i, 1); syncSel(); return; }
  // Inherit the grade and note the group already agrees on, so adding one more
  // footprint does not silently drop the whole selection back to ungraded.
  const shared = k => editor.sel.length && editor.sel.every(x => x[k] && x[k] === editor.sel[0][k]);
  if (!cand.status && shared('status')) cand.status = editor.sel[0].status;
  if (!cand.note && shared('note')) cand.note = editor.sel[0].note;
  editor.sel.push(cand);
  syncSel();
}

function editToSel(f) {
  const p = f.properties;
  return { id: p.id, geometry: f.geometry, source: p.source, src_id: p.src_id,
           name: p.name || '', status: p.status || '', note: p.note || '', existing: true };
}
function selectEdit(id, additive) {
  const f = editById(id);
  if (f) addSel(editToSel(f), additive);
}

/* A rendered building footprint becomes a candidate edit.  The id is
 * source + ':' + src_id, so re-picking the same building edits its record. */
function selectFootprint(hit, additive) {
  const p = hit.properties || {};
  const src = /-overture-/.test(hit.layer.id) ? 'overture' : 'osm';
  // A footprint from the PMTiles fallback carries no OSM or Overture id.  Fall
  // back to the centre of its bounding box at ~1 m: steadier under tile
  // simplification than a vertex mean, though still only approximate.
  // Re-picking is caught either way, because a click tests the edits layer first.
  const bb = editBBox(hit.geometry);
  const srcId = String(p.id || p['@id'] || p.osm_id || hit.id ||
    'xy:' + ((bb[0][0] + bb[1][0]) / 2).toFixed(5) + ',' + ((bb[0][1] + bb[1][1]) / 2).toFixed(5));
  const id = src + ':' + srcId;
  const existing = editById(id);
  if (existing) {
    const had = selHas(id);
    selectEdit(id, additive);
    if (!had && selHas(id)) toast('Already recorded — editing it');
    return;
  }
  addSel({ id, geometry: hit.geometry, source: src, src_id: srcId,
    name: p.name || p.name_en || p.name_latin || '', status: '', note: '', existing: false }, additive);
}

/* Write every selected candidate into the collection under one timestamp. */
function commitSel() {
  const sels = editor.sel;
  if (!sels.length) return;
  const status = sels[0].status;
  if (!status || sels.some(s => s.status !== status)) { toast('Choose a status first'); return; }
  const now = new Date().toISOString();
  for (const s of sels) {
    let f = editById(s.id);
    if (!f) {
      f = { type: 'Feature', id: s.id, geometry: s.geometry,
        properties: { id: s.id, status: s.status, source: s.source, src_id: s.src_id || '',
                      name: s.name || '', note: s.note || '', created_at: now } };
      editor.features.push(f);
    } else {
      f.properties.status = s.status;
      f.properties.note = s.note || '';
      f.properties.updated_at = now;
      if (s.geometry) f.geometry = s.geometry;
    }
    editor.deleted.delete(s.id);
  }
  const n = sels.length;
  clearSel();
  refreshEdits();
  toast(n + ' marked ' + editLabel(status).toLowerCase() + ' — ' + editor.features.length + ' edit' +
    (editor.features.length === 1 ? '' : 's'));
}

function deleteEdit(id) {
  const i = editor.features.findIndex(f => f.properties && f.properties.id === id);
  if (i < 0) return;
  editor.features.splice(i, 1);
  if (editor.baseIds.has(id)) editor.deleted.add(id);
  const j = editor.sel.findIndex(s => s.id === id);
  if (j >= 0) { editor.sel.splice(j, 1); syncSel(); }
  refreshEdits();
}

/* Delete every selected record that has already been saved. */
function deleteSel() {
  const ids = editor.sel.filter(s => s.existing).map(s => s.id);
  if (!ids.length) return;
  if (ids.length > 1 && !confirm('Delete ' + ids.length + ' saved edits?')) return;
  for (const id of ids) deleteEdit(id);
  clearSel();
}

// ------------------------------------------------------------ polygon draw
function pushDraw() {
  const feats = [];
  const r = editor.ring;
  for (const c of r) feats.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } });
  if (r.length >= 2) feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r } });
  if (r.length >= 3) feats.push({ type: 'Feature', properties: {},
    geometry: { type: 'Polygon', coordinates: [[...r, r[0]]] } });
  const fc = { type: 'FeatureCollection', features: feats };
  eachMap(m => { const s = m.getSource('edit_draw'); if (s) s.setData(fc); });
  const bar = $('#drawBar');
  if (bar) {
    bar.hidden = editor.mode !== 'draw';
    const n = bar.querySelector('.dn');
    if (n) n.textContent = r.length + (r.length === 1 ? ' point' : ' points');
    const fin = bar.querySelector('[data-draw="finish"]');
    if (fin) fin.disabled = r.length < 3;
  }
}
function drawUndo() { editor.ring.pop(); pushDraw(); }
function drawCancel() { editor.ring = []; pushDraw(); }
function drawFinish() {
  const r = editor.ring;
  if (r.length < 3) { toast('A polygon needs at least three points'); return; }
  const id = 'manual:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  editor.sel = [{ id, geometry: { type: 'Polygon', coordinates: [[...r, r[0]]] },
    source: 'manual', src_id: '', name: '', status: '', note: '', existing: false }];
  editor.ring = [];
  pushDraw();
  syncSel();
}


// ------------------------------------------------------- geometry: reshape
/* Move and reshape the selection.  There is no separate Reshape mode: a mode
 * of its own would need a second way of choosing a feature and Pick already
 * has one, so the gestures simply attach to whatever Pick has selected.  With
 * exactly one polygon selected every ring vertex gets an amber handle and
 * every edge a smaller blue midpoint that inserts a vertex when dragged; with
 * several selected there are no handles and a drag inside any of them moves
 * the whole set.  Everything runs on screen-pixel deltas through
 * project/unproject, so a shape stays rigid under a drag and a nudge means the
 * same distance at any zoom or latitude. */
const EDIT_VERT_PX = 12;    // grab radius for a vertex handle
const EDIT_MID_PX = 9;      // grab radius for an edge midpoint handle
const EDIT_HIST_MAX = 50;   // geometry undo depth

const cloneGeom = g => JSON.parse(JSON.stringify(g));
const isPolyGeom = g => !!g && (g.type === 'Polygon' || g.type === 'MultiPolygon');

/* Every closed ring of a polygon or multipolygon, as [polyIndex, ringIndex, ring].
 * Anything that is not a polygon yields nothing, so points and lines are simply
 * left alone rather than throwing. */
function editRings(g) {
  if (!isPolyGeom(g)) return [];
  const out = [];
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  (polys || []).forEach((rings, pi) => (rings || []).forEach((ring, ri) => {
    if (Array.isArray(ring) && ring.length >= 4) out.push([pi, ri, ring]);
  }));
  return out;
}
const editRingAt = (g, pi, ri) =>
  g.type === 'Polygon' ? g.coordinates[ri] : ((g.coordinates[pi] || [])[ri]);

/* Walk every coordinate pair of any geometry in place, for a rigid translate. */
function eachCoord(g, fn) {
  (function walk(c) {
    if (!c) return;
    if (typeof c[0] === 'number') { fn(c); return; }
    for (const x of c) walk(x);
  })(g.coordinates);
}

/* Handles are shown only for a lone polygon selection. */
function handleGeom() {
  const s = editor.sel;
  return (editorActive() && editor.mode !== 'draw' && s.length === 1 && isPolyGeom(s[0].geometry))
    ? s[0].geometry : null;
}
/* A ring repeats its first point last, so the closing copy is not its own
 * handle; the midpoint of the last edge runs from the last point back to it. */
function handlesFC() {
  const g = handleGeom(), feats = [];
  if (g) for (const [, , ring] of editRings(g)) {
    const n = ring.length - 1;
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[i + 1];
      feats.push({ type: 'Feature', properties: { k: 'm' },
        geometry: { type: 'Point', coordinates: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] } });
    }
    // Vertices last, so an amber handle draws over the midpoints crowding it.
    for (let i = 0; i < n; i++)
      feats.push({ type: 'Feature', properties: { k: 'v' },
        geometry: { type: 'Point', coordinates: [ring[i][0], ring[i][1]] } });
  }
  return { type: 'FeatureCollection', features: feats };
}
function pushHandles() {
  const fc = handlesFC();
  eachMap(m => { const s = m.getSource('edit_handles'); if (s) s.setData(fc); });
  return fc.features.length > 0;
}
function syncHandles() {
  const on = pushHandles();
  // Double-click deletes a vertex while handles are up, so its zoom stands down.
  eachMap(m => {
    if (!m.doubleClickZoom || editor.mode === 'draw') return;
    if (on) m.doubleClickZoom.disable(); else m.doubleClickZoom.enable();
  });
}

// ----------------------------------------------------------- hit testing
/* Nearest grab point to the pointer, or null.  Vertices are tested first and
 * with the wider radius, so one always wins against the midpoints beside it. */
function editHitHandle(m, pt) {
  const g = handleGeom();
  if (!g) return null;
  let hit = null, bd = EDIT_VERT_PX;
  for (const [pi, ri, ring] of editRings(g)) {
    for (let i = 0; i < ring.length - 1; i++) {
      const q = m.project(ring[i]), d = Math.hypot(q.x - pt.x, q.y - pt.y);
      if (d <= bd) { bd = d; hit = { kind: 'vertex', p: pi, r: ri, i }; }
    }
  }
  if (hit) return hit;
  bd = EDIT_MID_PX;
  for (const [pi, ri, ring] of editRings(g)) {
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i], b = ring[i + 1];
      const q = m.project([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      const d = Math.hypot(q.x - pt.x, q.y - pt.y);
      if (d <= bd) { bd = d; hit = { kind: 'mid', p: pi, r: ri, i }; }
    }
  }
  return hit;
}
/* Is the pointer inside one of the selected polygons?  Even-odd over every
 * ring, in screen space, so a hole reads as outside and a reprojected shape
 * still tests true. */
function editInSel(m, pt) {
  for (const s of editor.sel) {
    if (!isPolyGeom(s.geometry)) continue;
    let inside = false;
    for (const [, , ring] of editRings(s.geometry)) {
      const q = ring.map(c => m.project(c));
      for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
        const a = q[i], b = q[j];
        if ((a.y > pt.y) !== (b.y > pt.y) &&
            pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      }
    }
    if (inside) return s;
  }
  return null;
}
function editorCursor(m, pt) {
  if (editor.drag) return 'grabbing';
  if (editor.mode !== 'draw' && editor.sel.length) {
    if (editHitHandle(m, pt)) return 'grab';
    if (editInSel(m, pt)) return 'move';
  }
  return 'crosshair';
}

// ------------------------------------------------------------------ undo
/* One entry per completed gesture: the geometry of everything it touched,
 * taken before the first pixel moves. */
function pushGeomHist(sels) {
  editor.geomHist.push(sels.filter(s => s.geometry)
    .map(s => ({ id: s.id, geometry: cloneGeom(s.geometry) })));
  while (editor.geomHist.length > EDIT_HIST_MAX) editor.geomHist.shift();
  syncUndoBtn();
}
function syncUndoBtn() {
  const b = editor.ui.undo;
  if (b) {
    b.disabled = !editor.geomHist.length;
    b.textContent = 'Undo geometry' + (editor.geomHist.length ? ' (' + editor.geomHist.length + ')' : '');
  }
}
function undoGeom() {
  const h = editor.geomHist.pop();
  if (!h || !h.length) { toast('No geometry change to undo'); syncUndoBtn(); return; }
  for (const it of h) {
    const g = cloneGeom(it.geometry);
    const s = editor.sel.find(x => x.id === it.id);
    if (s) s.geometry = g;
    const f = editById(it.id);
    if (f) f.geometry = g;
  }
  syncUndoBtn();
  syncSel();
  refreshEdits();
  toast('Geometry restored');
}

// --------------------------------------------------------------- editing
/* Take a private copy of the geometry and hand the same object to the saved
 * feature, so edits-fill follows the drag without a copy per frame. */
function editWorkGeom(s) {
  s.geometry = cloneGeom(s.geometry);
  const f = editById(s.id);
  if (f) f.geometry = s.geometry;
  return s.geometry;
}
function pushGeomLive() {
  eachMap(m => { const s = m.getSource('edits'); if (s) s.setData(editFC()); });
  setSelGeom(editor.sel);
  pushHandles();
}
/* End of a gesture.  A feature already in the collection keeps its new shape
 * straight away — the working copy goes to localStorage exactly as a status
 * change does, and a baseline feature is written out as a local override.  A
 * candidate that has not been saved yet carries its geometry to Save. */
function commitGeom(sels) {
  const now = new Date().toISOString();
  let n = 0;
  for (const s of sels) {
    const f = editById(s.id);
    if (!f) continue;
    f.geometry = s.geometry;
    f.properties.updated_at = now;
    n++;
  }
  if (n) refreshEdits(); else pushGeomLive();
  syncHandles();
}
function shiftGeom(m, g, dx, dy) {
  eachCoord(g, c => {
    const q = m.project(c), o = m.unproject([q.x + dx, q.y + dy]);
    c[0] = o.lng; c[1] = o.lat;
  });
}
function moveVertex(m, d, dx, dy) {
  const g = d.sels[0] && d.sels[0].geometry;
  const ring = g && editRingAt(g, d.p, d.r);
  if (!ring || !ring[d.i]) return;
  const q = m.project(ring[d.i]), o = m.unproject([q.x + dx, q.y + dy]);
  ring[d.i] = [o.lng, o.lat];
  const n = ring.length - 1;
  if (d.i === 0) ring[n] = ring[0].slice();          // the ring closure follows its first point
  else if (d.i === n) ring[0] = ring[n].slice();
}
/* Drop a vertex, refusing to leave a ring with fewer than three of them. */
function deleteVertex(h) {
  const s = editor.sel[0];
  if (!s || !isPolyGeom(s.geometry)) return;
  const cur = editRingAt(s.geometry, h.p, h.r);
  if (!cur) return;
  editor.dragEnd = Date.now();      // a hit on a handle is a delete, never a fresh pick
  if (cur.length - 1 <= 3) { toast('A ring needs at least three points'); return; }
  pushGeomHist([s]);
  const ring = editRingAt(editWorkGeom(s), h.p, h.r);
  ring.splice(h.i, 1);
  if (h.i === 0) ring[ring.length - 1] = ring[0].slice();
  commitGeom([s]);
  toast('Vertex removed');
}
/* Arrow keys: one screen pixel, ten with Shift.  A run of presses coalesces
 * into a single undo step instead of filling the stack one tap at a time. */
function nudgeSel(dx, dy) {
  const m = maps.post;
  const sels = editor.sel.filter(s => s.geometry);
  if (!m || !sels.length) return;
  const now = Date.now();
  if (now - editor.nudgeAt > 900) {
    pushGeomHist(sels);
    for (const s of sels) editWorkGeom(s);
  }
  editor.nudgeAt = now;
  for (const s of sels) shiftGeom(m, s.geometry, dx, dy);
  commitGeom(sels);
}

// --------------------------------------------------------------- pointer
function editorDown(m, ev) {
  if (imgAlign.on || editor.drag) return;             // Image align owns the pointer while it is on
  if (!editorActive() || editor.mode === 'draw' || !editor.sel.length) return;
  const oe = ev.originalEvent || {};
  if (oe.shiftKey || oe.ctrlKey || oe.metaKey) return;   // those build the selection, not the shape
  const h = editHitHandle(m, ev.point);
  if (h && h.kind === 'vertex' && oe.altKey) {
    deleteVertex(h);
    if (ev.preventDefault) ev.preventDefault();
    return;
  }
  if (!h && !editInSel(m, ev.point)) return;
  const sels = h ? [editor.sel[0]] : editor.sel.filter(s => s.geometry);
  if (!sels.length) return;
  editor.drag = { m, kind: h ? h.kind : 'move', p: h ? h.p : 0, r: h ? h.r : 0, i: h ? h.i : 0,
    sels, last: { x: ev.point.x, y: ev.point.y }, moved: false };
  m.dragPan.disable();
  m.getCanvas().style.cursor = 'grabbing';
  if (ev.preventDefault) ev.preventDefault();
}
function editorDrag(m, ev) {
  const d = editor.drag;
  if (!d || d.m !== m) return;
  const dx = ev.point.x - d.last.x, dy = ev.point.y - d.last.y;
  if (!d.moved) {
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;   // a click, not a drag: no undo step yet
    pushGeomHist(d.sels);
    for (const s of d.sels) editWorkGeom(s);
    if (d.kind === 'mid') {
      // The midpoint becomes a real vertex the moment it is pulled, and the
      // rest of the drag carries it.
      const ring = editRingAt(d.sels[0].geometry, d.p, d.r);
      const a = ring[d.i], b = ring[d.i + 1];
      ring.splice(d.i + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      d.kind = 'vertex'; d.i += 1;
    }
    d.moved = true;
  }
  if (d.kind === 'vertex') moveVertex(m, d, dx, dy);
  else for (const s of d.sels) shiftGeom(m, s.geometry, dx, dy);
  d.last = { x: ev.point.x, y: ev.point.y };
  pushGeomLive();
  if (ev.preventDefault) ev.preventDefault();
}
function editorUp() {
  const d = editor.drag;
  if (!d) return;
  editor.drag = null;
  if (d.m.dragPan) d.m.dragPan.enable();
  d.m.getCanvas().style.cursor = editorActive() ? 'crosshair' : '';
  if (!d.moved) return;              // a click that never moved leaves no undo step
  editor.dragEnd = Date.now();     // the click that follows a drag must not re-select
  commitGeom(d.sels);
}

// -------------------------------------------------------------- map wiring
/* Every OSM/Overture buildings fill layer, both datasets, derived from the
 * layer sets vectorGroup() registered rather than hardcoded. */
const buildingFillIds = () => HOT_LAYERS
  .filter(h => h.cat === 'buildings')
  .flatMap(h => h.ids.filter(id => /-fill$/.test(id)));
const layerLive = (m, id) => m.getLayer(id) && m.getLayoutProperty(id, 'visibility') !== 'none';

function editorClick(m, ev) {
  if (imgAlign.on) return;              // Image align has the map; a drag must not drop a vertex
  if (editor.mode === 'draw') {
    // The second click of a double-click would otherwise land as a duplicate vertex.
    const now = Date.now(), lc = editor.lastClick;
    if (lc && now - lc.t < 350 && Math.abs(lc.x - ev.point.x) < 6 && Math.abs(lc.y - ev.point.y) < 6) return;
    editor.lastClick = { t: now, x: ev.point.x, y: ev.point.y };
    editor.ring.push([ev.lngLat.lng, ev.lngLat.lat]);
    pushDraw();
    return;
  }
  if (editor.mode !== 'pick') return;
  if (Date.now() - editor.dragEnd < 300) return;   // the tail of a move or reshape drag
  const oe = ev.originalEvent || {};
  const additive = !!(oe.shiftKey || oe.ctrlKey || oe.metaKey);
  if (editor.visible && layerLive(m, 'edits-fill')) {
    const own = m.queryRenderedFeatures(ev.point, { layers: ['edits-fill'] })[0];
    if (own && own.properties && own.properties.id) { selectEdit(own.properties.id, additive); return; }
  }
  const ids = buildingFillIds().filter(id => layerLive(m, id));
  if (!ids.length) { toast('Turn on Buildings under Mapped features or Overture Maps first'); return; }
  const hit = m.queryRenderedFeatures(ev.point, { layers: ids })[0];
  if (!hit) {
    if (!additive) clearSel();          // a plain click on bare ground drops the selection
    else toast('No building footprint here — zoom in or try again');
    return;
  }
  selectFootprint(hit, additive);
}

function setEditorMode(mode) {
  editor.mode = mode;
  if (mode !== 'draw') editor.ring = [];
  if (mode === 'off') clearSel();
  pushDraw();
  eachMap(m => {
    m.getCanvas().style.cursor = editorActive() ? 'crosshair' : '';
    // Double-click closes the ring, so its zoom has to stand down while drawing.
    if (m.doubleClickZoom) { if (mode === 'draw') m.doubleClickZoom.disable(); else m.doubleClickZoom.enable(); }
    // Shift-click extends the selection, so shift-drag box zoom stands down while picking.
    if (m.boxZoom) { if (mode === 'pick') m.boxZoom.disable(); else m.boxZoom.enable(); }
  });
  for (const b of document.querySelectorAll('#dmgEd .seg button[data-em]'))
    b.setAttribute('aria-pressed', String(b.dataset.em === mode));
  if (editor.ui.hint) editor.ui.hint.textContent =
    mode === 'pick' ? 'Click a building footprint on either side of the divider. Shift- or ' + EDIT_MOD +
      '-click to add more and grade them in one go. Click one of your own edits to change it.'
    : mode === 'draw' ? 'Click to add points, double-click or Finish to close the ring. Esc cancels.'
    : 'Pick a mode to start recording damage. Off restores the normal feature popups.';
  if (mode !== 'off' && editor.ui.det) editor.ui.det.open = true;
  renderEditForm();
}

function wireDamageEditor() {
  const bar = el('div');
  bar.id = 'drawBar';
  bar.hidden = true;
  bar.innerHTML = '<span class="dn">0 points</span>' +
    '<button data-draw="finish">Finish</button>' +
    '<button data-draw="undo">Undo point</button>' +
    '<button data-draw="cancel">Cancel</button>';
  bar.querySelector('[data-draw="finish"]').addEventListener('click', drawFinish);
  bar.querySelector('[data-draw="undo"]').addEventListener('click', drawUndo);
  bar.querySelector('[data-draw="cancel"]').addEventListener('click', drawCancel);
  const stage = $('#stage');
  if (stage) stage.appendChild(bar);

  eachMap(m => {
    m.on('click', ev => editorClick(m, ev));
    m.on('dblclick', ev => {
      if (editor.mode === 'draw') {
        if (ev.preventDefault) ev.preventDefault();
        drawFinish();
        return;
      }
      // On a vertex handle a double-click drops that vertex; the zoom is
      // already disabled while handles are up, so nothing else moves.
      if (imgAlign.on || !editorActive()) return;
      const h = editHitHandle(m, ev.point);
      if (!h || h.kind !== 'vertex') return;
      if (ev.preventDefault) ev.preventDefault();
      deleteVertex(h);
    });
    m.on('mousedown', ev => editorDown(m, ev));
    m.on('mousemove', ev => editorDrag(m, ev));
    m.on('mouseup', editorUp);
    m.on('touchstart', ev => { if (!ev.points || ev.points.length === 1) editorDown(m, ev); });
    m.on('touchmove', ev => { if (!ev.points || ev.points.length === 1) editorDrag(m, ev); });
    m.on('touchend', editorUp);
    m.on('touchcancel', editorUp);
  });
  // A pointer released off the canvas would otherwise leave dragPan disabled.
  window.addEventListener('mouseup', editorUp);
  // Esc: drop the ring first, then the selection, then leave the mode alone.
  window.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape') return;
    if (editor.ring.length) { drawCancel(); ev.preventDefault(); return; }
    if (editor.sel.length) { clearSel(); ev.preventDefault(); return; }
    if (editorActive()) { setEditorMode('off'); ev.preventDefault(); }
  });
}

// ------------------------------------------------------------- export / IO
function editsBlob() {
  return JSON.stringify({ type: 'FeatureCollection',
    name: 'nepal_flood_2026_damage_edits', features: editor.features }, null, 1);
}
function exportEdits() {
  if (!editor.features.length) { toast('Nothing to export yet'); return; }
  const url = URL.createObjectURL(new Blob([editsBlob()], { type: 'application/geo+json' }));
  const a = el('a');
  a.href = url; a.download = 'damage_edits.geojson';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('Exported ' + editor.features.length + ' feature' + (editor.features.length === 1 ? '' : 's'));
}
async function copyEdits() {
  try { await navigator.clipboard.writeText(editsBlob()); toast('GeoJSON copied'); }
  catch (e) { toast('Copy failed — use Export instead'); }
}
function importEdits(file) {
  const fr = new FileReader();
  fr.onload = () => {
    let j = null;
    try { j = JSON.parse(String(fr.result)); } catch (e) { toast('Not valid JSON'); return; }
    const feats = j && Array.isArray(j.features) ? j.features
      : (j && j.type === 'Feature' ? [j] : null);
    if (!feats) { toast('Not a GeoJSON FeatureCollection'); return; }
    let added = 0, updated = 0;
    for (const f of feats) {
      if (!f || !f.geometry) continue;
      editId(f);
      const i = editor.features.findIndex(x => x.properties.id === f.properties.id);
      if (i >= 0) { editor.features[i] = f; updated++; } else { editor.features.push(f); added++; }
      editor.deleted.delete(f.properties.id);
    }
    refreshEdits();
    toast('Imported ' + added + ' new, ' + updated + ' updated');
  };
  fr.readAsText(file);
}
function clearEdits() {
  if (!editor.features.length) return;
  if (!confirm('Delete all ' + editor.features.length + ' damage edits? This cannot be undone.')) return;
  for (const f of editor.features) if (editor.baseIds.has(f.properties.id)) editor.deleted.add(f.properties.id);
  editor.features = [];
  clearSel();
  refreshEdits();
}

// ------------------------------------------------------------- sidebar: UI
function editBBox(g) {
  let w = 180, s = 90, e = -180, n = -90;
  (function walk(c) {
    if (typeof c[0] === 'number') {
      w = Math.min(w, c[0]); e = Math.max(e, c[0]);
      s = Math.min(s, c[1]); n = Math.max(n, c[1]);
      return;
    }
    for (const x of c) walk(x);
  })(g.coordinates);
  if (e - w < 1e-4) { w -= 5e-5; e += 5e-5; }
  if (n - s < 1e-4) { s -= 5e-5; n += 5e-5; }
  return [[w, s], [e, n]];
}
function zoomToEdit(f) {
  if (!maps.post || !f.geometry) return;
  maps.post.fitBounds(editBBox(f.geometry), { padding: 120, duration: 700 });
}

/* The selection form: status buttons, a note, save / delete.  One selection
 * names the feature; several report the tally, and every control acts on all
 * of them at once. */
function renderEditForm() {
  const box = editor.ui.form;
  if (!box) return;
  const sels = editor.sel;
  box.innerHTML = '';
  box.hidden = !sels.length;
  if (!sels.length) return;
  const one = sels.length === 1 ? sels[0] : null;
  const srcName = v => v === 'manual' ? 'manual' : v === 'osm' ? 'OSM' : 'Overture';

  if (one) {
    box.appendChild(el('div', 'dmg-h', esc(one.source === 'manual' ? 'Drawn polygon' : (one.name || 'Unnamed building'))));
    box.appendChild(el('p', 'meta', srcName(one.source) + (one.src_id ? ' · <b>' + esc(one.src_id) + '</b>' : '') +
      (one.existing ? ' · already recorded' : '')));
  } else {
    box.appendChild(el('div', 'dmg-h', sels.length + ' features selected'));
    const bySrc = {};
    for (const s of sels) bySrc[s.source] = (bySrc[s.source] || 0) + 1;
    const already = sels.filter(s => s.existing).length;
    box.appendChild(el('p', 'meta',
      Object.entries(bySrc).map(([k, v]) => '<b>' + v + '</b> ' + srcName(k)).join(' · ') +
      (already ? ' · ' + already + ' already recorded' : '')));
  }

  // The status is shared: it reads back only when every selection agrees.
  const common = sels.every(s => s.status === sels[0].status) ? sels[0].status : '';
  const seg = el('div', 'seg');
  for (const st of EDIT_STATUS) {
    const b = el('button', null, st.label);
    b.dataset.st = st.key;
    b.setAttribute('aria-pressed', String(common === st.key));
    b.addEventListener('click', () => {
      for (const s of sels) s.status = st.key;
      for (const x of seg.children) x.setAttribute('aria-pressed', String(x.dataset.st === st.key));
    });
    seg.appendChild(b);
  }
  box.appendChild(seg);

  const ta = el('textarea');
  ta.placeholder = one ? 'Note (optional)' : 'Note (optional) — applied to all ' + sels.length;
  ta.rows = 2;
  ta.value = sels.every(s => s.note === sels[0].note) ? (sels[0].note || '') : '';
  ta.addEventListener('input', () => { for (const s of sels) s.note = ta.value; });
  box.appendChild(ta);

  const acts = el('div', 'chips');
  const nExisting = sels.filter(s => s.existing).length;
  const save = el('button', null,
    one ? (one.existing ? 'Update' : 'Save') : (nExisting === sels.length ? 'Update ' : 'Save ') + sels.length);
  save.addEventListener('click', commitSel);
  acts.appendChild(save);
  if (nExisting) {
    const del = el('button', null, one ? 'Delete' : 'Delete ' + nExisting);
    del.addEventListener('click', deleteSel);
    acts.appendChild(del);
  }
  const cancel = el('button', null, 'Cancel');
  cancel.addEventListener('click', clearSel);
  acts.appendChild(cancel);
  box.appendChild(acts);
  if (!one) box.appendChild(el('p', 'note', 'Shift- or ' + EDIT_MOD +
    '-click a selected footprint to drop it. Esc clears the selection.'));
}

/* Counts per status plus the scrollable item list. */
function renderEditList() {
  const u = editor.ui;
  if (!u.counts || !u.list) return;
  const n = editor.features.length;
  if (u.n) u.n.textContent = String(n);
  if (u.cnt) u.cnt.textContent = n ? fmtCount(n) : '';

  u.counts.innerHTML = '';
  for (const st of EDIT_STATUS) {
    const c = editor.features.filter(f => f.properties.status === st.key).length;
    const chip = el('span', 'chip lg', st.label + ' ' + c);
    chip.style.background = st.color;
    u.counts.appendChild(chip);
  }

  u.list.innerHTML = '';
  u.rows = new Map();
  if (!n) { u.list.appendChild(el('p', 'note', 'No edits yet.')); return; }
  for (const f of editor.features.slice().reverse()) {
    const p = f.properties;
    const row = el('div', 'brow');
    const chip = el('span', 'chip');
    chip.style.background = editColor(p.status);
    const t = el('div', 't');
    const label = p.name || (p.source === 'manual' ? 'manual polygon' : 'unnamed building');
    t.innerHTML = '<span>' + esc(label) + '</span><span class="sub">' + esc(editLabel(p.status)) +
      ' · ' + esc(p.source || '?') + (p.note ? ' · ' + esc(String(p.note).slice(0, 40)) : '') + '</span>';
    const acts = el('div', 'acts');
    const z = el('button', 'mini', 'zoom');
    z.title = 'Zoom to this feature';
    z.addEventListener('click', ev => { ev.stopPropagation(); zoomToEdit(f); });
    const d = el('button', 'mini', '×');
    d.title = 'Delete this edit';
    d.addEventListener('click', ev => { ev.stopPropagation(); deleteEdit(p.id); });
    acts.append(z, d);
    row.append(chip, t, acts);
    // Shift- or Ctrl-click builds a selection from the list without moving the map.
    row.addEventListener('click', ev => {
      if (ev.shiftKey || ev.ctrlKey || ev.metaKey) { selectEdit(p.id, true); return; }
      zoomToEdit(f);
      if (editor.mode === 'pick') selectEdit(p.id, false);
    });
    u.rows.set(p.id, row);
    u.list.appendChild(row);
  }
  markSelRows();
}

/* Tick the list rows that are in the current selection. */
function markSelRows() {
  const rows = editor.ui.rows;
  if (!rows) return;
  for (const [id, row] of rows) row.classList.toggle('on', selHas(id));
}

function buildDamageEditor() {
  const block = el('div', 'block');
  const det = el('details'); det.id = 'dmgEd';
  editor.ui.det = det;
  const sum = el('summary', null, 'Damage editor <span class="n">0</span>');
  det.appendChild(sum);
  editor.ui.n = sum.querySelector('.n');

  det.appendChild(el('p', 'note', 'Build your own layer of flood-damaged buildings. ' +
    'The HOT and NAXA damage record is incomplete; this stays on your machine until you export it.'));

  const modeF = el('div', 'field');
  modeF.appendChild(el('label', null, 'Mode'));
  const seg = el('div', 'seg');
  for (const [v, t] of [['off', 'Off'], ['pick', 'Pick building'], ['draw', 'Draw polygon']]) {
    const b = el('button', null, t);
    b.dataset.em = v;
    b.setAttribute('aria-pressed', String(editor.mode === v));
    b.addEventListener('click', () => setEditorMode(v));
    seg.appendChild(b);
  }
  modeF.appendChild(seg);
  det.appendChild(modeF);
  editor.ui.hint = el('p', 'note', 'Pick a mode to start recording damage. Off restores the normal feature popups.');
  det.appendChild(editor.ui.hint);
  det.appendChild(el('p', 'note', 'With something selected: drag inside it to move it. One polygon also gets ' +
    'handles — drag an amber vertex to reshape, a blue midpoint to add one, double-click or Alt-click a vertex ' +
    'to remove it. Arrow keys nudge by a screen pixel, ten with Shift. A saved feature keeps its new shape at ' +
    'once; an unsaved one carries it to Save.'));
  const undoRow = el('div', 'chips');
  editor.ui.undo = el('button', null, 'Undo geometry');
  editor.ui.undo.disabled = true;
  editor.ui.undo.title = 'Step back through the last 50 moves and reshapes';
  editor.ui.undo.addEventListener('click', undoGeom);
  undoRow.appendChild(editor.ui.undo);
  det.appendChild(undoRow);

  // Visibility lives with the other overlays ("Building damage grading (analyst edits)"); this row only counts.
  const vis = el('div', 'row');
  const sw = el('span', 'sw');
  sw.style.background = DAMAGE_ROAD_RED;
  editor.ui.cnt = el('span', 'cnt', '');
  vis.append(sw, el('span', 't', 'My damage edits (shown via the Overlays switch)'), editor.ui.cnt);
  det.appendChild(vis);

  editor.ui.form = el('div', 'dmgform');
  editor.ui.form.hidden = true;
  det.appendChild(editor.ui.form);

  editor.ui.counts = el('div', 'dmg-counts');
  det.appendChild(editor.ui.counts);
  editor.ui.list = el('div', 'lazy dmg-list');
  det.appendChild(editor.ui.list);

  const acts = el('div', 'chips');
  acts.style.marginTop = '7px';
  const exp = el('button', null, 'Export'); exp.addEventListener('click', exportEdits);
  const cp = el('button', null, 'Copy'); cp.addEventListener('click', copyEdits);
  const imp = el('button', null, 'Import');
  const file = el('input'); file.type = 'file'; file.accept = '.geojson,.json,application/geo+json,application/json';
  file.style.display = 'none';
  file.addEventListener('change', () => { if (file.files && file.files[0]) importEdits(file.files[0]); file.value = ''; });
  imp.addEventListener('click', () => file.click());
  const clr = el('button', null, 'Clear all'); clr.addEventListener('click', clearEdits);
  acts.append(exp, cp, imp, clr, file);
  det.appendChild(acts);
  det.appendChild(el('p', 'note',
    'Export, then save to <code>' + esc(CFG.DAMAGE_EDITS_URL || EDIT_FILE) + '</code> and commit it to publish. ' +
    'Footprint geometry is read from the rendered vector tile, so zoom in before picking.'));

  block.appendChild(det);
  renderEditList();
  return block;
}

// ======================================================================== //
// Image align                                                              //
// ------------------------------------------------------------------------ //
// Owner tool for hand-fitting an ungeoreferenced photograph onto the map.  A
// MapLibre `image` source accepts any four corners, so the photo can be
// dragged, rotated, scaled and stretched over the WorldView-2 / Legion layers
// until it sits right, and the resulting corners exported as JSON to feed the
// retile pipeline.  Everything is local: the working fit lives in
// localStorage under IMGALIGN_KEY and nothing here writes data/imagery.json
// or any committed file.  The maths runs in Web Mercator metres, not degrees,
// so a rotation stays rigid instead of shearing with latitude.
// ======================================================================== //

const IMGALIGN_KEY = 'nf26.imgalign';
const IMGALIGN_IMG = 'work/drone_trisuli/photo_v2.jpg';   // same frame as photo_clean.png, original JPEG without UI overlays
const IMGALIGN_W = 1080;   // fallback only; the real size is measured when an image loads
const IMGALIGN_H = 608;
// The published corners of post_drone_trisuli_202609, in the image order
// MapLibre wants: top-left, top-right, bottom-right, bottom-left.  They come
// from the affine solved against the cloud-free 5 Feb Legion scene
// (work/drone_trisuli/drone_align_pre_affine.json), which is what the tiles
// were built from, so "Reset to initial" returns to what the map is showing.
const IMGALIGN_INIT = [
  [85.1441602, 27.9212796], [85.1473678, 27.9272874],
  [85.1509512, 27.9257288], [85.1477436, 27.9197209],
];
const IMGALIGN_CORNER_PX = 14;   // grab radius for a corner handle
const IMGALIGN_EDGE_PX = 12;     // grab radius for an edge (midpoint) handle

const imgAlign = {
  on: false,
  mode: 'move',            // 'move' | 'corners'
  nx: 1, ny: 1,            // mesh cells across and down; 1x1 is the plain quad
  grid: null,              // (nx+1)*(ny+1) [lon,lat] mesh vertices, row-major from top-left
  cells: null,             // data: URLs of the sliced image, one per cell (null at 1x1)
  url: IMGALIGN_IMG,
  w: IMGALIGN_W, h: IMGALIGN_H,   // pixel size of the loaded image (measured in imgAlignLoad)
  fits: {},                // per-image placements keyed by url: {coordinates, nx, ny, grid, rot}
  opacity: 0.7,
  rot: 0,                  // running total for the rotation control; display only, the corners are the truth
  coords: IMGALIGN_INIT.map(p => p.slice()),
  hist: [],                // undo stack of {coords, rot} snapshots
  drag: null,              // {m, kind, corner, last, a0} while a pointer is down
  ui: {},                  // control-panel nodes, filled by buildImageAlign()
};

// ------------------------------------------------------------ Mercator maths
const MERC_R = 6378137;
const MERC_LAT_MAX = 85.05112878;
function toMerc(p) {
  const lat = Math.max(-MERC_LAT_MAX, Math.min(MERC_LAT_MAX, +p[1]));
  return [MERC_R * (+p[0]) * Math.PI / 180,
          MERC_R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
}
function fromMerc(q) {
  return [q[0] / MERC_R * 180 / Math.PI,
          (2 * Math.atan(Math.exp(q[1] / MERC_R)) - Math.PI / 2) * 180 / Math.PI];
}
/* Run `fn(point, centre)` over the four corners in Mercator metres and write
 * the result back as degrees.  Rotation about the centroid preserves it, so
 * the centre is safe to compute once per call. */
function imgAlignEach(fn) {
  const k = imgAlign.coords.map(toMerc);
  const c = [(k[0][0] + k[1][0] + k[2][0] + k[3][0]) / 4,
             (k[0][1] + k[1][1] + k[2][1] + k[3][1]) / 4];
  // Every mesh vertex moves, about the centre of the outer quad, so a rotation
  // or a scale stays rigid however the interior has been pulled around.
  imgAlign.grid = imgAlign.grid.map(p => fromMerc(fn(toMerc(p), c)));
  imgAlignSyncCorners();
}
function imgAlignCentre() {
  const m = imgAlign.coords.map(toMerc);
  return fromMerc([(m[0][0] + m[1][0] + m[2][0] + m[3][0]) / 4,
                   (m[0][1] + m[1][1] + m[2][1] + m[3][1]) / 4]);
}

// ------------------------------------------------------------------- mesh
/* The photo is carried by a mesh of (nx+1)x(ny+1) vertices.  At 1x1 that is
 * just the four corners and one MapLibre `image` source, exactly as before.
 * Denser, each cell becomes its own image source over its own four vertices,
 * so a vertex can be pulled onto the canal or a road bend and only the cells
 * touching it move.  Adjacent cells share vertices, so the sheet stays joined.
 * A single image source cannot do this: it takes four corners and no more. */
const gi = (ix, iy) => iy * (imgAlign.nx + 1) + ix;
const imgAlignIsMesh = () => imgAlign.nx > 1 || imgAlign.ny > 1;
/* Grid index of outer corner c, in the export order TL, TR, BR, BL. */
function cornerGI(c) {
  const nx = imgAlign.nx, ny = imgAlign.ny;
  return [gi(0, 0), gi(nx, 0), gi(nx, ny), gi(0, ny)][c];
}
function imgAlignSyncCorners() {
  imgAlign.coords = [0, 1, 2, 3].map(c => imgAlign.grid[cornerGI(c)].slice());
}
/* Even mesh over a quad, interpolated in Mercator so the spacing is true. */
function imgAlignGridFromCorners(coords, nx, ny) {
  const M = coords.map(toMerc);
  const out = [];
  for (let iy = 0; iy <= ny; iy++) {
    const v = iy / ny;
    for (let ix = 0; ix <= nx; ix++) {
      const u = ix / nx;
      const tx = M[0][0] + (M[1][0] - M[0][0]) * u, ty = M[0][1] + (M[1][1] - M[0][1]) * u;
      const bx = M[3][0] + (M[2][0] - M[3][0]) * u, by = M[3][1] + (M[2][1] - M[3][1]) * u;
      out.push(fromMerc([tx + (bx - tx) * v, ty + (by - ty) * v]));
    }
  }
  return out;
}
/* Bilinear sample of the current mesh at normalised (u, v), so changing the
 * density keeps whatever deformation has already been dialled in. */
function imgAlignSampleMesh(u, v) {
  const nx = imgAlign.nx, ny = imgAlign.ny, g = imgAlign.grid;
  const fx = Math.min(u * nx, nx - 1e-9), fy = Math.min(v * ny, ny - 1e-9);
  const ix = Math.max(0, Math.min(Math.floor(fx), nx - 1));
  const iy = Math.max(0, Math.min(Math.floor(fy), ny - 1));
  const s = fx - ix, t = fy - iy;
  const a = toMerc(g[gi(ix, iy)]), b = toMerc(g[gi(ix + 1, iy)]);
  const c = toMerc(g[gi(ix, iy + 1)]), d = toMerc(g[gi(ix + 1, iy + 1)]);
  const tx = a[0] + (b[0] - a[0]) * s, ty = a[1] + (b[1] - a[1]) * s;
  const bx = c[0] + (d[0] - c[0]) * s, by = c[1] + (d[1] - c[1]) * s;
  return fromMerc([tx + (bx - tx) * t, ty + (by - ty) * t]);
}
function imgAlignSetDensity(nx, ny) {
  const pts = [];
  for (let iy = 0; iy <= ny; iy++)
    for (let ix = 0; ix <= nx; ix++) pts.push(imgAlignSampleMesh(ix / nx, iy / ny));
  imgAlignPush();
  imgAlign.nx = nx; imgAlign.ny = ny; imgAlign.grid = pts;
  imgAlignSyncCorners();
  imgAlignSlice(() => { imgAlignEnsure(); imgAlignApply(); imgAlignSyncUI(); });
}
const imgAlignCellCoords = (ix, iy) => [
  imgAlign.grid[gi(ix, iy)], imgAlign.grid[gi(ix + 1, iy)],
  imgAlign.grid[gi(ix + 1, iy + 1)], imgAlign.grid[gi(ix, iy + 1)]];

/* Cut the source image into one data: URL per cell.  Same-origin, so the
 * canvas is not tainted and toDataURL works; at 1x1 the file is used whole. */
function imgAlignSlice(done) {
  if (!imgAlignIsMesh()) { imgAlign.cells = null; if (done) done(); return; }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const nx = imgAlign.nx, ny = imgAlign.ny, out = [];
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const x0 = Math.round(img.width * ix / nx), x1 = Math.round(img.width * (ix + 1) / nx);
        const y0 = Math.round(img.height * iy / ny), y1 = Math.round(img.height * (iy + 1) / ny);
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, x1 - x0); cv.height = Math.max(1, y1 - y0);
        cv.getContext('2d').drawImage(img, x0, y0, cv.width, cv.height, 0, 0, cv.width, cv.height);
        out.push(cv.toDataURL('image/png'));
      }
    }
    imgAlign.cells = out;
    if (done) done();
  };
  img.onerror = () => { toast('Could not read ' + imgAlign.url + ' to slice'); if (done) done(); };
  img.src = abs(imgAlign.url);
}

// ------------------------------------------------------------- transforms
/* Each of these mutates the corners only.  The caller pushes history once and
 * calls imgAlignApply() afterwards, so a whole drag is a single undo step. */
function imgAlignRotateBy(deg) {
  const a = deg * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
  imgAlignEach((p, c) => {
    const x = p[0] - c[0], y = p[1] - c[1];
    return [c[0] + x * cs - y * sn, c[1] + x * sn + y * cs];
  });
  const r = imgAlign.rot + deg;
  imgAlign.rot = Math.round((((r + 180) % 360 + 360) % 360 - 180) * 100) / 100;
}
function imgAlignScaleBy(f) {
  imgAlignEach((p, c) => [c[0] + (p[0] - c[0]) * f, c[1] + (p[1] - c[1]) * f]);
}
/* Stretch along the image's own axes rather than north/east: axis 0 is the
 * width direction (top-left to top-right), axis 1 the height direction
 * (top-left to bottom-left), each averaged over both opposite edges so a
 * skewed quad still stretches sensibly. */
function imgAlignStretchBy(axis, f) {
  const m = imgAlign.coords.map(toMerc);
  const edge = (a, b, c, d) => [((m[b][0] - m[a][0]) + (m[d][0] - m[c][0])) / 2,
                                ((m[b][1] - m[a][1]) + (m[d][1] - m[c][1])) / 2];
  let v = axis === 0 ? edge(0, 1, 3, 2) : edge(0, 3, 1, 2);
  const len = Math.hypot(v[0], v[1]);
  if (!len) return;
  v = [v[0] / len, v[1] / len];
  imgAlignEach((p, c) => {
    const along = (p[0] - c[0]) * v[0] + (p[1] - c[1]) * v[1];
    const d = along * (f - 1);
    return [p[0] + v[0] * d, p[1] + v[1] * d];
  });
}
function imgAlignTranslateBy(dx, dy) {
  imgAlignEach(p => [p[0] + dx, p[1] + dy]);
}
/* Move by screen pixels, measured on whichever map is showing, so a nudge is
 * the same visual distance at every zoom. */
function imgAlignNudge(dx, dy) {
  const m = maps.post || maps.pre;
  if (!m) return;
  const c = imgAlignCentre();
  const p = m.project(c);
  const ll = m.unproject([p.x + dx, p.y + dy]);
  const from = toMerc(c), to = toMerc([ll.lng, ll.lat]);
  imgAlignPush();
  imgAlignTranslateBy(to[0] - from[0], to[1] - from[1]);
  imgAlignApply();
}

// --------------------------------------------------------- history / state
function imgAlignPush() {
  imgAlign.hist.push({ grid: imgAlign.grid.map(p => p.slice()),
                       nx: imgAlign.nx, ny: imgAlign.ny, rot: imgAlign.rot });
  if (imgAlign.hist.length > 80) imgAlign.hist.shift();
}
function imgAlignUndo() {
  const h = imgAlign.hist.pop();
  if (!h) { toast('Nothing to undo'); return; }
  const changed = h.nx !== imgAlign.nx || h.ny !== imgAlign.ny;
  imgAlign.grid = h.grid; imgAlign.nx = h.nx; imgAlign.ny = h.ny; imgAlign.rot = h.rot;
  imgAlignSyncCorners();
  if (changed) imgAlignSlice(() => { imgAlignEnsure(); imgAlignApply(); imgAlignSyncUI(); });
  else { imgAlignApply(); imgAlignSyncUI(); }
}
/* Reset drops the hand-fitting but keeps the mesh density, so the density is a
 * working choice rather than something to set up again after every reset. */
function imgAlignReset() {
  imgAlignPush();
  imgAlign.grid = imgAlignGridFromCorners(IMGALIGN_INIT, imgAlign.nx, imgAlign.ny);
  imgAlign.rot = 0;
  imgAlignSyncCorners();
  imgAlignApply();
  imgAlignSyncUI();
  toast('Back to the automatic fit');
}
/* Flatten the mesh back onto its own outer quad, undoing interior deformation
 * without touching where the four corners sit. */
function imgAlignFlatten() {
  imgAlignPush();
  imgAlign.grid = imgAlignGridFromCorners(imgAlign.coords, imgAlign.nx, imgAlign.ny);
  imgAlignApply();
  imgAlignSyncUI();
  toast('Mesh flattened to its corners');
}
const imgAlignFit = () => ({ coordinates: imgAlign.coords, nx: imgAlign.nx, ny: imgAlign.ny, grid: imgAlign.grid, rot: imgAlign.rot });
function imgAlignSave() {
  try {
    imgAlign.fits[imgAlign.url] = imgAlignFit();   // each image keeps its own placement
    localStorage.setItem(IMGALIGN_KEY, JSON.stringify({
      v: 3, on: imgAlign.on, mode: imgAlign.mode, url: imgAlign.url,
      opacity: imgAlign.opacity, rot: imgAlign.rot, coordinates: imgAlign.coords,
      nx: imgAlign.nx, ny: imgAlign.ny, grid: imgAlign.grid, fits: imgAlign.fits,
    }));
  } catch (e) { /* private mode or storage full */ }
}
/* Adopt a stored placement (a fit record) if it is well formed; returns true on success. */
function imgAlignAdoptFit(j) {
  const okPt = p => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]);
  const c = j && j.coordinates;
  if (!(Array.isArray(c) && c.length === 4 && c.every(okPt))) return false;
  imgAlign.coords = c.map(p => [+p[0], +p[1]]);
  imgAlign.nx = 1; imgAlign.ny = 1;
  imgAlign.grid = imgAlignGridFromCorners(imgAlign.coords, 1, 1);
  const nx = +j.nx, ny = +j.ny;
  if (nx >= 1 && nx <= 8 && ny >= 1 && ny <= 8 && Array.isArray(j.grid) &&
      j.grid.length === (nx + 1) * (ny + 1) && j.grid.every(okPt)) {
    imgAlign.nx = nx; imgAlign.ny = ny;
    imgAlign.grid = j.grid.map(p => [+p[0], +p[1]]);
    imgAlignSyncCorners();
  }
  imgAlign.rot = (typeof j.rot === 'number' && isFinite(j.rot)) ? j.rot : 0;
  return true;
}
function imgAlignRestore() {
  // The mesh is the store; the four corners are derived from it.  A v1 record
  // predates the mesh and carries corners only, so it seeds a 1x1 grid.
  imgAlign.grid = imgAlignGridFromCorners(imgAlign.coords, 1, 1);
  let j = null;
  try { j = JSON.parse(localStorage.getItem(IMGALIGN_KEY) || 'null'); } catch (e) { return; }
  if (!j || typeof j !== 'object') return;
  const c = j.coordinates;
  const okPt = p => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]);
  if (Array.isArray(c) && c.length === 4 && c.every(okPt)) {
    imgAlign.coords = c.map(p => [+p[0], +p[1]]);
    imgAlign.grid = imgAlignGridFromCorners(imgAlign.coords, 1, 1);
  }
  const nx = +j.nx, ny = +j.ny;
  if (nx >= 1 && nx <= 8 && ny >= 1 && ny <= 8 && Array.isArray(j.grid) &&
      j.grid.length === (nx + 1) * (ny + 1) && j.grid.every(okPt)) {
    imgAlign.nx = nx; imgAlign.ny = ny;
    imgAlign.grid = j.grid.map(p => [+p[0], +p[1]]);
    imgAlignSyncCorners();
  }
  if (typeof j.url === 'string' && j.url) imgAlign.url = j.url;
  if (j.fits && typeof j.fits === 'object') imgAlign.fits = j.fits;
  if (typeof j.opacity === 'number' && j.opacity >= 0 && j.opacity <= 1) imgAlign.opacity = j.opacity;
  if (j.mode === 'move' || j.mode === 'corners') imgAlign.mode = j.mode;
  if (typeof j.rot === 'number' && isFinite(j.rot)) imgAlign.rot = j.rot;
  // The stored on/off is honoured only when the flag is present; without it the
  // overlay must not draw, since there would be no control to turn it off.
  imgAlign.on = ALIGN_TOOL && !!j.on;
}

// ------------------------------------------------------------ map plumbing
const imgAlignQuadFC = () => {
  const nx = imgAlign.nx, ny = imgAlign.ny, g = imgAlign.grid, f = [];
  const ls = co => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: co } });
  for (let iy = 0; iy <= ny; iy++) {
    const row = [];
    for (let ix = 0; ix <= nx; ix++) row.push(g[gi(ix, iy)]);
    f.push(ls(row));
  }
  for (let ix = 0; ix <= nx; ix++) {
    const col = [];
    for (let iy = 0; iy <= ny; iy++) col.push(g[gi(ix, iy)]);
    f.push(ls(col));
  }
  return { type: 'FeatureCollection', features: f };
};
/* Midpoint of edge `i`, which runs from corner i to corner i+1: top, right,
 * bottom, left.  Taken in Mercator so it sits on the drawn edge rather than
 * drifting off it the way a raw degree average would. */
function imgAlignEdgeMid(i) {
  const a = toMerc(imgAlign.coords[i]), b = toMerc(imgAlign.coords[(i + 1) % 4]);
  return fromMerc([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
}
/* Eight grab points: `k` is 'c' for a corner and 'e' for an edge stretcher,
 * which the circle layer styles apart and the hit test reads back. */
const imgAlignPtFC = () => {
  const nx = imgAlign.nx, ny = imgAlign.ny, f = [];
  const pt = (k, i, co) => f.push({ type: 'Feature', properties: { k, i },
    geometry: { type: 'Point', coordinates: co } });
  if (!imgAlignIsMesh()) {
    // At 1x1 the edge handles are virtual midpoints that carry a whole side.
    imgAlign.coords.forEach((c, i) => pt('c', i, c));
    [0, 1, 2, 3].forEach(i => pt('e', i, imgAlignEdgeMid(i)));
    return { type: 'FeatureCollection', features: f };
  }
  imgAlign.grid.forEach((p, idx) => {
    const ix = idx % (nx + 1), iy = Math.floor(idx / (nx + 1));
    const onx = ix === 0 || ix === nx, ony = iy === 0 || iy === ny;
    pt(onx && ony ? 'c' : (onx || ony) ? 'e' : 'i', idx, p);
  });
  return { type: 'FeatureCollection', features: f };
};

function imgAlignTeardown(m) {
  // The cell count changes with the mesh density, so sweep by prefix rather
  // than by a fixed list.
  let st = null;
  try { st = m.getStyle(); } catch (e) { return; }
  if (!st) return;
  for (const l of st.layers || []) if (l.id.indexOf('imgalign') === 0 && m.getLayer(l.id)) m.removeLayer(l.id);
  for (const id of Object.keys(st.sources || {})) if (id.indexOf('imgalign') === 0 && m.getSource(id)) m.removeSource(id);
}
/* (Re)insert the overlay on one map.  Also called at the end of
 * applyImagery(), which adds `imagery:<id>` layers at IMAGERY_BEFORE and would
 * otherwise leave a newly ticked scene sitting on top of the photo. */
function imgAlignEnsureOn(m) {
  if (!m.isStyleLoaded()) { m.once('idle', () => imgAlignEnsureOn(m)); return; }
  imgAlignTeardown(m);
  if (!imgAlign.on) return;
  // Above the imagery layer, below the terrain, overlays and labels.
  const before = m.getLayer(IMAGERY_BEFORE) ? IMAGERY_BEFORE : undefined;
  const add = (id, url, co) => {
    try { m.addSource(id, { type: 'image', url, coordinates: co }); } catch (e) { return; }
    m.addLayer({ id, type: 'raster', source: id,
      paint: { 'raster-opacity': imgAlign.opacity, 'raster-fade-duration': 0 } }, before);
  };
  if (imgAlignIsMesh() && imgAlign.cells && imgAlign.cells.length === imgAlign.nx * imgAlign.ny) {
    for (let iy = 0; iy < imgAlign.ny; iy++)
      for (let ix = 0; ix < imgAlign.nx; ix++)
        add('imgalign_c' + (iy * imgAlign.nx + ix), imgAlign.cells[iy * imgAlign.nx + ix],
            imgAlignCellCoords(ix, iy));
  } else {
    add('imgalign', abs(imgAlign.url), imgAlign.coords);
  }
  // The outline and the grab handles go on top of everything, else they
  // disappear under whichever overlay the analyst is aligning against.
  m.addSource('imgalign_quad', { type: 'geojson', data: imgAlignQuadFC() });
  m.addSource('imgalign_pts', { type: 'geojson', data: imgAlignPtFC() });
  m.addLayer({ id: 'imgalign-edge', type: 'line', source: 'imgalign_quad',
    paint: { 'line-color': '#5eb0ff', 'line-width': 1.4, 'line-dasharray': [3, 2] } });
  m.addLayer({ id: 'imgalign-pt', type: 'circle', source: 'imgalign_pts',
    layout: { visibility: imgAlign.mode === 'corners' ? 'visible' : 'none' },
    paint: {
      'circle-radius': ['match', ['get', 'k'], 'e', 5.5, 'i', 5, 7],
      'circle-color': ['match', ['get', 'k'], 'e', '#5eb0ff', 'i', '#7ee787', '#ffb64d'],
      'circle-stroke-color': '#12161c', 'circle-stroke-width': 2,
    } });
}
const imgAlignEnsure = () => eachMap(imgAlignEnsureOn);

/* Push the corners to both maps.  setCoordinates() keeps the decoded bitmap,
 * so this is cheap enough to run on every mousemove. */
function imgAlignApply(persist) {
  eachMap(m => {
    if (imgAlignIsMesh()) {
      for (let iy = 0; iy < imgAlign.ny; iy++) {
        for (let ix = 0; ix < imgAlign.nx; ix++) {
          const src = m.getSource('imgalign_c' + (iy * imgAlign.nx + ix));
          if (src && src.setCoordinates) {
            try { src.setCoordinates(imgAlignCellCoords(ix, iy)); } catch (e) { /* degenerate cell */ }
          }
        }
      }
    } else {
      const s = m.getSource('imgalign');
      if (s && s.setCoordinates) { try { s.setCoordinates(imgAlign.coords); } catch (e) { /* degenerate quad */ } }
    }
    const q = m.getSource('imgalign_quad'); if (q) q.setData(imgAlignQuadFC());
    const p = m.getSource('imgalign_pts'); if (p) p.setData(imgAlignPtFC());
  });
  if (imgAlign.ui.json) imgAlign.ui.json.value = imgAlignJSON();
  if (persist !== false) imgAlignSave();
}

function imgAlignSetOn(on) {
  imgAlign.on = !!on;
  if (imgAlign.on && imgAlignIsMesh() && !imgAlign.cells) {
    imgAlignSlice(() => { imgAlignEnsure(); imgAlignApply(); });
  } else imgAlignEnsure();
  eachMap(m => { m.getCanvas().style.cursor = imgAlign.on ? 'move' : (editorActive() ? 'crosshair' : ''); });
  if (imgAlign.on && imgAlign.ui.det) imgAlign.ui.det.open = true;
  imgAlignSyncUI();
  imgAlignSave();
}
function imgAlignSetMode(mode) {
  imgAlign.mode = mode;
  eachMap(m => { if (m.getLayer('imgalign-pt'))
    m.setLayoutProperty('imgalign-pt', 'visibility', mode === 'corners' ? 'visible' : 'none'); });
  imgAlignSyncUI();
  imgAlignSave();
}
function imgAlignSetOpacity(v) {
  imgAlign.opacity = v;
  eachMap(m => {
    let st = null;
    try { st = m.getStyle(); } catch (e) { return; }
    for (const l of (st && st.layers) || [])
      if (l.type === 'raster' && l.id.indexOf('imgalign') === 0) m.setPaintProperty(l.id, 'raster-opacity', v);
  });
  imgAlignSave();
}
/* Record the image's true pixel size so the export names the grid the tiles are built from. */
function imgAlignProbeSize(u) {
  const probe = new Image();
  probe.onload = () => { imgAlign.w = probe.naturalWidth; imgAlign.h = probe.naturalHeight; imgAlignSyncUI(); };
  probe.onerror = () => toast('Could not load ' + u);
  probe.src = u;
}
function imgAlignLoad(url) {
  const u = String(url || '').trim();
  if (!u) { toast('Give an image URL first'); return; }
  if (imgAlign.url && imgAlign.url !== u) imgAlign.fits[imgAlign.url] = imgAlignFit();   // park the outgoing image's placement
  imgAlign.url = u;
  // A previously placed image comes back where it was left; a new one starts
  // where the quad is now, so it can be dragged into place from a known spot.
  const had = imgAlignAdoptFit(imgAlign.fits[u]);
  imgAlign.hist = [];
  imgAlignProbeSize(u);
  imgAlignSlice(() => {
    if (imgAlign.on) imgAlignEnsure();
    imgAlignApply();
    imgAlignSyncUI();
    imgAlignSave();
    toast((had ? 'Restored placement of ' : 'Loaded ') + u);
  });
}

// -------------------------------------------------------------- pointer UI
/* Screen-space hit tests.  The quad can be any shape once corners have been
 * dragged, so test the projected polygon rather than a lon/lat box. */
function imgAlignInQuad(m, pt) {
  const q = imgAlign.coords.map(c => m.project(c));
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const a = q[i], b = q[j];
    if ((a.y > pt.y) !== (b.y > pt.y) &&
        pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
/* Nearest grab point to the pointer, or null.  Corners are tested first and
 * with the larger radius, so a corner always wins over the edge handles
 * crowding it once the quad is dragged small. */
function imgAlignHitHandle(m, pt) {
  let hit = null, bd = IMGALIGN_CORNER_PX;
  if (imgAlignIsMesh()) {
    // Every mesh vertex is its own handle; the outer ones get the wider radius.
    const nx = imgAlign.nx, ny = imgAlign.ny;
    imgAlign.grid.forEach((c, idx) => {
      const ix = idx % (nx + 1), iy = Math.floor(idx / (nx + 1));
      const outer = ix === 0 || ix === nx || iy === 0 || iy === ny;
      const lim = outer ? IMGALIGN_CORNER_PX : IMGALIGN_EDGE_PX;
      const p = m.project(c), d = Math.hypot(p.x - pt.x, p.y - pt.y);
      if (d <= lim && (!hit || d < bd)) { bd = d; hit = { kind: 'vertex', i: idx }; }
    });
    return hit;
  }
  imgAlign.coords.forEach((c, i) => {
    const p = m.project(c), d = Math.hypot(p.x - pt.x, p.y - pt.y);
    if (d <= bd) { bd = d; hit = { kind: 'corner', i }; }
  });
  if (hit) return hit;
  bd = IMGALIGN_EDGE_PX;
  for (let i = 0; i < 4; i++) {
    const p = m.project(imgAlignEdgeMid(i)), d = Math.hypot(p.x - pt.x, p.y - pt.y);
    if (d <= bd) { bd = d; hit = { kind: 'edge', i }; }
  }
  return hit;
}
function imgAlignAngleAt(lngLat) {
  const c = toMerc(imgAlignCentre()), p = toMerc([lngLat.lng, lngLat.lat]);
  return Math.atan2(p[1] - c[1], p[0] - c[0]);
}
function imgAlignCursor(m, pt) {
  if (imgAlign.drag) return 'grabbing';
  if (imgAlign.mode === 'corners' && imgAlignHitHandle(m, pt)) return 'grab';
  return imgAlignInQuad(m, pt) ? 'move' : '';
}

function imgAlignDown(m, ev) {
  if (!imgAlign.on || imgAlign.drag) return;
  const oe = ev.originalEvent || {};
  const h = imgAlign.mode === 'corners' ? imgAlignHitHandle(m, ev.point) : null;
  if (!h && !imgAlignInQuad(m, ev.point)) return;
  const kind = h ? h.kind : (oe.shiftKey ? 'rotate' : 'move');
  imgAlignPush();
  imgAlign.drag = { m, kind, i: h ? h.i : -1,
    last: toMerc([ev.lngLat.lng, ev.lngLat.lat]),
    a0: kind === 'rotate' ? imgAlignAngleAt(ev.lngLat) : 0 };
  m.dragPan.disable();
  if (m.boxZoom) m.boxZoom.disable();
  m.getCanvas().style.cursor = 'grabbing';
  if (ev.preventDefault) ev.preventDefault();
}
function imgAlignDrag(m, ev) {
  const d = imgAlign.drag;
  if (!d || d.m !== m) return;
  const now = toMerc([ev.lngLat.lng, ev.lngLat.lat]);
  const dx = now[0] - d.last[0], dy = now[1] - d.last[1];
  const nudgeGrid = j => {
    const c = toMerc(imgAlign.grid[j]);
    imgAlign.grid[j] = fromMerc([c[0] + dx, c[1] + dy]);
  };
  if (d.kind === 'vertex') {
    // One mesh vertex: only the cells touching it deform, which is what lets a
    // single road bend be pulled into place without disturbing the rest.
    nudgeGrid(d.i);
    imgAlignSyncCorners();
  } else if (d.kind === 'corner') {
    // Move by the pointer delta rather than snapping the corner to the cursor,
    // so grabbing a handle off-centre does not jolt the quad.
    nudgeGrid(cornerGI(d.i));
    imgAlignSyncCorners();
  } else if (d.kind === 'edge') {
    // An edge stretcher carries both of its corners, so the opposite edge stays
    // put and the drag reads as a stretch (or a skew, dragged sideways).
    for (const j of [d.i, (d.i + 1) % 4]) nudgeGrid(cornerGI(j));
    imgAlignSyncCorners();
  } else if (d.kind === 'rotate') {
    const a = imgAlignAngleAt(ev.lngLat);
    imgAlignRotateBy((a - d.a0) * 180 / Math.PI);
    d.a0 = a;
  } else {
    imgAlignTranslateBy(dx, dy);
  }
  d.last = now;
  imgAlignApply(false);
  if (ev.preventDefault) ev.preventDefault();
}
function imgAlignUp() {
  const d = imgAlign.drag;
  if (!d) return;
  imgAlign.drag = null;
  d.m.dragPan.enable();
  // Shift-drag box zoom belongs to the damage editor's pick mode when that is on.
  if (d.m.boxZoom && editor.mode !== 'pick') d.m.boxZoom.enable();
  d.m.getCanvas().style.cursor = imgAlign.on ? 'move' : '';
  imgAlignApply();
  imgAlignSyncUI();
}

function wireImageAlign() {
  eachMap(m => {
    m.on('mousedown', ev => imgAlignDown(m, ev));
    m.on('mousemove', ev => imgAlignDrag(m, ev));
    m.on('mouseup', imgAlignUp);
    m.on('touchstart', ev => { if (!ev.points || ev.points.length === 1) imgAlignDown(m, ev); });
    m.on('touchmove', ev => { if (!ev.points || ev.points.length === 1) imgAlignDrag(m, ev); });
    m.on('touchend', imgAlignUp);
    m.on('touchcancel', imgAlignUp);
  });
  // A pointer released off the canvas would otherwise leave dragPan disabled.
  window.addEventListener('mouseup', imgAlignUp);
  imgAlignSetOn(imgAlign.on);
}

// ------------------------------------------------------------- export / IO
function imgAlignJSON() {
  const r = p => [+p[0].toFixed(7), +p[1].toFixed(7)];
  const out = {
    image: imgAlign.url, width: imgAlign.w, height: imgAlign.h,
    coordinates: imgAlign.coords.map(r),
  };
  if (imgAlignIsMesh()) {
    // Mesh vertices run row-major from the top-left of the image.  Each one is
    // a ground control point at image pixel (ix/nx * width, iy/ny * height),
    // which is what a thin-plate-spline warp needs.
    out.mesh = { nx: imgAlign.nx, ny: imgAlign.ny, grid: imgAlign.grid.map(r) };
  }
  return JSON.stringify(out, null, 1);
}
async function imgAlignCopy() {
  try { await navigator.clipboard.writeText(imgAlignJSON()); toast('Corners copied'); }
  catch (e) { toast('Copy failed — select the text in the box instead'); }
}
function imgAlignDownload() {
  const url = URL.createObjectURL(new Blob([imgAlignJSON()], { type: 'application/json' }));
  const a = el('a');
  a.href = url; a.download = 'drone_align.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('Saved drone_align.json');
}

// -------------------------------------------------------------------- panel
function imgAlignSyncUI() {
  const u = imgAlign.ui;
  if (!u.det) return;
  for (const b of document.querySelectorAll('#imgAl .seg button[data-ia]'))
    b.setAttribute('aria-pressed', String(b.dataset.ia === (imgAlign.on ? 'on' : 'off')));
  for (const b of document.querySelectorAll('#imgAl .seg button[data-iam]'))
    b.setAttribute('aria-pressed', String(b.dataset.iam === imgAlign.mode));
  for (const b of document.querySelectorAll('#imgAl .seg button[data-iag]'))
    b.setAttribute('aria-pressed', String(b.dataset.iag === imgAlign.nx + 'x' + imgAlign.ny));
  if (u.url && document.activeElement !== u.url) u.url.value = imgAlign.url;
  if (u.op && document.activeElement !== u.op) u.op.value = Math.round(imgAlign.opacity * 100);
  if (u.opN) u.opN.textContent = Math.round(imgAlign.opacity * 100) + '%';
  if (u.rot && document.activeElement !== u.rot) u.rot.value = imgAlign.rot;
  if (u.rotN) u.rotN.textContent = imgAlign.rot.toFixed(1) + '°';
  if (u.json) u.json.value = imgAlignJSON();
  if (u.n) u.n.textContent = imgAlign.on ? 'on' : 'off';
  if (u.hint) u.hint.textContent = !imgAlign.on
    ? 'Turn the tool on to place the photo. Nothing is drawn while it is off.'
    : imgAlign.mode !== 'corners'
      ? 'Drag inside the photo to move it, shift-drag to rotate about its centre. Arrow keys nudge one pixel, ten with Shift.'
      : imgAlignIsMesh()
        ? 'Drag any mesh vertex to bend that part of the photo onto the map: amber at the corners, blue on the edges, green inside. ' +
          'Only the cells touching a vertex move, so the canal and a road bend can be fitted one at a time.'
        : 'Drag an amber corner to move that corner alone, or a blue edge handle to carry a whole side. ' +
          'Pick a denser warp mesh above to bend the middle of the photo as well.';
}

function buildImageAlign() {
  const block = el('div', 'block');
  const det = el('details', 'imgal'); det.id = 'imgAl';
  imgAlign.ui.det = det;
  const sum = el('summary', null, 'Image align <span class="n">off</span>');
  det.appendChild(sum);
  imgAlign.ui.n = sum.querySelector('.n');

  det.appendChild(el('p', 'note', 'Hand-fit an ungeoreferenced photograph over the imagery, then export its ' +
    'four corners. Local only — this never touches <code>data/imagery.json</code>.'));

  // on / off ---------------------------------------------------------------
  const onF = el('div', 'field');
  onF.appendChild(el('label', null, 'Tool'));
  const onSeg = el('div', 'seg');
  for (const [v, t] of [['off', 'Off'], ['on', 'On']]) {
    const b = el('button', null, t);
    b.dataset.ia = v;
    b.addEventListener('click', () => imgAlignSetOn(v === 'on'));
    onSeg.appendChild(b);
  }
  onF.appendChild(onSeg);
  det.appendChild(onF);

  // image ------------------------------------------------------------------
  const urlF = el('div', 'field');
  urlF.appendChild(el('label', null, 'Image URL'));
  const urlRow = el('div', 'ia-row');
  const url = el('input'); url.type = 'text'; url.value = imgAlign.url;
  url.spellcheck = false;
  url.addEventListener('keydown', ev => { if (ev.key === 'Enter') imgAlignLoad(url.value); });
  const load = el('button', null, 'Load');
  load.addEventListener('click', () => imgAlignLoad(url.value));
  urlRow.append(url, load);
  urlF.appendChild(urlRow);
  imgAlign.ui.url = url;
  det.appendChild(urlF);

  // opacity ----------------------------------------------------------------
  const opF = el('div', 'field');
  const opL = el('label', null, 'Opacity <span class="ia-n">70%</span>');
  opF.appendChild(opL);
  imgAlign.ui.opN = opL.querySelector('.ia-n');
  const op = el('input'); op.type = 'range'; op.min = '0'; op.max = '100'; op.step = '1';
  op.value = String(Math.round(imgAlign.opacity * 100));
  op.addEventListener('input', () => { imgAlignSetOpacity(+op.value / 100); imgAlignSyncUI(); });
  opF.appendChild(op);
  imgAlign.ui.op = op;
  det.appendChild(opF);

  // drag mode --------------------------------------------------------------
  const mF = el('div', 'field');
  mF.appendChild(el('label', null, 'Drag mode'));
  const mSeg = el('div', 'seg');
  for (const [v, t] of [['move', 'Move'], ['corners', 'Stretch']]) {
    const b = el('button', null, t);
    b.dataset.iam = v;
    b.addEventListener('click', () => imgAlignSetMode(v));
    mSeg.appendChild(b);
  }
  mF.appendChild(mSeg);
  det.appendChild(mF);

  // mesh density -----------------------------------------------------------
  const gF = el('div', 'field');
  gF.appendChild(el('label', null, 'Warp mesh'));
  const gSeg = el('div', 'seg');
  for (const [nx, ny, t] of [[1, 1, '1x1'], [2, 2, '2x2'], [3, 3, '3x3'], [3, 5, '3x5'], [4, 6, '4x6']]) {
    const b = el('button', null, t);
    b.dataset.iag = nx + 'x' + ny;
    b.title = nx === 1 ? 'Plain quad: four corners and four side handles'
      : 'Split the photo into ' + (nx * ny) + ' cells; drag any vertex to bend that part onto the map';
    b.addEventListener('click', () => imgAlignSetDensity(nx, ny));
    gSeg.appendChild(b);
  }
  gF.appendChild(gSeg);
  det.appendChild(gF);

  imgAlign.ui.hint = el('p', 'note', '');
  det.appendChild(imgAlign.ui.hint);

  // rotation ---------------------------------------------------------------
  const rF = el('div', 'field');
  const rL = el('label', null, 'Rotation <span class="ia-n">0.0°</span>');
  rF.appendChild(rL);
  imgAlign.ui.rotN = rL.querySelector('.ia-n');
  const rot = el('input'); rot.type = 'range'; rot.min = '-180'; rot.max = '180'; rot.step = '0.5';
  rot.value = String(imgAlign.rot);
  // The slider is a delta control: the corners are the truth, so it applies the
  // change since its last position rather than an absolute bearing.
  let rotHeld = false;
  rot.addEventListener('input', () => {
    const d = (+rot.value) - imgAlign.rot;
    if (!d) return;
    if (!rotHeld) { imgAlignPush(); rotHeld = true; }
    imgAlignRotateBy(d);
    imgAlignApply();
    imgAlignSyncUI();
  });
  rot.addEventListener('change', () => { rotHeld = false; });
  rF.appendChild(rot);
  imgAlign.ui.rot = rot;
  const rBtn = el('div', 'chips ia-btns');
  const step = (label, fn) => { const b = el('button', null, label); b.addEventListener('click', fn); return b; };
  const bump = fn => { imgAlignPush(); fn(); imgAlignApply(); imgAlignSyncUI(); };
  rBtn.append(
    step('−0.5°', () => bump(() => imgAlignRotateBy(-0.5))),
    step('+0.5°', () => bump(() => imgAlignRotateBy(0.5))));
  rF.appendChild(rBtn);
  det.appendChild(rF);

  // scale and stretch ------------------------------------------------------
  const sF = el('div', 'field');
  sF.appendChild(el('label', null, 'Scale and stretch (1% steps)'));
  const sRow = el('div', 'chips ia-btns');
  sRow.append(
    step('− size', () => bump(() => imgAlignScaleBy(1 / 1.01))),
    step('+ size', () => bump(() => imgAlignScaleBy(1.01))),
    step('− width', () => bump(() => imgAlignStretchBy(0, 1 / 1.01))),
    step('+ width', () => bump(() => imgAlignStretchBy(0, 1.01))),
    step('− height', () => bump(() => imgAlignStretchBy(1, 1 / 1.01))),
    step('+ height', () => bump(() => imgAlignStretchBy(1, 1.01))));
  sF.appendChild(sRow);
  det.appendChild(sF);

  // undo / reset -----------------------------------------------------------
  const hRow = el('div', 'chips ia-btns');
  hRow.append(step('Undo', imgAlignUndo), step('Flatten mesh', imgAlignFlatten),
              step('Reset to initial', imgAlignReset));
  det.appendChild(hRow);

  // export -----------------------------------------------------------------
  const json = el('textarea');
  json.readOnly = true; json.rows = 7; json.spellcheck = false;
  json.value = imgAlignJSON();
  imgAlign.ui.json = json;
  det.appendChild(json);
  const eRow = el('div', 'chips ia-btns');
  eRow.append(step('Copy JSON', imgAlignCopy), step('Download JSON', imgAlignDownload));
  det.appendChild(eRow);
  det.appendChild(el('p', 'note', 'Corners run top-left, top-right, bottom-right, bottom-left of the image — ' +
    'the order a MapLibre <code>image</code> source and the retile scripts both expect. A denser mesh also ' +
    'exports <code>mesh.grid</code>, its vertices row-major from the top-left, each one a control point for a ' +
    'thin-plate-spline rewarp.'));

  block.appendChild(det);
  imgAlignSyncUI();
  return block;
}

// -------------------------------------------------------------------- boot
async function main() {
  const protocol = new pmtiles.Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);

  [catalog, terrain, hotTiles, aoiFlood, reports] = await Promise.all(
    [loadCatalog(), loadTerrain(), loadHotTiles(), loadAoi(), loadReports()]);
  const ovParam = readHash();

  // Scene ids from the hash that are not in the catalogue (stale link, renamed
  // layer) are dropped.  A hash that says nothing about a side seeds that side
  // from `default_<side>` in data/imagery.json: either a single id, or a list
  // of ids already in stacking order (bottom to top) for a multi-scene
  // default.  Any id no longer in the catalogue is dropped, in place.
  for (const side of ['pre', 'post']) {
    state[side] = selIds(side).filter(id => byId(id));
    if (!hashHadSide[side] && !state[side].length) {
      const def = catalog['default_' + side] || (layersFor(side)[0] || {}).id || null;
      const defList = Array.isArray(def) ? def : (def && def !== NO_IMAGERY ? [def] : []);
      const ids = defList.filter(id => byId(id));
      if (ids.length) state[side] = ids;
    }
  }

  const defs = buildDefs();
  applyOverlayDiff(ovParam);
  buildTags();
  applySidebar(false);

  maps.pre = makeMap('mapPre', defs, 'pre');
  maps.post = makeMap('mapPost', defs, 'post');
  maps.post.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
  if (maplibregl.GeolocateControl) maps.post.addControl(new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true }, trackUserLocation: true, showAccuracyCircle: true }), 'top-right');
  maps.post.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 120 }), 'bottom-left');
  maps.post.addControl(new maplibregl.FullscreenControl({ container: $('#stage') }), 'top-right');

  await Promise.all(['pre', 'post'].map(s => new Promise(res => maps[s].on('load', res))));

  applyImagery('pre'); applyImagery('post');
  applyOverlays(); applyBase(); applyColorBy(); applyOverlayOpacity(); applyAdminOpacity();
  syncMaps(maps.pre, maps.post);
  wirePopups(maps.pre); wirePopups(maps.post);

  imgAlignRestore();
  if (ALIGN_TOOL) imgAlignProbeSize(imgAlign.url);
  renderSidebar();
  applyMode();
  setSwipe(state.swipe, false);
  wireDivider(); wireKeyboard();
  wireDamageEditor();
  if (ALIGN_TOOL) wireImageAlign();
  initDamageEdits();

  // Default view: Trisuli Bazar at street scale (owner direction, 7 Sep 2026); CFG.HOME stays the pan limit.
  if (!state.center) maps.post.jumpTo({ center: CFG.DEFAULT_VIEW.center, zoom: CFG.DEFAULT_VIEW.zoom });
  maps.post.on('moveend', writeHash);
  maps.post.on('moveend', updateDamageInView);
  // the count column shows "z12+" for a category the current zoom is below
  maps.post.on('zoomend', () => { if (hotRefresh) hotRefresh(); });
  writeHash();

  const tog = $('#sidebarToggle');
  if (tog) tog.addEventListener('click', toggleSidebar);
  const ctog = $('#controlsToggle');
  if (ctog) ctog.addEventListener('click', toggleControls);
  window.addEventListener('resize', () => eachMap(m => m.resize()));
  window.addEventListener('hashchange', () => { if (!hashWriting) location.reload(); });
  // ?debug=1 also exposes the module internals, so a harness page can inspect
  // map and overlay state from outside the IIFE.  Off by default.
  if (QS.has('debug')) window.NF26 = { maps, state, get GROUPS() { return GROUPS; },
    get ENTRY() { return ENTRY; }, get reports() { return reports; } };
}

main().catch(e => {
  console.error(e);
  document.body.insertAdjacentHTML('afterbegin',
    '<pre style="position:absolute;z-index:99;background:#300;color:#fdd;padding:12px;max-width:90%">' + e + '</pre>');
});

// ------------------------------------------------------------------ debug
/* ?debug=1 : report each map's imagery state on screen and to the dev server. */
function debugReport(tag) {
  if (!QS.has('debug')) return;
  const rep = { tag, t: Date.now(), state: { mode: state.mode, pre: selIds('pre').join(','), post: selIds('post').join(','), base: state.base }, maps: {} };
  eachMap((m, side) => {
    let gl = null; try { gl = m.getCanvas().getContext('webgl2') || m.getCanvas().getContext('webgl'); } catch (e) {}
    const cc = m.getContainer().querySelector('.maplibregl-canvas-container');
    const ids = m.getStyle().layers.map(l => l.id);
    const imgIds = ids.filter(id => id.indexOf(IMG_PREFIX) === 0);
    const src = imgIds.length ? m.getSource(imgIds[imgIds.length - 1]) : null;
    rep.maps[side] = {
      styleLoaded: m.isStyleLoaded(), loaded: m.loaded(), zoom: +m.getZoom().toFixed(2),
      canvas: [m.getCanvas().width, m.getCanvas().height], container: [m.getContainer().clientWidth, m.getContainer().clientHeight],
      clip: cc ? getComputedStyle(cc).clipPath : null, webgl: !!gl, lostContext: gl ? gl.isContextLost() : null,
      imageryLayers: imgIds, imagerySource: src ? (src.tiles || src.url) : null, imageryBounds: src ? src.bounds : null,
      imageryLayerIdx: imgIds.length ? ids.indexOf(imgIds[0]) : -1, baseOsmIdx: ids.indexOf('base-osm'), nLayers: ids.length, first6: ids.slice(0, 6),
      imageryTiles: (() => { try {
        const out = {};
        for (const lid of imgIds) {
          const sc = m.style.sourceCaches[lid] || (m.style._otherSourceCaches || {})[lid];
          if (!sc) { out[lid] = null; continue; }
          const ts = Object.values(sc._tiles || {});
          out[lid] = { n: ts.length, states: ts.reduce((a, t) => (a[t.state] = (a[t.state] || 0) + 1, a), {}) };
        }
        return out; } catch (e) { return String(e); } })(),
    };
  });
  const txt = JSON.stringify(rep);
  try { navigator.sendBeacon('log', txt); } catch (e) {}
  let box = document.getElementById('dbg');
  if (!box) { box = document.createElement('pre'); box.id = 'dbg';
    box.style.cssText = 'position:absolute;left:8px;bottom:8px;z-index:99;max-width:60%;max-height:45%;overflow:auto;background:rgba(0,0,0,.85);color:#9f9;font:11px/1.3 monospace;padding:8px;white-space:pre-wrap';
    document.body.appendChild(box); }
  box.textContent = JSON.stringify(rep, null, 1);
}
window.addEventListener('error', e => { if (QS.has('debug')) try { navigator.sendBeacon('log', JSON.stringify({ tag: 'window.error', msg: String(e.message), src: e.filename, line: e.lineno })); } catch (_) {} });
})();
