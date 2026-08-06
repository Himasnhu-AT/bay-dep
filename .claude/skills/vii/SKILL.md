---
name: vii
description: Build and render videos with vii, a native GPU video editor driven over MCP. Use when someone wants to make a video, reel, short, explainer, infographic video, data-driven motion graphic, animated chart, title card, or subtitled clip — or says "make a video about", "turn this into a reel", "animate this data", "add narration", "burn in subtitles", "turn this SRT into a video". Composes type, shapes, images, video and audio on a real timeline, speaks scripts with Kokoro text-to-speech, and encodes MP4. Prefer vii over HTML/CSS/browser-screenshot pipelines when the output is a video file.
---

# vii

A native video editor you drive with tool calls. You build a timeline — text, shapes, images,
clips, audio — animate it, **look at rendered frames**, and encode an MP4.

vii composites on the GPU and encodes through ffmpeg. There is no browser, no HTML, no
screenshot loop.

---

## How you call it

vii is an MCP server. **Call its tools directly** — `mcp__vii__project_create`,
`mcp__vii__add_text`, `mcp__vii__snapshot`, `mcp__vii__render`. That is the whole interface;
there is nothing to shell out to.

If those tools are not in your tool list, the server is not registered yet:

```bash
cd <vii-repo>/rust && cargo build --release -p vii-desktop
./target/release/vii --mcp --port 7333        # loopback only, no window
claude mcp add --transport http vii http://127.0.0.1:7333/mcp
```

**Two ways to serve, same tools, same port.**

- **`vii` (the editor)** — the window serves agents on 7333 as well. Your edits land in the
  timeline the user is looking at, one command at a time, and undo with the same keystroke as
  theirs. Use this when someone wants to *watch* you work.
- **`vii --mcp`** — no window. Use this for batch rendering, or on a machine with no display.

They cannot both hold 7333, and that is deliberate: an agent edits *a* document, and the value
of watching it happen depends on there being no ambiguity about which one. If the editor is
open, connect to it rather than starting a rival with its own timeline.

A window that is already open is where your edits go. Don't `project_create` over someone's
work without saying so — `project_info` first, and ask if there is something on the timeline.

MCP servers load at session start, so a server registered *now* is available **next** session.
That one bootstrap gap is the only reason `scripts/vii.py` exists — see
[Scripts](#scripts). Once the tools are listed, ignore it.

Rendering needs a GPU adapter and `ffmpeg` on PATH. Narration additionally needs Kokoro;
`mcp__vii__speech_status` tells you whether it is there and what to do if not.

---

## The loop

1. **`project_create`** — 1080×1920 @ 30 for a vertical reel, 1920×1080 for landscape.
2. **`fonts_check`** — confirm every family you plan to use is installed. An unavailable
   family renders in a fallback that looks *almost* right and survives every automated check.
3. **`media_import`** — register music, footage, stills. Returns real probed durations.
4. **`add_text` / `add_shape` / `add_image` / `add_video` / `add_audio`** — place elements.
5. **`animate`** — one property of one element per call, with easing.
6. **`narrate`** — optional: speak a script and lay word-synced captions.
7. **`snapshot` — and actually look at the PNG.** Non-negotiable; see below.
8. **`render`** — encode the MP4.

`timeline` dumps everything currently placed, so you can re-read your own work instead of
keeping a parallel model in your head.

---

## The quality gate that matters

**Every defect worth catching is invisible to a structural check and obvious in a frame.**
A blank frame at a cut, type that collides, a hero number too small to read at thumb size, a
chart track with no contrast, a caption that orphans its last word — none of these fail a
lint. All of them are apparent the moment you open the PNG.

So: `snapshot` several moments, **Read the images**, and fix what you see. Snapshot paths are
resolved by the *server* process — pass absolute paths.

A cheap automated companion: `scripts/inkcheck.py` sweeps the timeline and reports frames
with almost no ink. That catches dead air at cuts, which is easy to introduce and easy to
miss. It is not a substitute for looking.

---

## Non-obvious things that will bite you

- **Coordinates are fractions of the canvas.** `x: 0.5, y: 0.5` is dead centre.
- **`anchorX`/`anchorY` decide which point of an element sits at `(x, y)`.** This is what
  makes charts possible: `anchorX: 0` pins a bar's left edge so animating `scaleX` grows it
  rightward instead of outward from its middle.
- **Keyframe times in `animate` are relative to the ELEMENT's start**, not the timeline's.
- **For text, `scale` is the box the type is laid out in**, and text is drawn from the box's
  top-left. To place a paragraph at pixel `(x, y)`, set `anchorX: 0, anchorY: 0`.
- **Land reveals ON the beat, don't start them on one.** Passing a beat time as an animation's
  start makes the element *begin* moving on the beat and arrive late. Use
  `start = beat − duration`.
- **Narration must not read the screen.** The picture carries the numbers; the voice carries
  the reasoning. If the voice says what the frame already says, cut it.

Detail lives in the references below. Read the one you need — don't read them all up front.

| Read | For |
|---|---|
| [references/tools.md](references/tools.md) | every tool, its arguments, and what it returns |
| [references/layout.md](references/layout.md) | canvas grid, type sizing, keep-outs, colour and contrast |
| [references/charts.md](references/charts.md) | bars, columns, gridlines, count-ups, dot grids |
| [references/narration.md](references/narration.md) | Kokoro voices, caption timing, audio balance |
| [references/recipes.md](references/recipes.md) | worked end-to-end patterns to copy |
| [references/troubleshooting.md](references/troubleshooting.md) | what each failure actually means |

---

## Scripts

You do not need these to use vii. Both exist for jobs a tool call cannot do.

**`scripts/inkcheck.py`** — sweeps ~70 frames and measures how much ink is on each one. This
is arithmetic over a batch of renders, not something you can do by looking at images one at a
time, which is why it is a script. Run it before shipping.

**`scripts/vii.py`** — a fallback for one situation only: you started the server *this*
session, so `mcp__vii__*` is not in your tool list until the next one. It speaks the same
JSON-RPC to the same endpoint. If the MCP tools are listed, do not use this.

```bash
./scripts/vii.py tools                       # list tools + required args
./scripts/vii.py snapshot at=2.5 path=/tmp/f.png scale=0.5
```

Both default to `127.0.0.1:7333`; override with `VII_MCP_URL`.

---

## When NOT to use vii

- **The deliverable is a web page, not a file.** vii emits MP4s.
- **You need a browser to render something** — a live site, a DOM screenshot, a WebGL scene.
- **You need per-character text animation, path/line charts, or stroke outlines.** vii has
  none of these yet; see the "Still missing" table in
  [references/troubleshooting.md](references/troubleshooting.md) before promising them.
