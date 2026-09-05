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
  overlays: null,           // Set of enabled entry keys
  center: null, zoom: null,
};

let catalog = { layers: [], default_pre: null, default_post: null };
let terrain = null;
let catalogNote = '';
let GROUPS = [];            // sidebar model
let ENTRY = {};             // key -> entry
let LABEL_OF = {};          // style layer id -> human label
let QUERY_IDS = [];         // style layer ids that answer clicks
let PAINT_TARGETS = [];     // {id, prop, def} for the colour-by-status switch
let IMAGERY_BEFORE = null;  // style layer id the imagery layer is inserted before
const maps = {};            // {pre, post}

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

const layersFor = side => catalog.layers.filter(l => l.side === side);
const byId = id => catalog.layers.find(l => l.id === id) || null;

// --------------------------------------------------------- style definition
const STATUS_FALLBACK = ['match', ['to-string', ['get', 'category']],
  'destroyed_features', CFG.STATUS.destroyed, CFG.STATUS.standing];
const STATUS_EXPR = ['match', ['to-string', ['get', 'status']],
  ['Standing', 'Intact', 'standing', 'intact'], CFG.STATUS.standing,
  ['Damaged', 'damaged', 'major-damage', 'Major Damage'], CFG.STATUS.damaged,
  ['Destroyed', 'destroyed', 'Washed out', 'washed out'], CFG.STATUS.destroyed,
  STATUS_FALLBACK];

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
    sel_footprint: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
  };
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

  function vectorGroup(src, ds, on) {
    const entries = [];
    const sl = ds === 'corridor' ? 'hot_flood_npl_corridor' : 'hot_flood_npl';
    for (const [cat, s, label, color] of CFG.CATS) {
      const key = cat + '|' + s;
      const count = CFG.COUNTS[ds][key];
      if (count === undefined) continue;
      const id = ds + '-' + cat + '-' + s;
      const f = ['==', ['concat', ['get', 'category'], '|', ['get', 'source']], key];
      push({ id: id + '-fill', type: 'fill', source: src, 'source-layer': sl, layout: { visibility: 'none' },
              filter: ['all', ['==', ['geometry-type'], 'Polygon'], f],
              paint: { 'fill-color': color, 'fill-opacity': 0.5, 'fill-outline-color': color } },
            { id: id + '-line', type: 'line', source: src, 'source-layer': sl, layout: { visibility: 'none' },
              filter: ['all', ['==', ['geometry-type'], 'LineString'], f],
              paint: { 'line-color': color, 'line-width': 1.3 } },
            { id: id + '-point', type: 'circle', source: src, 'source-layer': sl, layout: { visibility: 'none' },
              filter: ['all', ['==', ['geometry-type'], 'Point'], f],
              paint: { 'circle-color': color, 'circle-radius': 3, 'circle-stroke-width': 0.5, 'circle-stroke-color': '#fff' } });
      PAINT_TARGETS.push({ id: id + '-fill', prop: 'fill-color', def: color },
                         { id: id + '-fill', prop: 'fill-outline-color', def: color },
                         { id: id + '-line', prop: 'line-color', def: color },
                         { id: id + '-point', prop: 'circle-color', def: color });
      entries.push({ key: id, label, color, ids: [id + '-fill', id + '-line', id + '-point'], on, count });
    }
    return entries;
  }

  groups.push({ title: 'Flood-affected area (extent + 200 m)', entries: [
    { key: 'aoi_flood', label: 'Area of interest outline', color: '#e11d48', ids: ['aoi_flood-line'], on: true, outline: true },
    ...vectorGroup('flood', 'flood', true) ] });
  groups.push({ title: 'River corridor (1 km buffer)', entries: [
    { key: 'aoi_corridor', label: 'Area of interest outline', color: '#7c3aed', ids: ['aoi_corridor-line'], on: false, outline: true },
    ...vectorGroup('corridor', 'corridor', false) ] });

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
    !id.startsWith('aoi_') && !id.startsWith('contour-') && !id.endsWith('-label'));

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
  const m = maps[side]; if (!m || !m.isStyleLoaded()) return;
  const l = byId(state[side]);
  if (m.getLayer('imagery')) m.removeLayer('imagery');
  if (m.getSource('imagery')) m.removeSource('imagery');
  const src = imagerySource(l);
  if (src) {
    m.addSource('imagery', src);
    const before = m.getLayer(IMAGERY_BEFORE) ? IMAGERY_BEFORE : undefined;
    m.addLayer({ id: 'imagery', type: 'raster', source: 'imagery', paint: { 'raster-fade-duration': 120 } }, before);
  }
  const fp = m.getSource('sel_footprint');
  if (fp) fp.setData(state.footprintOutline ? boundsFeature(l) : { type: 'FeatureCollection', features: [] });
  $('#lab' + (side === 'pre' ? 'Pre' : 'Post')).textContent =
    (side === 'pre' ? 'Before · ' : 'After · ') + (l ? fmtDate(l.date) : 'no layer');
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
}
function applyColorBy() {
  const useStatus = state.colorBy === 'status';
  eachMap(m => {
    for (const t of PAINT_TARGETS) {
      if (!m.getLayer(t.id)) continue;
      try { m.setPaintProperty(t.id, t.prop, useStatus ? STATUS_EXPR : t.def); } catch (e) { /* ignore */ }
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
function sourceSelect(side) {
  const sel = document.createElement('select');
  sel.id = 'sel' + side;
  const list = layersFor(side);
  if (!list.length) {
    sel.appendChild(new Option('(no ' + side + ' imagery in catalogue)', ''));
    sel.disabled = true;
    return sel;
  }
  const order = ['trisuli_bazar', 'upper_valley', 'corridor'];
  const byCov = {};
  for (const l of list) (byCov[l.coverage || 'corridor'] ||= []).push(l);
  const covs = Object.keys(byCov).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  for (const cov of covs) {
    const og = document.createElement('optgroup');
    og.label = CFG.COVERAGE_LABEL[cov] || cov;
    for (const l of byCov[cov]) {
      const o = new Option(`${fmtDate(l.date)} · ${l.sensor}${l.gsd_m ? ' · ' + l.gsd_m + ' m' : ''}`, l.id);
      o.title = CFG.SCENES[l.id] || l.label || '';
      og.appendChild(o);
    }
    sel.appendChild(og);
  }
  return sel;
}
function describe(id) {
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

  // mode ------------------------------------------------------------------
  const modeBlock = el('div', 'block', '<h2>View</h2>');
  const seg = el('div', 'seg'); seg.id = 'modeSeg';
  for (const [m, t] of [['pre', 'Before'], ['swipe', 'Swipe'], ['post', 'After']]) {
    const b = el('button', null, t); b.dataset.mode = m;
    b.addEventListener('click', () => { state.mode = m; applyMode(); writeHash(); });
    seg.appendChild(b);
  }
  modeBlock.appendChild(seg);
  pad.appendChild(modeBlock);

  // imagery selectors -----------------------------------------------------
  const imgBlock = el('div', 'block', '<h2>Imagery</h2>');
  for (const side of ['pre', 'post']) {
    const f = el('div', 'field');
    f.appendChild(el('label', null, side === 'pre' ? 'Before (left)' : 'After (right)'));
    const sel = sourceSelect(side);
    if (state[side]) sel.value = state[side];
    if (!sel.value && sel.options.length) { sel.selectedIndex = 0; state[side] = sel.value; }
    const meta = el('p', 'meta'); meta.id = 'meta' + side;
    sel.addEventListener('change', () => {
      state[side] = sel.value; applyImagery(side); meta.innerHTML = describe(sel.value); writeHash();
    });
    meta.innerHTML = describe(state[side]);
    f.append(sel, meta);
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
  pad.appendChild(zBlock);

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

// --------------------------------------------------------------- behaviour
function wirePopups(m) {
  const live = () => QUERY_IDS.filter(id => m.getLayer(id) && m.getLayoutProperty(id, 'visibility') !== 'none');
  m.on('click', ev => {
    const hits = m.queryRenderedFeatures(ev.point, { layers: live() });
    if (!hits.length) return;
    const html = hits.slice(0, 4).map(h => {
      const rows = Object.entries(h.properties || {})
        .filter(([, v]) => v !== null && v !== '' && v !== 'null' && v !== undefined)
        .map(([k, v]) => `<tr><th>${k}</th><td>${/^https?:\/\//.test(String(v)) ? `<a href="${v}" target="_blank" rel="noopener">${v}</a>` : String(v)}</td></tr>`).join('');
      return `<b>${LABEL_OF[h.layer.id] || h.layer.id}</b><table class="popup">${rows}</table>`;
    }).join('<hr>');
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

  [catalog, terrain] = await Promise.all([loadCatalog(), loadTerrain()]);
  const ovParam = readHash();

  if (!state.pre) state.pre = catalog.default_pre || (layersFor('pre')[0] || {}).id || null;
  if (!state.post) state.post = catalog.default_post || (layersFor('post')[0] || {}).id || null;

  const defs = buildDefs();
  applyOverlayDiff(ovParam);

  maps.pre = makeMap('mapPre', defs, 'pre');
  maps.post = makeMap('mapPost', defs, 'post');
  maps.post.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
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
  writeHash();

  $('#panelToggle').addEventListener('click', () => {
    document.body.classList.toggle('panel-open');
    setTimeout(() => eachMap(m => m.resize()), 200);
  });
  window.addEventListener('resize', () => eachMap(m => m.resize()));
  window.addEventListener('hashchange', () => { if (!hashWriting) location.reload(); });
}

main().catch(e => {
  console.error(e);
  document.body.insertAdjacentHTML('afterbegin',
    '<pre style="position:absolute;z-index:99;background:#300;color:#fdd;padding:12px;max-width:90%">' + e + '</pre>');
});
})();
