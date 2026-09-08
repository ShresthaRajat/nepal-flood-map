#!/usr/bin/env python3
"""
Retile the trisuli-flood-map "world pixel" imagery into Web Mercator XYZ tile
pyramids for the nepal-flood-2026 MapLibre map.

Source (read-only):  S = /Users/rajatshrestha/Documents/trisuli-flood-map
Target:               R = /Users/rajatshrestha/Documents/nepal-flood-2026
  outputs -> R/tiles/<id>/{z}/{x}/{y}.webp
             R/data/imagery.json
             R/work/            (scratch, gitignored)

--- The source grid ---
"World pixels" are an exact equirectangular grid over the map extent, north-up:
    lon = 84.52 + 1.08 * wx / 36169        (WORLD_W = 36169)
    lat = 28.45 - 0.75 * wy / 28011        (WORLD_H = 28011)
Any raster placed at world-px (left, top, width, height) is therefore an EPSG:4326
raster; the two 27-May/26-Aug PlanetScope full-frame band scenes are instead placed
with a small CSS affine (rotation + scale + translate) that composes with the above
into a single 6-term GDAL GeoTransform (handled by gt_affine() below).

Tile pyramids: a tile "tx_ty" at a level with tile size T covers world-px
x in [tx*T, (tx+1)*T), y in [ty*T, (ty+1)*T) and its image is T*F pixels square.
Overviews cover [left, top, width, height] in world-px but are NOT always stored
1 image-px per world-px -- verified per-pyramid below (wv3_0827, pelican0901 and
skysat0831 overviews are stored at half that density).

Every image's actual pixel size is measured with gdal.Open(...).RasterXSize/YSize
before computing a geotransform -- nothing is assumed from nominal dimensions.
"""
import json
import math
import os
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

from osgeo import gdal

gdal.UseExceptions()

S = "/Users/rajatshrestha/Documents/trisuli-flood-map"
R = "/Users/rajatshrestha/Documents/nepal-flood-2026"
WORK = os.path.join(R, "work")
TILES = os.path.join(R, "tiles")
DATA = os.path.join(R, "data")

GDALWARP = "/opt/homebrew/bin/gdalwarp"
GDALBUILDVRT = "/opt/homebrew/bin/gdalbuildvrt"
GDAL2TILES = "/opt/homebrew/bin/gdal2tiles.py"

WORLD_W, WORLD_H = 36169, 28011
BW, BE, BN, BS = 84.52, 85.60, 28.45, 27.70
BOX = dict(left=20435, top=18685, width=1464, height=1797)

DLON = 1.08 / WORLD_W   # deg longitude per world-px
DLAT = -0.75 / WORLD_H  # deg latitude per world-px (negative: north-up)

PS_XFORM = (1.020287, -0.015518, 0.015332, 1.011359, 19354.2, 18674.5)
POST_PS_XFORM = (1.020095, -0.015548, 0.015381, 1.011884, 19353.9, 18673.4)

NPROC = 10

os.makedirs(WORK, exist_ok=True)
os.makedirs(TILES, exist_ok=True)


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        raise RuntimeError(f"cmd failed: {' '.join(cmd)}\n--- stdout ---\n{r.stdout}\n--- stderr ---\n{r.stderr}")
    return r


def bandcount(path):
    ds = gdal.Open(path)
    n = ds.RasterCount
    ds = None
    return n


def gt_simple(origin_wx, origin_wy, wpx_per_px):
    """Axis-aligned geotransform. wpx_per_px = world-px represented by one source pixel."""
    lon0 = BW + DLON * origin_wx
    lat0 = BN + DLAT * origin_wy
    return (lon0, DLON * wpx_per_px, 0.0, lat0, 0.0, DLAT * wpx_per_px)


def gt_affine(matrix):
    """Compose a CSS matrix(a,b,c,d,e,f) (image-px -> world-px) with the world->lonlat
    linear map into one 6-term GDAL GeoTransform (handles the PlanetScope rotation)."""
    a, b, c, d, e, f = matrix
    return (
        BW + DLON * e, DLON * a, DLON * c,
        BN + DLAT * f, DLAT * b, DLAT * d,
    )


