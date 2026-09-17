#!/usr/bin/env python3
"""Wards cut off from their usual routes by the destroyed bridges.

Network analysis of which wards of Rasuwa, Nuwakot and Dhading lost their road
connection to the places they normally drive to after the 26 Aug 2026 Bhote
Koshi / Trishuli flood took out the bridges.

Method
  1. Road graph.  The national HOT OSM roads export (work/roads_build/roads.gpkg,
     gitignored, 418 MB) is read with a spatial filter of Rasuwa + Nuwakot +
     Dhading + Kathmandu buffered by BUFFER_KM, so detours through the
     neighbouring districts and down the Prithvi Highway are available.  That
     export is a post-flood snapshot -- HOT mappers have already deleted the
     stretches the river took -- so the HOT flood-response corridor export
     (data/hdx/gpkg/hot_flood_npl/roads_osm/roads.gpkg) is unioned in for every
     way id the national file no longer carries.  Without it the Betrawati-
     Mailung gorge road is absent from the baseline too, no route ever used it,
     and every ward comes out unaffected.  Only vehicle-capable classes are kept
     (DRIVABLE); paths, footways and steps are dropped, because a ward reachable
     only on foot is cut off for relief trucks, ambulances and market traffic.
     Ways are split at every vertex they share with another way, giving a graph
     whose nodes are junctions and whose edges carry their ground length.
  2. Routing cost is length x CLASS_PENALTY, not raw metres.  On raw metres the
     solver strings together field tracks that happen to shortcut a gorge, the
     baseline route never touches the highway the flood destroyed, and the loss
     disappears.  Reported pre_km / post_km are the true ground length of the
     chosen route; severity is judged on the penalised cost, which can only grow
     when edges are removed.  A raw length that falls post-flood means traffic
     was pushed off the highway onto a shorter but far rougher hill road, and
     `notes` says so.
  3. Damage.  Five sources are unioned, all of them conservative -- "Damaged" is
     treated as impassable for vehicles, the assumption a relief planner would
     make, recorded in `notes`:
       hot_flood_npl_bridge_damage.geojson   58 ground-reported bridges,
                                             status Washed out / Damaged
       hot_flood_npl_corridor/bridges_osm    220 OSM bridges, status Destroyed
       derived/ems_road_grading.geojson      Copernicus EMS per-segment grades,
                                             Destroyed / Damaged
       derived/roads_in_flood_extent.geojson segments with status Destroyed
       the corridor export's own per-way `status`
     Ground reports are surveyed bridge sites, not OSM geometry: two thirds sit
     30-320 m off the centreline of the way that carries the deck, so a plain
     proximity rule silently drops them.  Each is instead snapped to the single
     best drivable edge within REPORT_SNAP_M -- bridge-tagged first, then higher
     road class, then nearest -- and that edge is severed.  This over-cuts where
     the winning edge is a long unsplit way, which removes more road than the
     bridge did but severs the network in the right place.  OSM bridges and EMS
     lines are matched by proximity (BRIDGE_MATCH_M, EMS_MATCH_M); flood-extent
     segments by OSM way id first, proximity second.  The 15 bridges a ground
     report calls Intact are protected from the proximity rules, so a standing
     bridge beside a washed-out one survives; an OSM "Standing" tag only means
     nobody recorded that bridge as gone, so it never protects anything.
  4. Baseline = the full graph.  Post-flood = the graph minus the cut edges.
     Dijkstra runs once per target over each graph, from the target outwards.
  5. Every ward gets the graph nodes inside its polygon that the baseline can
     reach; unreachable stubs are ignored, so an OSM fragment cannot make a ward
     look cut off.  pre / post are the median over those nodes, so one stray
     node cannot decide a ward.  A ward that loses every route for at least
     DISC_FRAC of its nodes counts as disconnected.  Targets are the three
     district headquarters and Kathmandu (Balaju); the worse of the two wins.

Severity (property `severity`)
  3  no route to its own district HQ or to Kathmandu after the flood
  2  a route exists but costs >= 2x more, or >= 30 km more
  1  1.25-2x more, or 10-30 km more
  0  essentially unchanged

Caveats
  OSM completeness decides everything here: a ward with no mapped drivable road
  falls back to the nearest network node and `notes` says so.  Ward boundaries
  are the 2018 set.  "Damaged" is read as impassable, so severity is an upper
  bound.  Temporary crossings, fords and airlifts are not modelled.

Inputs
  work/roads_build/roads.gpkg                             gitignored, see above
  data/hdx/gpkg/hot_flood_npl/roads_osm/roads.gpkg        gitignored, corridor
  data/admin/admin_ward.geojson, admin_district.geojson
  data/hdx/hot_flood_npl/hot_flood_npl_bridge_damage.geojson
  data/hdx/hot_flood_npl_corridor/bridges_osm.geojson
  data/hdx/derived/ems_road_grading.geojson
  data/hdx/derived/roads_in_flood_extent.geojson
Outputs
  data/hdx/derived/cutoff_wards.geojson   tracked, ward polygons + severity
  work/cutoff_wards/summary.csv           gitignored, one row per ward
  work/cutoff_wards/graph.pickle          gitignored, extraction cache (--rebuild)

Requires the GDAL Python bindings (osgeo).  Dijkstra is heapq, no networkx.
Run from anywhere:  python3 tools/build_cutoff_wards.py
"""
import csv
import heapq
import json
import math
import os
import pickle
import sys
from collections import defaultdict

