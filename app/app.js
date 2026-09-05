/* Nepal Flood 2026 — Bhote Koshi & Trishuli.
 * Two synchronised MapLibre maps with a clip-path swipe divider.  The left map
 * carries the PRE imagery, the right map the POST imagery; every overlay is
 * added to both maps so features stay aligned across the divider. */
(function () {
'use strict';

const CFG = window.CFG;
const QS = new URLSearchParams(location.search);
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
  mode: 'swipe', pre: null, post: null, swipe: 50,
  base: 'osm', hillshade: false, colorBy: 'layer',
  footprintOutline: true,
  sidebar: null,            // resolved from hash, then localStorage, then viewport
  overlays: null,           // Set of enabled entry keys
  center: null, zoom: null,
};

let catalog = { layers: [], default_pre: null, default_post: null };
let terrain = null;
let hotTiles = null;        // {flood:Set<sourceLayer>, corridor:Set, minzoom, maxzoom} once built
let catalogNote = '';
let GROUPS = [];            // sidebar model
let ENTRY = {};             // key -> entry
let LABEL_OF = {};          // style layer id -> human label
let QUERY_IDS = [];         // style layer ids that answer clicks
let PAINT_TARGETS = [];     // {id, prop, def} for the colour-by-status switch
let IMAGERY_BEFORE = null;  // style layer id the imagery layer is inserted before
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

/* Attribute-complete per-layer vector tiles, if the data agent has built them.
 * metadata.json shape is not pinned down, so accept the usual spellings. */
function metaLayerNames(j) {
  const raw = j && (j.vector_layers || j.layers || j.sourceLayers || (Array.isArray(j) ? j : null));
  if (!raw) return null;
  const names = (Array.isArray(raw) ? raw : Object.keys(raw))
    .map(x => typeof x === 'string' ? x : (x && (x.id || x.name)))
    .filter(Boolean);
  return names.length ? new Set(names) : null;
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
const layersFor = side => catalog.layers.filter(l => l.side === side);
const hasImagery = side => !!byId(state[side]);
const byId = id => catalog.layers.find(l => l.id === id) || null;

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
const HW = {
  trunk: ['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link'],
  sec: ['secondary', 'secondary_link', 'tertiary', 'tertiary_link'],
  minor: ['unclassified', 'residential', 'service', 'living_street'],
  track: ['track'],
  path: ['footway', 'path', 'steps', 'bridleway', 'cycleway'],
};
const HW_ROADLIKE = [...HW.trunk, ...HW.sec, ...HW.minor, ...HW.track];
const inHw = list => ['in', ['to-string', ['get', 'highway']], ['literal', list]];
/* Width by class, interpolated over zoom.  `add` widens every stop, for casings. */
function hwWidth(add) {
  const at = (t, sc, m, tr, pa, unk) => ['match', ['to-string', ['get', 'highway']],
    HW.trunk, t + add, HW.sec, sc + add, HW.minor, m + add, HW.track, tr + add, HW.path, pa + add, unk + add];
  return ['interpolate', ['linear'], ['zoom'],
    14, at(3.2, 2.2, 1.4, 1.2, 1.0, 1.2),
    18, at(6, 4.5, 3, 2.2, 2.0, 2.4)];
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

function footprintCollection() {
  return { type: 'FeatureCollection', features: catalog.layers.filter(l => l.bounds && l.bounds.length === 4).map(l => ({
    type: 'Feature',
    properties: { id: l.id, label: l.label, side: l.side, date: l.date, sensor: l.sensor,
                  provider: l.provider, gsd_m: l.gsd_m, coverage: l.coverage, size_mb: l.size_mb },
    geometry: { type: 'Polygon', coordinates: [[[l.bounds[0], l.bounds[1]], [l.bounds[2], l.bounds[1]],
      [l.bounds[2], l.bounds[3]], [l.bounds[0], l.bounds[3]], [l.bounds[0], l.bounds[1]]]] },
  })) };
}
function boundsFeature(l) {
  if (!l || !l.bounds) return { type: 'FeatureCollection', features: [] };
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { label: l.label },
    geometry: { type: 'Polygon', coordinates: [[[l.bounds[0], l.bounds[1]], [l.bounds[2], l.bounds[1]],
      [l.bounds[2], l.bounds[3]], [l.bounds[0], l.bounds[3]], [l.bounds[0], l.bounds[1]]]] } }] };
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
    flood_extent: { type: 'geojson', data: HDX + 'hot_flood_npl/hot_flood_npl_flood_extent.geojson' },
    bridge_damage: { type: 'geojson', data: HDX + 'hot_flood_npl/hot_flood_npl_bridge_damage.geojson' },
    hydro: { type: 'geojson', data: HDX + 'hot_flood_npl/hot_flood_npl_exposed_hydropowers.geojson' },
    tm: { type: 'geojson', data: HDX + 'hot_flood_npl/hot_flood_npl_tm_projects.geojson' },
    fair: { type: 'geojson', data: HDX + 'hot_flood_npl_buildings_damage/hot_flood_npl_buildings_damage.geojson' },
    fair_aoi: { type: 'geojson', data: HDX + 'hot_flood_npl_buildings_damage/hot_flood_npl_buildings_damage_analyzed_aoi.geojson' },
    waterways_np: { type: 'geojson', data: HDX + 'hotosm_npl_waterways/hotosm_npl_waterways_clip.geojson' },
    footprints: { type: 'geojson', data: footprintCollection() },
    search_pin: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    sel_footprint: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
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
  push({ id: 'base-osm', type: 'raster', source: 'osm', paint: { 'raster-opacity': 0.6 } },
       { id: 'base-esri', type: 'raster', source: 'esri', layout: { visibility: 'none' } });

  // 2. imagery placeholder — real layer is inserted at runtime -------------
  // 3. hillshade -----------------------------------------------------------
  if (sources.hillshade) push({ id: 'hillshade', type: 'raster', source: 'hillshade',
    layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.35 } });

  // 4. contours ------------------------------------------------------------
  const contourEntries = [];
  if (sources.contours) {
    const order = ['c1000', 'c500', 'c100', 'c50', 'c10'];
    const defs = terrain.contours.layers || {};
    const srcMax = terrain.contours.maxzoom != null ? terrain.contours.maxzoom : 14;
    const labelIds = [];
    // A class maxzoom that reaches the tile source's own maxzoom means "all the
    // way up": the source overzooms past it, so capping the style layer there
    // would make the contours vanish at high zoom.  Only honour a real cap.
    const capOf = d => (d.maxzoom != null && d.maxzoom < srcMax) ? d.maxzoom : 22;
    for (const cls of order) {
      const d = defs[cls]; if (!d) continue;
      const iv = cls.slice(1);
      const lid = 'contour-' + cls;
      push({ id: lid, type: 'line', source: 'contours', 'source-layer': cls,
        minzoom: d.minzoom != null ? d.minzoom : 8, maxzoom: capOf(d),
        layout: { 'line-join': 'round', visibility: 'none' },
        paint: { 'line-color': ['case', ['==', ['get', 'idx'], 1], '#e8a95c', '#c2884a'],
                 'line-width': ['interpolate', ['linear'], ['zoom'], 10, ['case', ['==', ['get', 'idx'], 1], 0.9, 0.45],
                                                                    16, ['case', ['==', ['get', 'idx'], 1], 1.8, 0.9]],
                 'line-opacity': 0.8 } });
      const tid = lid + '-label';
      push({ id: tid, type: 'symbol', source: 'contours', 'source-layer': cls,
        minzoom: Math.max(13, d.minzoom != null ? d.minzoom : 8), maxzoom: capOf(d),
        layout: { visibility: 'none', 'symbol-placement': 'line', 'text-field': ['concat', ['to-string', ['get', 'ele']], ' m'],
                  'text-font': FONT, 'text-size': 10, 'symbol-spacing': 320, 'text-max-angle': 25, 'text-padding': 4 },
        paint: { 'text-color': '#f0d5b0', 'text-halo-color': 'rgba(30,20,10,.85)', 'text-halo-width': 1.4 } });
      labelIds.push(tid);
      contourEntries.push({ key: 'ct_' + cls, label: iv + ' m contours', color: '#c2884a',
        ids: [lid], on: true, outline: false });
    }
    contourEntries.push({ key: 'ct_labels', label: 'Elevation labels (zoom 13+)', color: '#f0d5b0', ids: labelIds, on: true });
  }

  // 5. HOT / HDX -----------------------------------------------------------
  push({ id: 'aoi_flood-line', type: 'line', source: 'aoi_flood', layout: { visibility: 'none' },
         paint: { 'line-color': '#e11d48', 'line-width': 2 } },
       { id: 'aoi_corridor-line', type: 'line', source: 'aoi_corridor', layout: { visibility: 'none' },
         paint: { 'line-color': '#7c3aed', 'line-width': 1.5, 'line-dasharray': [3, 2] } });

  /* Where a category's features live.  The PMTiles build packs every category
   * into one source-layer keyed by category|source; the per-layer tile build
   * gives each HOT layer its own source-layer and needs no filter. */
  function resolve(ds, cat, src) {
    const pm = { source: ds, sl: ds === 'corridor' ? 'hot_flood_npl_corridor' : 'hot_flood_npl',
                 filter: ['==', ['concat', ['get', 'category'], '|', ['get', 'source']], cat + '|' + src] };
    const names = hotTiles && hotTiles[ds];
    if (!names) return pm;
    const hit = [cat + '_' + src, src === 'osm' ? cat : null].filter(Boolean).find(n => names.has(n));
    return hit ? { source: ds + '_mvt', sl: hit, filter: null } : pm;
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
        paint: { 'line-color': '#000000', 'line-opacity': 0.35, 'line-width': hwWidth(casingAdd) } };
      const line = { id: id + '-' + suffix, type: 'line', source: r.source, 'source-layer': r.sl,
        filter, layout: { visibility: 'none', 'line-join': 'round', 'line-cap': cap },
        paint: { 'line-color': isBridge ? ROAD_STATUS : ROAD_WHITE, 'line-width': hwWidth(0) } };
      if (dash) { casing.paint['line-dasharray'] = dash; line.paint['line-dasharray'] = dash; }
      out.push(casing, line);
      PAINT_TARGETS.push({ id: line.id, prop: 'line-color',
        def: isBridge ? ROAD_STATUS : ROAD_WHITE, status: ROAD_STATUS });
    }
    return out;
  }

  function vectorGroup(ds, on) {
    const entries = [];
    // Three passes so roads always sit above building fills and below points.
    const fills = [], lines = [], roads = [], points = [];
    for (const [cat, s, label, color] of CFG.CATS) {
      const key = cat + '|' + s;
      const count = CFG.COUNTS[ds][key];
      if (count === undefined) continue;
      const id = ds + '-' + cat + '-' + s;
      const r = resolve(ds, cat, s);
      const roadish = cat === 'roads' || cat === 'bridges';
      const ids = [];
      fills.push({ id: id + '-fill', type: 'fill', source: r.source, 'source-layer': r.sl,
        layout: { visibility: 'none' }, filter: andF(gt('Polygon'), r.filter),
        paint: { 'fill-color': roadish ? ROAD_WHITE : color, 'fill-opacity': roadish ? 0.55 : 0.5,
                 'fill-outline-color': roadish ? '#000000' : color } });
      ids.push(id + '-fill');
      if (roadish) {
        for (const l of roadLayers(id, r, cat === 'bridges')) { roads.push(l); ids.push(l.id); }
      } else {
        lines.push({ id: id + '-line', type: 'line', source: r.source, 'source-layer': r.sl,
          layout: { visibility: 'none', 'line-join': 'round' }, filter: andF(gt('LineString'), r.filter),
          paint: { 'line-color': color, 'line-width': 1.3 } });
        ids.push(id + '-line');
        PAINT_TARGETS.push({ id: id + '-line', prop: 'line-color', def: color, status: statusExprFor(cat) });
      }
      points.push({ id: id + '-point', type: 'circle', source: r.source, 'source-layer': r.sl,
        layout: { visibility: 'none' }, filter: andF(gt('Point'), r.filter),
        paint: { 'circle-color': color, 'circle-radius': 3, 'circle-stroke-width': 0.5, 'circle-stroke-color': '#fff' } });
      ids.push(id + '-point');
      PAINT_TARGETS.push({ id: id + '-point', prop: 'circle-color', def: color, status: statusExprFor(cat) });
      if (!roadish) PAINT_TARGETS.push(
        { id: id + '-fill', prop: 'fill-color', def: color, status: statusExprFor(cat) },
        { id: id + '-fill', prop: 'fill-outline-color', def: color, status: statusExprFor(cat) });
      entries.push({ key: id, label, color: roadish ? ROAD_WHITE : color, ids, on, count });
    }
    push(...fills, ...lines, ...roads, ...points);
    return entries;
  }

  groups.push({ title: 'Flood-affected area (extent + 200 m)', entries: [
    { key: 'aoi_flood', label: 'Area of interest outline', color: '#e11d48', ids: ['aoi_flood-line'], on: true, outline: true },
    ...vectorGroup('flood', true) ] });
  groups.push({ title: 'River corridor (1 km buffer)', entries: [
    { key: 'aoi_corridor', label: 'Area of interest outline', color: '#7c3aed', ids: ['aoi_corridor-line'], on: false, outline: true },
    ...vectorGroup('corridor', false) ] });

  const fairColor = ['match', ['get', 'damage'],
    'destroyed', CFG.FAIR['destroyed'], 'major-damage', CFG.FAIR['major-damage'],
    'minor-damage', CFG.FAIR['minor-damage'], 'no-damage', CFG.FAIR['no-damage'], CFG.FAIR['no-data']];
  const bridgeColor = ['match', ['get', 'status'],
    ['Destroyed', 'Washed out'], CFG.STATUS.destroyed, 'Damaged', CFG.STATUS.damaged, '#2ca25f'];

  push(
    { id: 'flood_extent-fill', type: 'fill', source: 'flood_extent', layout: { visibility: 'none' },
      paint: { 'fill-color': '#1d4ed8', 'fill-opacity': 0.3 } },
    { id: 'flood_extent-line', type: 'line', source: 'flood_extent', layout: { visibility: 'none' },
      paint: { 'line-color': '#3b82f6', 'line-width': 1.2 } },
    { id: 'waterways_np-fill', type: 'fill', source: 'waterways_np', layout: { visibility: 'none' },
      filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#0ea5e9', 'fill-opacity': 0.4 } },
    { id: 'waterways_np-line', type: 'line', source: 'waterways_np', layout: { visibility: 'none' },
      filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#0ea5e9', 'line-width': 0.8 } },
    { id: 'tm-fill', type: 'fill', source: 'tm', layout: { visibility: 'none' }, paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.08 } },
    { id: 'tm-line', type: 'line', source: 'tm', layout: { visibility: 'none' }, paint: { 'line-color': '#f59e0b', 'line-width': 1.2 } },
    { id: 'fair_aoi-line', type: 'line', source: 'fair_aoi', layout: { visibility: 'none' },
      paint: { 'line-color': '#f8fafc', 'line-width': 1.5, 'line-dasharray': [2, 2] } },
    { id: 'fair-fill', type: 'fill', source: 'fair', layout: { visibility: 'none' }, paint: { 'fill-color': fairColor, 'fill-opacity': 0.8 } },
    { id: 'fair-line', type: 'line', source: 'fair', layout: { visibility: 'none' }, paint: { 'line-color': '#333', 'line-width': 0.4 } },
    { id: 'hydro-point', type: 'circle', source: 'hydro', layout: { visibility: 'none' },
      paint: { 'circle-color': '#facc15', 'circle-radius': 6, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#000' } },
    { id: 'bridge_damage-point', type: 'circle', source: 'bridge_damage', layout: { visibility: 'none' },
      paint: { 'circle-color': bridgeColor, 'circle-radius': 6, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff' } },
  );
  PAINT_TARGETS.push({ id: 'bridge_damage-point', prop: 'circle-color', def: bridgeColor });

  groups.push({ title: 'Flood extent, damage & ground reports', entries: [
    { key: 'flood_extent', label: 'Flood extent, observed 27 Aug 2026', color: '#1d4ed8', ids: ['flood_extent-fill', 'flood_extent-line'], on: true, count: 1 },
    { key: 'bridge_damage', label: 'Bridge damage (ground reports)', color: CFG.STATUS.destroyed, ids: ['bridge_damage-point'], on: true, count: 58 },
    { key: 'hydro', label: 'Exposed hydropowers', color: '#facc15', ids: ['hydro-point'], on: true, count: 10 },
    { key: 'fair', label: 'fAIr building damage (AI)', color: CFG.FAIR['destroyed'], ids: ['fair-fill', 'fair-line'], on: true, count: 1053 },
    { key: 'fair_aoi', label: 'fAIr analysed tile', color: '#f8fafc', ids: ['fair_aoi-line'], on: true, outline: true },
    { key: 'tm', label: 'Tasking Manager projects', color: '#f59e0b', ids: ['tm-fill', 'tm-line'], on: false, count: 9 },
    { key: 'waterways_np', label: 'Waterways of Nepal (local copy only)', color: '#0ea5e9', ids: ['waterways_np-line', 'waterways_np-fill'], on: false },
  ] });

  // 6. footprints ----------------------------------------------------------
  push(
    { id: 'footprints-fill', type: 'fill', source: 'footprints', layout: { visibility: 'none' },
      paint: { 'fill-color': '#22d3ee', 'fill-opacity': 0.05 } },
    { id: 'footprints-line', type: 'line', source: 'footprints', layout: { visibility: 'none' },
      paint: { 'line-color': '#22d3ee', 'line-width': 1, 'line-dasharray': [4, 3] } },
    { id: 'footprints-label', type: 'symbol', source: 'footprints', layout: { visibility: 'none',
      'text-field': ['get', 'label'], 'text-font': FONT, 'text-size': 10, 'text-anchor': 'top-left', 'text-offset': [0.4, 0.4] },
      paint: { 'text-color': '#a5f3fc', 'text-halo-color': 'rgba(0,20,25,.85)', 'text-halo-width': 1.4 } },
    { id: 'search_pin-halo', type: 'circle', source: 'search_pin',
      paint: { 'circle-radius': 13, 'circle-color': '#5eb0ff', 'circle-opacity': 0.28,
               'circle-stroke-width': 1.5, 'circle-stroke-color': '#5eb0ff' } },
    { id: 'search_pin-dot', type: 'circle', source: 'search_pin',
      paint: { 'circle-radius': 4.5, 'circle-color': '#5eb0ff', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } },
    { id: 'sel_footprint-line', type: 'line', source: 'sel_footprint',
      paint: { 'line-color': '#ffffff', 'line-width': 1.6, 'line-dasharray': [6, 3], 'line-opacity': 0.9 } },
  );

  const footEntries = [
    { key: 'footprints', label: 'All imagery footprints', color: '#22d3ee',
      ids: ['footprints-fill', 'footprints-line', 'footprints-label'], on: false, outline: true, count: catalog.layers.length },
  ];
  if (contourEntries.length) groups.unshift({ title: 'Terrain contours (GLO-30)', entries: contourEntries });
  groups.push({ title: 'Imagery footprints', entries: footEntries });

  // registry ---------------------------------------------------------------
  for (const g of groups) for (const e of g.entries) {
    ENTRY[e.key] = e;
    for (const id of e.ids) LABEL_OF[id] = e.label;
  }
  QUERY_IDS = Object.keys(LABEL_OF).filter(id =>
    !id.startsWith('aoi_') && !id.startsWith('contour-') && !id.endsWith('-label') && !id.endsWith('-casing'));

  IMAGERY_BEFORE = (sources.hillshade ? 'hillshade' : null)
    || (contourEntries.length ? contourEntries[0].ids[0] : null)
    || 'aoi_flood-line';

  GROUPS = groups;
  return { sources, layers };
}

// --------------------------------------------------------------- map set-up
function makeMap(container, defs, side) {
  const style = { version: 8, glyphs: GLYPHS,
    sources: JSON.parse(JSON.stringify(defs.sources)),
    layers: JSON.parse(JSON.stringify(defs.layers)) };
  const m = new maplibregl.Map({
    container, style, maxZoom: 20, minZoom: 5, keyboard: false,
    attributionControl: { compact: true },
    center: state.center || [85.15, 27.99], zoom: state.zoom != null ? state.zoom : 9,
  });
  m.__side = side;
  m.on('error', ev => {
    const msg = (ev && ev.error && ev.error.message) || '';
    if (/40[34]|Failed to fetch|NetworkError|AbortError/i.test(msg)) return;   // sparse tiles / missing optional data
    console.warn('[map:' + side + ']', msg || ev);
  });
  return m;
}

function applyImagery(side) {
  const m = maps[side]; if (!m) return;
  // The style can still be settling right after 'load' (GeoJSON/PMTiles sources
  // fetching); never drop the request silently, re-run once the map is idle.
  if (!m.isStyleLoaded()) { m.once('idle', () => applyImagery(side)); return; }
  const l = byId(state[side]);
  if (m.getLayer('imagery')) m.removeLayer('imagery');
  if (m.getSource('imagery')) m.removeSource('imagery');
  const src = imagerySource(l);
  if (src) {
    m.addSource('imagery', src);
    const before = m.getLayer(IMAGERY_BEFORE) ? IMAGERY_BEFORE : undefined;
    m.addLayer({ id: 'imagery', type: 'raster', source: 'imagery', paint: { 'raster-fade-duration': 120 } }, before);
  }
  applyBaseOpacity();
  const fp = m.getSource('sel_footprint');
  if (fp) fp.setData(state.footprintOutline ? boundsFeature(l) : { type: 'FeatureCollection', features: [] });
  refreshTags();
  updateMeta(side);
}

function setVis(ids, on) {
  for (const side of ['pre', 'post']) {
    const m = maps[side]; if (!m) continue;
    for (const id of ids) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }
}
function eachMap(fn) { for (const side of ['pre', 'post']) if (maps[side]) fn(maps[side], side); }

function applyOverlays() {
  for (const g of GROUPS) for (const e of g.entries) setVis(e.ids, state.overlays.has(e.key));
}
function applyBase() {
  setVis(['base-osm'], state.base === 'osm');
  setVis(['base-esri'], state.base === 'esri');
  setVis(['hillshade'], state.hillshade);
  applyBaseOpacity();
}
/* The OSM basemap is dimmed under imagery, full strength when a side is showing
 * the basemap alone.  Per map, since the two sides can differ. */
function applyBaseOpacity() {
  eachMap((m, side) => {
    if (!m.getLayer('base-osm')) return;
    try { m.setPaintProperty('base-osm', 'raster-opacity', hasImagery(side) ? 0.6 : 1); } catch (e) { /* ignore */ }
  });
}
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
function storedSidebar() {
  try { const v = localStorage.getItem('nf26.sidebar'); if (v !== null) return v === '1'; } catch (e) { /* private mode */ }
  try { if (window.matchMedia) return !window.matchMedia('(max-width: 780px)').matches; } catch (e) { /* no matchMedia */ }
  return true;
}
function applySidebar(persist) {
  document.body.classList.toggle('sidebar-open', state.sidebar);
  const b = $('#sidebarToggle');
  if (b) {
    b.textContent = state.sidebar ? '\u25c2' : '\u25b8';
    b.setAttribute('aria-expanded', String(state.sidebar));
    b.setAttribute('title', (state.sidebar ? 'Hide' : 'Show') + ' the layer panel (B)');
  }
  if (persist !== false) { try { localStorage.setItem('nf26.sidebar', state.sidebar ? '1' : '0'); } catch (e) { /* private mode */ } }
  setTimeout(() => eachMap(m => m.resize()), 220);   // after the CSS transition
}
function toggleSidebar() { state.sidebar = !state.sidebar; applySidebar(); writeHash(); }

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
  if (state.pre) p.set('pre', state.pre);
  if (state.post) p.set('post', state.post);
  p.set('c', c.lng.toFixed(5) + ',' + c.lat.toFixed(5));
  p.set('z', z.toFixed(2));
  p.set('s', state.swipe.toFixed(1));
  p.set('b', state.base);
  if (state.hillshade) p.set('hs', '1');
  if (state.colorBy !== 'layer') p.set('cb', state.colorBy);
  if (!state.footprintOutline) p.set('fo', '0');
  if (!state.sidebar) p.set('sb', '0');
  const ov = serialiseOverlays();
  if (ov) p.set('ov', ov);
  hashWriting = true;
  history.replaceState(null, '', '#' + p.toString());
  setTimeout(() => { hashWriting = false; }, 0);
}
function readHash() {
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (p.get('m')) state.mode = p.get('m');
  if (p.get('pre')) state.pre = p.get('pre');
  if (p.get('post')) state.post = p.get('post');
  if (p.get('s')) state.swipe = parseFloat(p.get('s'));
  if (p.get('b')) state.base = p.get('b');
  if (p.get('hs')) state.hillshade = p.get('hs') === '1';
  if (p.get('cb')) state.colorBy = p.get('cb');
  if (p.get('fo')) state.footprintOutline = p.get('fo') !== '0';
  state.sidebar = p.get('sb') ? p.get('sb') !== '0' : storedSidebar();
  const c = p.get('c');
  if (c && /^-?[\d.]+,-?[\d.]+$/.test(c)) state.center = c.split(',').map(Number);
  if (p.get('z')) state.zoom = parseFloat(p.get('z'));
  return p.get('ov');
}
function applyOverlayDiff(ov) {
  state.overlays = new Set();
  for (const g of GROUPS) for (const e of g.entries) if (e.on) state.overlays.add(e.key);
  if (!ov) return;
  for (const tok of ov.split(',')) {
    const k = tok.slice(1);
    if (!ENTRY[k]) continue;
    if (tok[0] === '+') state.overlays.add(k); else state.overlays.delete(k);
  }
}

// ----------------------------------------------------------------- sidebar
const optionText = (side, l) =>
  (side === 'pre' ? 'Pre' : 'Post') + ' \u00b7 ' + fmtDate(l.date) + ' \u00b7 ' + l.sensor +
  (l.gsd_m ? ' ' + l.gsd_m + ' m' : '');

/* Appends this side's scenes to a <select>, grouped by coverage. */
function fillScenes(sel, side) {
  sel.appendChild(new Option('None \u00b7 basemap only', NO_IMAGERY));
  const list = layersFor(side);
  if (!list.length) { sel.appendChild(new Option('(no ' + side + ' imagery in catalogue)', '')); return 0; }
  const order = ['trisuli_bazar', 'upper_valley', 'corridor'];
  const byCov = {};
  for (const l of list) (byCov[l.coverage || 'corridor'] ||= []).push(l);
  const covs = Object.keys(byCov).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  for (const cov of covs) {
    const og = document.createElement('optgroup');
    og.label = CFG.COVERAGE_LABEL[cov] || cov;
    for (const l of byCov[cov]) {
      const o = new Option(optionText(side, l), l.id);
      o.title = CFG.SCENES[l.id] || l.label || '';
      og.appendChild(o);
    }
    sel.appendChild(og);
  }
  return list.length;
}

/* The two corner tags: scene picker plus the "<side> only" view option. */
function buildTags() {
  for (const side of ['pre', 'post']) {
    const t = $('#tag' + (side === 'pre' ? 'Pre' : 'Post'));
    if (!t) continue;
    tagEl[side] = t;
    fillScenes(t, side);
    const og = document.createElement('optgroup');
    og.label = 'View';
    const only = new Option(side === 'pre' ? 'Pre only' : 'Post only', '__only');
    og.appendChild(only);
    og.appendChild(new Option('Compare (swipe)', '__swipe'));
    t.appendChild(og);
    t.__only = only;
    t.addEventListener('change', () => {
      const v = t.value;
      if (v === '__only') setMode(state.mode === side ? 'swipe' : side);
      else if (v === '__swipe') setMode('swipe');
      else if (v) { state[side] = v; applyImagery(side); writeHash(); }
      refreshTags();
    });
  }
  refreshTags();
}

/* Keeps both tags showing their current scene, ticks the active view option
 * and outlines the side that is being shown alone. */
function refreshTags() {
  for (const side of ['pre', 'post']) {
    const t = tagEl[side];
    if (!t) continue;
    if (t.__only) t.__only.textContent = (state.mode === side ? '\u2713 ' : '') + (side === 'pre' ? 'Pre only' : 'Post only');
    if (state[side]) t.value = state[side];
    if (t.classList) t.classList.toggle('only', state.mode === side);
  }
}
function updateMeta(side) {
  const n = document.querySelector('#meta' + side);
  if (n) n.innerHTML = describe(state[side]);
}
function describe(id) {
  if (id === NO_IMAGERY) return 'No imagery, basemap only';
  const l = byId(id);
  if (!l) return '<i>no layer selected</i>';
  const bits = [];
  if (l.label) bits.push('<b>' + l.label + '</b>');
  const facts = [l.provider, l.gsd_m ? l.gsd_m + ' m GSD' : null, CFG.COVERAGE_LABEL[l.coverage] || l.coverage,
                 l.size_mb ? l.size_mb + ' MB' : null].filter(Boolean);
  if (facts.length) bits.push(facts.join(' · '));
  if (l.attribution) bits.push(l.attribution);
  return bits.join('<br>');
}

function renderSidebar() {
  const pad = $('#panel .pad');

  // search ----------------------------------------------------------------
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
  pad.appendChild(modeBlock);

  // imagery selectors -----------------------------------------------------
  const imgBlock = el('div', 'block', '<h2>Imagery</h2>');
  imgBlock.appendChild(el('p', 'note', 'Choose scenes with the tags at the top of the map.'));
  for (const side of ['pre', 'post']) {
    const f = el('div', 'field');
    f.appendChild(el('label', null, side === 'pre' ? 'Before (left)' : 'After (right)'));
    const meta = el('p', 'meta side-' + side);
    meta.id = 'meta' + side;
    meta.innerHTML = describe(state[side]);
    f.appendChild(meta);
    imgBlock.appendChild(f);
  }
  const fo = el('label', 'row');
  const foCb = el('input'); foCb.type = 'checkbox'; foCb.checked = state.footprintOutline;
  foCb.addEventListener('change', () => {
    state.footprintOutline = foCb.checked; applyImagery('pre'); applyImagery('post'); writeHash();
  });
  fo.append(foCb, el('span', 't', 'Outline the selected scene footprint'));
  imgBlock.appendChild(fo);
  if (catalogNote) imgBlock.appendChild(el('p', 'warn', catalogNote));
  pad.appendChild(imgBlock);

  // basemap ---------------------------------------------------------------
  const bmBlock = el('div', 'block', '<h2>Basemap</h2>');
  for (const [v, t] of [['osm', 'OpenStreetMap (dimmed)'], ['esri', 'Esri World Imagery'], ['none', 'None (black)']]) {
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
  pad.appendChild(bmBlock);

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

  // bridge ground reports + damage summary, both loaded on first open ------
  const lazy = (title, note, fill) => {
    const b = el('div', 'block');
    const det = el('details');
    det.appendChild(el('summary', null, title));
    const body = el('div', 'lazy', '<p class="note">' + note + '</p>');
    det.appendChild(body);
    let done = false;
    det.addEventListener('toggle', () => { if (done) return; done = true; fill(det, body); });
    b.appendChild(det);
    pad.appendChild(b);
    return det;
  };
  lazy('Bridge ground reports', 'Loading…', renderBridges);
  lazy('Damage by municipality', 'Loading…', renderDamage);

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

  for (const g of GROUPS) {
    const det = el('details');
    det.open = g.entries.some(e => state.overlays.has(e.key)) && g.entries.length < 12;
    const sum = el('summary', null, g.title + ' <span class="n">' + g.entries.length + '</span>');
    det.appendChild(sum);
    const ctl = el('div', 'grp', '<button data-all="1">all on</button><button data-all="0">all off</button>');
    det.appendChild(ctl);
    const boxes = [];
    for (const e of g.entries) {
      const row = el('label', 'row');
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = state.overlays.has(e.key);
      const sw = el('span', 'sw' + (e.outline ? ' outline' : ''));
      sw.style.background = e.color; sw.style.borderColor = e.color;
      row.append(cb, sw, el('span', 't', e.label));
      if (e.count !== undefined) row.appendChild(el('span', 'cnt', fmtCount(e.count)));
      cb.addEventListener('change', () => {
        if (cb.checked) state.overlays.add(e.key); else state.overlays.delete(e.key);
        setVis(e.ids, cb.checked); writeHash();
      });
      boxes.push([cb, e]);
      det.appendChild(row);
    }
    ctl.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      const on = b.dataset.all === '1';
      for (const [cb, e] of boxes) { cb.checked = on; if (on) state.overlays.add(e.key); else state.overlays.delete(e.key); setVis(e.ids, on); }
      writeHash();
    }));
    oBlock.appendChild(det);
  }
  pad.appendChild(oBlock);

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
  add('#1d4ed8', 'Flood extent, 27 Aug 2026');
  add('#e11d48', 'Flood-affected AOI', true);
  add('#7c3aed', 'River corridor AOI', true);
  add('#22d3ee', 'Imagery footprint', true);
  lBlock.appendChild(lg);

  const roadLg = el('div', 'roadlg');
  roadLg.innerHTML =
    '<div class="hd">Roads and bridges (white, dark casing)</div>' +
    '<div class="r"><i class="rl w4"></i>Trunk and primary</div>' +
    '<div class="r"><i class="rl w3"></i>Secondary and tertiary</div>' +
    '<div class="r"><i class="rl w2"></i>Residential, service</div>' +
    '<div class="r"><i class="rl w2 dash"></i>Track</div>' +
    '<div class="r"><i class="rl w1 dot"></i>Path, steps, footbridge</div>' +
    '<div class="r"><i class="rl w4 heavy"></i>Road bridge span</div>' +
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

// ---------------------------------------------------------- damage summary
const DAMAGE_CLASS = { building: 'buildings', 'building part': 'buildings', road: 'roads',
  tunnel: 'roads', bridge: 'bridges' };
let damageRows = null;
async function renderDamage(det, body) {
  const d = await gj('hot_flood_npl/destroyed_features_osm.geojson');
  if (!d || !d.features) { body.innerHTML = '<p class="note">Destroyed-feature data not available.</p>'; return; }
  damageRows = d.features.map(f => {
    const p = f.properties || {};
    return { adm3: p.adm3_name || 'Unknown', cls: DAMAGE_CLASS[p.feature_type] || 'other',
             status: p.status || '', c: centroid(f.geometry) };
  }).filter(r => r.c);
  const by = {};
  for (const r of damageRows) {
    const m = (by[r.adm3] ||= { buildings: 0, roads: 0, bridges: 0, other: 0, total: 0 });
    m[r.cls]++; m.total++;
  }
  const names = Object.keys(by).sort((a, b) => by[b].total - by[a].total);
  let html = '<table class="dmg"><thead><tr><th>Municipality</th><th>Bldg</th><th>Road</th><th>Brdg</th><th>Other</th></tr></thead><tbody>';
  for (const n of names) {
    const m = by[n];
    html += '<tr><td>' + esc(n) + '</td><td>' + m.buildings + '</td><td>' + m.roads +
            '</td><td>' + m.bridges + '</td><td>' + m.other + '</td></tr>';
  }
  html += '</tbody></table><p class="inview" id="dmgInView"></p>' +
    '<p class="note">Volunteer-recorded in OpenStreetMap; not field-verified.</p>';
  body.innerHTML = html;
  updateDamageInView();
}
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
    const hits = m.queryRenderedFeatures(ev.point, { layers: live() });
    if (!hits.length) return;
    const html = hits.slice(0, 4)
      .map(h => popupHTML(LABEL_OF[h.layer.id] || h.layer.id, h.properties)).join('<hr>');
    new maplibregl.Popup({ maxWidth: '340px' }).setLngLat(ev.lngLat).setHTML(html).addTo(m);
  });
  let hoverTimer = 0;
  m.on('mousemove', ev => {
    $('#readout').textContent = ev.lngLat.lat.toFixed(5) + '°N, ' + ev.lngLat.lng.toFixed(5) + '°E · z' + m.getZoom().toFixed(1);
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
    const step = ev.shiftKey ? 400 : 120;
    switch (ev.key) {
      case 'ArrowLeft':  m.panBy([-step, 0]); break;
      case 'ArrowRight': m.panBy([step, 0]); break;
      case 'ArrowUp':    m.panBy([0, -step]); break;
      case 'ArrowDown':  m.panBy([0, step]); break;
      case '+': case '=': m.zoomIn(); break;
      case '-': case '_': m.zoomOut(); break;
      case 'b': case 'B': toggleSidebar(); break;
      case '[': setSwipe(state.swipe - (ev.shiftKey ? 10 : 2)); break;
      case ']': setSwipe(state.swipe + (ev.shiftKey ? 10 : 2)); break;
      default: return;
    }
    ev.preventDefault();
  });
}

