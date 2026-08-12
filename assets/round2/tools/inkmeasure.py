#!/usr/bin/env python3
"""Measure a PNG the way the briefs' checks measure it.

For every file given, report:
  w x h                 pixel dimensions
  alpha                 whether the file carries an alpha channel
  a_cov                 fraction of ALL canvas pixels with alpha > 0.5 (the "is it blank" test)
  ink_cov               fraction of ALL canvas pixels that are ink: alpha > 0.5 AND the pixel
                        is at least `--lum` away from the image's own ground.  For a
                        transparent asset the ground is transparency, so ink == alpha coverage
                        above the luminance floor; for an opaque frame grab the ground is the
                        modal luminance and ink is what stands off it.
  bbox                  tight bounding box of the ink cluster, in pixels
  bbox_fill             ink pixels / bbox area  -- the density figure Brief B's floor turns on
  root_area_self        sqrt(ink px / canvas px): the anchor the asset would score if it were
                        placed to exactly fill the 1080x1920 frame.  Multiply by the placed
                        width fraction to get the real anchor (see --placed).

With --placed W (the element's width as a fraction of a 1080-wide frame) it also reports
  anchor = sqrt(ink_area_on_canvas / (1080*1920)), which is the number Brief B's >= 0.26 floor
  and Brief C's 0.29 target are measured against.
"""
import sys
from PIL import Image

FRAME_W, FRAME_H = 1080, 1920


def measure(path, lum=0.10, placed=None, frame=(FRAME_W, FRAME_H)):
    im = Image.open(path)
    fmt, mode, (w, h) = im.format, im.mode, im.size
    has_alpha = mode in ("RGBA", "LA", "PA") or "transparency" in im.info
    rgba = im.convert("RGBA")
    px = rgba.load()

    # Luminance of every pixel, and its alpha.
    lums, alphas = [], []
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            lums.append((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0)
            alphas.append(a / 255.0)

    n = w * h
    opaque = [i for i in range(n) if alphas[i] > 0.5]
    a_cov = len(opaque) / n

    if has_alpha and a_cov < 0.995:
        # Transparent asset: the ground is transparency. Ink = covered pixels that are not
        # themselves near-black-and-invisible.
        ground = 0.0
        ink_idx = [i for i in opaque if abs(lums[i] - ground) >= lum]
    else:
        # Opaque plate (a frame grab): the ground is the modal luminance, quantised to 32 bins.
        hist = [0] * 32
        for i in opaque:
            hist[min(31, int(lums[i] * 32))] += 1
        modal = (hist.index(max(hist)) + 0.5) / 32.0
        ground = modal
        ink_idx = [i for i in opaque if abs(lums[i] - modal) >= lum]

    ink_cov = len(ink_idx) / n
    if ink_idx:
        xs = [i % w for i in ink_idx]
        ys = [i // w for i in ink_idx]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        bw, bh = x1 - x0 + 1, y1 - y0 + 1
        bbox_fill = len(ink_idx) / (bw * bh)
    else:
        x0 = x1 = y0 = y1 = bw = bh = 0
        bbox_fill = 0.0

    root_self = (ink_cov) ** 0.5
    out = {
        "path": path, "format": fmt, "mode": mode, "w": w, "h": h,
        "has_alpha": has_alpha, "a_cov": a_cov, "ink_cov": ink_cov, "ground": ground,
        "bbox": (x0, y0, x1, y1), "bw": bw, "bh": bh, "bbox_fill": bbox_fill,
        "root_self": root_self, "n_ink": len(ink_idx),
    }
    if placed is not None:
        # The element is drawn `placed` of the frame width, aspect preserved.
        draw_w = placed * frame[0]
        draw_h = draw_w * h / w
        ink_px_on_canvas = ink_cov * draw_w * draw_h
        out["placed"] = placed
        out["draw_wh"] = (draw_w, draw_h)
        out["anchor"] = (ink_px_on_canvas / (frame[0] * frame[1])) ** 0.5
    return out


def fmt_row(m):
    s = (f"{m['path'].split('/')[-1]:<16} {m['w']}x{m['h']:<6} "
         f"alpha={'yes' if m['has_alpha'] else 'NO ':<3} "
         f"a_cov={m['a_cov']*100:6.2f}%  ink={m['ink_cov']*100:6.2f}%  "
         f"bbox={m['bw']}x{m['bh']} fill={m['bbox_fill']*100:5.1f}%")
    if "anchor" in m:
        s += f"  @w{m['placed']:.2f} anchor={m['anchor']:.3f}"
    return s


if __name__ == "__main__":
    args = sys.argv[1:]
    lum, placed = 0.10, None
    files = []
    i = 0
    while i < len(args):
        if args[i] == "--lum":
            lum = float(args[i + 1]); i += 2
        elif args[i] == "--placed":
            placed = float(args[i + 1]); i += 2
        else:
            files.append(args[i]); i += 1
    for f in files:
        try:
            print(fmt_row(measure(f, lum=lum, placed=placed)))
        except Exception as e:
            print(f"{f}: FAILED {e}")
