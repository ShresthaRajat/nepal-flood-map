#!/usr/bin/env python3
"""
Corrected per-level tiling for the 7 tile-pyramid-sourced layers.

Bug this fixes: building ONE merged VRT per pyramid (overview + all levels via
gdalbuildvrt -resolution highest) makes gdal2tiles treat the WHOLE bbox as
available at the finest resolution, so it writes real (non-transparent, so not
--exclude-able) z17-19 tiles across the entire regional bbox by upsampling the
~2.9 m overview wherever the narrow river-corridor fine levels don't reach.
post_wv3_20260827 hit 435 MB / 104841 tiles from a 66 MB source this way.

Fix: tile each level SEPARATELY, confined to its own (spatially narrow) VRT, in
a gapless zoom sequence coarse -> fine:
    overview (~2.9 m)  -> [base_minzoom .. 16]
    F=2      (~1.47 m) -> [17 .. 17]                 (extended to fill any gap
    F=4      (~0.73 m) -> [18 .. 18]                   left by a missing level,
    F=6/F=8  (~0.49 m) -> [19 .. 19]                   see STAGE_MAX below)
Only zooms whose level actually exists get generated, and --exclude drops
fully-transparent tiles, so tile count now tracks the real (narrow) footprint
at every zoom instead of the full regional bbox.

For the one compound layer (post_skysat_20260831 = full/skysat0831 pyramid +
trisuli/skysat pyramid stacked on top): run the full pyramid's whole gapless
sequence first, then the trisuli pyramid's whole sequence into the SAME output
dir -- since both are re-run at the same z/x/y where they overlap, the trisuli
(finer, re-registered) pass simply overwrites the full pass there, which is
exactly "trisuli box on top".
"""
import json
import os
import shutil
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from retile import (  # noqa: E402
    S, R, WORK, TILES,
    gt_simple, georeference_nodata, GDALBUILDVRT,
)
from osgeo import gdal  # noqa: E402

gdal.UseExceptions()

GDAL2TILES = "/opt/homebrew/bin/gdal2tiles.py"
NPROC = 10

STAGE_MAX = {"overview": 16, 2: 17, 4: 18, 6: 19, 8: 19}


def build_overview_vrt(pyramid_dir, tag):
    index = json.load(open(os.path.join(pyramid_dir, "index.json")))
    ov = index["overview"]
    ov_path = os.path.join(pyramid_dir, ov["src"])
    ds = gdal.Open(ov_path)
    rw, rh = ds.RasterXSize, ds.RasterYSize
    ds = None
    wpx_per_px = ov["width"] / rw
    wpx_per_px_y = ov["height"] / rh
    assert abs(wpx_per_px - wpx_per_px_y) < 1e-6
    gt = gt_simple(ov["left"], ov["top"], wpx_per_px)
    return georeference_nodata(ov_path, gt, tag + "_overview")


def build_level_vrt(pyramid_dir, level, tag):
    T, F = level["T"], level["F"]
    d = os.path.join(pyramid_dir, level["dir"]) if level.get("dir") else pyramid_dir
    sources = []
    for key in level["tiles"]:
        tx, ty = (int(v) for v in key.split("_"))
        p = os.path.join(d, f"{key}.webp")
        if not os.path.exists(p):
            print(f"  ! missing tile {p}", file=sys.stderr)
            continue
        gt = gt_simple(tx * T, ty * T, 1.0 / F)
        sources.append(georeference_nodata(p, gt, f"{tag}_F{F}"))
    out = os.path.join(WORK, f"{tag}_F{F}.vrt")
    lst = os.path.join(WORK, f"{tag}_F{F}_sources.txt")
    with open(lst, "w") as fh:
        fh.write("\n".join(sources))
    subprocess.run([GDALBUILDVRT, "-resolution", "highest", "-input_file_list", lst,
                     "-overwrite", out], check=True, capture_output=True, text=True)
    return out