from osgeo import ogr

ogr.UseExceptions()
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROADS_GPKG = os.path.join(ROOT, 'work/roads_build/roads.gpkg')
CORRIDOR_GPKG = os.path.join(ROOT, 'data/hdx/gpkg/hot_flood_npl/roads_osm/roads.gpkg')
WARDS = os.path.join(ROOT, 'data/admin/admin_ward.geojson')
DISTRICTS = os.path.join(ROOT, 'data/admin/admin_district.geojson')
REPORTS = os.path.join(ROOT, 'data/hdx/hot_flood_npl/hot_flood_npl_bridge_damage.geojson')
BRIDGES_OSM = os.path.join(ROOT, 'data/hdx/hot_flood_npl_corridor/bridges_osm.geojson')
EMS = os.path.join(ROOT, 'data/hdx/derived/ems_road_grading.geojson')
FLOODED = os.path.join(ROOT, 'data/hdx/derived/roads_in_flood_extent.geojson')
OUT = os.path.join(ROOT, 'data/hdx/derived/cutoff_wards.geojson')
WORK = os.path.join(ROOT, 'work/cutoff_wards')
CACHE = os.path.join(WORK, 'graph.pickle')
CSV_OUT = os.path.join(WORK, 'summary.csv')

DISTRICTS_OF_INTEREST = ('RASUWA', 'NUWAKOT', 'DHADING')
EXTRACT_DISTRICTS = ('Rasuwa', 'Nuwakot', 'Dhading', 'Kathmandu')
BUFFER_KM = 15.0
DRIVABLE = {
    'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
    'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified',
    'residential', 'living_street', 'road', 'service', 'track',
}
# Routing cost is length x a class penalty, so the solver prefers the road a
# driver would actually take.  Raw metres sends vehicles down field tracks that
# happen to shortcut a gorge, and the pre-flood route then never uses the
# highway the flood destroyed, which hides the loss.  Reported pre_km / post_km
# are the true ground length of the chosen route, not the penalised cost.
CLASS_PENALTY = {
    'motorway': 1.0, 'motorway_link': 1.0, 'trunk': 1.0, 'trunk_link': 1.0,
    'primary': 1.0, 'primary_link': 1.1, 'secondary': 1.15, 'secondary_link': 1.2,
    'tertiary': 1.4, 'tertiary_link': 1.5, 'unclassified': 2.2, 'residential': 2.2,
    'living_street': 2.5, 'road': 2.2, 'service': 3.0, 'track': 4.5,
}
SNAP = 5                  # decimal places, ~1.1 m at this latitude
BRIDGE_MATCH_M = 30.0     # OSM bridge geometry to graph edge
REPORT_SNAP_M = 350.0     # radius a ground-reported bridge is snapped within
BRIDGE_BONUS_M = 250.0    # a bridge-tagged edge wins by this much when snapping
CLASS_BONUS = {'trunk': 80.0, 'primary': 80.0, 'secondary': 60.0, 'tertiary': 50.0,
               'unclassified': 25.0, 'residential': 25.0, 'road': 25.0}
EMS_MATCH_M = 15.0        # EMS graded line to graph edge
SAMPLE_M = 10.0           # densify step when indexing damage and testing edges
DISC_FRAC = 0.5           # share of a ward's nodes that must lose the route
IMPASSABLE = {'washed out', 'damaged', 'destroyed'}
INTACT = {'intact', 'standing', 'no visible damage'}

