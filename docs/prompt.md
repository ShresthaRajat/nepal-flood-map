Research digest · compiled 9 Sep 2026 · for nepal-flood-2026 and nepal-flood-viewer
What changed since the 7 Sep inventory
A web scan across imagery providers, response datasets, event science, tooling and peer projects, filtered against what the map already has. Items are graded by what you should do with them.

Stale on the map, refresh
New and confirmed
Reported by research, not independently confirmed
Act on these first
staleHOT flood datasets on HDX were rebuilt this morning.
hot_flood_npl modified 2026-09-09 04:07 UTC and hot_flood_npl_corridor at 03:10 UTC, both now 74 to 78 resources. The map carries the 6 Sep snapshot. Run tools/refresh_hdx.sh. The separate hot_flood_npl_buildings_damage dataset has not changed since 28 Aug. Confirmed via the HDX CKAN API.

newThree Vantor scenes from 8 Sep are not in the catalogue.
The Vantor STAC collection now lists 30 items, up from 23 on 7 Sep. The watcher picked up WV-2 EF5510 and EF5910 and Legion 1F4F10 but not Legion LG04 B14000110116A310 (0.52 m, upper valley) nor WV-2 EF5110 and EF5210 (0.68 to 0.71 m, Nuwakot south of Trisuli Bazar). Details in the imagery table below.

newOSM post-event mapping is validated and newer than your Overpass pull.
HOT Tasking Manager projects 63069 (buildings), 63102 (roads) and 63399 (settlement extent) under the #nepal-flood-2026-trisuli-bhotekoshi campaign; the OSM wiki activity page was last edited 8 Sep. Re-pull roads, waterways and places after the HDX refresh so both come from the same OSM state.

newA gauge-based flood-front timeline exists for an animation.
Wikipedia's "Timeline of the 2026 Nepal–Tibet floods" is built from the Flood Forecasting Division technical report of 27 Aug: 8:37 collapse (later re-catalogued as an M5.2 event), Syabrubesi gauge last reading 1.62 m at 8:40 then silent at 8:50, customs yard and Friendship Bridge hit 8:50 to 9:00, SMS alert to 679,295 residents at 9:15, Devghat back to about 4 m by 18:30 with an estimated 20 million m³ excess volume. Find the FFD report itself before publishing times.

verifyCasualty figures on the map need a dated official source.
MOFA publishes a daily "Situation Update on Bhote Koshi River Floods"; the 7 Sep 14:00 NPT edition is live and confirms tunnel-rescue teams from five countries and continued work at Upper Trishuli 1, 3A, 3B, Chilime, Rasuwagadhi and Langtang. Wikipedia's infobox, as of today, cites 1,400+ deaths (1,357 Nepal, 43 China), 5,845+ missing and 6,827+ injured. Agents saw other counts from 903 upward depending on date. Quote MOFA or NDRRMA with the date, never an aggregate.

verifyCopernicus EMSR927 has a Situational Reporting product.
The activation page lists it alongside the delineation and grading products the map already uses. Whether it carries new vectors or only a PDF overview was not confirmed. Check before the next EMS build.

Imagery
Everything the imagery scan surfaced that predates 7 Sep is already in docs/IMAGERY_INVENTORY.md (Charter activation 1052, Sentinel Asia sensors, Landsat 9, NEA drones, the older Vantor pre-event baselines). The genuinely new material is below.