def pyramid_stages(pyramid_dir, tag, base_minzoom):
    """Return [(zmin, zmax, vrt_path), ...] coarse -> fine, gapless."""
    index = json.load(open(os.path.join(pyramid_dir, "index.json")))
    levels = index.get("levels")
    if levels is None:
        levels = [{"F": index["F"], "T": index["T"], "dir": "", "tiles": index["tiles"]}]
    levels = sorted(levels, key=lambda L: L["F"])

    stages = []
    cur_min = base_minzoom
    ov_vrt = build_overview_vrt(pyramid_dir, tag)
    ov_max = STAGE_MAX["overview"]
    stages.append((cur_min, ov_max, ov_vrt))
    cur_min = ov_max + 1

    for L in levels:
        F = L["F"]
        lvl_max = STAGE_MAX.get(F, 19)
        if lvl_max < cur_min:
            # (shouldn't happen given F in {2,4,6,8}) -- skip a level that would
            # be entirely below the already-covered range
            continue
        vrt = build_level_vrt(pyramid_dir, L, tag)
        stages.append((cur_min, lvl_max, vrt))
        cur_min = lvl_max + 1
    return stages


def tile_stage(zmin, zmax, vrt, outdir, log):
    cmd = [GDAL2TILES, "--xyz", "--profile=mercator", "--tiledriver=WEBP",
           "--webp-quality=80", "--resampling=bilinear", f"--processes={NPROC}",
           "--exclude", "-z", f"{zmin}-{zmax}", vrt, outdir]
    with open(log, "a") as fh:
        fh.write(f"\n$ {' '.join(cmd)}\n")
        fh.flush()
        r = subprocess.run(cmd, stdout=fh, stderr=subprocess.STDOUT)
    return r.returncode


# id -> list of (pyramid_dir, base_minzoom), full component(s) first, trisuli last
LAYER_PYRAMIDS = {
    "pre_legion_20260205": [
        (os.path.join(S, "assets/trisuli/tiles/vantor_pre"), 11),
    ],
    "post_wv02_20260828": [
        (os.path.join(S, "assets/trisuli/tiles/vantor_post"), 11),
    ],
    "post_skysat_20260831": [
        (os.path.join(S, "assets/full/tiles/skysat0831"), 8),
        (os.path.join(S, "assets/trisuli/tiles/skysat"), 11),
    ],
    "post_skysat_20260827": [
        (os.path.join(S, "assets/full/tiles/skysat0827"), 8),
    ],
    "post_wv3_20260827": [
        (os.path.join(S, "assets/full/tiles/wv3_0827"), 8),
    ],
    "post_legion_20260901": [
        (os.path.join(S, "assets/full/tiles/legion0901"), 8),
    ],
    "post_pelican_20260901": [
        (os.path.join(S, "assets/full/tiles/pelican0901"), 8),
    ],
}


def main():
    log = os.path.join(WORK, "retile_pyramids.log")
    open(log, "w").close()
    results = {}
    for layer_id, pyramids in LAYER_PYRAMIDS.items():
        outdir = os.path.join(TILES, layer_id)
        if os.path.isdir(outdir):
            shutil.rmtree(outdir)
        os.makedirs(outdir, exist_ok=True)
        overall_max = 0
        t0 = time.time()
        with open(log, "a") as fh:
            fh.write(f"\n=== {layer_id} {time.ctime()} ===\n")
        for pdir, base_minzoom in pyramids:
            tag = f"{layer_id}_{os.path.basename(pdir)}"
            stages = pyramid_stages(pdir, tag, base_minzoom)
            for zmin, zmax, vrt in stages:
                rc = tile_stage(zmin, zmax, vrt, outdir, log)
                with open(log, "a") as fh:
                    fh.write(f"  stage z{zmin}-{zmax} ({os.path.basename(vrt)}) rc={rc}\n")
                if rc != 0:
                    with open(log, "a") as fh:
                        fh.write(f"  !! stage failed for {layer_id}, continuing\n")
                overall_max = max(overall_max, zmax)
        n = sum(len(files) for _, _, files in os.walk(outdir))
        sz = subprocess.run(["du", "-sh", outdir], capture_output=True, text=True).stdout.split()[0]
        dt = time.time() - t0
        line = f"=== {layer_id} done in {dt:.0f}s tiles={n} size={sz} maxzoom_reached={overall_max} ==="
        print(line, flush=True)
        with open(log, "a") as fh:
            fh.write(line + "\n")
        results[layer_id] = dict(tiles=n, size=sz, maxzoom=overall_max, seconds=round(dt))
    with open(os.path.join(WORK, "retile_pyramids_results.json"), "w") as fh:
        json.dump(results, fh, indent=1)
    print("ALL_PYRAMIDS_DONE")


if __name__ == "__main__":
    main()
