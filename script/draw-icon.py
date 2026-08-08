#!/usr/bin/env python3
"""Draw bay's placeholder app icon as a 1024x1024 PNG, using only the standard library.

No ffmpeg `drawtext` (this machine's build has no freetype), no Pillow, no ImageMagick — a PNG
is a handful of zlib-compressed scanlines, and depending on an image library to draw three
rectangles would be a poor trade.

The mark is three ascending bars: "bay" as three strokes, and a timeline read at a glance.
Replace assets/bay-icon.png with real artwork whenever there is some.
"""
import math
import struct
import sys
import zlib

SIZE = 1024
GROUND = (0x0E, 0x0E, 0x12)
ACCENT = (0xFF, 0x5B, 0x5B)
CREAM = (0xED, 0xEC, 0xE6)


def rounded_rect_coverage(x, y, left, top, right, bottom, radius):
    """Antialiased coverage of a rounded rectangle at a pixel centre, 0..1."""
    cx = min(max(x, left + radius), right - radius)
    cy = min(max(y, top + radius), bottom - radius)
    distance = math.hypot(x - cx, y - cy)
    # One-pixel linear ramp across the edge, same idea as the shape rasterizer in bay-preview.
    return max(0.0, min(1.0, radius + 0.5 - distance)) if radius > 0 else (
        1.0 if left <= x <= right and top <= y <= bottom else 0.0
    )


def blend(under, over, alpha):
    return tuple(round(o * alpha + u * (1 - alpha)) for u, o in zip(under, over))


def draw() -> bytes:
    # The macOS icon grid leaves a margin; filling the full square looks oversized next to
    # every other app in the Dock.
    margin = SIZE * 0.09
    left, top = margin, margin
    right, bottom = SIZE - margin, SIZE - margin
    corner = SIZE * 0.22

    # Three bars, ascending — "bay" as strokes, and a rising timeline.
    bar_w = SIZE * 0.115
    gap = SIZE * 0.075
    heights = [0.26, 0.40, 0.54]
    total = 3 * bar_w + 2 * gap
    bar_x0 = (SIZE - total) / 2
    baseline = SIZE * 0.72
    bars = []
    for index, fraction in enumerate(heights):
        x0 = bar_x0 + index * (bar_w + gap)
        height = SIZE * fraction
        colour = ACCENT if index == 2 else CREAM
        bars.append((x0, baseline - height, x0 + bar_w, baseline, bar_w / 2, colour))

    rows = []
    for py in range(SIZE):
        y = py + 0.5
        row = bytearray()
        for px in range(SIZE):
            x = px + 0.5
            ground_alpha = rounded_rect_coverage(x, y, left, top, right, bottom, corner)
            if ground_alpha <= 0.0:
                row += bytes((0, 0, 0, 0))
                continue
            pixel = GROUND
            for x0, y0, x1, y1, radius, colour in bars:
                coverage = rounded_rect_coverage(x, y, x0, y0, x1, y1, radius)
                if coverage > 0.0:
                    pixel = blend(pixel, colour, coverage)
            row += bytes((*pixel, round(ground_alpha * 255)))
        rows.append(bytes(row))

    raw = b"".join(b"\x00" + row for row in rows)

    def chunk(tag, payload):
        return (
            struct.pack(">I", len(payload))
            + tag
            + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "assets/bay-icon.png"
    data = draw()
    with open(out, "wb") as handle:
        handle.write(data)
    print(f"wrote {out} ({len(data) // 1024} KB, {SIZE}x{SIZE})")