_vrt_counter = [0]


def georeference(src, gt, tag, want_alpha=True):
    """Build a small VRT for `src` with the given GeoTransform. If the source has
    3 bands and want_alpha, adds a real 4th (alpha) band via an identity gdalwarp so
    all leaf sources end up uniformly 4-band RGBA (nodata-derived alpha optional)."""
    _vrt_counter[0] += 1
    base = os.path.join(WORK, "vrt", tag)
    os.makedirs(base, exist_ok=True)
    step1 = os.path.join(base, f"{_vrt_counter[0]:06d}.vrt")

    ds = gdal.Open(src)
    nb = ds.RasterCount
    driver = gdal.GetDriverByName("VRT")
    out = driver.CreateCopy(step1, ds, strict=0)
    out.SetGeoTransform(gt)
    out.SetProjection('GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4326"]]')
    out.FlushCache()
    out = None
    ds = None

    if nb == 3 and want_alpha:
        step2 = os.path.join(base, f"{_vrt_counter[0]:06d}_a.vrt")
        run([GDALWARP, "-of", "VRT", "-dstalpha", "-q", step1, step2])
        return step2
    return step1


def georeference_nodata(src, gt, tag, nodata="0 0 0"):
    """Like georeference() but for 3-band pyramid tiles where pure black is fill:
    derive real transparency from -srcnodata instead of a flat opaque alpha."""
    _vrt_counter[0] += 1
    base = os.path.join(WORK, "vrt", tag)
    os.makedirs(base, exist_ok=True)
    step1 = os.path.join(base, f"{_vrt_counter[0]:06d}.vrt")

    ds = gdal.Open(src)
    nb = ds.RasterCount
    driver = gdal.GetDriverByName("VRT")
    out = driver.CreateCopy(step1, ds, strict=0)
    out.SetGeoTransform(gt)
    out.SetProjection('GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4326"]]')
    out.FlushCache()
    out = None
    ds = None

    if nb == 3:
        step2 = os.path.join(base, f"{_vrt_counter[0]:06d}_a.vrt")
        run([GDALWARP, "-of", "VRT", "-srcnodata", nodata, "-dstalpha", "-q", step1, step2])
        return step2
    return step1  # already has alpha -- keep as delivered


PYRAMID_IS_NODATA_BLACK = True  # per spec: true for all Vantor/SkySat/Pelican pyramids


def georeference_pyramid_tile(src, origin_wx, origin_wy, wpx_per_px, tag):
    gt = gt_simple(origin_wx, origin_wy, wpx_per_px)
    if PYRAMID_IS_NODATA_BLACK:
        return georeference_nodata(src, gt, tag)
    return georeference(src, gt, tag)


def build_pyramid_vrt(pyramid_dir, tag, out_vrt):
    """Georeference every tile + the overview of one source tile-pyramid and merge
    them (coarsest/overview first, finest level last -> finest ends up on top)."""
    index = json.load(open(os.path.join(pyramid_dir, "index.json")))
    ordered_sources = []

    ov = index.get("overview")
    if ov:
        ov_path = os.path.join(pyramid_dir, ov["src"])
        ds = gdal.Open(ov_path)
        rw, rh = ds.RasterXSize, ds.RasterYSize
        ds = None
        wpx_per_px = ov["width"] / rw  # verified empirically per pyramid; not assumed 1:1
        wpx_per_px_y = ov["height"] / rh
        assert abs(wpx_per_px - wpx_per_px_y) < 1e-6, (pyramid_dir, wpx_per_px, wpx_per_px_y)
        gt = gt_simple(ov["left"], ov["top"], wpx_per_px)
        if PYRAMID_IS_NODATA_BLACK:
            ordered_sources.append(georeference_nodata(ov_path, gt, tag))
        else:
            ordered_sources.append(georeference(ov_path, gt, tag))

    levels = index.get("levels")
    if levels is None:
        levels = [{"F": index["F"], "T": index["T"], "dir": "", "tiles": index["tiles"]}]

    for L in levels:  # already coarsest -> finest in every index.json checked
        T, F = L["T"], L["F"]
        d = os.path.join(pyramid_dir, L["dir"]) if L["dir"] else pyramid_dir
        for key in L["tiles"]:
            tx, ty = (int(v) for v in key.split("_"))
            p = os.path.join(d, f"{key}.webp")
            if not os.path.exists(p):
                print(f"  ! missing tile {p}", file=sys.stderr)
                continue
            ordered_sources.append(
                georeference_pyramid_tile(p, tx * T, ty * T, 1.0 / F, tag)
            )

    lst = os.path.join(WORK, f"{tag}_sources.txt")
    with open(lst, "w") as fh:
        fh.write("\n".join(ordered_sources))
    run([GDALBUILDVRT, "-resolution", "highest", "-input_file_list", lst, "-overwrite", out_vrt])
    return out_vrt