Vantor open-data scenes over the corridor not yet tiled
Date	Sensor	Item id	GSD	Covers	Size	Status
2026-09-08	Legion LG04	B14000110116A310	0.52 m	Upper valley, Syabrubesi to Timure	112 MB	new since 7 Sep
2026-09-08	WorldView-2	B030001100EF5210	0.71 m	Trishuli below Trisuli Bazar, Nuwakot	183 MB	new since 7 Sep
2026-09-08	WorldView-2	B030001100EF5110	0.68 m	Far south, Dhading edge of corridor	138 MB	new since 7 Sep
2026-09-07	Legion LG04 / LG06 / LG02	…14DC10 · …DA4B10 · …250A10	0.43–0.58 m	Trisuli Bazar (two) and upper valley east	30–77 MB	in inventory, not tiled
2026-09-06	GeoEye-1	B0500011006DC010	0.72 m	Upper valley, wide	112 MB	in inventory, not tiled
2026-09-05	Legion LG02	B120001101226410	0.53 m	Upper valley	70 MB	in inventory, not tiled
2026-08-31 / 08-28	Legion LG03 / LG01	…1153A10 · …1165110	0.40–0.60 m	Upper valley; LG01 is a long N–S strip	53 / 482 MB	in inventory, not tiled
2024-05-29	WorldView-2 pre-event	10300100FCB83600	0.65 m	Whole corridor, both focus boxes	979 MB	in inventory; best sub-metre pre baseline
Source: OpenAerialMap API query over lon 84.85–85.70, lat 27.75–28.70 on 9 Sep, cross-checked with the Vantor collection.json. Coverage judged against the upper-valley box (85.20–85.45 E, 28.05–28.35 N) and the Trisuli Bazar box (85.05–85.25 E, 27.85–28.05 N). Default pre side is still "none"; the 2024 WV-2 would give the swipe a real sub-metre before layer.

Why the watcher skipped them
Not a bug. The watch log for 8 Sep shows all three were seen and logged "notify only" because they fail the quality gates: cloud above 50% for EF5110 (56%) and 116A310 (71%), and off-nadir above 35° for all three (37.3°, 39.7° and 41.2°). EF5210 at 40% cloud over Trisuli Bazar and Betrawati is the one most worth an owner override; the other two are hazy and steeply viewed.

