#!/usr/bin/env python3
"""The 1929 crash, on the same 138 BPM grid as the Weimar music cut.

What changed from the Weimar cut is the writing. That piece opened on the bare word "1923" and
nobody reading it knew what 1923 was — the cards were fragments of a sentence the narration used
to be carrying, and with the narration gone they carried nothing. Here every card is a complete
statement with its own context: who, where, when, in five or six words a line.

Longer lines need smaller type. The captions drop from the `label` tier to `chrome`, whose
metrics were measured off a calibration frame the same way — at the label tier "The market hits
a record" would have made a chip 0.90 of the frame wide.

So the two rates are deliberately different and neither is guessed:

* the track is 138.00 BPM — 0.435 s a beat, 115 beats, detected off the file rather than assumed
* **pictures cut every 3 beats (1.305 s)** — the reference reel averages 1.35 s
* **cards hold 4-8 beats (1.7-3.5 s)** — two pictures per card, so the text is still while the
  picture underneath it changes

The card lengths in `cards.json` sum to exactly 115 beats, so the last card lands on the last
beat of the track.
"""
import json, subprocess, pathlib

HERE = pathlib.Path(__file__).parent
W, H, FPS = 1080, 1920, 30

PANEL_TOP, PANEL_BOTTOM = 0.209, 0.793
PANEL_CY = (PANEL_TOP + PANEL_BOTTOM) / 2

CAPTION_Y = 0.470
LINE_H = 0.0335
CHIP_PAD_X = 0.022
CHIP_H = 0.0330
TITLE_Y1, TITLE_Y2 = 0.075, 0.1195

# The `chrome` tier, measured off a calibration frame (four real caption strings, none of which
# wrapped). Deliberately 5-7 % generous so a chip is never narrower than the line inside it.
TEXT_TOP_TO_CENTRE = 0.0155
ADVANCE_UPPER, ADVANCE_LOWER = 0.0360, 0.0310
ADVANCE_SPACE, ADVANCE_PUNCT = 0.0150, 0.0140
CAPTION_ROLE = "chrome"

BPM = 138.0
BEAT = 60.0 / BPM
FIRST_BEAT = 0.36          # where the grid starts in the track


def text_width(s):
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