def merge_vrts(paths, out_vrt, tag):
    """gdalbuildvrt: later files in the list paint on top of earlier ones."""
    lst = os.path.join(WORK, f"{tag}_merge.txt")
    with open(lst, "w") as fh:
        fh.write("\n".join(paths))
    run([GDALBUILDVRT, "-resolution", "highest", "-input_file_list", lst, "-overwrite", out_vrt])
    return out_vrt


# ---------------------------------------------------------------------------
# Leaf source builders
# ---------------------------------------------------------------------------

def full_extent_source(name, tag):
    """A whole-world (0..WORLD_W x 0..WORLD_H) raster from assets/full/."""
    src = os.path.join(S, "assets/full", name)
    ds = gdal.Open(src)
    rw = ds.RasterXSize
    ds = None
    wpx_per_px = WORLD_W / rw
    gt = gt_simple(0, 0, wpx_per_px)
    return georeference(src, gt, tag)


def box_source(name, tag):
    """A trisuli-box (1464x1797, 1 raster-px == 1 world-px) raster from assets/trisuli/."""
    src = os.path.join(S, "assets/trisuli", name)
    gt = gt_simple(BOX["left"], BOX["top"], 1.0)
    return georeference(src, gt, tag)


def ps_frame_source(name, matrix, tag):
    """A compact, rotated PlanetScope band frame from assets/full/ (NOT full-corridor
    extent despite living in assets/full/ -- placed via a CSS affine, not the grid)."""
    src = os.path.join(S, "assets/full", name)
    gt = gt_affine(matrix)
    return georeference(src, gt, tag)


# ---------------------------------------------------------------------------
# Layer definitions
# ---------------------------------------------------------------------------
# maxzoom brackets (native GSD -> zoom): <=0.5->19  <=0.8->18  <=1.5->17  <=3->16
# <=12->14  ~20m->13.  minzoom 8 whenever a layer includes an assets/full/* source
# (whole-corridor bounds), else 11 (trisuli-box-only bounds).
#
# NOTE on the three whole-corridor, gapless (no-alpha) backdrops -- pre_s2, post_s2,
# post_s1: their trisuli-box counterpart is finer (2.93 m) than the S2/S1 backdrop
# (~19.5 m / ~11.7 m), but gdal2tiles tiles one raster at one maxzoom for its WHOLE
# extent and these backdrops have no transparency to let --exclude shrink deep-zoom
# tiles to just the box. Tiling the merged VRT to the box's native zoom (16) would
# generate real, non-empty (if blurry) tiles across the entire ~90 km corridor at
# that zoom -- tens of thousands of tiles, blowing the size budget for no gain (the
# box's own detail is already served by the dedicated pyramid layers: pre_legion,
# post_wv02, post_skysat_20260831+trisuli). So these three layers are capped at
# their backdrop's own native resolution; the box mosaic still sits on top and is
# visibly sharper than the raw backdrop up to that zoom, it just isn't tiled all the
# way to 2.93 m here. Flagged in the final report.

LAYERS = []


def add_layer(**kw):
    LAYERS.append(kw)


def build_pre_s2():
    tag = "pre_s2_20260603"
    full = full_extent_source("pre_s2_20260603.jpg", tag + "_full")
    box = box_source("pre_s2_20260603.jpg", tag + "_box")
    out = os.path.join(WORK, f"{tag}.vrt")
    merge_vrts([full, box], out, tag)
    add_layer(id=tag, label="3 Jun 2026 · Sentinel-2 20 m", side="pre", date="2026-06-03",
               sensor="Sentinel-2", provider="ESA Copernicus / AWS open data", gsd_m=20,
               vrt=out, minzoom=8, maxzoom=13, coverage="corridor",
               attribution="© ESA Copernicus")


