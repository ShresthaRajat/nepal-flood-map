/* Nepal Flood 2026 — static configuration.
 * Layer catalogue, counts, colours and source notes.  Ported from
 * trisuli-flood-map/hdx-explorer.html (CATS/COUNTS) and the #srcNotes
 * paragraphs of trisuli-flood-map/index.html and full-map.html. */
window.CFG = (function () {

// HOT packs every OSM/Overture layer of a dataset into one PMTiles source-layer
// and distinguishes them by `category` + `source`.  Counts mirror HOT's own
// overview page (6 Sep 2026).
const CATS = [
  ['bridges','osm','Bridges (OSM)','#e6194B'],
  ['buildings','osm','Buildings (OSM)','#3cb44b'],
  ['buildings','overture','Buildings (Overture)','#f58231'],
  ['destroyed_features','osm','Destroyed and damaged features (OSM)','#b91c1c'],
  ['education_facilities','osm','Education facilities (OSM)','#911eb4'],
  ['education_facilities','overture','Education facilities (Overture)','#008080'],
  ['financial_services','osm','Financial services (OSM)','#f032e6'],
  ['health_facilities','osm','Health facilities (OSM)','#9A6324'],
  ['health_facilities','overture','Health facilities (Overture)','#800000'],
  ['helipads','osm','Helipads (OSM)','#808000'],
  ['open_spaces','osm','Open spaces (OSM)','#000075'],
  ['open_spaces','overture','Open spaces (Overture)','#5a5aa0'],
  ['points_of_interest','osm','Points of interest (OSM)','#e6194B'],
  ['points_of_interest','overture','Points of interest (Overture)','#46f0f0'],
  ['police_stations','osm','Police stations (OSM)','#bcf60c'],
  ['police_stations','overture','Police stations (Overture)','#7a9a00'],
  ['residential_areas','osm','Residential areas (OSM)','#fabebe'],
  ['roads','osm','Roads (OSM)','#aaffc3'],
  ['roads','overture','Roads (Overture)','#2e8b57'],
  ['populated_places','osm','Settlement names (OSM)','#ffd8b1'],
  ['populated_places','overture','Settlement names (Overture)','#c08040'],
  ['waterways','osm','Waterways (OSM)','#808080'],
  ['waterways','overture','Waterways (Overture)','#404040'],
];

const COUNTS = {
  flood: { 'bridges|osm':171,'buildings|osm':19976,'buildings|overture':19913,'destroyed_features|osm':2121,
    'education_facilities|osm':60,'education_facilities|overture':13,'financial_services|osm':29,'health_facilities|osm':5,
    'health_facilities|overture':3,'helipads|osm':14,'open_spaces|osm':65,'points_of_interest|osm':401,
    'points_of_interest|overture':170,'police_stations|osm':9,'populated_places|osm':55,'residential_areas|osm':535,
    'roads|osm':2277,'waterways|osm':397 },
  corridor: { 'bridges|osm':223,'buildings|osm':51799,'buildings|overture':52646,'destroyed_features|osm':2131,
    'education_facilities|osm':146,'education_facilities|overture':20,'financial_services|osm':97,
    'health_facilities|osm':18,'health_facilities|overture':12,'helipads|osm':23,'open_spaces|osm':93,
    'open_spaces|overture':18,'points_of_interest|osm':572,'points_of_interest|overture':248,'police_stations|osm':11,
    'police_stations|overture':2,'populated_places|osm':152,'populated_places|overture':43,'residential_areas|osm':1476,
    'roads|osm':5318,'roads|overture':3451,'waterways|osm':566,'waterways|overture':465 },
};

// Status palette used by the "colour by status" switch and the legend.
const STATUS = {
  standing:  '#9ca3af',
  damaged:   '#f59e0b',
  destroyed: '#dc2626',
};
const FAIR = {
  'destroyed':    '#d7191c',
  'major-damage': '#fdae61',
  'minor-damage': '#ffff66',
  'no-damage':    '#9e9e9e',
  'no-data':      '#bdbdbd',
};

// Zoom-to targets, [[w,s],[e,n]].
const PLACES = [
  { key:'trisuli',   label:'Trisuli Bazar',        bounds:[[85.1302,27.9016],[85.1739,27.9497]] },
  { key:'betrawati', label:'Betrawati / Battar',   bounds:[[85.1350,27.9300],[85.2350,28.0200]] },
  { key:'upper',     label:'Syabrubesi–Rasuwagadhi', bounds:[[85.2900,28.1100],[85.4400,28.3700]] },
  { key:'fair',      label:'fAIr damage tile',     bounds:[[85.289155,28.11104],[85.437807,28.369382]] },
  { key:'origin',    label:'Collapse origin',      bounds:[[85.4300,28.2400],[85.5800,28.3600]] },
  // The pan limit (+12 % margin); reaches east to the glacier (owner direction, 6 Sep 2026).
  { key:'corridor',  label:'Whole corridor',       bounds:[[84.5544,27.7933],[85.6200,28.4000]] },
];
const HOME = PLACES[PLACES.length - 1].bounds;
// Opening view when the hash carries no centre: Trisuli Bazar at street scale (owner direction, 7 Sep 2026).
const DEFAULT_VIEW = { center: [85.15105, 27.92319], zoom: 15.7 };

// Per-scene facts, keyed by the layer ids of the data/imagery.json contract.
// Used by the "Sources & notes" drawer and by the source dropdowns as a tooltip.
const SCENES = {
  pre_s2_20260603:      'Sentinel-2 (S2C, tiles 45RUL/45RUM), 3 Jun 2026, 10 m native and resampled to ~20 m here. © ESA Copernicus, via the AWS open Sentinel-2 COG archive.',
  pre_ps_20260527:      'PlanetScope scene 20260527_053226_41_254a, 27 May 2026, 3.8 m, rendered from the 16-bit surface-reflectance product with a percentile stretch, north-up at ~2.9 m. Covers 85.10–85.20°E, 27.83–27.95°N. Planet open disaster data, CC-BY-NC-4.0.',
  pre_legion_20260205:  'Vantor Legion, 5 Feb 2026 ~14:02 NPT, 0.39 m, cloud-free. Covers the western three quarters of the Trisuli Bazar box. Registered to the PlanetScope frame; streams at ~0.37–0.49 m. © 2026 Vantor via OpenAerialMap, CC-BY-NC 4.0.',
  pre_s1_20260816:      'Sentinel-1 ascending pass, 16 Aug 2026, 10 m, on the same relative orbit (85) as the 28 Aug post-event pass, so the two are radiometrically comparable. Note the extent differs: only the Trisuli Bazar reach was built for this date (about 85.12–85.19°E, 27.90–27.96°N, to zoom 14), while the 28 Aug pass covers the whole corridor, so the before/after radar comparison holds at Trisuli Bazar and nowhere else. Radiometrically terrain-corrected gamma0 (VV/VH in dB, light speckle filter) from the Microsoft Planetary Computer. © ESA Copernicus.',
  post_s2_20260827:     'Sentinel-2 (S2B, tiles 45RUL/45RUM), 27 Aug 2026 ~10:56 NPT, the day after the flood, mostly clear over the corridor (54 % cloud on the southern tile, 78 % on the northern). True-colour at the native 10 m, tiled to z14 straight from the AWS open Sentinel-2 COG archive. © ESA Copernicus Sentinel data 2026.',
  post_ps_20260826:     'PlanetScope full-resolution flood-morning scene 20260826_050135_34_255f, 26 Aug 2026, 3.8 m, hazy. Covers 85.10–85.20°E, 27.83–27.95°N. Planet open disaster data, CC-BY-NC-4.0.',
  post_ps26_mosaic:     'PlanetScope flood-morning mosaic, 26 Aug 2026, nine scenes from two passes (~10:46 and ~11:30 NPT), rendered ~20 m. Heavy monsoon cloud with the surge visible in gaps. Planet open disaster data, CC-BY-NC-4.0.',
  post_ps28_mosaic:     'PlanetScope day-2 mosaic, 28 Aug 2026 ~10:42 NPT, five scenes, ~20 m — the clearest wide view of the upper valley and debris corridor. Planet open disaster data, CC-BY-NC-4.0.',
  post_s1_20260828:     'Sentinel-1D pass, 28 Aug 2026 ~18:06 NPT, 10 m — the only post-flood image of the whole corridor without cloud. Water and fresh wet sediment return little signal and read dark, vegetation and buildings read bright, slopes facing away from the satellite fall into shadow, so the widened sediment-filled channel shows as a dark band. Terrain-corrected gamma0 from the Microsoft Planetary Computer. © ESA Copernicus.',
  post_wv02_20260828:   'Vantor WorldView-2, 28 Aug 2026 ~10:52 NPT, 0.54 m, broken cloud. Covers the whole Trisuli Bazar focus box; registered to the PlanetScope frame and streamed at ~0.37–0.49 m. © 2026 Vantor via OpenAerialMap, CC-BY-NC 4.0.',
  post_skysat_20260831: 'Planet SkySat pair, 31 Aug 2026 ~15:10 NPT, 0.65 m, Betrawati down through Trisuli Bazar and Bidur — the only sub-metre view of the downstream reach. The southern frame is largely clear over the river and town, the northern frame over Battar and Betrawati is mostly cloud. Delivered georeferencing sat ~500 m east and ~800 m south of the map grid, so each frame is re-registered with a thin-plate-spline warp through ~80–200 tie points matched to the pre-event PlanetScope scene (residual a few metres over clear ground; the collect was ~9° off-nadir, so a few metres of terrain-related shift can remain on steep slopes). Planet open disaster data, CC-BY-NC-4.0.',
  post_skysat_20260827: 'Planet SkySat pair, 27 Aug 2026 ~07:45 NPT, 0.8 m, ~50 % cloud, over Rasuwagadhi and Syabrubesi — the earliest sub-metre imagery after the flood. Cross-correlated against the 1 Sep Legion layer and sits within ~10 m of it. Planet open disaster data, CC-BY-NC-4.0.',
  post_wv3_20260827:    'Vantor WorldView-3, four strips, 27 Aug 2026 ~10:49 NPT, 0.30–0.35 m, 71–79 % cloud — the sharpest imagery of the event, upper valley only. © 2026 Vantor, CC-BY-NC-4.0 (Vantor open data; also mirrored on OpenAerialMap).',
  post_legion_20260901: 'Vantor Legion, two frames, 1 Sep 2026 ~08:43 NPT, 0.37–0.46 m, hazy but largely cloud-free — the clearest post-flood view of the upper valley. © 2026 Vantor, CC-BY-NC-4.0.',
  post_drone_trisuli_202609: 'Drone photograph of Trisuli Bazar, post-flood, ~0.47 m, cloud-free — the only clear open view of the old bazaar between the hydropower canal and the river. Screenshot of a social-media post; capture date and photographer not yet confirmed (early September 2026, after the 26 Aug flood). Georeferenced here against the pre-flood imagery rather than the post-flood: WorldView-2 is cloud over most of this frame, so the 5 Feb Legion scene is the only cloud-free sub-metre reference over it, and the features worth matching — the hydropower canal, the roads and the two hairpin bends — are permanent and appear in both. 153 tie points were matched by normalised cross-correlation and a robust affine solved through them. Residual to the pre-flood scene is 0.98 m median and 2.41 m at the 90th percentile; against the 28 Aug WorldView-2 scene it is 2.79 m, and those two references themselves disagree by 2.1 m. A second-order fit registered marginally better to the pre-flood scene but degraded against WorldView-2 and swung 10 m at the frame corner with no tie points, so it was rejected as overfitting. Nothing below the old bazaar could be tied down, because the river reach was rebuilt by the flood and has no pre-flood counterpart; that end rides on the affine and can be several metres out. A single nadir frame with no terrain correction, so also expect a few metres of drift on the slope below the canal and at the frame edges. Rights reserved by the photographer; shown for situational awareness only.',
  post_pelican_20260901:'Planet Pelican, three scenes, 1 Sep 2026 ~10:51 NPT, 0.56 m, 47–84 % cloud, Syabrubesi to Rasuwagadhi, re-imaging the 27 Aug Pelican footprint. Rendered ~0.73 m. Planet open disaster data, CC-BY-NC-4.0.',
};

// Damage editor: the committed baseline the editor loads at start-up, on top of
// which the analyst's localStorage working copy is layered.  A 404 is ignored.
const DAMAGE_EDITS_URL = 'data/edits/damage_edits.geojson';

const COVERAGE_LABEL = {
  corridor: 'Whole corridor',
  trisuli_bazar: 'Trisuli Bazar reach',
  upper_valley: 'Upper valley (Syabrubesi–Rasuwagadhi)',
};

const HDX_CREDIT = '© Humanitarian OpenStreetMap Team, OpenStreetMap contributors, Overture Maps Foundation, NAXA and volunteer field reports (ODbL)';
const HDX_URL = 'https://data.humdata.org/dataset/hot_flood_npl';

// "Sources & notes" drawer body.  Per-scene imagery facts are appended from
// SCENES at runtime for whichever layers the catalogue actually contains.
const NOTES_HTML = `
<h3>The event</h3>
<p>On 26 August 2026 a section of glacier at about 5,200 m in the Lhende valley (Tibet) collapsed and
triggered a flood down the Lhende, Bhote Koshi and Trishuli rivers, per ICIMOD and USGS reporting.
This map covers the corridor from Rasuwagadhi and Syabrubesi in the north down through Betrawati,
Trisuli Bazar and Bidur to Galchhi and Mugling.</p>

<h3>Imagery</h3>
<p>Before/after scenes are registered to a common frame and served as 256&nbsp;px Web Mercator WebP
tiles. Outside a scene's footprint its tiles are transparent, so the basemap or the other side shows
through. Per-scene detail:</p>
<dl id="sceneList"></dl>
<p>As of 5 September 2026 the 28 Aug WorldView-2 and the 31 Aug SkySat pair are the only post-flood
sub-metre collects released openly over the Trisuli Bazar reach. Every other open sub-metre scene of
the event sits upstream of Betrawati, and the 1 Sep Sentinel-2 pass is solid cloud there. Scenes left
out as too clouded or superseded: the 27 Aug Pelican frames (83–85 % cloud), the 28 Aug WorldView-2
and Legion frames over the upper valley (78–81 % cloud) and the 31 Aug and 5 Sep Legion collects
(94 % cloud).</p>

<h3>Terrain</h3>
<p>Place names come from OpenStreetMap (Overpass API, © OpenStreetMap contributors, ODbL): every
city, town, village and hamlet node in the map window, plus a featured list for the corridor so that
Rasuwagadhi, Timure, Syabrubesi, Kalikasthan, Betrawati, Sole Bazar, Trishuli Bazar, Devighat, Kimtang,
Galchhi, Salyantar, Malekhu, Benighat and Mugling, and the district headquarters Dhunche,
Bidur (Battar), Dhading Besi, Gorkha and Kathmandu, always appear whatever OSM's place tag says.
Kalikasthan, Salyantar, Khanikhola, Sole Bazar, Trishuli Bazar and Kimtang have no OSM place node and
are positioned from Nominatim or GeoNames results. Below the hamlet tier, minor settlements along the
river with no OSM node of their own come from the GeoNames gazetteer (CC BY 4.0), shown from zoom 14 in
a fainter grey; their positions are gazetteer-grade and can be a few hundred metres off.</p>
<p>Contours and hillshade are derived from the Copernicus GLO-30 DEM (© ESA / Airbus, 30 m). Contour
lines reveal progressively with zoom — 1000, 500, 100, 50 then 10 m intervals — with index lines
(multiples of 100 m) drawn heavier and elevation labels placed along the lines from zoom 13. The 50
and 10 m contours are clipped by height above river rather than a fixed boundary, so they fade out
with distance from the valley floor instead of stopping abruptly.</p>

<h3>HOT / HDX response data</h3>
<p>From the Humanitarian OpenStreetMap Team's
<a href="${HDX_URL}" target="_blank" rel="noopener">Nepal Flood 2026 Flood Affected Area, Bhote Koshi and Trishuli</a>
dataset on HDX, snapshot of 6 September 2026. ${HDX_CREDIT}.</p>
<ul>
  <li><b>Flood-affected area</b> — everything inside the observed flood extent plus a 200 m buffer:
      OSM buildings, roads, bridges, waterways, facilities and settlement names.</li>
  <li><b>Overture Maps</b> — a separate section. Overture's last release before the flood: OSM plus
      Microsoft and Google building footprints and Meta places. About a quarter of its buildings have no
      OSM counterpart (densest around Betrawati and Trisuli Bazar). It carries no damage status, so under
      the Status palette it draws grey.</li>
  <li><b>River corridor</b> — the same catalogue over a wider 1 km buffer along the river. Off by
      default because it is large.</li>
  <li><b>Glacier collapse origin</b> — from the UN Satellite Centre (UNOSAT) assessment: the ice-rock
      detachment zone mapped on Landsat-9 of 26 Aug 2026 (about 2 km², above the Lende Khola in Tibet), its
      centroid as the approximate origin, and the two barrier lakes seen on Cartosat-3 on 28 Aug. The area of
      interest outline is extended from Rasuwagadhi up the Lende Khola to the detachment zone using UNOSAT's
      multi-sensor flood extent buffered by 200 m, matching how HOT built its own AOI. CC BY-SA.</li>
  <li><b>Flood extent</b>, <b>destroyed and damaged features</b> (volunteer-recorded in OSM, drawn
      in dark red; road stretches with a damaged or destroyed status draw bright red in the roads layer),
      <b>bridge ground reports</b> and <b>exposed hydropowers</b>.</li>
  <li><b>Road damage grading</b> — the Copernicus Emergency Management Service rapid-mapping activation
      EMSR927 graded every road and bridge segment in four areas from 0.3–0.7 m post-event imagery: Timure
      and Syapru Besi (27 Aug), Bidur / Trisuli Bazar to Betrawati (27–28 Aug, monitoring update) and
      Phosretar / Galchhi to Benighat (31 Aug). Grades are Destroyed, Damaged, Possibly damaged, No visible
      damage and Not analysed; only Destroyed, Damaged and Possibly damaged are drawn. The 557 segments graded No visible damage
      are used to clear the computed overlay below, and the 116 Not analysed ones are omitted. The Mailung gorge between Betrawati and Syapru Besi was not covered. Where a
      grade exists it overrides the computed overlay below. CC BY 4.0, © 2026 European Union.</li>
  <li><b>Roads inside the flood extent</b> — computed here by clipping the HOT flood-area roads to the
      27 Aug 2026 flood extent polygon: 879 stretches, 175 km. Of those, 263 already carry a Destroyed
      status and 616 are still recorded as Standing, so this overlay shows exposure, not confirmed damage,
      except where a Copernicus grade settles it: 537 stretches were graded, 419 confirmed Destroyed or Damaged
      and 56 removed as No visible damage.
      Bridges are the exception, because a deck over the river always intersects the flood polygon. They
      follow river position and the bridge ground reports: upstream of the BhimDhunga bridge every bridge
      was destroyed unless a ground report says Intact (44 segments red, 27 of them confirmed by Copernicus or
      a report, 2 tributary bridges spared); between BhimDhunga and Benighat Copernicus or the nearest report
      within 120 m decides (10 red, 14 left out); from Benighat downstream bridges are left out unless
      Copernicus or a report says otherwise (1 footbridge red, 26 left out).</li>
  <li><b>Highways and main roads</b> — the national OSM roads export on HDX (9 Aug 2026), clipped to the
      corridor and its approaches and drawn underneath the HOT roads with the same styling: national
      highways (trunk and primary) yellow, everything else white. Nepal's highways are under-tagged in
      OSM, so stretches of the Pasang Lhamu and Mid-Hill highways appear as ordinary roads. Labels use
      the English or transliterated name.</li>
  <li><b>fAIr building damage</b> — 1,053 buildings AI-scored as destroyed (677), major damage (105),
      minor damage (155), no damage (113) or no data (3).</li>
</ul>
<p class="warn">Caveats. The flood extent is one analyst's interpretation of a single date of imagery
(27 Aug 2026), not a field survey, and it breaks where every post-event scene is clouded. OSM
Standing / Damaged / Destroyed status is volunteer-recorded and incomplete — the absence of a
building on the map does not mean its absence on the ground, and building footprints are hand-traced
and only approximate individual roofs. The fAIr damage layer is AI-scored and limited to a single
upper-valley tile; it is not a validated damage assessment. Bridge conditions in the ground-report
layer come from volunteer field reports of varying age. Coordinates shown are approximate.</p>

<h3>Basemaps</h3>
<p>OpenStreetMap raster © OpenStreetMap contributors. Esri World Imagery © Esri and its imagery
partners. Map glyphs from the MapLibre demo font stack.</p>
`;

return { CATS, COUNTS, STATUS, FAIR, PLACES, HOME, DEFAULT_VIEW, SCENES, COVERAGE_LABEL, HDX_CREDIT, HDX_URL, NOTES_HTML,
         DAMAGE_EDITS_URL };
})();
