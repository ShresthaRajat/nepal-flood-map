#!/usr/bin/env python3
"""Rebuild the imagery layers that stack a Trisuli-box raster on a whole-extent one.

The original merge used gdalbuildvrt, which (a) refuses to mix 3- and 4-band sources
and (b) does not treat alpha as a mask, so transparent pixels of the top image punched
holes through the backdrop.  Here the box is composited onto the backdrop with gdalwarp
(alpha-aware) into a small GeoTIFF, and each part is tiled only at its native zooms.
Usage: python3 tools/fix_box_layers.py [layer ...]
"""
import glob, os, shutil, subprocess, sys
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = "/opt/homebrew/bin/"
BOX = [85.1302, 27.9016, 85.1739, 27.9497]          # lon/lat of the Trisuli box
BOX_RES = (1.08 / 36169, 0.75 / 28011)              # one world px in degrees
# layer -> zoom of the whole-extent backdrop; the box always tiles to 16 (2.9 m)
# post_ps28_mosaic intentionally excluded (8 Sep 2026): tiles/post_ps28_mosaic was cropped
# in place to the upper valley north of Dhunche (coverage "upper_valley"); rebuilding it here
# from work/vrt/post_ps28_mosaic_{full,box} would recreate the old full-corridor tiles and
# overwrite the crop. See tools/retile.py build_post_ps28() docstring.
LAYERS = {"post_ps26_mosaic": 13, "post_s1_20260828": 14,
          "pre_ps_20260527": 16, "post_ps_20260826": 16}
def run(cmd): print("$", " ".join(cmd), flush=True); subprocess.run(cmd, check=True)
def vrt(tag):
    fs = sorted(glob.glob(f"{R}/work/vrt/{tag}/*.vrt")) or glob.glob(f"{R}/work/vrt/{tag}.vrt")
    assert fs, tag; return fs[0]
def tile(src, out, z0, z1):
    run([G + "gdal2tiles.py", "--xyz", "--profile=mercator", "--tiledriver=WEBP", "--webp-quality=80",
         "--resampling=bilinear", "--processes=4", "--exclude", "-q", f"-z{z0}-{z1}", src, out])
for L in (sys.argv[1:] or LAYERS):
    zfull = LAYERS[L]; full, box = vrt(L + "_full"), vrt(L + "_box")
    out = f"{R}/tiles/{L}"; work = f"{R}/work/fix_{L}"; os.makedirs(work, exist_ok=True)
    if os.path.isdir(out): shutil.rmtree(out)           # broken tiles, rebuilt below
    if zfull < 16:
        comp = f"{work}/box_comp.tif"
        if os.path.exists(comp): os.remove(comp)
        # backdrop resampled to box resolution over the box, then the box painted on top
        run([G + "gdalwarp", "-q", "-dstalpha", "-r", "bilinear", "-te", *map(str, BOX),
             "-tr", str(BOX_RES[0]), str(BOX_RES[1]), full, comp])
        run([G + "gdalwarp", "-q", "-r", "bilinear", box, comp])
        tile(full, out, 8, zfull); tile(comp, out, zfull + 1, 16)
    else:
        comp = f"{work}/frame_comp.tif"
        if os.path.exists(comp): os.remove(comp)
        run([G + "gdalwarp", "-q", "-dstalpha", "-r", "bilinear", full, comp])
        run([G + "gdalwarp", "-q", "-r", "bilinear", box, comp])
        tile(comp, out, 8, 16)
    print(f"== {L} rebuilt", flush=True)