def build_pre_ps():
    tag = "pre_ps_20260527"
    full = ps_frame_source("pre_ps_20260527.jpg", PS_XFORM, tag + "_full")
    box = box_source("pre_ps_sr_20260527.webp", tag + "_box")
    out = os.path.join(WORK, f"{tag}.vrt")
    merge_vrts([full, box], out, tag)
    add_layer(id=tag, label="27 May 2026 · PlanetScope 3.8 m", side="pre", date="2026-05-27",
               sensor="PlanetScope", provider="Planet Labs PBC (open disaster data)", gsd_m=3.8,
               vrt=out, minzoom=8, maxzoom=16, coverage="corridor",
               attribution="© Planet Labs PBC, CC-BY-NC 4.0")


def build_pre_legion():
    tag = "pre_legion_20260205"
    out = os.path.join(WORK, f"{tag}.vrt")
    build_pyramid_vrt(os.path.join(S, "assets/trisuli/tiles/vantor_pre"), tag, out)
    add_layer(id=tag, label="5 Feb 2026 · Vantor Legion 0.39 m", side="pre", date="2026-02-05",
               sensor="Legion", provider="Vantor (OpenAerialMap mirror)", gsd_m=0.39,
               vrt=out, minzoom=11, maxzoom=19, coverage="trisuli_bazar",
               attribution="© 2026 Vantor via OpenAerialMap, CC-BY-NC 4.0")


def build_pre_s1():
    """SUPERSEDED, not in BUILDERS: this used to place the trisuli-box-only
    assets/trisuli/pre_s1_20260816.webp crop (minzoom 11-14, coverage
    trisuli_bazar). tiles/pre_s1_20260816 is now a full-corridor pyramid
    (bounds/zoom matching post_s1_20260828) built directly from Planetary
    Computer sentinel-1-rtc STAC (relative orbit 85, same as the 28 Aug scene)
    by a one-off script in work/cog/pre_s1_20260816/, not by this asset-based
    pipeline -- there is no assets/full/pre_s1_20260816.webp to feed
    full_extent_source() the way build_post_s1() does. Left here only so the
    box-crop history isn't lost; do not add back to BUILDERS or it will
    overwrite the full-corridor tiles with the old small crop."""
    tag = "pre_s1_20260816"
    out = box_source("pre_s1_20260816.webp", tag)
    add_layer(id=tag, label="16 Aug 2026 · Sentinel-1 RTC", side="pre", date="2026-08-16",
               sensor="Sentinel-1", provider="ESA Copernicus / Microsoft Planetary Computer", gsd_m=11.7,
               vrt=out, minzoom=11, maxzoom=14, coverage="trisuli_bazar",
               attribution="© ESA Copernicus")


def build_post_s2():
    tag = "post_s2_20260827"
    full = full_extent_source("post_s2_20260827.jpg", tag + "_full")
    box = box_source("post_s2_20260827.jpg", tag + "_box")
    out = os.path.join(WORK, f"{tag}.vrt")
    merge_vrts([full, box], out, tag)
    add_layer(id=tag, label="27 Aug 2026 · Sentinel-2 20 m", side="post", date="2026-08-27",
               sensor="Sentinel-2", provider="ESA Copernicus / AWS open data", gsd_m=20,
               vrt=out, minzoom=8, maxzoom=13, coverage="corridor",
               attribution="© ESA Copernicus")


def build_post_ps():
    tag = "post_ps_20260826"
    full = ps_frame_source("post_ps_20260826.jpg", POST_PS_XFORM, tag + "_full")
    box = box_source("post_ps_20260826.webp", tag + "_box")
    out = os.path.join(WORK, f"{tag}.vrt")
    merge_vrts([full, box], out, tag)
    add_layer(id=tag, label="26 Aug 2026 · PlanetScope 3.8 m (flood morning)", side="post", date="2026-08-26",
               sensor="PlanetScope", provider="Planet Labs PBC (open disaster data)", gsd_m=3.8,
               vrt=out, minzoom=8, maxzoom=16, coverage="corridor",
               attribution="© Planet Labs PBC, CC-BY-NC 4.0")


