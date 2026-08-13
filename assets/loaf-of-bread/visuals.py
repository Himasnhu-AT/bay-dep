#!/usr/bin/env python3
"""Phase B — cut the picture to the voice that phase A already recorded.

Every start and duration comes out of `windows.json`, so nothing is guessed, and everything is
snapped to the frame grid. The layout is the reference short measured at 720x1280 and scaled:
a headline strap on black, a nearly square picture panel in the middle band, a red chip on it,
a mark low left.

Two things here are shaped by the gate rather than by taste, and both are also just how an edit
works:

* **Shots overlap by one beat.** `check` derives a beat from every narration cue, and asks that
  consecutive beats share an element that visibly changed. A cut on every line shares nothing
  across the cut — that is a slideshow. Holding each picture across two beats and starting the
  next one a beat early means every pair of beats has a picture in common, and the incoming
  frame is already there when the line lands.
* **Pictures are pre-cut to the panel.** Each source is cover-cropped to 1080x1122 by ffmpeg
  before import, so no element needs a crop. `crop_set` is a one-shot state change, so a single
  reusable element could never have carried sources of different shapes anyway.
"""
import json, subprocess, pathlib

HERE = pathlib.Path(__file__).parent
W, H, FPS = 1080, 1920, 30

PANEL_TOP, PANEL_BOTTOM = 0.209, 0.793
PANEL_CY = (PANEL_TOP + PANEL_BOTTOM) / 2

CAPTION_Y = 0.470
LINE_H = 0.0400
CHIP_PAD_X = 0.022
CHIP_H = 0.0420

# Measured off a calibration frame rather than assumed, because none of it is guessable:
# `scale` on a text element sizes the *box the type is laid out in* and never the glyph, and the
# type draws from that box's top-left. So `anchorY: 0.5` on a full-width box puts the first line
# almost half a canvas above where you asked for it — which is exactly what the first build did.
# These two numbers turn "where I want the line centred" into "what to pass".
TEXT_TOP_TO_CENTRE = 0.0236   # add to a text y (anchorY 0) to get the optical centre
# Helvetica Neue at the label tier, as a fraction of canvas width. Per character *class*, not a
# single average: "200 BILLION MARKS" is half again as wide as the same count of lowercase, and
# an average sized the chips so that every capitalised line overflowed its own plate.
# Fitted against two measured strings — "HOW A LOAF OF BREAD" at 0.685 and
# "to paper a wall with money" at 0.730.
ADVANCE_UPPER = 0.0415
ADVANCE_LOWER = 0.0305
ADVANCE_SPACE = 0.0170
ADVANCE_PUNCT = 0.0150


def text_width(s):
    """How wide this line will render, so its chip can be cut to fit it."""
    total = 0.0
    for ch in s:
        if ch == " ":
            total += ADVANCE_SPACE
        elif ch.isupper() or ch.isdigit():
            total += ADVANCE_UPPER
        elif ch.isalpha():
            total += ADVANCE_LOWER
        else:
            total += ADVANCE_PUNCT
    return total
TITLE_Y1, TITLE_Y2 = 0.075, 0.1195



def frame(t):
    """Snap to the frame grid. `off-grid` fires on any authored start or duration that is not."""
    return round(round(t * FPS) / FPS, 5)


