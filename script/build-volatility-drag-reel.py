#!/usr/bin/env python3
"""Build the "Volatility Drag" reel entirely through the vii MCP server.

Every visual decision is a vii MCP tool call over http://127.0.0.1:7333/mcp — this script is
only the client. Nothing else touches a pixel.
"""
import json
import os
import sys
import urllib.request

URL = "http://127.0.0.1:7333/mcp"
_id = [0]


def call(tool, **args):
    _id[0] += 1
    payload = {
        "jsonrpc": "2.0", "id": _id[0], "method": "tools/call",
        "params": {"name": tool, "arguments": args},
    }
    req = urllib.request.Request(
        URL, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as response:
        body = json.load(response)
    result = body.get("result", {})
    text = result.get("content", [{}])[0].get("text", "")
    if result.get("isError"):
        print(f"  !! {tool}({args}) -> {text}", file=sys.stderr)
        sys.exit(1)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


# ---------------------------------------------------------------- house style
GROUND = "#0E0E12"
PRIMARY = "#EDECE6"
SECONDARY = "#A8A8B0"
MUTED = "#73737E"
ACCENT = "#FF5B5B"
COOL = "#8A93A3"
TRACK = "#606070"          # 3.12:1 against ground — measured, not guessed

DISPLAY = "Helvetica Neue"
MONO = "Menlo"

W, H = 1080, 1920
GUTTER = 96                # left content edge
CONTENT_W = 804            # to x=900; the right 180px is the action rail keep-out
BOX = CONTENT_W / W        # text box scale that wraps at the content width
HERO = 0.95                # wider box for display figures, which must never wrap

# Font sizes are quoted against a 1080-tall canvas and vii scales them by H/1080 = 1.778.
PX = H / 1080


def fs(on_screen_px):
    """Convert a wanted on-screen pixel size into vii's fontSize."""
    return round(on_screen_px / PX, 1)


# ------------------------------------------------------------- clip structure
CLIPS = [
    ("c1", 0.000, 4.286),
    ("c2", 4.286, 4.285),
    ("c3", 8.571, 2.143),
    ("c4", 10.714, 4.286),
    ("c5", 15.000, 4.286),
    ("c6", 19.286, 2.143),
]
CLIP = {name: (start, dur) for name, start, dur in CLIPS}
TOTAL = 21.429
XFADE = 0.45               # neighbours overlap by this much, so no frame is ever blank


def beat(n):
    """Absolute time of the nth beat pulse of the 111 BPM bed."""
    return 0.255 + n * 0.540


def land(beat_n, clip, dur=0.52):
    """Local start time such that a `dur`-long entrance SETTLES exactly on beat `beat_n`.

    Passing the beat straight in as the start time was the mistake: the element then began
    moving on the beat and arrived half a second late, so nothing was ever actually synced to
    the music. Negative results are clamped — a beat too close to the cut cannot be hit.
    """
    return max(0.0, beat(beat_n) - CLIP[clip][0] - dur)


ids = [0]


def uid(prefix):
    ids[0] += 1
    return f"{prefix}{ids[0]}"


def lives(clip, extend=XFADE):
    """Start and duration for an element that lives for its whole clip, plus the crossfade."""
    start, dur = CLIP[clip]
    return start, dur + extend


def text(clip, content, *, y, size, color=PRIMARY, family=DISPLAY, weight=400,
         align="left", x=GUTTER, tracking=0.0, line_height=1.15, layer=1,
         scale=BOX, start=None, dur=None, eid=None):
    """Place text with its box's top-left corner at (x, y) in pixels."""
    start_t, duration = lives(clip)
    eid = eid or uid("t")
    call("add_text",
         id=eid, layer=layer,
         start=start if start is not None else start_t,
         duration=dur if dur is not None else duration,
         content=content, fontSize=fs(size), color=color,
         fontFamily=family, fontWeight=weight, align=align,
         letterSpacing=tracking, lineHeight=line_height,
         x=x / W, y=y / H, anchorX=0.0, anchorY=0.0, scale=scale)
    return eid


def rect(clip, *, x, y, w, h, color, anchor_x=0.0, anchor_y=0.0, radius=0.0,
         layer=1, opacity=1.0, start=None, dur=None, eid=None):
    """Place a rectangle by pixel geometry. (x, y) is the anchor point."""
    start_t, duration = lives(clip)
    eid = eid or uid("r")
    call("add_shape",
         id=eid, layer=layer,
         start=start if start is not None else start_t,
         duration=dur if dur is not None else duration,
         shape="rect", radius=radius, color=color,
         x=x / W, y=y / H, anchorX=anchor_x, anchorY=anchor_y,
         scaleX=w / W, scaleY=h / H, opacity=opacity)
    return eid


def fade_in(eid, at, dur=0.36):
    call("animate", elementId=eid, property="opacity", easing="ease-out",
         keys=[{"t": 0, "value": 0}, {"t": at, "value": 0},
               {"t": at + dur, "value": 1}])


def rise(eid, at, *, distance=34, dur=0.52, y_px):
    """The house entrance: type arrives from below its own baseline and settles."""
    call("animate", elementId=eid, property="y", easing="power-out",
         keys=[{"t": 0, "value": (y_px + distance) / H},
               {"t": at, "value": (y_px + distance) / H},
               {"t": at + dur, "value": y_px / H}])
    fade_in(eid, at, dur * 0.7)


def fade_out(eid, clip):
    """Fade an element down across the crossfade into the next clip."""
    _, dur = CLIP[clip]
    call("animate", elementId=eid, property="opacity", easing="ease-in-out",
         keys=[{"t": dur, "value": 1}, {"t": dur + XFADE, "value": 0}])


def enter_exit(eid, clip, at, y_px, *, distance=34, dur=0.52):
    """Rise in, hold, then fade out over the crossfade — in one animation per property."""
    _, clip_dur = CLIP[clip]
    call("animate", elementId=eid, property="y", easing="power-out",
         keys=[{"t": 0, "value": (y_px + distance) / H},
               {"t": at, "value": (y_px + distance) / H},
               {"t": at + dur, "value": y_px / H}])
    call("animate", elementId=eid, property="opacity", easing="ease-out",
         keys=[{"t": 0, "value": 0},
               {"t": at, "value": 0},
               {"t": at + dur * 0.7, "value": 1},
               {"t": clip_dur, "value": 1},
               {"t": clip_dur + XFADE, "value": 0}])


def hold_then_out(eid, clip, at=0.0, fade=0.30):
    _, clip_dur = CLIP[clip]
    call("animate", elementId=eid, property="opacity", easing="ease-out",
         keys=[{"t": 0, "value": 0},
               {"t": at, "value": 0},
               {"t": at + fade, "value": 1},
               {"t": clip_dur, "value": 1},
               {"t": clip_dur + XFADE, "value": 0}])


# ============================================================== build the reel
print("project…")
call("project_create", name="Volatility Drag", width=W, height=H, fps=30,
     background=GROUND)

music = call("media_import",
             path="/Users/himanshu/codes/qubitquant/website/brag/_build/_template/"
                  "assets/music/bed-112bpm.mp3")
print(f"  music: {music['name']} {music.get('durationSeconds', 0):.3f}s")
# Ducked when a voice is on top of it: a 0.9 bed buries narration.
MUSIC_VOLUME = float(os.environ.get("VII_MUSIC_VOLUME", "0.9"))  # 0.12 under narration
call("add_audio", mediaId=music["mediaId"], start=0.0, duration=TOTAL, volume=MUSIC_VOLUME)

# A persistent hairline rail at the gutter — the one element that survives every cut, so the
# piece reads as one document rather than six unrelated cards.
rail = rect("c1", x=GUTTER - 34, y=250, w=2, h=1180, color=TRACK, opacity=0.55,
            start=0.0, dur=TOTAL, eid="rail")
call("animate", elementId=rail, property="scaleY", easing="power-out",
     keys=[{"t": 0, "value": 0.0}, {"t": 0.34, "value": 1180 / H}])

# ---------------------------------------------------------------------- c1
# HOOK: the two returns, nothing else. The payoff (-25%) is deliberately withheld.
k1 = text("c1", "VOLATILITY DRAG", y=250, size=34, color=MUTED, family=MONO,
          tracking=0.18, weight=600)
hold_then_out(k1, "c1", at=0.0, fade=0.25)

up = text("c1", "+50%", y=470, size=270, color=PRIMARY, family=MONO, weight=600,
          scale=HERO)
enter_exit(up, "c1", at=land(1, "c1"), y_px=470, distance=46)

then = text("c1", "then", y=830, size=64, color=SECONDARY, family=DISPLAY, weight=400)
enter_exit(then, "c1", at=land(2, "c1"), y_px=830, distance=22)

down = text("c1", "−50%", y=960, size=270, color=ACCENT, family=MONO, weight=600,
            scale=HERO)
enter_exit(down, "c1", at=land(3, "c1"), y_px=960, distance=46)

sub = text("c1", "One account. Two periods.", y=1360, size=52, color=SECONDARY,
           family=DISPLAY, weight=400)
enter_exit(sub, "c1", at=land(5, "c1"), y_px=1360, distance=26)

# ---------------------------------------------------------------------- c2
# SETUP: the arithmetic mean — the answer that feels right and is wrong.
k2 = text("c2", "THE AVERAGE SAYS", y=250, size=34, color=MUTED, family=MONO,
          tracking=0.18, weight=600)
hold_then_out(k2, "c2", at=0.0, fade=0.25)

zero = text("c2", "0%", y=560, size=380, color=SECONDARY, family=MONO, weight=600,
            scale=HERO)
enter_exit(zero, "c2", at=land(9, "c2"), y_px=560, distance=50)

# A flat rule: the shape of "nothing happened". Grows from the gutter, cool grey, not accent —
# this is the false answer, so it gets no voltage.
flat = rect("c2", x=GUTTER, y=1080, w=CONTENT_W, h=14, color=COOL, radius=0.5)
call("animate", elementId=flat, property="scaleX", easing="power-out",
     keys=[{"t": 0, "value": 0.0},
           {"t": land(11, "c2", 0.7), "value": 0.0},
           {"t": land(11, "c2", 0.7) + 0.7, "value": CONTENT_W / W}])
hold_then_out(flat, "c2", at=land(11, "c2", 0.7))

body2 = text("c2", "+50% and −50%\naverage to zero.", y=1210, size=62,
             color=PRIMARY, family=DISPLAY, weight=400, line_height=1.22)
enter_exit(body2, "c2", at=land(12, "c2"), y_px=1210, distance=28)

# ---------------------------------------------------------------------- c3
# TURN: one idea, one line, short clip.
turn_a = text("c3", "Your account", y=790, size=96, color=PRIMARY, family=DISPLAY,
              weight=400)
enter_exit(turn_a, "c3", at=0.06, y_px=790, distance=30, dur=0.42)
turn_b = text("c3", "disagrees.", y=940, size=96, color=ACCENT, family=DISPLAY,
              weight=700)
enter_exit(turn_b, "c3", at=land(17, "c3"), y_px=940, distance=30)

# ---------------------------------------------------------------------- c4
# PAYOFF: the actual path, as columns growing from a shared baseline.
k4 = text("c4", "WHAT ACTUALLY HAPPENS", y=250, size=34, color=MUTED, family=MONO,
          tracking=0.18, weight=600)
hold_then_out(k4, "c4", at=0.0, fade=0.25)

BASE = 1040                # shared baseline for the columns
COL_W = 170
COL_MAX = 420              # pixel height of the tallest column (150)
COLS = [
    ("100", 100, "START", PRIMARY),
    ("150", 150, "+50%", COOL),
    ("75", 75, "−50%", ACCENT),
]
c4_start = CLIP["c4"][0]

# Baseline rule under the columns, drawn first so the columns sit on it.
RULE_W = 760
rule = rect("c4", x=GUTTER, y=BASE, w=RULE_W, h=3, color=TRACK, anchor_y=0.0)
call("animate", elementId=rule, property="scaleX", easing="power-out",
     keys=[{"t": 0, "value": 0.0}, {"t": 0.25, "value": 0.0},
           {"t": 0.85, "value": RULE_W / W}])
hold_then_out(rule, "c4", at=0.25)

# A reference line at the starting level (100). This replaces per-column track boxes: a track
# behind each column made the value labels read as sitting *inside* a box, and at any opacity
# low enough to look right it composited back to ~1.3:1 against the ground — an invisible
# denominator. One gridline at the level that matters is a better denominator anyway, because
# the whole point of the piece is that the third column ends up BELOW where it started.
START_Y = BASE - COL_MAX * 100 / 150.0
grid = rect("c4", x=GUTTER, y=START_Y, w=RULE_W, h=3, color=MUTED, anchor_y=0.5)
call("animate", elementId=grid, property="scaleX", easing="power-out",
     keys=[{"t": 0, "value": 0.0}, {"t": 0.95, "value": 0.0},
           {"t": 1.55, "value": RULE_W / W}])
hold_then_out(grid, "c4", at=0.95)
grid_label = text("c4", "start", y=START_Y - 56, size=36, color=MUTED, family=MONO,
                  align="right", x=GUTTER + RULE_W - 210, scale=210 / W)
hold_then_out(grid_label, "c4", at=1.25)

for index, (value_label, value, caption, colour) in enumerate(COLS):
    cx = 200 + index * 270
    height = COL_MAX * value / 150.0
    col = rect("c4", x=cx, y=BASE, w=COL_W, h=height, color=colour,
               anchor_x=0.5, anchor_y=1.0)
    at = 0.55 + index * 0.26
    call("animate", elementId=col, property="scaleY", easing="power-out",
         keys=[{"t": 0, "value": 0.0}, {"t": at, "value": 0.0},
               {"t": at + 0.62, "value": height / H}])
    # Caption then value, BOTH below the baseline on the column's own axis. Floating the value
    # above each column put the short third column's "75" straight through the start gridline
    # and into the gridline's own label. Below the axis every label sits on one grid, nothing
    # can collide with the chart, and the reading order is caption → figure for all three.
    cap = text("c4", caption, y=BASE + 26, size=40, color=MUTED, family=MONO,
               weight=400, align="center", x=cx - 135, scale=270 / W)
    hold_then_out(cap, "c4", at=at + 0.10)
    value_id = text("c4", value_label, y=BASE + 82, size=68, color=colour,
                    family=MONO, weight=600, align="center",
                    x=cx - 135, scale=270 / W)
    hold_then_out(value_id, "c4", at=at + 0.45)

# The payoff number, landing on a beat, after the last column has settled.
payoff_at = land(25, "c4")
loss = text("c4", "−25%", y=1270, size=200, color=ACCENT, family=MONO, weight=600,
            scale=HERO)
enter_exit(loss, "c4", at=payoff_at, y_px=1270, distance=40)

# ---------------------------------------------------------------------- c5
# CONSEQUENCE: the asymmetry of recovery. Every pair is exact: 1/(1-d) - 1.
k5 = text("c5", "TO GET BACK TO EVEN", y=250, size=34, color=MUTED, family=MONO,
          tracking=0.18, weight=600)
hold_then_out(k5, "c5", at=0.0, fade=0.25)

ROWS = [("−10%", "+11%", 0.11, SECONDARY),
        ("−20%", "+25%", 0.25, SECONDARY),
        ("−50%", "+100%", 1.00, ACCENT)]
ROW_Y = 560
ROW_STEP = 330
BAR_X = 430
BAR_MAX = 390
BAR_H = 24
for index, (drop, need, magnitude, colour) in enumerate(ROWS):
    y = ROW_Y + index * ROW_STEP
    at = 0.35 + index * 0.42
    lose = text("c5", drop, y=y, size=76, color=MUTED, family=MONO, weight=400,
                x=GUTTER, scale=300 / W)
    hold_then_out(lose, "c5", at=at)
    # Track, then the recovery bar over it.
    # Full-opacity track: a measured 3.12:1 against the ground. Fading it to 30% would
    # composite back down to ~1.3:1 — an invisible denominator, which is the whole defect.
    rect("c5", x=BAR_X, y=y + 118, w=BAR_MAX, h=BAR_H, color=TRACK, anchor_y=1.0,
         radius=0.5)
    bar = rect("c5", x=BAR_X, y=y + 118, w=BAR_MAX * magnitude, h=BAR_H, color=colour,
               anchor_y=1.0, radius=0.5)
    call("animate", elementId=bar, property="scaleX", easing="power-out",
         keys=[{"t": 0, "value": 0.0}, {"t": at + 0.12, "value": 0.0},
               {"t": at + 0.78, "value": BAR_MAX * magnitude / W}])
    gain = text("c5", need, y=y, size=76, color=colour, family=MONO, weight=600,
                x=BAR_X, scale=300 / W)
    hold_then_out(gain, "c5", at=at + 0.30)

# ---------------------------------------------------------------------- c6
# CLOSE: the thesis, and the kicker returns so the last frame rhymes with the first.
def close_line(eid, at, y_px, dur=0.52):
    """Enter as usual, but fade out INSIDE the clip so the reel ends on the kicker alone.

    The last frame then rhymes with the first — same kicker, same position, in accent rather
    than muted — so the loop reads as a return rather than a hard reset.
    """
    _, clip_dur = CLIP["c6"]
    call("animate", elementId=eid, property="y", easing="power-out",
         keys=[{"t": 0, "value": (y_px + 26) / H},
               {"t": at, "value": (y_px + 26) / H},
               {"t": at + dur, "value": y_px / H}])
    call("animate", elementId=eid, property="opacity", easing="ease-in-out",
         keys=[{"t": 0, "value": 0},
               {"t": at, "value": 0},
               {"t": at + dur * 0.7, "value": 1},
               {"t": clip_dur - 0.38, "value": 1},
               {"t": clip_dur - 0.02, "value": 0}])


close_a = text("c6", "Averages add.", y=820, size=88, color=SECONDARY,
               family=DISPLAY, weight=400)
close_line(close_a, 0.04, 820, dur=0.42)
close_b = text("c6", "Money compounds.", y=960, size=88, color=PRIMARY,
               family=DISPLAY, weight=700)
close_line(close_b, land(37, "c6"), 960)

# The kicker survives to the final frame at full strength — it is the thing that rhymes.
k6 = text("c6", "VOLATILITY DRAG", y=250, size=34, color=ACCENT, family=MONO,
          tracking=0.18, weight=600)
call("animate", elementId=k6, property="opacity", easing="ease-out",
     keys=[{"t": 0, "value": 0}, {"t": 0.30, "value": 1},
           {"t": CLIP["c6"][1] + XFADE, "value": 1}])

info = call("project_info")
print(f"built: {info['visualElements']} visual elements, {info['audioElements']} audio, "
      f"{info['layers']} layers, {info['durationSeconds']:.3f}s")
call("project_save", path="/Users/himanshu/.claude/jobs/5fdf9528/tmp/volatility-drag.json")


# ============================================================ narration (opt-in)
# VII_NARRATE=1 speaks the reel with Kokoro and lays word-synced captions under it. One line
# per scene, each starting just inside its own clip so a line never steps on the one before.
if os.environ.get("VII_NARRATE") == "1":
    VOICE = os.environ.get("VII_VOICE", "af_heart")
    # Kokoro comes out quiet: mean around -26 dB against a -16.7 dB music bed, so at equal
    # nominal volume the bed masks the voice completely. 1.4x lifts the worst-case narration
    # peak to -1.1 dB (measured, so it cannot clip) and puts the voice 11.5 dB over the ducked
    # bed — the separation broadcast voice-over aims for.
    VOICE_VOLUME = float(os.environ.get("VII_VOICE_VOLUME", "1.4"))
    SPEED = float(os.environ.get("VII_SPEED", "1.06"))
    # Captions sit at 0.79 — inside the platform caption band. This reel was composed as a
    # silent piece whose own type fills the frame down to y=1490, so there is nowhere higher
    # for a caption to go without covering the artwork. Noted rather than hidden.
    CAPTION_Y = float(os.environ.get("VII_CAPTION_Y", "0.79"))

    # The screen already carries every number. Narration that repeats them teaches nothing and
    # gives a viewer two copies of one message to read at once — so the voice carries only what
    # the picture cannot: the reasoning, and why it matters. Read end to end the narration is a
    # complete explanation that never says a single on-screen figure.
    LINES = [
        (0.10,  "A gain, then an equal loss. Feels like a wash."),
        (4.40,  "The arithmetic agrees. Add them, divide by two, you get nothing."),
        (8.70,  "But nobody trades an average."),
        (10.85, "The loss lands on a bigger balance than the gain did."),
        (15.10, "And climbing back always starts from a smaller base."),
        # Started at 19.30 rather than 19.55: the closer needs 2.07s and the bed ends
        # at 21.429, so a later start clipped the last word.
        (19.30, "Volatility is the cost."),
    ]

    print("narrating…")
    overruns = []
    for index, (at, line) in enumerate(LINES):
        result = call("narrate", text=line, start=at, voice=VOICE, speed=SPEED,
                      volume=VOICE_VOLUME, captions=True,
                      captionY=CAPTION_Y, captionFontSize=38, captionFontFamily="Helvetica Neue",
                      captionFontWeight=600, captionColor="#EDECE6", captionLayer=12,
                      # 4 words at 38px fits the 907px caption box on one line. At 5 words /
                      # 42px a caption like "bigger balance than the gain" wrapped and
                      # orphaned its last word onto a second line.
                      maxWords=4, minCaptionSeconds=0.6, maxCaptionSeconds=2.6)
        end = result["endSeconds"]
        nxt = LINES[index + 1][0] if index + 1 < len(LINES) else TOTAL
        flag = "" if end <= nxt + 0.02 else f"  OVERRUNS next line by {end - nxt:.2f}s"
        if flag:
            overruns.append((index + 1, round(end - nxt, 2)))
        print(f"  {at:6.2f}s -> {end:6.2f}s  {result['words']:2d} words, "
              f"{len(result['cues'])} cues{flag}")
    if overruns:
        print(f"  !! {len(overruns)} line(s) overrun: {overruns}")
    else:
        print("  every line fits inside its own scene")

    call("subtitles_export",
         path="/Users/himanshu/codes/synthai/vii-reels/volatility-drag.srt", format="srt")
