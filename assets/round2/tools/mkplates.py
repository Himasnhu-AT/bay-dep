#!/usr/bin/env python3
"""Emit Brief C's code plate and struck-parameter plates as SVG, rasterise via sips, and set
each strike rule's x2 from the *measured* ink of the rendered label rather than from an
assumed Menlo advance width.

Two passes per strike plate: render the label alone, measure the right edge of its ink, then
re-emit with the rule ending just past it. That is why the strike lands on the word instead of
overshooting or stopping short.

Every code line here is verbatim from the repo at HEAD. See MANIFEST.md for the citations.
"""
import subprocess, sys, os
from PIL import Image

OUT = "/Users/himanshu/codes/synthai/vii/assets/round2"
SVG = os.path.join(OUT, "svg")

INK, DIM, ACCENT = "#EDECE6", "#8A8A96", "#FF5B5B"


def sips(svg_path, png_path):
    r = subprocess.run(["sips", "-s", "format", "png", svg_path, "--out", png_path],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"sips failed on {svg_path}: {r.stderr}")
    return png_path


def ink_right_edge(png, units_per_px):
    """Right-most column holding ink, expressed in the SVG's viewBox units."""
    im = Image.open(png).convert("RGBA")
    px, w, h = im.load(), *im.size
    right = 0
    for y in range(h):
        for x in range(w - 1, right - 1, -1):
            if px[x, y][3] > 40:
                right = max(right, x)
                break
    return right * units_per_px


def write(path, text):
    with open(path, "w") as f:
        f.write(text)
    return path


# ---------------------------------------------------------------- code plates

def code_svg(lines, w, h, vb_w, vb_h, y0, step, size_first, size_rest):
    rows = []
    for i, (txt, col) in enumerate(lines):
        size = size_first if i == 0 else size_rest
        y = y0 + i * step
        esc = txt.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        rows.append(f'  <text x="4" y="{y}" font-family="Menlo" font-size="{size}" '
                    f'fill="{col}">{esc}</text>')
    body = "\n".join(rows)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
            f'viewBox="0 0 {vb_w} {vb_h}">\n{body}\n</svg>\n')


# code.png -- Brief C's 900x260, but with lines that are real. Every string below is a verbatim
# substring of .claude/skills/bay/references/recipes.md:17 at HEAD.
code_lines = [
    ("references/recipes.md:17", DIM),
    ('"color": "#EDECE6",', INK),
    ('"fontSize": 96,', ACCENT),
]
write(f"{SVG}/code.svg", code_svg(code_lines, 900, 260, 90, 26, 8, 8, 5, 6))
sips(f"{SVG}/code.svg", f"{OUT}/code.png")

# code_scroll.png -- beat 9 scrolls the plate 0.30 of its height to reveal three more matches,
# which a three-line plate cannot do. Seven verbatim matches across all four instruction files.
scroll_lines = [
    ("references/recipes.md:17", DIM),
    ('"color": "#EDECE6",', INK),
    ('"fontSize": 96,', ACCENT),
    ("references/recipes.md:18", DIM),
    ('"fontWeight": 700,', ACCENT),
    ("references/layout.md:50", DIM),
    ("| big number | 130 |", ACCENT),
    ("references/charts.md:17", DIM),
    ('"color": "#FF5B5B",', ACCENT),
]
write(f"{SVG}/code_scroll.svg",
      code_svg(scroll_lines, 900, 620, 90, 62, 8, 6.6, 5, 5.4))
sips(f"{SVG}/code_scroll.svg", f"{OUT}/code_scroll.png")


# ---------------------------------------------------------------- strike plates

def strike(label, out_png):
    W, H, VB_W, VB_H = 900, 200, 90, 20
    upp = VB_W / W  # viewBox units per pixel
    probe_svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
                 f'viewBox="0 0 {VB_W} {VB_H}">\n'
                 f'  <text x="4" y="13" font-family="Menlo" font-weight="bold" font-size="9" '
                 f'fill="{INK}">{label}</text>\n</svg>\n')
    p = write("/tmp/x_probe.svg", probe_svg) if False else write(
        os.path.join(SVG, f".probe_{label}.svg"), probe_svg)
    probe_png = os.path.join(SVG, f".probe_{label}.png")
    sips(p, probe_png)
    x2 = ink_right_edge(probe_png, upp) + 1.2   # a hair past the last glyph
    final = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
             f'viewBox="0 0 {VB_W} {VB_H}">\n'
             f'  <text x="4" y="13" font-family="Menlo" font-weight="bold" font-size="9" '
             f'fill="{INK}">{label}</text>\n'
             f'  <line x1="2" y1="10" x2="{x2:.1f}" y2="10" stroke="{ACCENT}" '
             f'stroke-width="1.6" stroke-linecap="round"/>\n</svg>\n')
    write(os.path.join(SVG, f"strike_{label}.svg"), final)
    sips(os.path.join(SVG, f"strike_{label}.svg"), out_png)
    return x2


for lbl, out in [("fontSize", "strike.png"),
                 ("color", "strike_color.png"),
                 ("fontWeight", "strike_fontWeight.png"),
                 ("fontFamily", "strike_fontFamily.png")]:
    x2 = strike(lbl, os.path.join(OUT, out))
    print(f"{out:26s} label={lbl:12s} strike x2={x2:5.1f} units "
          f"(brief assumed 44.0 for fontSize)")
