#!/usr/bin/env python3
"""Sweep a bay timeline and report frames with almost nothing on them.

Catches the defect no structural check can see: a cut that lands on an empty screen. A reel
that spent 15% of its runtime blank once passed every lint it had.

    python3 inkcheck.py                        # sweep 0..duration at 0.25s
    python3 inkcheck.py --at 4.286 8.571       # also sample around these cut times
    python3 inkcheck.py --background 0E0E12    # ground colour to measure against

Needs the bay MCP server running (BAY_MCP_URL, default http://127.0.0.1:7333/mcp) and ffmpeg.

This is a companion to looking at frames, not a replacement. It cannot tell you the type
collides or the hero number is too small — only that *something* is on screen.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import urllib.request

URL = os.environ.get("BAY_MCP_URL", "http://127.0.0.1:7333/mcp")

# A 34px kicker is ~0.1% of a 1080x1920 frame and perfectly legible, so "blank" has to mean
# essentially no ink at all. The band above it is reported separately as thin-but-readable.
BLANK = 0.0004
THIN = 0.004


def call(tool: str, **args):
    payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
               "params": {"name": tool, "arguments": args}}
    request = urllib.request.Request(
        URL, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request) as response:
        body = json.load(response)
    result = body.get("result", {})
    text = result.get("content", [{}])[0].get("text", "")
    if result.get("isError"):
        raise SystemExit(f"bay tool error ({tool}): {text}")
    return json.loads(text)


def ink_fraction(path: str, ground: tuple[int, int, int], tolerance: int = 18) -> float:
    """Fraction of pixels that differ from the background colour."""
    raw = subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", path,
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        capture_output=True, check=True).stdout
    r0, g0, b0 = ground
    lit = sum(
        1
        for i in range(0, len(raw), 3)
        if abs(raw[i] - r0) > tolerance
        or abs(raw[i + 1] - g0) > tolerance
        or abs(raw[i + 2] - b0) > tolerance
    )
    return lit / max(len(raw) // 3, 1)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--step", type=float, default=0.25, help="sweep interval, seconds")
    parser.add_argument("--scale", type=float, default=0.22, help="render scale for the sweep")
    parser.add_argument("--at", type=float, nargs="*", default=[],
                        help="cut times to sample densely around")
    parser.add_argument("--background", default=None,
                        help="ground colour rrggbb; defaults to the project's own")
    args = parser.parse_args()

    info = call("project_info")
    duration = float(info["durationSeconds"])
    if duration <= 0:
        print("the timeline is empty", file=sys.stderr)
        return 1

    hexcolour = (args.background or "0E0E12").lstrip("#")
    ground = tuple(int(hexcolour[i:i + 2], 16) for i in (0, 2, 4))

    times = [round(i * args.step, 3) for i in range(int(duration / args.step) + 1)]
    for cut in args.at:
        times += [round(cut + d, 3) for d in (-0.10, -0.03, 0.0, 0.03, 0.10)]
    times = sorted({t for t in times if 0 <= t <= duration})

    print(f"sweeping {len(times)} frames over {duration:.3f}s against #{hexcolour}…")
    rows = []
    with tempfile.TemporaryDirectory() as work:
        for t in times:
            path = os.path.join(work, f"f{t:08.3f}.png")
            call("snapshot", at=t, path=path, scale=args.scale)
            rows.append((t, ink_fraction(path, ground)))
            os.remove(path)

    values = [f for _, f in rows]
    print(f"\nink: min {min(values):.4f}  max {max(values):.4f}  "
          f"mean {sum(values) / len(values):.4f}")

    blank = [(t, f) for t, f in rows if f < BLANK]
    thin = [(t, f) for t, f in rows if BLANK <= f < THIN]

    if blank:
        print(f"\nBLANK — nothing on screen ({len(blank)}):")
        for t, f in blank:
            print(f"  {t:7.3f}s  ink {f:.4f}")
    else:
        print("\nno blank frames")
    if thin:
        print(f"\nTHIN — one small element only ({len(thin)}):")
        for t, f in thin:
            print(f"  {t:7.3f}s  ink {f:.4f}")

    # A blank frame in the first 0.3s is just the opening cut from black, which is normal.
    real = [t for t, _ in blank if t > 0.3]
    if real:
        print(f"\n{len(real)} blank frame(s) after 0.3s — overlap the neighbouring scenes")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