Other imagery leads
Charter activation 1052 contributors are now itemised. ISRO/NRSC, JAXA, TASA, GISTDA, BGS, SERTIT, Copernicus EMS, K-water and KIGAM, MBRSC, INPE and SUPARCO; 34 products, images 28 to 29 Aug, quicklooks to 2 Sep. Still quicklook and PDF only. disasterscharter.org/activations/flood-in-nepal-activation-1052-
Sentinel Asia raw data (ALOS-2 28 Aug, EOS-04 26 Aug, FORMOSAT-5 28 Aug and 1 Sep, THEOS-2 27 Aug) is listed as downloadable to registered users. Licence terms not checked.
Nothing found for Umbra, Capella, ICEYE, Satellogic, BlackSky, Airbus, KOMPSAT, Gaofen or Jilin-1 event releases, nor NASA ARIA damage proxy maps. Absence of results, not proof of absence.
Copernicus Browser is the place to check for a clearer Sentinel-2 pass after 27 Aug; none was confirmed by the scan.
Response data
IOM Displacement Tracking Matrix. Emergency Tracking Tool round covering 15 sites in Dhading, Nuwakot and Rasuwa; reports 4,288 households affected and 2,886 displaced. A natural point layer. Whether a Rasuwa-specific HDX resource exists is unverified. dtm.iom.int/nepal
NDRRMA situation reports. A formal SitRep PDF dated 1 Sep exists under ndrrma.gov.np/mediafiles/rasuwa/; the directory returns 403 to scripts, so browse it by hand for later numbers. BIPAD portal incident records were not checked.
Department of Roads estimate from 29 Aug: about 40 km of road and 41 bridges destroyed or damaged between Betrawati and Rasuwagadhi. No GIS download found; useful as a headline check against the EMSR927 grades and your flooded-roads overlay.
OCHA Flash Updates run at least to number 5 (1 Sep) plus a Flash Appeal (4 Sep). The ReliefWeb API v1 is decommissioned and v2 requires a registered appname, so the watcher cannot poll it without a one-time request at apidoc.reliefweb.int.
UNOSAT. No product newer than FL20260826NPL and #4257 was confirmed; their Sentinel-1 FloodAI dashboard is not known to cover this AOI.
ICIMOD "Kyirong-Rasuwa Flood 2026" page carries mechanism analysis but no GIS download. It also blocks scripted fetches.
Google Flood Hub: no evidence of coverage for this event.
Event science and figures
~5,200 m
detachment elevation, north face of the Lirung massif (ICIMOD)
18–19 h
Lende Khola blocked before the dam failed on 26 Aug (ICIMOD)
~20 M m³
excess volume estimated at Devghat (FFD via Wikipedia timeline)
431 MW
operating hydropower off-grid, per NEA (Kathmandu Post, 30 Aug)
Mechanism. ICIMOD's working account: a rock mass carrying a hanging glacier detached from the Lirung north face, fell about 1,200 m into the Lende Khola headwaters, dammed it for most of a day, and the dam failed on the morning of 26 Aug. Outlets still disagree on the label (glacier collapse, GLOF, cascading rock-ice avalanche). No peer-reviewed discharge figure yet.
First paper. arXiv 2609.04563, "When a high-mountain slope failure cascades downstream: physical footprint and evolving exposure of the 2026 Gyirong mixed rock-ice cascade". Uses Landsat 9 from 26 Aug, GLO-30 and GPM IMERG. Confirmed to exist; not read. A likely source for the source-zone polygon and volume.
Secondary hazard. A landslide-dammed lake formed and breached on 28 Aug, pausing rescue on both sides of the border. No currently unstable lake was reported as of 7 Sep; ICIMOD says monitoring continues. The map's two barrier-lake polygons from UNOSAT should carry that date context.
Contrast with July 2025. That flood was a supraglacial lake drainage on the Purepu Glacier about 35 km upstream, a different mechanism on the same corridor. Good context for the origin layer.
Infrastructure. Rasuwagadhi (111 MW), Chilime (20 MW), Upper Trishuli-1 (216 MW), Upper Trishuli-3A (60 MW), 3B and Langtang facilities damaged; NEA estimates 431 MW operating plus 470 MW under construction affected. The Rasuwagadhi dry port lost 300+ vehicles, about 1,000 EVs and 100 to 200 loaded containers per Maritime Executive.
Response status, 7 Sep. Nepal Army is placing a Bailey bridge on the Tadi; Galchhi to Trishuli is partly open via the Kalleritar and Gauribesi route; the Syabrubesi to Rasuwagadhi road remains closed. MOFA has requested LiDAR and high-capacity drones from partners, which may mean more open imagery later.
Weather. The 2026 monsoon is forecast below average overall; DHM and the US Embassy still warn of flash-flood and landslide risk, and the Prithvi Highway is cut at Krishnabhir by river erosion.
Tooling
Component	Project	Current	What it changes
MapLibre GL JS	4.7.1	6.8.0	Two majors behind. v5 changed geometry-type semantics and the query-intersects API; globe and raster-on-terrain improved. maplibre-gl-compare is now maintained under the maplibre org and would replace the hand-rolled swipe sync.
pmtiles.js	3.2.1	4.5.0	Rewritten TypeScript surface; read the changelog before bumping alongside MapLibre.
Leaflet (old viewer)	1.9.4	1.9.4 stable, 2.0.0-alpha.1	2.0 is still alpha, ESM-only, pointer events. Leave the Leaflet viewer as is.
GDAL	3.13.3 installed	3.13.3	Already current. Since 3.13 gdal2tiles.py runs on the new gdal raster tile command by default, so a parallelism regression or gain in your WebP z8–19 runs is worth timing once.
Tile hosting	XYZ directories on GitHub Pages	Raster PMTiles on Cloudflare R2	Pages has a 1 GB soft repo limit and 100 MiB file cap; 21 imagery layers already push that. R2 gives 10 GB and zero egress free, MapLibre reads raster PMTiles natively, and one file per scene is far kinder to git.
STAC bulk access	pystac-client style requests	rustac (was stacrs), stac-geoparquet 0.8	Only matters if the watcher starts sweeping large Sentinel time ranges.
Overture Maps	—	Aug 2026 release; Sept drops categories on places	Only relevant if you take Places from Overture instead of OSM.
OSM damage tags	HOT status export field	destroyed:building, damage:event, damage:type, damage:date	Use these keys for your locally edited damages so they can flow back to OSM.
Prior art worth a look for time exploration: Development Seed's NASA VEDA Fire Event Explorer (2025). Planetary Computer Pro is a separate Azure product and does not affect the public STAC endpoint the watcher uses.

