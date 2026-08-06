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

**Two ways to serve, same port — but NOT the same tools.**

- **`vii --mcp`** — no window, **all 22 tools**. This is what you want for making a video end
  to end, because `render` and `narrate` only exist here.
- **`vii` (the editor)** — the window serves agents on 7333 too, so your edits land in the
  timeline the user is watching and undo with the same keystroke as theirs. **13 of 22 tools**:

  ```
  project_create  project_list  project_load  project_info  timeline  project_save
  add_text  add_shape  animate  element_delete  snapshot  fonts_check  speech_status
  ```

  Missing: `render`, `narrate`, `media_import`, `add_image`, `add_video`, `add_audio`, and the
  three `subtitles_*` tools. They are slow — seconds to minutes — and the bridge applies calls
  on the UI thread, so running them there would freeze the editor mid-edit. A refusal lists
  what does work.

**If the request needs narration or an MP4 and the editor is open, say so before you start.**
Offer to build what you can in the window (layout, type, shapes, animation, snapshots) and
render after they close it — or to work headlessly from the start. Discovering it at the
`render` call, after twenty tool calls, wastes their time.

They cannot both hold 7333, deliberately: an agent edits *a* document, and the value of
watching it happen depends on there being no ambiguity about which one.

**With the editor open and nothing loaded, call `project_create`** — it makes the project and
opens it in the window. If something is already on the timeline, `project_info` first and ask
before replacing it.

**A tool list is fixed when the session starts.** Registering a server — or starting one — part
way through does nothing for the session you are in, even though `claude mcp list` will happily
report it connected, because that is a fresh probe rather than the binding your tools came
from. So an HTTP registration silently yields no tools whenever vii was not already listening
at launch, which is most of the time, since the app only holds the port while it is open.

Registering it over stdio avoids that entirely — Claude Code spawns the process itself, so it
is connected every session with nothing to remember:

```bash
claude mcp add -s user vii-headless -- /Applications/vii.app/Contents/MacOS/vii --stdio
```

That gets all 22 tools and no window. Keep the HTTP entry as well for when you want the live
editor; they are different trade-offs, not competing answers.

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
