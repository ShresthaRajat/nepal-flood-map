# Alternative routes in use: Trisuli Bazar, Betrawati and Dhunche

**As of 17 September 2026.** Bhote Koshi / Trishuli glacier-collapse flood of 26 August 2026.

This note records what people and relief convoys are actually using right now to reach or pass
through Trisuli Bazar / Bidur, Betrawati and Dhunche. Every claim carries a source. Where
something is inferred rather than reported, it says so.

> **Where the problem actually is.** South of Trisuli Bazar the road network is back. The
> Galchhi - Devighat - Dhunge - Trishuli line is clear and operational, the Ratamate hillside
> cutting is finished and traffic has resumed, and road access to Dhading district headquarters
> has been restored. Trisuli Bazar itself is **not** cut off. The unresolved severance is
> everything north of it: the 800 m gap on the Bidur - Betrawati road, the Betrawati crossing,
> and the whole corridor beyond Dhunche. Features in the GeoJSON carry a `role` field
> (`restored`, `backup`, `lifeline`, `cut`, `planned`) so the map can show that difference rather
> than flagging restored southern stretches as problems.
> **Source: NDRRMA SitRep 14, 15 Sep; SitRep 15, 16 Sep.**

Geographic features for the routes below are in `data/hdx/derived/alt_routes.geojson`
(21 features, ids `TB-*`, `BW-*`, `DH-*`). The Overpass queries behind them are in
`tools/fetch_alt_routes_overpass.txt`.

## Sources used

