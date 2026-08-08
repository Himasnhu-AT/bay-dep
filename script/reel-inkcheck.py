"""Sweep the timeline through bay's snapshot tool and measure how much ink is on each frame.

The failure this catches is the one no structural check can: a cut that lands on an empty
screen. A previous house reel spent 15% of its runtime blank and passed every lint.
"""
import json, os, struct, subprocess, sys, urllib.request, zlib

URL = "http://127.0.0.1:7333/mcp"
OUT = "/Users/himanshu/.claude/jobs/5fdf9528/tmp/sweep"
os.makedirs(OUT, exist_ok=True)


def call(tool, **args):
    payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
               "params": {"name": tool, "arguments": args}}
    req = urllib.request.Request(URL, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        body = json.load(r)
    res = body.get("result", {})
    if res.get("isError"):
        raise SystemExit("tool error: " + res["content"][0]["text"])
    return json.loads(res["content"][0]["text"])


def ink_fraction(path):
    """Fraction of pixels differing from the #0E0E12 ground by more than a small threshold."""
    out = subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", path,
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        capture_output=True, check=True).stdout
    lit = 0
    total = len(out) // 3
    for i in range(0, len(out), 3):
        if abs(out[i] - 14) > 18 or abs(out[i+1] - 14) > 18 or abs(out[i+2] - 18) > 18:
            lit += 1
    return lit / max(total, 1)


BOUNDARIES = [0.0, 4.286, 8.571, 10.714, 15.000, 19.286]
times = [round(t, 3) for t in
         [i * 0.25 for i in range(0, 87)]]
# make sure every cut boundary and its immediate neighbourhood is sampled
for b in BOUNDARIES:
    for d in (-0.10, -0.03, 0.0, 0.03, 0.10):
        t = round(b + d, 3)
        if 0 <= t <= 21.4:
            times.append(t)
times = sorted(set(times))

print(f"sweeping {len(times)} frames…")
rows = []
for t in times:
    p = f"{OUT}/f{t:07.3f}.png"
    call("snapshot", at=t, path=p, scale=0.22)
    rows.append((t, ink_fraction(p)))
    os.remove(p)

# A 34px kicker alone is ~0.001 of the frame and is perfectly legible, so "blank" has to mean
# essentially no ink at all. The band above it is reported separately as thin-but-readable.
blank = [(t, f) for t, f in rows if f < 0.0004]
low = [(t, f) for t, f in rows if 0.0004 <= f < 0.004]
print(f"\nink: min {min(f for _, f in rows):.4f}  max {max(f for _, f in rows):.4f}  "
      f"mean {sum(f for _, f in rows)/len(rows):.4f}")
if blank:
    print(f"\nBLANK ({len(blank)}):")
    for t, f in blank:
        print(f"  {t:7.3f}s  ink {f:.4f}")
else:
    print("\nno blank frames")
if low:
    print(f"\nTHIN — one small element only ({len(low)}):")
    for t, f in low:
        print(f"  {t:7.3f}s  ink {f:.4f}")