Peer viewers of the same event
About a dozen exist. None links to or mentions your map. Two are worth a conversation.

Collaboration candidates
Geopera reconstruction by Darcy Weedman. PlanetScope, SkySat, Pelican and Vantor WorldView-2/3 stereo plus NASA and Copernicus DEMs feeding a 3D hydraulic flood-depth model with a timeline scrubber, flow height, velocity and sediment. Open GitHub repo geo-pera/bhotekoshi-2026-reconstruction with a 32 GB source archive and a 335 MB derived package in EPSG:32645, CC BY-NC 4.0. The derived depth and extent rasters would slot straight into your overlay list. URL responds.
rasuwaflood.org by Apil K.C., University of Michigan. OSM-based interactive corridor map, a Cesium 3D view and an embedded ArcGIS StoryMap, synthesising HiRISK, ICIMOD, Copernicus, UNOSAT and Nepali press. Pairs with a Nepali-language "Rasuwa Flood Bulletin" for road status at nirajbhusal.github.io/rasuwa-flood-bulletin. The nearest analogue to your map and the obvious cross-link. An earlier scan flagged this domain as unclear provenance; the author is now identified.
Others
Nepal AI Twin, Rasuwa 2026 at eo-rasuwa.dev/map. Change detection from Sentinel-2, Planet disaster data, OSM and the GLIMS glacier inventory, ranking six priority inspection sites with the OlmoEarth embedding model. Frames itself as observed change, not damage. A GLIMS glacier outline layer is an idea worth borrowing for the origin zone.
Esri Disaster Response Program StoryMap "Nepal Flood - 2026" and a second, unattributed StoryMap "August 2026 Nepal Trishuli Flood". Standard Esri layer compilations, static.
USGS "2026 Nepal Debris Avalanche and Flash Flood" page: static hazard map plus seismic-signal analysis. Relevant to the 8:37 M5.2 re-catalogued event in the timeline.
Mappr.co article by Andreas De Rosi using Planet imagery and HiRISK analysis; geosutra.com field report; ReliefWeb reference-map PDFs 26 Aug to 6 Sep; static Planet before/after pairs from Al Jazeera, ABC and India TV. NDRRMA itself distributed Planet imagery with Stimson Center support.
nepal-flood-map.pages.dev and nesraspace.org/floodwatch/rasuwa-2026 surfaced in a separate scan and were not inspected. Check whether the first is a mirror of yours.
One inconsistency between scans: the peer-viewer pass attributed ICIMOD's cause analysis to a Purepu Glacier supraglacial lake drainage. That describes the July 2025 flood; ICIMOD's 2026 account is the Lirung rock-ice detachment given above.

Verification notes
Confirmed by direct fetch
HDX modification times, Vantor collection item count, OpenAerialMap listing, MOFA 7 Sep update text, Wikipedia infobox and timeline, arXiv 2609.04563 title, npm versions, local GDAL version, EMSR927 page naming Situational Reporting.
Reported by agents, not re-checked
Charter 1052 contributor list, Sentinel Asia download terms, IOM DTM counts, Department of Roads estimate, hydropower and dry-port figures, weather outlook, Tasking Manager project numbers.
Blocked to scripts
NDRRMA mediafiles (403), ICIMOD event page (403), HDX HTML pages (403, API fine), ReliefWeb API (needs appname).
Compiled from five parallel web-research passes plus direct API checks on 9 Sep 2026. Figures are provisional and change daily; cite the dated primary source on the map, not this page.