#!/usr/bin/env python3
"""Cut a raw interview down to a clip, the way a podcast editor does.

Three decisions, and every one of them is made from a measurement rather than by watching:

1. **Which shots are worth keeping** — `shots_detect` finds the cuts, then SigLIP scores a frame
   from each against a description of the guest, the host, the b-roll and the titles. That is
   "who is on screen" solved from the picture, which matters because this recording's audio is
   dual-mono: L and R correlate at 1.000, so there is no stereo cue to tell the speakers apart
   and nothing to diarise with.
2. **What to remove inside them** — `silence_detect` measures the noise floor (−50.9 dB here),
   puts the threshold 6 dB above it, and returns the dead air. 59 gaps, 35.9 s, 9.6% of the take.
3. **Where the picture sits** — the source is 640×360. A portrait crop of a 360-line source is
   202 px wide and upscales 5.3×, which is mush. So the video stays landscape in a portrait
   frame at 1.7× — the shape every podcast clip is actually cut in — and the frame does the rest.

No voiceover, no music, no captions invented. The audio is the interview's own.
"""
import json
import pathlib
import subprocess

HERE = pathlib.Path(__file__).parent
W, H, FPS = 1080, 1920, 30

# The conversation, after the titles and the b-roll sequence: host question, guest answer,
# host question, guest answer. Chosen from the labels, not by scrubbing.
FROM_SHOT, TO_SHOT = 32, 35

PANEL_TOP = 0.30            # the video sits in the upper-middle, name below it
SOURCE_ASPECT = 640 / 360


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
    d = json.loads(out)
    if "error" in d:
        raise RuntimeError(f"{tool}: {json.dumps(d['error'])[:300]}")
    text = d["result"]["content"][0]["text"]
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def frame(t):
    return round(round(t * FPS) / FPS, 5)