| Key | Source | Date |
|---|---|---|
| SitRep 15 | [NDRRMA Situation Report #15 (English)](https://ndrrma.gov.np/mediafiles/publications/SitRep_ENG_15_16092026.pdf) | 16 Sep 2026 |
| SitRep 14 | [NDRRMA Situation Report #14 (English)](https://ndrrma.gov.np/mediafiles/publications/SitRep_ENG_14_15092026.pdf) | 15 Sep 2026 |
| KP 13 Sep | [Kathmandu Post, Flood damage leaves Rasuwagadhi road facing long repairs](https://kathmandupost.com/national/2026/09/13/flood-damage-leaves-rasuwagadhi-road-facing-long-repairs) | 13 Sep 2026 |
| KP 8 Sep | [Kathmandu Post, Dhunche has relief supplies; getting aid to villages is the problem](https://kathmandupost.com/national/2026/09/08/dhunche-has-relief-supplies-getting-aid-to-flood-hit-rasuwa-villages-is-the-problem) | 8 Sep 2026 |
| OK 29 Aug | [OnlineKhabar, Rasuwa reconnected to road network](https://english.onlinekhabar.com/rasuwa-reconnected-road-network.html) | 29 Aug 2026 |
| OK 31 Aug | [OnlineKhabar, Trishuli-Betrawati road: 4 km washed away, 6 km usable](https://english.onlinekhabar.com/trishuli-betrawati-road-4-kilometres-washed-away-6-kilometres-remains-usable.html) | 31 Aug 2026 |
| Meroauto | [Rs 32.5m for road repairs, Bailey bridges at three sites](https://www.en.meroauto.com/rs-32-5-million-allocated-for-road-repairs-as-bailey-bridges-planned-at-three-sites/) | 10 Sep 2026 |
| OSM | [OpenStreetMap via Overpass](https://overpass-api.de/api/interpreter), data timestamp 2026-09-17T08:26Z | 17 Sep 2026 |
| DoR inventory | `data/hdx/hot_flood_npl/hot_flood_npl_bridge_damage.geojson` (Department of Roads, via HDX/HOT) | 6 Sep 2026 |
| Copernicus | `data/hdx/derived/ems_road_grading.geojson`, EMSR927 photo-interpretation | 27-28 Aug 2026 |

---

## 1. Trisuli Bazar / Bidur (Nuwakot)

### What the usual route was

Kathmandu to Trisuli Bazar ran along the Prithvi Highway to Galchhi in Dhading, then north on the
Pasang Lhamu Highway (NH42) up the left bank of the Trishuli through Ratmate, Buddhasinghghat and
Devighat, crossing the Tadi Khola at Devighat and the Trishuli at Trisuli Bazar.

### Current status: restored

**The ordinary route works again** (`TB-0`, role `restored`). NDRRMA SitRep 14 of 15 September:
"Galchhi-Devighat: Hillside cutting at Ratamate has been completed, and traffic has resumed.
Kolphu Bridge is open to one-lane traffic following minor repairs. Devighat-Dhunge: The road is
clear and operational. Dhunge-Trishuli: The road is clear and operational." SitRep 15 repeats that
Galchhi - Devighat is clear and operational.

Two things made that possible: the Ratamate hillside cutting, and the Nepal Army Acrow bridge at
Devighat. Everything else in this section is therefore a **maintained backup**, not the way in.
Southern Dhading is likewise reconnected: SitRep 15 records the Dhadingbesi - Parewatar -
Gajuritar - Keurinitar - Mastar route to the Prithvi Highway as operational, with road access to
the district headquarters restored.

### What was gone

The Department of Roads inventory records, on this stretch alone, both Trisuli Bazar bridges
(60 m each), Simchaur (100 m), both Devighat Tadi Khola bridges (55 m each), the Devighat
suspension bridge, the Mid-Hill Highway Trishuli bridge near Devighat, Srikhali (180 m),
Buddhasinghghat (140 m), Ratmate (150 m) and Keurini/Phosretar, all washed out. Copernicus
EMSR927 grades 430 road and bridge segments in the corridor "Destroyed", concentrated around
Bidur and Phosretar. **Source: DoR inventory; Copernicus EMSR927.**

### What restored access, and what is now only a backup

**1. The Ratmate bypass track** (`TB-2`, mapped from OSM, role `restored`) - **complete**
A new track cut into the hillside above the washed-out highway at Ratmate, about 8 km from
Galchhi, adding roughly 3 km to the journey and rejoining at Dui Pipal village. SitRep 14,
15 September: "Hillside cutting at Ratamate has been completed, and traffic has resumed."
The OpenStreetMap way that maps it (1559050050) still carries the older
`note=Under construction to bypass damaged section`, so **the OSM tag lags the SitRep**.
**Source: SitRep 14; KP 13 Sep; OSM.**

**2. The Devighat Acrow bridge** (`TB-3`, mapped point, role `restored`)
A 60 m Acrow bridge, 5.5 m wide and rated 50 tonnes, built in five days by a 55-member Nepal Army
Bridging Unit team at the site of the destroyed Tadi Khola bridge. Opened to pedestrians on
10 September and to vehicles from 11 September. This is the link that put Galchhi - Devighat -
Trishuli back together. **Source: Meroauto 10 Sep; SitRep 15.**

**3. The Trishuli right-bank detour** (`TB-1`, approximate, 25 km, role `backup`)
Galchhi - Trishuli Bridge - Kalleritar - Koshikhola - Pimaltar - Darshantar - Chhatre Khola -
Gauribesi - Trishuli Bazaar. Still listed as operational and maintained in SitRep 15, but it is no
longer the necessary route. It crosses the Trishuli on the Bhimdhunga-Lamidanda road bridge near
Galchhi, which the DoR inventory records as intact, then runs up the right (west) bank through
Galchhi rural municipality in **southern Dhading** and re-crosses at Trisuli Bazar. Narrow, single
lane, slow and hard for two-way traffic. It opened around 2 September, when the left bank was
still severed. **Mode: vehicle. Users: right-bank communities; a fallback for through traffic.
Source: SitRep 15; `data/reports.json` citing OnlineKhabar, 2 Sep.**

**4. The Devighat bridge bypass** (`TB-4`, approximate, role `backup`)
Pipaltar - Pasang Lhamu Highway - Dhamle - Niranjana - Bagkhor - Harre - Deurali - Kolputar.
SitRep 15 lists it as operational, providing an alternative to the damaged Tadi Khola bridge at
Devighat, with maintenance continuing. It is a local hill road, not a highway.
**Mode: vehicle. Source: SitRep 15.**

**5. The Devighat rope crossing** (`TB-5`, approximate point, role `backup`)
SitRep 15: "Rope crossings have been completed at Devighat, Indreni Chaur and Syafrubesi." A tuin
across the Trishuli for people and goods where the Devighat suspension bridge was lost.
**Mode: rope crossing, foot and goods. Source: SitRep 15.**

### Reaching the area from Kathmandu at all

The Prithvi Highway is still blocked at Krishnabhir on the Mugling-Malekhu section, where the road
base eroded into the Trishuli. A 250 m hill-cut track is graveled and traffic was due to resume at
06:00 on Asoj 1. The Fisling-Benighat alternative is still in procurement and construction has not
started. Traffic from the west therefore runs Abukhaireni - Arughat - Salyantar - Dhadingbesi -
Mastar or Kalleri to Kathmandu. This is the one genuinely unresolved constraint south of Trisuli
Bazar, and it is a Prithvi Highway problem in Benighat Rorang, not a Trisuli corridor one.
**Source: SitRep 15.**

---

## 2. Betrawati (Bidur-10, Nuwakot / Rasuwa boundary)

### What the usual route was

Trisuli Bazar 10 km north on the Pasang Lhamu Highway, crossing at Betrawati into Rasuwa and on to
Kalikasthan and Dhunche.

### What is gone

Both Betrawati bridges, old and new, 70 m each, washed out, along with the Trisuli River bridge at
Tupche (100 m) and the Naya Pul Trishuli at Khalte (50 m) further north. DoR technical officials
who inspected the 10 km Trisuli Bazar - Betrawati road on 31 August found the Trishuli had
completely washed away 4 km of it, with about 6 km usable once debris was cleared. **Source: DoR
inventory; OK 31 Aug.**

### Alternatives currently in use

**1. The partly restored Bidur - Betrawati road** (`BW-1`, approximate, 11 km)
SitRep 15, 16 September: of the 10 km section, 9.2 km is clear; the remaining 0.8 km was
completely washed away. Restoration continues, including cutting through 0.5 km of hard rock, with
graveling ongoing. Landslides and waterlogged ground keep affecting work on both the new and the
existing tracks. The Kathmandu Post put it slightly differently on 13 September: 9.5 km opened and
500 m remaining. **Mode: restricted vehicle, works traffic and light 4WD. Source: SitRep 15;
KP 13 Sep.**

**2. The Gerkhu / Bhainse feeder around the gap** (`BW-2`, approximate)
A 1.5 km feeder route through Gerku and Bhainse covers the remaining 500 m gap, with two options
for the final 300 m: a track along the riverbed, or the Bar Bhanjyang local road. **Mode: 4WD and
foot. Users: works traffic and local people. Source: KP 13 Sep.**

**3. The temporary footbridge at Betrawati** (`BW-3`, approximate point) - **damaged, status unconfirmed**
SitRep 14 of 15 September, in full: "A temporary footbridge approximately 30 metres long has been
rebuilt at Betrawati, Bidur-10, on the Nuwakot-Rasuwa border. The crossing, built on Bhadra 28,
**was damaged by flooding following overnight rainfall.**" SitRep 15 on 16 September drops the
footbridge entirely, so there is no confirmation it has been repaired. It is the only fixed
crossing at Betrawati either way, and it carries people and head-loaded relief, not vehicles.
**Mode: foot. Status: damaged as of 15 Sep, unconfirmed since. Source: SitRep 14.**

**4. The Betrawati Bailey bridge** (`BW-4`, approximate point) - **not yet open**
SitRep 15: "Foundation excavation is underway for a Bailey bridge at Betrawati." DoR had specified
roughly a 48 m span. The Nepal Army bridging team moved here after finishing Devighat. Work could
only begin once about 1.5 km of track between Dhunge Bazar and Betrawati was opened.
**Status: under construction as of 16 Sep. Source: SitRep 15; `data/reports.json` citing Kathmandu
Post, 8 Sep.**

**5. The Falakhu Khola Bailey bridge** (`BW-5`, approximate point) - **not yet open**
A 70 m Bailey bridge is planned at Falakhu Khola on the Rasuwa-Nuwakot border just north of
Betrawati, using an Indian-supplied bridge that was en route from Hetauda. Neupane on 13
September: "we expect to install it within ten days." India handed over the first components of a
70 m Bailey bridge on 12 September. Once installed this would give a direct road connection
through to Dhunche. **Status: planned. Source: KP 13 Sep.**

**6. Through traffic does not use Betrawati at all.** Vehicles bound for Rasuwa bypass the whole
Trisuli Bazar - Betrawati stretch via the Dhikure - Jibjibe - Bogatitar route or the Tokha ridge
route, both described below. **Source: SitRep 15.**

---

## 3. Dhunche (Rasuwa district headquarters)

### What the usual route was

Pasang Lhamu Highway from Betrawati through Khalte, Ramche and Kalikasthan to Dhunche, then on to
Thulo Bharkhu, Syabrubesi, Timure and the Rasuwagadhi border crossing.

### What is gone

The Betrawati - Kalikasthan link (`DH-4`) is cut: Betrawati old and new and the Naya Pul at Khalte
are all washed out, and Copernicus grades stretches of the highway here "Destroyed". Beyond
Dhunche (`DH-5`) the road is simply gone: the Syafrubesi bridge, the Bhotekoshi bridge at Chilime,
the Chilime Khola bridge, both Haku hydropower Bailey bridges, the Mailung Bailey bridge and the
Miteri Friendship Bridge at Rasuwagadhi are all recorded washed out. "Beyond Dhunche, the road is
gone," Urken Chiring Lama told the Kathmandu Post. **Source: DoR inventory; Copernicus EMSR927;
KP 8 Sep.**

### Alternatives currently in use

**1. The Kathmandu - Tokha - Saramthali - Bogatitar route** (`DH-2`, approximate)
Kathmandu - Tokha - Chhahare - Gadkhar Bridge - Aapre - Narja - Lachyang - Saramthali - Patikharka
- Bogatitar - Kalikasthan - Dhunche. Announced by the Ministry of Physical Infrastructure and
Transport and reported reopened on **28 August, two days after the flood**. Restricted to light
four-wheeled vehicles; heavy trucks are excluded. This is the main lifeline into Rasuwa and the
route that reconnected the district to the road network. **Mode: light 4WD only. Users: relief
convoys, government traffic. Source: OK 29 Aug.**

**2. The Dhikure - Jibjibe - Bogatitar route** (`DH-3`, approximate)
Dhikure - Phedi Besi Chowk - Hiramunitar - Chogte - Bore Bhanjyang - Sano Khola - Dhanswara -
Bhorle - Jibjibe - Bogatitar. SitRep 15 lists it as operational, "providing alternative access
while the Trishuli-Betrawati highway section remains damaged", with maintenance continuing.
SitRep 14 recorded it as newly operational on 15 September. This is the shorter Nuwakot-side
approach and it bypasses Betrawati entirely. **Mode: vehicle, hill road. Source: SitRep 15;
SitRep 14.**

**3. Kalikasthan - Dhunche, light 4WD only** (`DH-1`, mapped from OSM, 21 km)
The final stretch of the Pasang Lhamu Highway is open but tightly restricted. OpenStreetMap ways
along this section (27033235, 344160419, 934778608, 934778609 and others) carry an explicit
advisory note:

> "Only small vehicles (4 x 4 jeeps) are allowed. Caution due to risk of landslides. Not advised
> to travel the route at night. Relief vehicles should register with the police in Kalikasthan
> before driving to Dhunche."

That matches the reporting: the Bogatitar - Kalikasthan - Dhunche section reopened to light
four-wheel drive only, and the Bidur - Dhunche road is limited to small 4WD vehicles.
**Mode: light 4WD only, daylight, with police registration at Kalikasthan. Source: OSM;
`data/reports.json` citing Kathmandu Post, 8 Sep.**

**4. Helicopter, which is how everything moves beyond Dhunche** (`DH-6`, `DH-7`)
Relief is trucked to Dhunche, then flown onward. 63 trucks and 38 utility vehicles were dispatched
from Kathmandu, but past Dhunche it is aviation only. SitRep 15 records **1,694 helicopter sorties**
in total. The bottleneck is flight slots rather than stock: ward chairman Mansing Tamang had waited
three days in Dhunche to fly 250 sacks of rice to Mailung, and ward chairs generally wait three to
four days. The Nepal Army also flies Chinese-supplied drones, which Sang Lama said are useful only
for small consignments and cannot supply entire villages. An emergency helipad at Uttargaya (OSM
node 3498339453) serves the Mailung area. **Mode: helicopter and drone. Source: KP 8 Sep;
SitRep 15; OSM.**

**5. Rope crossings** (`DH-8`, `DH-9`, `DH-10`)
SitRep 15: rope crossings **completed** at Devighat, Indreni Chaur and Syafrubesi; instructions
issued to expedite two more at **Hakubesi and Pahirebesi**. The Kathmandu Post on 8 September
listed three planned crossings: the Bhotekoshi between Syabrubesi and Chilime, the Runga Khola
linking Gosainkunda wards 5 and 1, and the Trishuli between Pahirebesi (Uttargaya-4) and
Shantibazar (Kispang-5, Nuwakot). Separately, repairs are underway on five suspension bridges with
preparations for another 15, targeting all 20 within Asoj. **Mode: rope crossing, foot and goods.
Source: SitRep 15; KP 8 Sep.**

**6. Onward road restoration** - the DoR plan is a 70 m Bailey bridge at Falakhu Khola to reach
Dhunche directly, then multiple Bailey bridges over the Bhotekoshi and Chilime to reach
Rasuwagadhi, targeting a temporary track by Dashain. Five 70 m Bailey bridges are available and
five 100 m bridges are needed; three bridges from India have arrived. China is working on the road
from its side toward Timure, and Nepal has asked for a Chinese temporary track between Rasuwagadhi
and Syabrubesi. A temporary Friendship Bridge at Rasuwagadhi is already mapped in OpenStreetMap
(ways 1552746552 and 1552746560, named 热索临时便桥 / रसुवागढीमा अस्थायी मितेरी पुल). **Source: KP 13 Sep; OSM.**

**7. Trekkers are being routed away from Dhunche entirely.** Commercial operators advise reaching
Gosaikunda on foot via Kathmandu - Dupcheshwor - Sisipu - Talu/Gyangphedi - Phedi - Suryakunda,
and exiting via Lauribina La to Helambu, with the standard Dhunche corridor to be avoided until
authorities confirm it is open. This is trekking-industry advice, not a government statement, and
should be treated as low-confidence. **Source: [Nepal Mother House Treks](https://nepalmotherhousetreks.com/blog/langtang-gosaikunda-trek-after-rasuwa-flood-alternative-route).**

### One local restriction worth noting

Ghattekholagaun in Gosaikunda is reported passable in daylight only, with a mandatory night
closure enforced. This comes from a community-run bulletin, not an official source.
**Source: `data/reports.json`, Rasuwa Flood Bulletin (unofficial), 9 Sep.**

---

## Unknowns and conflicting reports

**Scope: where the flood still bites**

South of Trisuli Bazar, road access has been restored and should not be presented as an access
problem. That covers the Galchhi - Devighat - Trishuli line, the Ratamate section, southern
Dhading and the route to Dhading district headquarters. The one live constraint in the south is
the Prithvi Highway at Krishnabhir, which is a separate landslide problem on the Mugling - Malekhu
section. The genuine severance runs north from Trisuli Bazar: the 800 m Bidur - Betrawati gap, the
Betrawati crossing, and the corridor beyond Dhunche where there is no road at all.

**Conflicts in the numbers**

- *Length of the Bidur - Betrawati gap.* SitRep 15 (16 Sep) says 9.2 km of 10 km clear with 0.8 km
  washed away. The Kathmandu Post (13 Sep) says 9.5 km opened with 500 m remaining. The earlier
  DoR inspection (31 Aug) said 4 km of the 10 km was completely washed away and 6 km usable. These
  are probably successive snapshots of repair progress rather than true contradictions, but the
  13 Sep figure being *better* than the 16 Sep figure is not explained.
- *Bridge totals.* Already flagged in `data/reports.json` and unresolved: NDRRMA reported 41
  motorable bridges washed away plus 4 damaged; OnlineKhabar counted at least 19 bridges and about
  40 km of road along the Trishuli; the DoR early estimate was 68 suspension and 33 driveable
  bridges damaged.
- *Which alternative is "the" Rasuwa route.* SitRep 15 names Dhikure - Jibjibe - Bogatitar.
  OnlineKhabar and the Ministry named the Tokha - Saramthali - Bogatitar route. Both appear to be
  in use and both converge at Bogatitar; no source ranks them by traffic volume.

**Resolved since the first draft of this note**

- *The Ratmate bypass.* Confirmed complete: SitRep 14 of 15 September says the hillside cutting at
  Ratamate is finished and traffic has resumed. An earlier draft recorded this as unconfirmed.
- *Whether Trisuli Bazar is cut off.* It is not. Galchhi - Devighat - Dhunge - Trishuli is clear
  and operational. An earlier draft of this note presented the right-bank detour as the way in,
  which overstated the severance south of Trisuli Bazar and in southern Dhading.

**Not established**

- Whether the Betrawati temporary footbridge was repaired after the overnight-rain damage recorded
  on 15 September. SitRep 15 simply stops mentioning it, which could mean repaired, still out, or
  dropped for brevity. This matters: it is the only fixed crossing at Betrawati.
- Whether the Falakhu Khola Bailey bridge has been installed. The ten-day window from 13 September
  had not closed as of 17 September, and no report confirms installation.
- Whether the Betrawati Bailey bridge has progressed past foundation excavation.
- The exact 800 m gap location on the Bidur - Betrawati road. No source gives a chainage or
  coordinates, so `BW-1` shows the whole corridor rather than the gap.
- Any organised **porter or mule** arrangement. Searches turned up none. Porters are implied by the
  30 m Betrawati footbridge and by relief moving to villages without roads, but no source describes
  a porter or mule system, so none is claimed here.
- Whether any **boat or ferry** crossing is in use. Nothing in the reports or in OSM
  (`amenity=ferry_terminal` returned nothing in the corridor). Rope crossings appear to be the only
  non-bridge river crossings.
- Passenger bus or public transport services on any of these routes. All sources describe relief
  and government movement; none describes restored public transport.

**Geolocation gaps**

Fourteen of the twenty features are `confidence: approximate`. The reason is that most of the
intermediate waypoints NDRRMA names are absent from both OpenStreetMap and Nominatim:
Bogatitar, Kalikasthan (the Rasuwa one, as distinct from the Kathmandu neighbourhood), Gauribesi,
Kolputar, Darshantar, Koshikhola, Kalleritar, Pimaltar, Falakhu Khola, Pahirebesi, Indreni Chaur,
Dhanswara, Saramthali, Patikharka and Gadkhar Bridge. For these routes the geometry shows the
corridor, not the alignment. **None of these geometries should be used for navigation.**

Note also that place names in this corridor are usually tagged in Devanagari in OpenStreetMap
(`name=बेत्रावती`, with English only in `name:en` or `alt_name`), which is why a naive `name` match
finds almost nothing. This is recorded in `tools/fetch_alt_routes_overpass.txt`.

**Inference flags.** Route geometry for `TB-1` and `BW-1` is traced from the Trishuli centreline
with a lateral offset; the offset direction is inferred from which bank the source describes, and
the magnitude is arbitrary. The rope-crossing points `TB-5` and `DH-8` are placed at the destroyed
bridges they replace, which is an inference; the ropes may be strung some distance away. `DH-10` is
placed from the Uttargaya-Kispang boundary on the Trishuli and could be several kilometres off.