// -------------------------------------------------------------------- boot
async function main() {
  const protocol = new pmtiles.Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);

  [catalog, terrain, hotTiles] = await Promise.all([loadCatalog(), loadTerrain(), loadHotTiles()]);
  const ovParam = readHash();

  // A scene id from the hash that is not in the catalogue (stale link, renamed
  // layer) falls back to the default instead of leaving the side empty.
  for (const side of ['pre', 'post']) {
    if (state[side] && state[side] !== NO_IMAGERY && !byId(state[side])) state[side] = null;
    if (!state[side]) state[side] = catalog['default_' + side] || (layersFor(side)[0] || {}).id || null;
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
  applyOverlays(); applyBase(); applyColorBy();
  syncMaps(maps.pre, maps.post);
  wirePopups(maps.pre); wirePopups(maps.post);

  renderSidebar();
  applyMode();
  setSwipe(state.swipe, false);
  wireDivider(); wireKeyboard();

  if (!state.center) maps.post.fitBounds(CFG.HOME, { padding: 24, duration: 0 });
  maps.post.on('moveend', writeHash);
  maps.post.on('moveend', updateDamageInView);
  writeHash();

  const tog = $('#sidebarToggle');
  if (tog) tog.addEventListener('click', toggleSidebar);
  window.addEventListener('resize', () => eachMap(m => m.resize()));
  window.addEventListener('hashchange', () => { if (!hashWriting) location.reload(); });
}

main().catch(e => {
  console.error(e);
  document.body.insertAdjacentHTML('afterbegin',
    '<pre style="position:absolute;z-index:99;background:#300;color:#fdd;padding:12px;max-width:90%">' + e + '</pre>');
});
})();