def frame(t):
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
    spec = json.loads((HERE / "cards1929.json").read_text())
    pairs = json.loads((HERE / "picks1929.json").read_text())["pairs"]
    used = json.loads((HERE / "used1929.json").read_text())
    cards = spec["cards"]
    assert len(cards) == len(pairs), f"{len(cards)} cards vs {len(pairs)} picture pairs"

    # Card boundaries, in seconds, straight off the beat grid.
    at = FIRST_BEAT
    for card in cards:
        card["start"] = frame(at)
        at += card["beats"] * BEAT
        card["end"] = frame(at)
    total = frame(min(at + 0.30, 50.26))

    call("project_create", {"name": "wall-street-1929", "width": W, "height": H, "fps": FPS,
                            "kit": "stadium", "background": "#000000",
                            "brief": "The 1929 Wall Street crash, cut to a 138 BPM track. No voice; "
                                     "each card is a complete statement with its own context."})

    # Markers on the story beats. With no narration there are no speech cues, so these are the
    # only thing `check` can derive a beat from — which is the honest arrangement anyway.
    for card in cards:
        if card.get("mark"):
            call("marker_add", {"at": card["start"], "label": card["mark"]})
    print(f"markers: {sum(1 for c in cards if c.get('mark'))}")

    media = {}
    for key, u in used.items():
        r = call("media_import", {"path": u["plate"], "id": f"m{key}"})
        media[key] = r.get("id", f"m{key}")
    print(f"imported: {len(media)}")

    # Two shots per card. Both are alive until after the *next* card starts, so whichever beat
    # the gate picks, some picture spans it — and both take a `shunt` on that boundary so the
    # thing they share is an element that visibly moved, not one merely left switched on.
    # Opacity-free entrances only, and this is the whole reason the cuts read as cuts.
    #
    # `press`, `swell` and `z-in` each carry an opacity channel that ramps over 9-10 frames, so a
    # shot using one fades up over 0.3 s however hard you cut to it. With 38 pictures in 50 s
    # that meant nothing ever actually cut — measured, only 4 frames in the whole piece scored as
    # a scene change. `split` and `unveil` move geometry and leave opacity alone, so the new
    # picture is fully there on its first frame and slides into place under the panel mask.
    # The entrance must also not share a channel with the seam move. `unveil` is y and so is
    # `shunt`, and an element carrying two y moves stops matching any single registry signature —
    # the audit reports the channel as hand-keyed. So: entrances on x, seams on y, and the
    # variety comes from direction and from the ambient pan rather than from stacking channels.
    entrances = [("split", "right"), ("split", "left")]
    shots = 0
    for ci, (card, pair) in enumerate(zip(cards, pairs)):
        nxt = cards[ci + 1] if ci + 1 < len(cards) else None
        half = card["start"] + (card["end"] - card["start"]) / 2
        for si, index in enumerate(pair):
            start = frame(card["start"] if si == 0 else half)
            if ci == 0 and si == 0:
                start = 0.0
            end = total if nxt is None else frame(min(total, nxt["start"] + 0.95))
            # Long enough for the pan to finish; the tail is covered by the next picture.
            end = min(total, max(end, frame(start + 5.20)))
            eid = f"s{ci:02d}{si}"
            move, direction = entrances[(ci * 2 + si) % len(entrances)]
            call("add_image", {"mediaId": media[str(index)], "start": start,
                               "duration": frame(end - start), "id": eid, "layer": 1,
                               "x": 0.5, "y": PANEL_CY, "anchorX": 0.5, "anchorY": 0.5,
                               "scale": 1.0, "role": "ground"})
            # A stencil the size of the picture panel, held still while the picture moves under
            # it. Without this the seam `shunt` slides the outgoing frame straight out of the
            # panel and over the headline — the mask is what makes the panel an actual window
            # rather than just where the picture happens to sit. The gap the shunt opens behind
            # it does not matter: the incoming picture is already covering the panel.
            call("mask_set", {"elementId": eid, "shape": "rect", "x": 0.5, "y": PANEL_CY,
                              "width": 1.0, "height": PANEL_BOTTOM - PANEL_TOP, "feather": 0})
            call("animate", {"elementId": eid, "move": move, "direction": direction, "at": 0.0})
            # `drift` is a fixed 5 s move. On the closing cards there is no longer 5 s of
            # timeline left to run it in, and a move that outlives its clip is reported as one
            # that never lands — so those shots simply do not get the pan.
            if end - start >= 5.05:
                call("animate", {"elementId": eid, "move": "drift",
                                 "direction": "left" if (ci + si) % 2 == 0 else "right",
                                 "at": 0.0, "distance": 2.4})
            if nxt is not None:
                call("animate", {"elementId": eid, "move": "shunt",
                                 "direction": "up" if si == 0 else "down",
                                 "at": frame(nxt["start"] - start)})
            # Hard cut on the mid-card change, a short dissolve on the card change.
            #
            # At 1.3 s a dissolve blunts the cut, and the reference reel cuts hard throughout. But
            # the card boundary is where the outgoing pictures `shunt`, and a hard cut there would
            # bury that move under an opaque frame — leaving a carry that satisfies the continuity
            # rule and changes no pixel. So the dissolve is spent only where it buys something.
            if si == 0 and ci > 0:
                call("fade_set", {"elementId": eid, "fadeIn": 0.20})
            shots += 1
    print(f"shots: {shots}")

    for ci, card in enumerate(cards):
        lines = card["show"]
        start = frame(card["start"] - 0.06)
        end = frame(card["end"] - 0.06)
        dur = frame(end - start)
        top = CAPTION_Y - (len(lines) - 1) * LINE_H / 2
        for li, line in enumerate(lines):
            y = round(top + li * LINE_H, 4)
            width = round(text_width(line) + CHIP_PAD_X * 2, 4)
            call("add_shape", {"start": start, "duration": dur, "shape": "rect",
                               "id": f"chip{ci:02d}_{li}", "layer": 3,
                               "x": 0.5, "y": y, "anchorX": 0.5, "anchorY": 0.5,
                               "scaleX": width, "scaleY": CHIP_H,
                               "role": "chrome", "tone": "accent"})
            call("add_text", {"content": line, "start": start, "duration": dur,
                              "id": f"cap{ci:02d}_{li}", "layer": 4,
                              "x": 0.5, "y": round(y - TEXT_TOP_TO_CENTRE, 4),
                              "anchorX": 0.5, "anchorY": 0.0, "scale": 0.94,
                              "align": "center", "role": CAPTION_ROLE, "tone": "ink"})
    print(f"cards: {len(cards)}")

    for i, (line, y) in enumerate(zip(spec["title"], (TITLE_Y1, TITLE_Y2))):
        call("add_text", {"content": line, "start": 0.0, "duration": total,
                          "id": f"title{i}", "layer": 5, "x": 0.5,
                          "y": round(y - TEXT_TOP_TO_CENTRE, 4),
                          "anchorX": 0.5, "anchorY": 0.0, "align": "center",
                          "role": "label", "tone": "ink", "scale": 0.94, "opacity": 1.0})

    call("add_text", {"content": spec.get("mark", "1929"), "start": 0.0, "duration": total,
                      "id": "mark", "layer": 5, "x": 0.058,
                      "y": round(0.756 - TEXT_TOP_TO_CENTRE, 4),
                      "anchorX": 0.0, "anchorY": 0.0, "scale": 0.2,
                      "role": "kicker", "tone": "accent"})

    # The track, as supplied. It is the whole soundtrack — there is nothing to duck it against.
    bed = call("media_import", {"path": str(HERE / "music.wav"), "id": "music"})
    call("add_audio", {"mediaId": bed.get("id", "music"), "start": 0.0,
                       "duration": total, "id": "bedclip", "role": "bed", "volume": 1.0})
    call("fade_set", {"elementId": "bedclip", "fadeOut": 0.9})

    info = call("project_info", {})
    print(json.dumps({k: info[k] for k in
                      ("durationSeconds", "visualElements", "audioElements", "mediaAssets")}))


main()