def main():
    shots = [s for s in json.loads((HERE / "shots_labelled.json").read_text())
             if FROM_SHOT <= s["index"] <= TO_SHOT]
    source = str((HERE / "pod" / "goodall.webm").resolve())

    call("project_create", {"name": "goodall-clip", "width": W, "height": H, "fps": FPS,
                            "kit": "stadium", "background": "#000000",
                            "brief": "A podcast clip cut from a raw interview: dead air removed, "
                                     "shots chosen by who is on screen. No voiceover."})
    call("media_import", {"path": source, "id": "src"})

    scan = call("silence_detect", {"path": source, "minimumSeconds": 0.45, "padSeconds": 0.10})
    silences = [(s["startSeconds"], s["endSeconds"]) for s in scan["silences"]]
    print(f"threshold {scan['thresholdDb']} dB (floor {scan['noiseFloorDb']}), "
          f"{len(silences)} silences over the whole take")

    # Every span worth keeping: inside a chosen shot and outside every silence.
    spans = []
    for shot in shots:
        at = shot["startSeconds"]
        for a, b in silences:
            if b <= at or a >= shot["endSeconds"]:
                continue
            if a > at:
                spans.append((at, min(a, shot["endSeconds"]), shot["label"]))
            at = max(at, b)
        if at < shot["endSeconds"]:
            spans.append((at, shot["endSeconds"], shot["label"]))

    # A splice shorter than this is a stutter, not an edit — fold it into its neighbour.
    spans = [(a, b, who) for a, b, who in spans if b - a >= 0.45]
    raw = sum(s["durationSeconds"] for s in shots)
    kept = sum(b - a for a, b, _ in spans)
    print(f"shots {FROM_SHOT}-{TO_SHOT}: {raw:.1f}s -> {kept:.1f}s in {len(spans)} splices "
          f"({100 * (1 - kept / raw):.1f}% removed)")

    panel_h = (W / SOURCE_ASPECT) / H          # the video's height as a canvas fraction

    # Lay the splices out on the timeline first, so a clip can be given a tail that runs into
    # the next one.
    placed, at = [], 0.0
    for start, end, who in spans:
        duration = frame(end - start)
        placed.append({"at": frame(at), "duration": duration, "from": frame(start), "who": who})
        at += duration
    total = frame(at)

    # `add_video` carries no audio — the picture and the sound are separate elements. That is
    # what made the first cut of this export silent, and it is also what lets the picture
    # overlap while the sound stays butted: two video clips on top of each other is a dissolve,
    # two audio clips on top of each other is both people talking at once.
    marks = 0
    for i, clip in enumerate(placed):
        nxt = placed[i + 1] if i + 1 < len(placed) else None
        changes = nxt is not None and nxt["who"] != clip["who"]
        # Hold the picture past its own splice so it is still on screen at the next beat, which
        # is what the continuity rule measures. The next clip covers it.
        tail = 0.9 if nxt is not None else 0.0
        end_at = min(total, clip["at"] + clip["duration"] + tail)
        eid = f"clip{i:02d}"
        call("add_video", {"mediaId": "src", "start": clip["at"],
                           "duration": frame(end_at - clip["at"]),
                           "trimStart": clip["from"], "id": eid, "layer": 1,
                           "x": 0.5, "y": PANEL_TOP + panel_h / 2,
                           "anchorX": 0.5, "anchorY": 0.5, "role": "ground",
                           "cover": {"width": 1.0, "height": panel_h}})
        # A push on every seam, larger where the speaker changes.
        #
        # Every splice is a beat — `check` derives one from each speech clip's start — so every
        # splice needs the outgoing frame to visibly move, or the join reads as a rebuild. It is
        # also the right treatment: a silence cut in a talking head is a jump cut, and a push
        # makes it deliberate instead of a glitch. The speaker change gets the full move so the
        # two kinds of cut do not look the same.
        if nxt is not None:
            call("animate", {"elementId": eid, "move": "shunt",
                             "direction": "up" if changes else "down",
                             "distance": 1.0 if changes else 0.45,
                             "at": frame(nxt["at"] - clip["at"])})
        if changes:
            call("marker_add", {"at": nxt["at"], "label": nxt["who"]})
            marks += 1
        if i == 0:
            call("marker_add", {"at": 0.0, "label": clip["who"]})
            marks += 1

        # The sound, exact and butted. Role speech, so the mix checks judge it as speech.
        call("add_audio", {"mediaId": "src", "start": clip["at"], "duration": clip["duration"],
                           "trimStart": clip["from"], "id": f"snd{i:02d}",
                           "role": "speech", "volume": 1.0})
    print(f"placed {len(placed)} clips + {len(placed)} audio, {marks} beats, {total:.2f}s")

    # The name of whoever is on screen, changing with the shots — the visible half of the
    # detection. One element per run, not per splice.
    runs = []
    for clip in placed:
        if runs and runs[-1][2] == clip["who"]:
            runs[-1][1] = clip["at"] + clip["duration"]
        else:
            runs.append([clip["at"], clip["at"] + clip["duration"], clip["who"]])
    NAMES = {"guest": "JANE GOODALL", "host": "SILVER DONALD CAMERON"}
    for i, (a, b, who) in enumerate(runs):
        call("add_text", {"content": NAMES.get(who, who.upper()),
                          "start": frame(a), "duration": frame(b - a),
                          "id": f"who{i:02d}", "layer": 4,
                          "x": 0.5, "y": round(PANEL_TOP + panel_h + 0.035, 4),
                          "anchorX": 0.5, "anchorY": 0.0, "align": "center", "scale": 0.94,
                          "role": "label", "tone": "ink"})

    call("add_text", {"content": "JANE GOODALL ON HOPE", "start": 0.0, "duration": total,
                      "id": "strap", "layer": 5, "x": 0.5, "y": 0.075,
                      "anchorX": 0.5, "anchorY": 0.0, "align": "center", "scale": 0.94,
                      "role": "label", "tone": "ink"})
    # A wide box: `scale` sizes the layout box and never the glyph, so a narrow one wraps the
    # line instead of shrinking it — which is exactly what happened here first time.
    call("add_text", {"content": "THE GREEN INTERVIEW  ·  CC BY 3.0", "start": 0.0,
                      "duration": total, "id": "lic", "layer": 5, "x": 0.5, "y": 0.905,
                      "anchorX": 0.5, "anchorY": 0.0, "align": "center", "scale": 0.94,
                      "role": "chrome", "tone": "dim"})

    info = call("project_info", {})
    print(json.dumps({k: info[k] for k in
                      ("durationSeconds", "visualElements", "audioElements")}))


main()