# Targets: the three district headquarters / main markets, and Kathmandu.
# Kathmandu is Balaju, where the Trishuli road meets the ring road.
TARGETS = {
    'Dhunche (Rasuwa HQ)': (85.2967, 28.1119),
    'Bidur / Trisuli Bazar (Nuwakot HQ)': (85.1500, 27.9167),
    'Dhading Besi / Nilkantha (Dhading HQ)': (84.8986, 27.8681),
    'Kathmandu (Balaju)': (85.3033, 27.7361),
}
HQ_OF = {
    'RASUWA': 'Dhunche (Rasuwa HQ)',
    'NUWAKOT': 'Bidur / Trisuli Bazar (Nuwakot HQ)',
    'DHADING': 'Dhading Besi / Nilkantha (Dhading HQ)',
}
KTM = 'Kathmandu (Balaju)'

M_PER_DEG_LAT = 110574.0
LAT0 = 27.95
M_PER_DEG_LON = 111320.0 * math.cos(math.radians(LAT0))


def seg_m(a, b):
    dx = (b[0] - a[0]) * M_PER_DEG_LON
    dy = (b[1] - a[1]) * M_PER_DEG_LAT
    return math.hypot(dx, dy)


def line_m(pts):
    return sum(seg_m(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def snap(pt):
    return (round(pt[0], SNAP), round(pt[1], SNAP))


def densify(pts, step_m=SAMPLE_M):
    """Vertices plus extra points so no gap along the line exceeds step_m."""
    out = []
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        out.append(a)
        d = seg_m(a, b)
        n = int(d // step_m)
        for k in range(1, n + 1):
            t = k * step_m / d
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    out.append(pts[-1])
    return out


class Grid:
    """Point bucket index on a fixed degree cell, good enough at this scale."""

    def __init__(self, cell_m=100.0):
        self.cx = cell_m / M_PER_DEG_LON
        self.cy = cell_m / M_PER_DEG_LAT
        self.cells = defaultdict(list)

    def add(self, pt, payload):
        self.cells[(int(pt[0] // self.cx), int(pt[1] // self.cy))].append((pt, payload))

    def near_all(self, pt, radius_m):
        rx = int(radius_m / M_PER_DEG_LON // self.cx) + 1
        ry = int(radius_m / M_PER_DEG_LAT // self.cy) + 1
        i0, j0 = int(pt[0] // self.cx), int(pt[1] // self.cy)
        out = []
        for i in range(i0 - rx, i0 + rx + 1):
            for j in range(j0 - ry, j0 + ry + 1):
                for q, payload in self.cells.get((i, j), ()):
                    d = seg_m(pt, q)
                    if d <= radius_m:
                        out.append((d, payload))
        return out

    def near(self, pt, radius_m):
        got = self.near_all(pt, radius_m)
        return min(got, key=lambda x: x[0]) if got else None


def geom_coords(geom):
    """All linestrings of an OGR line or multiline geometry, as coord lists."""
    t = geom.GetGeometryType()
    if t in (ogr.wkbLineString, ogr.wkbLineString25D):
        return [[(p[0], p[1]) for p in geom.GetPoints()]]
    out = []
    for i in range(geom.GetGeometryCount()):
        out.extend(geom_coords(geom.GetGeometryRef(i)))
    return out


def json_lines(path):
    """(coords, properties) for every linestring in a GeoJSON file."""
    with open(path) as fh:
        data = json.load(fh)
    for ft in data['features']:
        g = ft.get('geometry') or {}
        if g.get('type') == 'LineString':
            yield g['coordinates'], ft['properties']
        elif g.get('type') == 'MultiLineString':
            for part in g['coordinates']:
                yield part, ft['properties']


def json_sites(path):
    """(sample points, properties) per feature, whatever the geometry type.

    The bridge layers mix single points with the line of the deck, so a
    feature is reduced to the points a graph edge can be measured against.
    """
    with open(path) as fh:
        data = json.load(fh)
    for ft in data['features']:
        g = ft.get('geometry') or {}
        t, c = g.get('type'), g.get('coordinates')
        if not c:
            continue
        if t == 'Point':
            pts = [tuple(c[:2])]
        elif t == 'MultiPoint':
            pts = [tuple(p[:2]) for p in c]
        elif t == 'LineString':
            pts = densify([tuple(p[:2]) for p in c])
        elif t == 'MultiLineString':
            pts = [q for part in c for q in densify([tuple(p[:2]) for p in part])]
        else:
            continue
        yield pts, ft['properties']


# ---------------------------------------------------------------- extraction
def region_geom():
    ds = ogr.Open(DISTRICTS)
    lyr = ds.GetLayer(0)
    union = None
    for ft in lyr:
        if ft.GetField('adm2_name') in EXTRACT_DISTRICTS:
            g = ft.GetGeometryRef().Clone()
            union = g if union is None else union.Union(g)
    if union is None:
        sys.exit('no districts matched %s in %s' % (EXTRACT_DISTRICTS, DISTRICTS))
    return union.Buffer(BUFFER_KM * 1000.0 / M_PER_DEG_LAT)


def read_ways(path, region, status_field=False, skip_ids=frozenset()):
    ds = ogr.Open(path)
    lyr = ds.GetLayer(0)
    if region is not None:
        lyr.SetSpatialFilter(region)
    ways = []
    for ft in lyr:
        hw = ft.GetField('highway')
        if hw not in DRIVABLE:
            continue
        wid = ft.GetField('id')
        if wid in skip_ids:
            continue
        g = ft.GetGeometryRef()
        if g is None:
            continue
        status = ft.GetField('status') if status_field else None
        for coords in geom_coords(g):
            if len(coords) >= 2:
                ways.append((coords, wid, ft.GetField('name'), hw,
                             ft.GetField('bridge'), status))
    return ways


def extract_ways():
    """Drivable ways of the baseline network, as (coords, id, name, highway, bridge, status).

    The national export is a post-flood snapshot: HOT mappers have already
    deleted or retagged the stretches the river took, so on its own it has no
    Betrawati-Mailung gorge road left to lose and every ward looks unaffected.
    The HOT flood-response corridor export still carries those ways, with a
    per-way `status`, so it is unioned in for any way id the national export no
    longer has.  That union is the pre-flood baseline.
    """
    if not os.path.exists(ROADS_GPKG):
        sys.exit('missing %s -- see work/roads_build/README.txt' % ROADS_GPKG)
    region = region_geom()
    ways = read_ways(ROADS_GPKG, region)
    have = {w[1] for w in ways}
    added = 0
    if os.path.exists(CORRIDOR_GPKG):
        extra = read_ways(CORRIDOR_GPKG, None, status_field=True, skip_ids=have)
        ways.extend(extra)
        added = len(extra)
    else:
        print('WARNING: %s missing, baseline will lack the washed-away roads'
              % CORRIDOR_GPKG)
    print('%d way parts from the national export, %d more only in the flood '
          'corridor export' % (len(ways) - added, added))
    return ways


def build_graph(ways):
    """Split ways at shared vertices; return nodes, edges, adjacency."""
    seen, shared = set(), set()
    for coords, *_ in ways:
        here = set()
        for pt in coords:
            s = snap(pt)
            if s in seen and s not in here:
                shared.add(s)
            here.add(s)
        seen |= here
        shared.add(snap(coords[0]))
        shared.add(snap(coords[-1]))

    node_id, nodes = {}, []

    def nid(s):
        if s not in node_id:
            node_id[s] = len(nodes)
            nodes.append(s)
        return node_id[s]

    edges = []      # (u, v, length_m, way_id, name, highway, bridge, coords, status)
    for coords, wid, name, hw, br, status in ways:
        run, start = [coords[0]], 0
        for k in range(1, len(coords)):
            run.append(coords[k])
            s = snap(coords[k])
            if s in shared or k == len(coords) - 1:
                u, v = nid(snap(coords[start])), nid(s)
                if u != v and len(run) >= 2:
                    edges.append([u, v, line_m(run), wid, name, hw, br, run, status])
                run, start = [coords[k]], k
    adj = defaultdict(list)
    for i, e in enumerate(edges):
        u, v, w, hw = e[0], e[1], e[2], e[5]
        cost = w * CLASS_PENALTY.get(hw, 2.2)
        adj[u].append((v, cost, w, i))
        adj[v].append((u, cost, w, i))
    return nodes, edges, adj


# ------------------------------------------------------------------- damage
def damage_cuts(edges):
    """Indices of edges made impassable, and a label for each cut."""
    cut_pts = Grid()      # damage that cuts an edge it passes close to
    safe_pts = Grid()     # explicitly intact structures, protected from cuts
    reports = []          # ground-reported bridges, snapped to one edge each
    n_src = defaultdict(int)

    for pts, props in json_sites(REPORTS):
        st = (props.get('status') or '').strip().lower()
        label = props.get('name') or props.get('location') or 'bridge report'
        if st in INTACT:
            for pt in pts:
                safe_pts.add(pt, label)
        elif st in IMPASSABLE:
            reports.append((pts, label))
            n_src['bridge_damage'] += 1

    for pts, props in json_sites(BRIDGES_OSM):
        st = (props.get('status') or '').strip().lower()
        label = props.get('name_en') or props.get('name') or props.get('name_latin')
        named = bool(label)
        label = label or 'unnamed bridge (%s)' % (props.get('id') or 'OSM')
        if st in IMPASSABLE:
            for pt in pts:
                cut_pts.add(pt, (label, BRIDGE_MATCH_M, 'OSM bridge', 2 if named else 1))
            n_src['bridges_osm'] += 1
        # "Standing" here only means nobody recorded this OSM bridge as gone, so
        # it is not evidence against an EMS grade and never protects an edge.

    ems_lines = 0
    for coords, props in json_lines(EMS):
        if (props.get('grade') or '').strip().lower() not in IMPASSABLE:
            continue
        is_bridge = (props.get('kind') or '') == 'bridge'
        label = props.get('name') or ('bridge at %s' % props.get('locality') if is_bridge
                                      else 'road at %s' % (props.get('locality') or 'EMS AOI'))
        kind = 'EMS %s' % (props.get('kind') or 'road')
        rank = 2 if (props.get('name') and is_bridge) else 1
        for pt in densify([tuple(c[:2]) for c in coords]):
            cut_pts.add(pt, (label, EMS_MATCH_M, kind, rank))
        ems_lines += 1
    n_src['ems'] = ems_lines

    flooded_ids, flooded_lines = {}, 0
    for coords, props in json_lines(FLOODED):
        if (props.get('status') or '').strip().lower() not in IMPASSABLE:
            continue
        named = props.get('report_name') or (props.get('bridge') and
                                             (props.get('name_en') or props.get('name')))
        label = named or props.get('name_en') or props.get('name') or 'road in the flood extent'
        rank = 2 if named else 1
        if props.get('id'):
            flooded_ids[props['id']] = (label, rank)
        for pt in densify([tuple(c[:2]) for c in coords]):
            cut_pts.add(pt, (label, EMS_MATCH_M, 'in flood extent', rank))
        flooded_lines += 1
    n_src['flood_extent'] = flooded_lines
    n_src['corridor_status'] = 0

    cuts = {}
    n_status = 0
    for i, (u, v, w, wid, name, hw, br, coords, status) in enumerate(edges):
        if (status or '').strip().lower() in IMPASSABLE:
            cuts[i] = (name or 'road washed away', 'HOT corridor status')
            n_status += 1
            continue
        if wid and wid in flooded_ids:
            label, rank = flooded_ids[wid]
            cuts[i] = (label, 'in flood extent')
            continue
        # best hit: a named structure beats an unnamed one, then the closer one
        hit = None
        for pt in densify(coords):
            for dist, (label, radius, kind, rank) in cut_pts.near_all(pt, BRIDGE_MATCH_M):
                if dist > radius:
                    continue            # EMS lines must be matched much tighter
                key = (rank, -dist)
                if hit is None or key > hit[0]:
                    hit = (key, dist, label, kind)
        if hit is None:
            continue
        # an explicitly intact structure closer than the damage keeps the edge
        mid = coords[len(coords) // 2]
        ok = safe_pts.near(mid, BRIDGE_MATCH_M)
        if ok is not None and ok[0] < hit[1]:
            continue
        cuts[i] = (hit[2], hit[3])

    # Ground reports are surveyed bridge sites, not OSM geometry: two thirds of
    # them sit 30-320 m off the centreline of the way that carries the deck, so
    # a plain proximity rule misses them.  Each report is instead snapped to the
    # single best drivable edge within REPORT_SNAP_M -- a bridge-tagged edge,
    # then a higher road class, then the closer one -- and that edge is severed.
    edge_pts = Grid()
    for i, e in enumerate(edges):
        for pt in densify(e[7]):
            edge_pts.add(pt, i)
    unmatched = []
    for pts, label in reports:
        cand = {}
        for pt in pts:
            for d, i in edge_pts.near_all(pt, REPORT_SNAP_M):
                if i not in cand or d < cand[i]:
                    cand[i] = d
        if not cand:
            unmatched.append(label)
            continue
        best = min(cand, key=lambda i: (cand[i] - (BRIDGE_BONUS_M if edges[i][6] else 0.0)
                                        - CLASS_BONUS.get(edges[i][5], 0.0)))
        cuts[best] = (label, 'ground report')
    if unmatched:
        print('%d ground reports had no drivable road within %d m: %s'
              % (len(unmatched), REPORT_SNAP_M, '; '.join(unmatched)))
    n_src['corridor_status'] = n_status
    print('damage sources: %s -> %d edges cut' % (dict(n_src), len(cuts)))
    return cuts


# ----------------------------------------------------------------- dijkstra
def dijkstra(adj, source, n_nodes, blocked=frozenset()):
    """Least-cost tree from source.

    Returns, per node, the class-penalised cost and the true ground length of
    the least-cost route, plus (prev_node, prev_edge) pointers.  Severity is
    judged on the cost, which can only grow when edges are removed; the raw
    length can fall, because a severed highway can push traffic onto a shorter
    but far rougher hill road, and that is a worse journey, not a better one.
    """
    INF = float('inf')
    cost = [INF] * n_nodes
    length = [INF] * n_nodes
    prev = [(-1, -1)] * n_nodes
    cost[source] = 0.0
    length[source] = 0.0
    pq = [(0.0, source)]
    while pq:
        c, u = heapq.heappop(pq)
        if c > cost[u]:
            continue
        for v, ec, ew, ei in adj[u]:
            if ei in blocked:
                continue
            nc = c + ec
            if nc < cost[v]:
                cost[v] = nc
                length[v] = length[u] + ew
                prev[v] = (u, ei)
                heapq.heappush(pq, (nc, v))
    return cost, length, prev


def main_component(adj, n_nodes):
    """Node ids of the largest connected component of the baseline graph.

    OSM leaves a long tail of stubs that touch nothing; a target or a ward
    snapped onto one of those would look cut off before the flood.
    """
    seen = [False] * n_nodes
    best = []
    for s in range(n_nodes):
        if seen[s]:
            continue
        comp, stack = [], [s]
        seen[s] = True
        while stack:
            u = stack.pop()
            comp.append(u)
            for v, _c, _w, _e in adj[u]:
                if not seen[v]:
                    seen[v] = True
                    stack.append(v)
        if len(comp) > len(best):
            best = comp
    return best


def nearest_node(grid, pt, max_m=20000.0):
    got = grid.near(pt, max_m)
    return None if got is None else got[1]


# --------------------------------------------------------------------- main
def severity_for(pre, post):
    """(severity, ratio) for one target from pre/post class-penalised cost."""
    if pre is None or not math.isfinite(pre) or pre <= 0:
        return 0, None
    if not math.isfinite(post):
        return 3, float('inf')
    ratio = post / pre
    gain_km = (post - pre) / 1000.0
    if ratio >= 2.0 or gain_km >= 30.0:
        return 2, ratio
    if ratio >= 1.25 or gain_km >= 10.0:
        return 1, ratio
    return 0, ratio


def main():
    os.makedirs(WORK, exist_ok=True)
    rebuild = '--rebuild' in sys.argv
    if os.path.exists(CACHE) and not rebuild:
        print('reading cached graph %s' % CACHE)
        with open(CACHE, 'rb') as fh:
            nodes, edges, adj = pickle.load(fh)
    else:
        print('extracting drivable ways from %s ...' % os.path.basename(ROADS_GPKG))
        ways = extract_ways()
        print('%d drivable way parts in the region' % len(ways))
        nodes, edges, adj = build_graph(ways)
        with open(CACHE, 'wb') as fh:
            pickle.dump((nodes, edges, adj), fh, protocol=4)
    print('graph: %d nodes, %d edges' % (len(nodes), len(edges)))

    cuts = damage_cuts(edges)
    blocked = frozenset(cuts)
    cut_km = sum(edges[i][2] for i in cuts) / 1000.0
    print('%.1f km of drivable road removed post-flood' % cut_km)

    main = main_component(adj, len(nodes))
    print('largest connected component: %d of %d nodes' % (len(main), len(nodes)))
    node_grid = Grid()
    for i in main:
        node_grid.add(nodes[i], i)

    # Dijkstra from each target, before and after
    runs = {}
    for name, pt in TARGETS.items():
        src = nearest_node(node_grid, pt)
        if src is None:
            sys.exit('no road node within 20 km of target %s' % name)
        off = seg_m(pt, nodes[src])
        pre_c, pre_l, pre_p = dijkstra(adj, src, len(nodes))
        post_c, post_l, _ = dijkstra(adj, src, len(nodes), blocked)
        reach = sum(1 for d in pre_c if math.isfinite(d))
        runs[name] = (pre_c, pre_l, pre_p, post_c, post_l)
        print('target %-38s node %d (%.0f m off), %d nodes reachable pre' %
              (name, src, off, reach))

    # ward -> node ids inside the polygon
    ds = ogr.Open(WARDS)
    lyr = ds.GetLayer(0)
    wards = []
    for ft in lyr:
        if ft.GetField('DISTRICT') not in DISTRICTS_OF_INTEREST:
            continue
        geom = ft.GetGeometryRef().Clone()
        props = {k: ft.GetField(k) for k in
                 ('DISTRICT', 'GaPa_NaPa', 'NEW_WARD_N', 'WardCode', 'flood_affected')}
        # 6 decimals is ~11 cm here; the default 15 significant digits would
        # triple the file for nothing, on geometry that is already simplified.
        wards.append((props, geom,
                      json.loads(geom.ExportToJson(options=['COORDINATE_PRECISION=6']))))
    print('%d wards in %s' % (len(wards), ', '.join(DISTRICTS_OF_INTEREST)))

    ward_nodes = {}
    for props, geom, _gj in wards:
        env = geom.GetEnvelope()          # minx maxx miny maxy
        inside = []
        pt_geom = ogr.Geometry(ogr.wkbPoint)
        for i, (x, y) in enumerate(nodes):
            if env[0] <= x <= env[1] and env[2] <= y <= env[3]:
                pt_geom.SetPoint_2D(0, x, y)
                if geom.Contains(pt_geom):
                    inside.append(i)
        ward_nodes[props['WardCode']] = inside

    features, rows = [], []
    for props, geom, gj in wards:
        code = props['WardCode']
        inside = ward_nodes[code]
        centroid = geom.Centroid()
        cpt = (centroid.GetX(), centroid.GetY())
        worst = None
        per_target = {}
        for tname in (HQ_OF[props['DISTRICT']], KTM):
            pre_c, pre_l, pre_p, post_c, post_l = runs[tname]
            pool = [i for i in inside if math.isfinite(pre_c[i])]
            fallback = False
            if not pool:
                near = nearest_node(node_grid, cpt, 30000.0)
                if near is not None and math.isfinite(pre_c[near]):
                    pool, fallback = [near], True
            if not pool:
                per_target[tname] = None
                continue
            mid = len(pool) // 2
            n_disc = sum(1 for i in pool if not math.isfinite(post_c[i]))
            frac = n_disc / len(pool)
            cut_off = frac >= DISC_FRAC
            pre = sorted(pre_c[i] for i in pool)[mid]
            post = float('inf') if cut_off else sorted(post_c[i] for i in pool)[mid]
            pre_km = sorted(pre_l[i] for i in pool)[mid] / 1000.0
            post_km = (None if cut_off
                       else sorted(post_l[i] for i in pool)[mid] / 1000.0)
            sev, ratio = severity_for(pre, post)
            per_target[tname] = dict(pre=pre, post=post, sev=sev, ratio=ratio,
                                     pre_km=pre_km, post_km=post_km,
                                     frac_disc=frac, n=len(pool),
                                     fallback=fallback, target=tname)
            if worst is None or (sev, ratio if ratio is not None else 0) > \
                    (worst['sev'], worst['ratio'] if worst['ratio'] is not None else 0):
                worst = per_target[tname]

        if worst is None:
            out = dict(severity=0, detour_ratio=None, pre_km=None, post_km=None,
                       target=None, lost_bridges='', notes='no road node reachable '
                       'in the baseline network; OSM coverage gap, not a flood effect')
        else:
            tname = worst['target']
            pre_c, pre_l, pre_p, post_c, post_l = runs[tname]
            # bridges lost on the baseline route of the ward's central node
            rep = None
            best = None
            for i in (n for n in inside if math.isfinite(pre_c[n])):
                d = seg_m(cpt, nodes[i])
                if best is None or d < best:
                    best, rep = d, i
            if rep is None:
                rep = nearest_node(node_grid, cpt, 30000.0)
            lost, seen_lost = [], set()
            node = rep
            guard = 0
            while node is not None and node >= 0 and guard < 200000:
                u, ei = pre_p[node]
                if ei < 0:
                    break
                if ei in cuts:
                    label = cuts[ei][0]
                    if label and label not in seen_lost:
                        seen_lost.add(label)
                        lost.append(label)
                node = u
                guard += 1
            note = ('%d graph nodes in ward; %.0f%% of them lose every route post-flood'
                    % (worst['n'], worst['frac_disc'] * 100))
            if worst['fallback']:
                note += '; no road node inside the ward, nearest network node used'
            if (worst['post_km'] is not None and worst['sev'] > 0
                    and worst['post_km'] < worst['pre_km']):
                note += ('; the detour is shorter on the ground but leaves the '
                         'highway for district and village roads')
            out = dict(
                severity=worst['sev'],
                detour_ratio=(None if worst['ratio'] is None or not math.isfinite(worst['ratio'])
                              else round(worst['ratio'], 2)),
                pre_km=round(worst['pre_km'], 1),
                post_km=(None if worst['post_km'] is None
                         else round(worst['post_km'], 1)),
                target=tname,
                lost_bridges=', '.join(lost[:6]),
                notes=note,
            )

        p = dict(props)
        p.update(out)
        for tname, res in per_target.items():
            key = 'hq' if tname != KTM else 'ktm'
            if res is None:
                p['%s_severity' % key] = None
            else:
                p['%s_severity' % key] = res['sev']
                p['%s_pre_km' % key] = round(res['pre_km'], 1)
                p['%s_post_km' % key] = (None if res['post_km'] is None
                                         else round(res['post_km'], 1))
        features.append({'type': 'Feature', 'properties': p, 'geometry': gj})
        rows.append(p)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as fh:
        json.dump({'type': 'FeatureCollection', 'name': 'cutoff_wards',
                   'description': 'wards of Rasuwa, Nuwakot and Dhading by loss of road '
                                  'access to their district HQ and Kathmandu after the '
                                  '26 Aug 2026 flood destroyed the Trishuli / Bhote Koshi '
                                  'bridges',
                   'features': features}, fh, separators=(',', ':'))

    cols = ['DISTRICT', 'GaPa_NaPa', 'NEW_WARD_N', 'WardCode', 'severity', 'detour_ratio',
            'pre_km', 'post_km', 'target', 'hq_severity', 'hq_pre_km', 'hq_post_km',
            'ktm_severity', 'ktm_pre_km', 'ktm_post_km', 'flood_affected',
            'lost_bridges', 'notes']
    with open(CSV_OUT, 'w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction='ignore')
        w.writeheader()
        for r in sorted(rows, key=lambda r: (-r['severity'], r['DISTRICT'],
                                             r['GaPa_NaPa'], r['NEW_WARD_N'])):
            w.writerow(r)

    counts = defaultdict(int)
    for r in rows:
        counts[r['severity']] += 1
    print('\nseverity counts: ' + ', '.join('%d -> %d wards' % (s, counts[s])
                                            for s in sorted(counts, reverse=True)))
    for sev in (3, 2):
        print('\n--- severity %d ---' % sev)
        by_mun = defaultdict(list)
        for r in rows:
            if r['severity'] == sev:
                by_mun[(r['DISTRICT'], r['GaPa_NaPa'])].append(r)
        for (dist, mun), rs in sorted(by_mun.items()):
            nums = ', '.join(str(r['NEW_WARD_N']) for r in sorted(rs, key=lambda r: r['NEW_WARD_N']))
            lost = next((r['lost_bridges'] for r in rs if r['lost_bridges']), '')
            print('%-9s %-22s wards %-24s %s' % (dist.title(), mun, nums, lost[:70]))
    print('\nwrote %s (%.0f KB) and %s' % (OUT, os.path.getsize(OUT) / 1e3, CSV_OUT))


if __name__ == '__main__':
    main()