def call(tool, args, timeout=900):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                       "params": {"name": tool, "arguments": args}})
    out = subprocess.run(
        ["curl", "-s", "--max-time", str(timeout), "-X", "POST", "http://127.0.0.1:7333/mcp",
         "-H", "Content-Type: application/json",
         "-H", "Accept: application/json, text/event-stream", "-d", body],
        capture_output=True, text=True).stdout
    for line in out.splitlines():
        if line.startswith("data:"):
            out = line[5:].strip()
            break
    if not out.strip():
        raise RuntimeError(f"{tool}: empty reply")
    d = json.loads(out)
    if "error" in d:
        raise RuntimeError(f"{tool}: {json.dumps(d['error'])[:400]}")
    text = d["result"]["content"][0]["text"]
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def main():
    script = json.loads((HERE / "script.json").read_text())
    plan = json.loads((HERE / "windows.json").read_text())
    used = json.loads((HERE / "used.json").read_text())
    windows = plan["windows"]
    total = frame(plan["duration"])
    by_line = {i + 1: w for i, w in enumerate(windows)}

    for m in script["markers"]:
        call("marker_add", {"at": frame(by_line[m["line"]]["start"]), "label": m["label"]})
    print(f"markers: {len(script['markers'])}")

    media = {}
    for n, u in used.items():
        if u["plate"] not in media:
            r = call("media_import", {"path": u["plate"], "id": f"p{n}"})
            media[u["plate"]] = r.get("id", f"p{n}")
    print(f"imported: {len(media)}")

    # Shot k lands on its beat, holds, and is pushed out on the next one while the incoming
    # picture dissolves over it.
    #
    # The shape of this is dictated by how the continuity rule measures, and it is worth writing
    # down because two obvious versions both fail. `held()` samples a whole beat and **the last
    # sample wins** — so an entrance that settles reads identically at the end of its own beat
    # and at the end of the next one, and carries nothing however visible it was. The element has
    # to move *again* during the second beat. So every shot gets two moves: an entrance on its
    # own beat, and a `shunt` on the seam that leaves it standing somewhere new.
    #
    # `shunt` for the seam specifically because it has no opacity channel: the picture is still
    # on stage while it is pushed away, and the incoming fade lets you watch it go. A push hidden
    # under an opaque cut would satisfy the rule and change no pixel, which is the carousel the
    # rule exists to catch.
    entrances = [("press", "out"), ("swell", "in"), ("z-in", "in"), ("press", "out"),
                 ("swell", "in")]
    for k, w in enumerate(windows):
        u = used[str(w["beat"])]
        nxt = windows[k + 1] if k + 1 < len(windows) else None
        start = 0.0 if k == 0 else frame(w["start"])
        end = total if nxt is None else frame(nxt["start"] + 0.85)
        move, direction = entrances[k % len(entrances)]
        eid = f"shot{k:02d}"
        call("add_image", {"mediaId": media[u["plate"]], "start": start,
                           "duration": frame(end - start), "id": eid, "layer": 1,
                           "x": 0.5, "y": PANEL_CY, "anchorX": 0.5, "anchorY": 0.5,
                           "scale": 1.0, "role": "ground"})
        call("animate", {"elementId": eid, "move": move, "direction": direction, "at": 0.0})
        if nxt is not None:
            call("animate", {"elementId": eid, "move": "shunt",
                             "direction": "up" if k % 2 == 0 else "down",
                             "at": frame(nxt["start"] - start)})
        if k:
            # An element field, not an animation channel — a keyed opacity here would be 24
            # off-vocabulary channels in the motion audit.
            call("fade_set", {"elementId": eid, "fadeIn": 0.26})
    print(f"shots: {len(windows)}")

    for idx, w in enumerate(windows):
        lines = w["show"]
        start = frame(w["start"] - 0.08)
        nxt = windows[idx + 1]["start"] if idx + 1 < len(windows) else total
        end = frame(min(nxt - 0.08, w["end"] + 0.34))
        dur = frame(end - start)
        top = CAPTION_Y - (len(lines) - 1) * LINE_H / 2
        for li, line in enumerate(lines):
            y = round(top + li * LINE_H, 4)
            width = round(text_width(line) + CHIP_PAD_X * 2, 4)
            call("add_shape", {"start": start, "duration": dur, "shape": "rect",
                               "id": f"chip{idx:02d}_{li}", "layer": 3,
                               "x": 0.5, "y": y, "anchorX": 0.5, "anchorY": 0.5,
                               "scaleX": width, "scaleY": CHIP_H,
                               "role": "chrome", "tone": "accent"})
            # anchorY 0 and the measured offset, so the line sits on the chip it belongs to.
            call("add_text", {"content": line, "start": start, "duration": dur,
                              "id": f"cap{idx:02d}_{li}", "layer": 4,
                              "x": 0.5, "y": round(y - TEXT_TOP_TO_CENTRE, 4),
                              "anchorX": 0.5, "anchorY": 0.0, "scale": 0.94,
                              "align": "center", "role": "label", "tone": "ink"})
    print(f"captions: {len(windows)}")

    for i, (line, y) in enumerate(zip(script["title"], (TITLE_Y1, TITLE_Y2))):
        call("add_text", {"content": line, "start": 0.0, "duration": total,
                          "id": f"title{i}", "layer": 5, "x": 0.5,
                          "y": round(y - TEXT_TOP_TO_CENTRE, 4),
                          "anchorX": 0.5, "anchorY": 0.0, "align": "center",
                          "role": "label", "tone": "ink", "scale": 0.94, "opacity": 1.0})

    # A bed under the whole runtime, ducked against the lines. Without one the mix cannot be
    # judged at all: `speech-masked` has no gaps to compare the lines against and `bed-too-quiet`
    # has nothing to measure, so both come back skipped — and a suite that could not run has not
    # passed. There is no music pack to install, so the bed is authored: filtered brown noise
    # with two slow low tones under it, which is room tone rather than a tune.
    bed = call("media_import", {"path": str(HERE / "bed.wav"), "id": "bed"})
    call("add_audio", {"mediaId": bed.get("id", "bed"), "start": 0.0, "duration": total,
                       "id": "bedclip", "role": "bed", "volume": 1.0})
    call("duck", {"bedId": "bedclip", "depthDb": 8.0, "attackMs": 400, "releaseMs": 760,
                  "preRollMs": 180, "holdMs": 220, "joinGapMs": 900})

    call("add_text", {"content": "1923", "start": 0.0, "duration": total,
                      "id": "mark", "layer": 5, "x": 0.058,
                      "y": round(0.756 - TEXT_TOP_TO_CENTRE, 4),
                      "anchorX": 0.0, "anchorY": 0.0, "scale": 0.2,
                      "role": "kicker", "tone": "accent"})

    info = call("project_info", {})
    print(json.dumps({k: info[k] for k in
                      ("durationSeconds", "visualElements", "audioElements", "mediaAssets")}))


main()
