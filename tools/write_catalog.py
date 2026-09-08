#!/usr/bin/env python3
"""Write data/imagery.json from whatever tile pyramids exist under tiles/.
Bounds come from work/vrt/<id>*.vrt when present, else from the tile grid at maxzoom.
Safe to re-run; the retile pipeline may overwrite with the same schema."""
import json, math, os, glob, datetime
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
META = {
 "pre_s2_20260603":     ("3 Jun 2026 · Sentinel-2 10 m","pre","2026-06-03","Sentinel-2","ESA Copernicus",10,"© ESA Copernicus","corridor"),
 "pre_ps_20260527":     ("27 May 2026 · PlanetScope 3 m","pre","2026-05-27","PlanetScope","Planet Labs PBC",3,"© Planet Labs PBC, CC-BY-NC 4.0","corridor"),
 "pre_legion_20260205": ("5 Feb 2026 · Vantor Legion 0.39 m","pre","2026-02-05","Legion","Vantor",0.39,"© 2026 Vantor via OpenAerialMap, CC-BY 4.0","trisuli_bazar"),
 "pre_s1_20260816":     ("16 Aug 2026 · Sentinel-1 radar 10 m","pre","2026-08-16","Sentinel-1 RTC","ESA Copernicus / Microsoft Planetary Computer",10,"© ESA Copernicus","corridor"),
 "post_s2_20260827":    ("27 Aug 2026 · Sentinel-2 10 m","post","2026-08-27","Sentinel-2","ESA Copernicus",10,"© ESA Copernicus","corridor"),
 "post_ps_20260826":    ("26 Aug 2026 flood morning · PlanetScope 3 m","post","2026-08-26","PlanetScope","Planet Labs PBC",3,"© Planet Labs PBC, CC-BY-NC 4.0","corridor"),
 "post_ps26_mosaic":    ("26 Aug 2026 · PlanetScope 9-scene mosaic ~20 m","post","2026-08-26","PlanetScope","Planet Labs PBC",20,"© Planet Labs PBC, CC-BY-NC 4.0","corridor"),
 "post_ps28_mosaic":    ("28 Aug 2026 · PlanetScope 5-scene mosaic ~20 m","post","2026-08-28","PlanetScope","Planet Labs PBC",20,"© Planet Labs PBC, CC-BY-NC 4.0","corridor"),
 "post_s1_20260828":    ("28 Aug 2026 · Sentinel-1 radar 10 m","post","2026-08-28","Sentinel-1 RTC","ESA Copernicus / Microsoft Planetary Computer",10,"© ESA Copernicus","corridor"),
 "post_wv02_20260828":  ("28 Aug 2026 · Vantor WorldView-2 0.54 m","post","2026-08-28","WorldView-2","Vantor",0.54,"© 2026 Vantor via OpenAerialMap, CC-BY 4.0","trisuli_bazar"),
 "post_skysat_20260831":("31 Aug 2026 · SkySat 0.65 m","post","2026-08-31","SkySat","Planet Labs PBC",0.65,"© Planet Labs PBC, CC-BY-NC 4.0","trisuli_bazar"),
 "post_skysat_20260827":("27 Aug 2026 · SkySat 0.8 m","post","2026-08-27","SkySat","Planet Labs PBC",0.8,"© Planet Labs PBC, CC-BY-NC 4.0","upper_valley"),
 "post_wv3_20260827":   ("27 Aug 2026 · Vantor WorldView-3 0.35 m","post","2026-08-27","WorldView-3","Vantor",0.35,"© 2026 Vantor, CC-BY-NC 4.0","upper_valley"),
 "post_legion_20260901":("1 Sep 2026 · Vantor Legion 0.4–0.5 m","post","2026-09-01","Legion","Vantor",0.45,"© 2026 Vantor, CC-BY-NC 4.0","upper_valley"),
 "post_pelican_20260901":("1 Sep 2026 · Planet Pelican 0.56 m","post","2026-09-01","Pelican","Planet Labs PBC",0.56,"© Planet Labs PBC, CC-BY-NC 4.0","upper_valley"),
}
def t2ll(x, y, z):
    n = 2 ** z; lon = x / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n)))); return lon, lat
def vrt_bounds(id_):
    try:
        from osgeo import gdal
        for v in sorted(glob.glob(f"{R}/work/vrt/{id_}*.vrt")):
            ds = gdal.Open(v); gt = ds.GetGeoTransform()
            w, n = gt[0], gt[3]; e = w + gt[1] * ds.RasterXSize; s = n + gt[5] * ds.RasterYSize
            if abs(w) <= 180 and abs(n) <= 90: return [round(w,6), round(s,6), round(e,6), round(n,6)]
    except Exception: pass
    return None
def grid_bounds(d, z):
    xs = [int(x) for x in os.listdir(f"{d}/{z}") if x.isdigit()]
    ys = [int(os.path.splitext(f)[0]) for x in xs for f in os.listdir(f"{d}/{z}/{x}") if f.endswith('.webp')]
    w, n = t2ll(min(xs), min(ys), z); e, s = t2ll(max(xs) + 1, max(ys) + 1, z)
    return [round(w,6), round(s,6), round(e,6), round(n,6)]
def du(d): return sum(os.path.getsize(os.path.join(p, f)) for p, _, fs in os.walk(d) for f in fs)
layers = []
for id_, (label, side, date, sensor, prov, gsd, attr, cov) in META.items():
    d = f"{R}/tiles/{id_}"
    zs = sorted(int(z) for z in os.listdir(d) if z.isdigit()) if os.path.isdir(d) else []
    if not zs or not os.listdir(f"{d}/{zs[-1]}"): print("skip (no tiles yet):", id_); continue
    layers.append({"id": id_, "label": label, "side": side, "date": date, "sensor": sensor, "provider": prov, "gsd_m": gsd,
        "bounds": vrt_bounds(id_) or grid_bounds(d, zs[0] + 2 if len(zs) > 2 else zs[0]),
        "minzoom": zs[0], "maxzoom": zs[-1], "tiles": f"tiles/{id_}/{{z}}/{{x}}/{{y}}.webp",
        "attribution": attr, "coverage": cov, "size_mb": round(du(d) / 1e6, 1)})
cat = {"generated": datetime.date.today().isoformat(),
       "grid_note": "Re-tiled from the trisuli-flood-map world-pixel grid (equirectangular, lon=84.52+1.08*wx/36169, lat=28.45-0.75*wy/28011) to Web Mercator XYZ with GDAL; registration preserved.",
       "layers": layers, "default_pre": "none",
       # default_post is the post-side default selection in draw order, bottom first (owner direction, 8 Sep 2026)
       "default_post": ["post_s2_20260827", "post_pelican_20260901", "post_wv02_20260908_ef5510", "post_wv02_20260908_ef5910"]}
json.dump(cat, open(f"{R}/data/imagery.json", "w"), indent=1, ensure_ascii=False)
for l in layers: print(f"{l['id']:24s} z{l['minzoom']}-{l['maxzoom']:<3} {l['size_mb']:>7} MB  {l['bounds']}")