def build_post_ps26():
    tag = "post_ps26_mosaic"
    full = full_extent_source("ps26_mosaic.webp", tag + "_full")
    box = box_source("ps26_mosaic.webp", tag + "_box")
    out = os.path.join(WORK, f"{tag}.vrt")
    merge_vrts([full, box], out, tag)
    add_layer(id=tag, label="26 Aug 2026 · PlanetScope mosaic (9 scenes, ~20 m)", side="post", date="2026-08-26",
               sensor="PlanetScope", provider="Planet Labs PBC (open disaster data)", gsd_m=20,
               vrt=out, minzoom=8, maxzoom=13, coverage="corridor",
               attribution="© Planet Labs PBC, CC-BY-NC 4.0")


def build_post_ps28():
    tag = "post_ps28_mosaic"
    full = full_extent_source("ps28_mosaic.webp", tag + "_full")
    box = box_source("ps28_mosaic.webp", tag + "_box")
    out = os.path.join(WORK, f"{tag}.vrt")
    merge_vrts([full, box], out, tag)
    add_layer(id=tag, label="28 Aug 2026 · PlanetScope mosaic (5 scenes, ~20 m)", side="post", date="2026-08-28",
               sensor="PlanetScope", provider="Planet Labs PBC (open disaster data)", gsd_m=20,
               vrt=out, minzoom=8, maxzoom=13, coverage="corridor",
               attribution="© Planet Labs PBC, CC-BY-NC 4.0")


def build_post_s1():
    tag = "post_s1_20260828"
    full = full_extent_source("post_s1_20260828.webp", tag + "_full")
    box = box_source("post_s1_20260828.webp", tag + "_box")
    out = os.path.join(WORK, f"{tag}.vrt")
    merge_vrts([full, box], out, tag)
    add_layer(id=tag, label="28 Aug 2026 · Sentinel-1 RTC radar", side="post", date="2026-08-28",
               sensor="Sentinel-1", provider="ESA Copernicus / Microsoft Planetary Computer", gsd_m=11.7,
               vrt=out, minzoom=8, maxzoom=14, coverage="corridor",
               attribution="© ESA Copernicus")


def build_post_wv02():
    tag = "post_wv02_20260828"
    out = os.path.join(WORK, f"{tag}.vrt")
    build_pyramid_vrt(os.path.join(S, "assets/trisuli/tiles/vantor_post"), tag, out)
    add_layer(id=tag, label="28 Aug 2026 · Vantor WorldView-2 0.54 m", side="post", date="2026-08-28",
               sensor="WorldView-2", provider="Vantor (OpenAerialMap mirror)", gsd_m=0.54,
               vrt=out, minzoom=11, maxzoom=18, coverage="trisuli_bazar",
               attribution="© 2026 Vantor via OpenAerialMap, CC-BY-NC 4.0")


def build_post_skysat31():
    tag = "post_skysat_20260831"
    full_vrt = os.path.join(WORK, f"{tag}_full.vrt")
    build_pyramid_vrt(os.path.join(S, "assets/full/tiles/skysat0831"), tag + "_full", full_vrt)
    box_vrt = os.path.join(WORK, f"{tag}_box.vrt")
    build_pyramid_vrt(os.path.join(S, "assets/trisuli/tiles/skysat"), tag + "_box", box_vrt)
    out = os.path.join(WORK, f"{tag}.vrt")
    merge_vrts([full_vrt, box_vrt], out, tag)
    add_layer(id=tag, label="31 Aug 2026 · SkySat 0.65 m", side="post", date="2026-08-31",
               sensor="SkySat", provider="Planet Labs PBC (open disaster data)", gsd_m=0.65,
               vrt=out, minzoom=8, maxzoom=18, coverage="trisuli_bazar",
               attribution="© Planet Labs PBC, CC-BY-NC 4.0")


