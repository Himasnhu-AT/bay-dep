#!/usr/bin/env python3
"""Crop a transparent PNG to its ink bounding box plus a small pad.

Why this exists: an anchor is sqrt(ink area / frame area), and an element is placed by its
*canvas* width. Empty canvas around the ink is therefore anchor thrown away -- strike.png is
900x200 holding a 476x70 word, so 89% of what you place is nothing. Cropping to the ink nearly
doubles the anchor at the same placed width (0.097 -> 0.184 for strike.png) and changes nothing
about how the asset looks.

usage: tightcrop.py IN.png OUT.png [pad_px]
"""
import sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
pad = int(sys.argv[3]) if len(sys.argv) > 3 else 8

im = Image.open(src).convert("RGBA")
bbox = im.split()[3].getbbox()          # alpha channel bounding box
if bbox is None:
    print(f"{src}: fully transparent, refusing to crop")
    sys.exit(1)
x0, y0, x1, y1 = bbox
x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
x1, y1 = min(im.width, x1 + pad), min(im.height, y1 + pad)
out = im.crop((x0, y0, x1, y1))
out.save(dst)
print(f"{dst} {out.width}x{out.height}  (from {im.width}x{im.height}, pad {pad})")
