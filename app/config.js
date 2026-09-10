/* Nepal Flood 2026 — static configuration.
 * Layer catalogue, counts, colours and source notes.  Ported from
 * trisuli-flood-map/hdx-explorer.html (CATS/COUNTS) and the #srcNotes
 * paragraphs of trisuli-flood-map/index.html and full-map.html. */
window.CFG = (function () {

// HOT packs every OSM/Overture layer of a dataset into one PMTiles source-layer
// and distinguishes them by `category` + `source`.  Counts mirror HOT's own
// overview page (10 Sep 2026).
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
  flood: { 'bridges|osm':159,'buildings|osm':20356,'buildings|overture':19913,'destroyed_features|osm':4409,
    'education_facilities|osm':60,'education_facilities|overture':13,'financial_services|osm':29,'health_facilities|osm':5,
    'health_facilities|overture':3,'helipads|osm':14,'open_spaces|osm':65,'points_of_interest|osm':404,
    'points_of_interest|overture':170,'police_stations|osm':9,'populated_places|osm':54,'residential_areas|osm':537,
    'roads|osm':2280,'waterways|osm':400 },
  corridor: { 'bridges|osm':213,'buildings|osm':52271,'buildings|overture':52646,'destroyed_features|osm':4430,
    'education_facilities|osm':146,'education_facilities|overture':20,'financial_services|osm':97,
    'health_facilities|osm':18,'health_facilities|overture':12,'helipads|osm':22,'open_spaces|osm':93,
    'open_spaces|overture':18,'points_of_interest|osm':576,'points_of_interest|overture':248,'police_stations|osm':11,
    'police_stations|overture':2,'populated_places|osm':150,'populated_places|overture':43,'residential_areas|osm':1476,
    'roads|osm':5336,'roads|overture':3451,'waterways|osm':570,'waterways|overture':465 },
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
  pre_s1_20260816:      'Sentinel-1D ascending pass, 16 Aug 2026, 10 m, on the same relative orbit (85) as the 28 Aug post-event pass and covering the same full corridor, so the two are directly comparable before/after. Water and wet ground return little signal and read dark, vegetation and buildings read bright, slopes facing away from the satellite fall into shadow. Terrain-corrected gamma0 from the Microsoft Planetary Computer. © ESA Copernicus.',
  post_s2_20260827:     'Sentinel-2 (S2B, tiles 45RUL/45RUM), 27 Aug 2026 ~10:56 NPT, the day after the flood, mostly clear over the corridor (54 % cloud on the southern tile, 78 % on the northern). True-colour at the native 10 m, tiled to z14 straight from the AWS open Sentinel-2 COG archive. © ESA Copernicus Sentinel data 2026.',
  post_ps_20260826:     'PlanetScope full-resolution flood-morning scene 20260826_050135_34_255f, 26 Aug 2026, 3.8 m, hazy. Covers 85.10–85.20°E, 27.83–27.95°N. Planet open disaster data, CC-BY-NC-4.0.',
  post_ps26_mosaic:     'PlanetScope flood-morning mosaic, 26 Aug 2026, nine scenes from two passes (~10:46 and ~11:30 NPT), rendered ~20 m. Heavy monsoon cloud with the surge visible in gaps. Planet open disaster data, CC-BY-NC-4.0.',
  post_ps28_mosaic:     'PlanetScope day-2 mosaic, 28 Aug 2026 ~10:42 NPT, five scenes, ~20 m — the clearest wide view of the upper valley and debris corridor. Cropped to the upper valley north of Dhunche; the wide-corridor version was cloudy and unhelpful further south. Planet open disaster data, CC-BY-NC-4.0.',
  post_s1_20260828:     'Sentinel-1D pass, 28 Aug 2026 ~18:06 NPT, 10 m — the only post-flood image of the whole corridor without cloud. Water and fresh wet sediment return little signal and read dark, vegetation and buildings read bright, slopes facing away from the satellite fall into shadow, so the widened sediment-filled channel shows as a dark band. Terrain-corrected gamma0 from the Microsoft Planetary Computer. © ESA Copernicus.',
  post_wv02_20260828:   'Vantor WorldView-2, 28 Aug 2026 ~10:52 NPT, 0.54 m, broken cloud. Covers the whole Trisuli Bazar focus box; registered to the PlanetScope frame and streamed at ~0.37–0.49 m. © 2026 Vantor via OpenAerialMap, CC-BY-NC 4.0.',
  post_skysat_20260831: 'Planet SkySat pair, 31 Aug 2026 ~15:10 NPT, 0.65 m, Betrawati down through Trisuli Bazar and Bidur — the only sub-metre view of the downstream reach. The southern frame is largely clear over the river and town, the northern frame over Battar and Betrawati is mostly cloud. Delivered georeferencing sat ~500 m east and ~800 m south of the map grid, so each frame is re-registered with a thin-plate-spline warp through ~80–200 tie points matched to the pre-event PlanetScope scene (residual a few metres over clear ground; the collect was ~9° off-nadir, so a few metres of terrain-related shift can remain on steep slopes). Planet open disaster data, CC-BY-NC-4.0.',
  post_skysat_20260827: 'Planet SkySat pair, 27 Aug 2026 ~07:45 NPT, 0.8 m, ~50 % cloud, over Rasuwagadhi and Syabrubesi — the earliest sub-metre imagery after the flood. Cross-correlated against the 1 Sep Legion layer and sits within ~10 m of it. Planet open disaster data, CC-BY-NC-4.0.',
  post_wv3_20260827:    'Vantor WorldView-3, four strips, 27 Aug 2026 ~10:49 NPT, 0.30–0.35 m, 71–79 % cloud — the sharpest imagery of the event, upper valley only. © 2026 Vantor, CC-BY-NC-4.0 (Vantor open data; also mirrored on OpenAerialMap).',
  post_legion_20260901: 'Vantor Legion, two frames, 1 Sep 2026 ~08:43 NPT, 0.37–0.46 m, hazy but largely cloud-free — the clearest post-flood view of the upper valley. © 2026 Vantor, CC-BY-NC-4.0.',
  post_drone_trisuli_202609: 'Two post-flood drone photographs of Trisuli Bazar mosaicked into one layer, ~0.65 m, cloud-free: the old bazaar between the hydropower canal and the river, and the Trishuli bend to the south with the highway settlement on the left bank. Screenshots of a social-media post; capture date and photographer not yet confirmed (early September 2026, after the 26 Aug flood). Each frame was placed by hand in the Image align tool against the 28 Aug WorldView-2 and 5 Feb Legion scenes and baked verbatim; single nadir frames with no terrain correction, so expect a few metres of drift on the slopes and a visible seam where the frames meet. Rights reserved by the photographer; shown for situational awareness only.',
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
<p>Per ICIMOD's working account, a rock mass carrying a hanging glacier detached from the north face of
the Lirung massif (Langtang Himal) at about 5,200 m, fell roughly 1,200 m into the Lende (Lhende) Khola
headwaters, and blocked the river for about 18–19 hours before the dam failed on the morning of 26 Aug
2026 (<a href="https://www.icimod.org/kyirong-rasuwa-flood-2026-nepal-china-border/" target="_blank" rel="noopener">ICIMOD</a>).
The July 2025 flood on the same corridor was a different mechanism — drainage of a supraglacial lake on
the Purepu Glacier, about 35 km upstream. First scientific paper on this event:
<a href="https://arxiv.org/abs/2609.04563" target="_blank" rel="noopener">"When a high-mountain slope failure
cascades downstream: physical footprint and evolving exposure of the 2026 Gyirong mixed rock-ice cascade"</a>
(arXiv 2609.04563).</p>
<p>Casualty and damage figures change daily. The Casualties, Municipality reports, Hydropower &amp; grid and
Communities affected sections in this panel carry the figures as at the date stamped on each one, taken from
Nepal's Ministry of Foreign Affairs
<a href="https://mofa.gov.np/content/1879/daily-update-07-september-bhote-koshi-flood/" target="_blank" rel="noopener">Situation
Update on Bhote Koshi River Floods</a> (7 Sep 2026 14:00 NPT edition), NDRRMA and OCHA; for anything newer go to
those sources directly. Flood-front arrival times
cited elsewhere on this site come from the Flood Forecasting Division's (DHM) technical report of 27 Aug
2026, as summarised in
<a href="https://en.wikipedia.org/wiki/Timeline_of_the_2026_Nepal%E2%80%93Tibet_floods" target="_blank" rel="noopener">Wikipedia's
timeline</a>; treat those times as approximate until the DHM report itself is obtained.</p>
<p>Related open reconstructions: Geopera's
<a href="https://geopera.com/blog/bhote-koshi-flood-2026-satellite-analysis" target="_blank" rel="noopener">satellite
analysis</a> (<a href="https://github.com/geo-pera/bhotekoshi-2026-reconstruction" target="_blank" rel="noopener">code
and data</a>, CC BY-NC 4.0) and <a href="https://rasuwaflood.org" target="_blank" rel="noopener">rasuwaflood.org</a>
(Apil K.C., University of Michigan).</p>

<h3>Reports</h3>
<p>The four report sections in this panel are built from <code>data/reports.json</code>. Every number in them
carries its own "as of" date and a link to the source it came from; the small arrow beside a figure opens that
source, in blue for an official one and amber for anything that is not. Where no official figure exists at that
level the cell reads "not reported" — nothing on this map is estimated, interpolated or carried across from a
neighbouring place.</p>
<p>Two labelling points worth keeping in mind. The headline casualty number is <b>bodies recovered</b>, not
identified deaths: only about 4% of the roughly 900 bodies found by 1 September had been formally identified.
And the district figures record <b>where remains were found</b>, not where people lived, which is why Chitwan and
the two Nawalparasi districts exceed Rasuwa and Nuwakot — bodies travelled up to 240 km downstream. "Missing" is
a separate category that Nepal's authorities do not treat as presumed dead.</p>
<p>Official and inter-governmental sources used:
<a href="https://ndrrma.gov.np/mediafiles/rasuwa/Rasuwa_Flood_SitRep_Temp_ENG_01_01092026.pdf" target="_blank" rel="noopener">NDRRMA
Rasuwa-Bhotekoshi Flood Situation Report #1</a> (1 Sep 2026);
<a href="https://mofa.gov.np/content/1879/daily-update-07-september-bhote-koshi-flood/" target="_blank" rel="noopener">MoFA
daily situation updates</a> (6 and 7 Sep 2026);
<a href="https://www.unocha.org/publications/report/nepal/nepal-rasuwa-flood-flash-update-4-31-august-2026" target="_blank" rel="noopener">OCHA
Rasuwa Flood Flash Update #4</a> (31 Aug 2026) and
<a href="https://www.unocha.org/publications/report/nepal/nepal-rasuwa-flood-flash-update-5-1-september-2026" target="_blank" rel="noopener">#5</a>
(1 Sep 2026);
<a href="https://dtm.iom.int/nepal" target="_blank" rel="noopener">IOM Displacement Tracking Matrix</a>;
<a href="https://www.unicef.org/press-releases/" target="_blank" rel="noopener">UNICEF</a> on water and sanitation;
<a href="https://radionepalonline.com/en/2026/09/07/435557.html" target="_blank" rel="noopener">Radio Nepal</a> on
electricity restoration; and <a href="https://bipadportal.gov.np/" target="_blank" rel="noopener">NDRRMA's BIPAD
incident portal</a>.</p>
<p>Hydropower positions: ten come from HOT's surveyed <i>exposed hydropowers</i> layer. The other nine plants in
the table were located by hand from OpenStreetMap and Wikidata where either had the plant mapped, otherwise from
the Global Energy Monitor hydropower tracker or, for two projects that have never published coordinates, from
Nominatim's centre for the settlement the developer names. Those carry an "approximate" or "settlement-level" tag
in the table and draw hollow rather than solid on the map, and the popup says which source placed them.
Municipality and district for every plant are resolved from the coordinate against the boundary layer rather than
copied from the source, because the HDX export's own <code>municipality</code> field contradicts its
<code>adm3_name</code> on several rows. Built by <code>tools/build_hydropower_points.py</code>.</p>
<p>Municipality-level detail comes from the "needs and priority" table in NDRRMA's situation report #01 of
1 September 2026, which names the affected wards for eleven local levels in Rasuwa, Nuwakot and Dhading and says
what relief had reached each. That report publishes no casualty count below district level, so the municipality
rows show official casualty figures nowhere and say "not reported" instead. NDRRMA issued later reports, including
#7 dated 7 September, but none of those PDFs could be retrieved, so anything dated after 1 September on this map
comes from MoFA daily updates or named press reporting rather than an NDRRMA document.</p>
<p>A note on BIPAD, since it is the obvious place to look for municipality-level figures. As of 9 September 2026
its incident register does not contain this event: across the eight corridor districts for 26 Aug to 9 Sep it
holds 45 incidents totalling 2 deaths, and Rasuwa has two unrelated high-altitude reports and nothing about the
flood. NDRRMA tracked this disaster through its situation reports and rescue lists instead. Nothing from BIPAD is
therefore used on this map; <code>tools/merge_bipad_reports.py</code> is ready to merge it in if and when the
register is backfilled.</p>
<p>Nepal Electricity Authority figures reach this map through named press reporting rather than an NEA
publication: the Kathmandu Post of 30 Aug and 6 Sep 2026, Nepalnews, Spotlight Nepal, OnlineKhabar, myRepublica,
Nepal Press, Khabarhub, Korea JoongAng Daily, NPR and Mongabay. Those are marked as unofficial sources in the
panels. Where sources disagree — MW knocked off the grid, the number of projects damaged, the size of the
sector's losses, the count of missing foreign nationals — both or all figures are shown side by side rather than
one being picked. The community-run Rasuwa Flood Bulletin is cited on a single settlement row and tagged
unofficial there.</p>

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
dataset on HDX, snapshot of 10 September 2026. ${HDX_CREDIT}.</p>
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
      in dark red; road stretches with a damaged or destroyed status draw bright red in the roads layer;
      413 of the 4,409 features are individual OSM nodes rather than building or road outlines and are
      counted in the totals but not drawn as map markers), <b>bridge ground reports</b> and
      <b>exposed hydropowers</b>.</li>
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

<h3>Administrative boundaries</h3>
<p>District and municipality (local level) boundaries are from OCHA's Common Operational
Dataset for Nepal (COD-AB), version v02 valid 14 March 2024 — the current federal structure. Survey
Department of Nepal / UN Resident Coordinator's Office in Nepal, CC BY-IGO. Ward boundaries are the
only ward-level (admin4) source found for Nepal: a 2018 Housing Recovery and Reconstruction Platform
(HRRP) dataset covering the 31 districts affected by the 2015 earthquake, filtered here to Rasuwa,
Nuwakot, Dhading and Gorkha (315 wards). CC0, but treat ward shapes and numbers as reference-only, not authoritative — see
<code>data/admin/README.md</code> for the full provenance and caveats. The layers are clipped to
roughly the map's maximum pan extent and simplified for basemap display. The whole
group has its own opacity slider.</p>
<p>The district outline is drawn at all times as a solid bright green line, limited to the four districts
the flood ran through — Rasuwa, Nuwakot, Dhading and Gorkha. Municipality boundaries (thin solid dark
green) show only the fourteen local levels whose polygon touches the observed flood extent along the
Bhote Koshi and Trishuli, ward outlines the 108 wards inside those same fourteen, and the national
highways and waterways are clipped to the same four districts. There is no province layer: the
event touches too few districts for one to say anything. Municipality is a toggle, off by default;
the flood-affected wards are on by default.</p>
<p>The ward fill is a white-to-brown ramp on mapped damage. Each shaded ward is shaded by
<code>dmg_total</code>: the number of features recorded as Destroyed or Damaged in the HOT
<code>destroyed_features_osm</code> corridor layer that fall inside it, joined to the ward polygons by
<code>tools/build_admin_ward.py</code> (points by containment, lines and polygons by intersection, each
feature counted once per ward). The ramp runs near-white at zero through tan and sienna to deep brown,
with breakpoints at 0, 40, 340 and 534 — the median, 85th percentile and maximum of the counts over the
35 wards that carry any mapped damage at all. <strong>No official source publishes casualties at ward
level</strong> — NDRRMA reports bodies recovered by district — so the ramp reflects mapped damage, never
a casualty count, and the wards with the deepest brown are the ones volunteers have mapped most, which
is not the same thing as the ones hit hardest.</p>
<p>The wards NDRRMA lists as affected in its Rasuwa–Bhotekoshi Flood Situation Report #01 of 1 September
2026 keep a thin dark-brown outline instead of a fill colour of their own, so that official tier stays
readable over the ramp. They are read from the <code>wards_official</code> entries in
<code>data/reports.json</code> and matched to the 2018 ward polygons by local-level name (via the alias
list, which bridges spellings such as Aamachhodingmo/Parbati Kunda, plus the <code>HRRP_ALIAS</code>
table in <code>app/app.js</code> for Galchhi/Galchi and Shahid Lakhan/Sahid Lakhan) and ward number.
Twenty-four of the 108 drawn wards carry that outline: 11 in Rasuwa, 8 in Nuwakot, 5 in Dhading. Two NDRRMA-listed wards do not intersect the observed flood extent — the situation report
counts isolation and road closure as well as inundation — so the shaded set is the union of the
flood-touching wards and the NDRRMA ones, not a subset of either. Every ward inside the fourteen local
levels, shaded or not, still gets the ordinary dashed green outline. Full method, data sources and
field definitions: <code>data/admin/README.md</code>.</p>

<h3>Basemaps</h3>
<p>OpenStreetMap raster © OpenStreetMap contributors. Esri World Imagery © Esri and its imagery
partners. Map glyphs from the MapLibre demo font stack.</p>
`;

return { CATS, COUNTS, STATUS, FAIR, PLACES, HOME, DEFAULT_VIEW, SCENES, COVERAGE_LABEL, HDX_CREDIT, HDX_URL, NOTES_HTML,
         DAMAGE_EDITS_URL };
})();