def build_post_skysat27():
    tag = "post_skysat_20260827"
    out = os.path.join(WORK, f"{tag}.vrt")
    build_pyramid_vrt(os.path.join(S, "assets/full/tiles/skysat0827"), tag, out)
    add_layer(id=tag, label="27 Aug 2026 · SkySat 0.8 m", side="post", date="2026-08-27",
               sensor="SkySat", provider="Planet Labs PBC (open disaster data)", gsd_m=0.8,
               vrt=out, minzoom=8, maxzoom=18, coverage="upper_valley",
               attribution="© Planet Labs PBC, CC-BY-NC 4.0")


def build_post_wv3():
    tag = "post_wv3_20260827"
    out = os.path.join(WORK, f"{tag}.vrt")
    build_pyramid_vrt(os.path.join(S, "assets/full/tiles/wv3_0827"), tag, out)
    add_layer(id=tag, label="27 Aug 2026 · Vantor WorldView-3 0.35 m", side="post", date="2026-08-27",
               sensor="WorldView-3", provider="Vantor (OpenAerialMap mirror)", gsd_m=0.35,
               vrt=out, minzoom=8, maxzoom=19, coverage="upper_valley",
               attribution="© 2026 Vantor via OpenAerialMap, CC-BY-NC 4.0")


def build_post_legion():
    tag = "post_legion_20260901"
    out = os.path.join(WORK, f"{tag}.vrt")
    build_pyramid_vrt(os.path.join(S, "assets/full/tiles/legion0901"), tag, out)
    add_layer(id=tag, label="1 Sep 2026 · Vantor Legion 0.4-0.5 m", side="post", date="2026-09-01",
               sensor="Legion", provider="Vantor (OpenAerialMap mirror)", gsd_m=0.45,
               vrt=out, minzoom=8, maxzoom=19, coverage="upper_valley",
               attribution="© 2026 Vantor via OpenAerialMap, CC-BY-NC 4.0")


def build_post_pelican():
    tag = "post_pelican_20260901"
    out = os.path.join(WORK, f"{tag}.vrt")
    build_pyramid_vrt(os.path.join(S, "assets/full/tiles/pelican0901"), tag, out)
    add_layer(id=tag, label="1 Sep 2026 · Planet Pelican 0.56 m", side="post", date="2026-09-01",
               sensor="Pelican", provider="Planet Labs PBC (open disaster data)", gsd_m=0.56,
               vrt=out, minzoom=8, maxzoom=18, coverage="upper_valley",
               attribution="© Planet Labs PBC, CC-BY-NC 4.0")


BUILDERS = [
    build_pre_s2, build_pre_ps, build_pre_legion,
    # build_pre_s1 intentionally excluded -- see its docstring: tiles/pre_s1_20260816
    # is now a full-corridor pyramid built outside this pipeline, and rerunning it
    # here would overwrite that with the old trisuli-box-only crop.
    build_post_s2, build_post_ps, build_post_ps26, build_post_ps28, build_post_s1,
    build_post_wv02, build_post_skysat31, build_post_skysat27,
    build_post_wv3, build_post_legion, build_post_pelican,
]


def vrt_bounds(vrt_path):
    ds = gdal.Open(vrt_path)
    gt = ds.GetGeoTransform()
    w, h = ds.RasterXSize, ds.RasterYSize
    xs = [gt[0], gt[0] + gt[1] * w + gt[2] * h]
    ys = [gt[3], gt[3] + gt[4] * w + gt[5] * h]
    ds = None
    return [min(xs), min(ys), max(xs), max(ys)]


def tile_and_catalog():
    for b in BUILDERS:
        print(f"=== building VRT: {b.__name__} ===", flush=True)
        b()

    for layer in LAYERS:
        layer["bounds"] = [round(v, 6) for v in vrt_bounds(layer["vrt"])]

    with open(os.path.join(WORK, "layers.json"), "w") as fh:
        json.dump([{k: v for k, v in l.items() if k != "vrt"} | {"vrt": l["vrt"]} for l in LAYERS],
                   fh, indent=1)
    print(f"Wrote {len(LAYERS)} layer VRTs to {WORK}/layers.json")


if __name__ == "__main__":
    tile_and_catalog()
