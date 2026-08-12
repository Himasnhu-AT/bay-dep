# bay as an MCP server

bay exposes its editor engine as [Model Context Protocol](https://modelcontextprotocol.io)
tools, so an agent can build a timeline and render it to MP4 with no GUI.

```
MCP client ──JSON-RPC──▶ server.rs ──▶ tools.rs ──▶ studio.rs ──▶ Editor + PreviewRenderer
                         transport      schemas       engine
```

The crate is `rust/crates/bay-mcp`. It has no async runtime and no MCP SDK — the protocol
we need is "read a JSON-RPC request, return a JSON-RPC response", and the transport is ~200
lines of `std::net`.

---

## Run it

```bash
cd rust
cargo build --release -p bay-desktop
./target/release/bay --mcp               # HTTP on 127.0.0.1:7333
./target/release/bay --stdio             # JSON-RPC on stdin/stdout instead
./target/release/bay --agents            # what is serving right now, and how to reach it
```

**One owner, and the port never moves.** 7333 is the address `claude mcp add` writes into your
client's configuration, so bay treats it as fixed: exactly one process may serve it, and if it
is taken bay tells you *what* has it — an editor window (and which project), another headless
bay (and its pid), or something that is not bay at all — rather than quietly starting somewhere
else. A server on a different port is one your configured client cannot reach, which is why
`--port` exists only for running a genuinely separate bay (a second checkout, CI) and is never
the fix for a conflict.

Register with Claude Code:

```bash
claude mcp add --transport http bay http://127.0.0.1:7333/mcp
```

MCP servers are loaded at session start, so the tools appear as `mcp__bay__*` in the **next**
session.

**The listener binds loopback only.** These tools read and write arbitrary files on this
machine; exposing the port to the network would hand that to anyone who could reach it.

### Requirements
| Need | For |
|---|---|
| A GPU adapter (Metal on macOS) | compositing any frame at all |
| `ffmpeg` on `PATH` | `render`, and decoding imported video/audio |

`snapshot` and `render` report the real reason when either is missing rather than failing
silently.

---

## The tools

| Tool | What it does |
|---|---|
| `runtime_status` | **What bay needs and whether this machine has it.** ffmpeg for render, Kokoro for narration. |
| `runtime_install` | **Install what is missing** — bay fetches it, the user installs nothing. Returns a job id; poll `runtime_status` (or `job_status`) with it. |
| `job_status` | **Follow background work.** One job by id, or all of them. `finished`, `fraction`, `result`, `error`. |
| `job_cancel` | Ask a job to stop. Cooperative and best-effort — a render stops at its next frame, leaving no partial file. |
| `project_create` | Start an empty project. 1080×1920 @ 30 for a vertical reel. |
| `project_info` | Canvas, fps, duration, element counts. |
| `fonts_check` | **Which families are installed, and at which weights.** A family being present says nothing: a weight it lacks drops the family. Returns the resolvable weights, the metric class and the measured cap/em per family. |
| `media_import` | Register a file and probe its real duration/size → `mediaId`. Anything with sound is also **measured**: `loudness` comes back with `lufs`, `peakDb`, `rmsDb` and `accentSeconds`. Pass `mediaId` instead of `path` to re-measure something already imported. |
| `audio_probe` | **How loud a file actually is**, in LUFS. `volume` is a multiplier and says nothing about level — two files that both sound fine alone can differ by 15 dB, and the bed in the project this comes from was 9 LU too quiet at `2.0`. |
| `add_text` | Text, with align / tracking / line height. **Requires `role`**; the face, size, weight and colour come from the committed style kit. |
| `add_shape` | Rect or ellipse — bars, rules, dots, panels, underlines. **Requires `role`.** |
| `add_image` / `add_video` | Place imported media, fitted without distortion. |
| `add_audio` | Music bed or SFX. Mixed into the exported MP4. Takes `role`: `speech` / `bed` / `sfx`. |
| `apply_move` | Put a **named move** from bay's vocabulary on an element. Call it with no arguments to list all 33 — each carries its own duration, curve and amplitude, and says when it is the wrong choice. |
| `animate` | `move` (the same registry, reachable without a new tool name) or hand-written `keys`. Transform properties on picture, `volume` on audio — which is how a bed ducks under narration. Hand-written keys are legal and are reported per channel as `off-vocabulary-motion`. |
| `element_delete` | Remove by id. |
| `element_move` | Slide a clip along the timeline. Changes *when* it plays, never *what*. |
| `element_trim` | **A real trim.** Moving the head eats the footage behind it; both edges stop at the ends of the file. |
| `element_split` | Cut a clip in two. The second half picks up in the source where the first stopped. |
| `element_source` | **Slip** — pick which part of a file plays, without moving the clip. Start a bed at the drop. |
| `element_duplicate` / `element_rename` | Copy a clip with its effects and animation; relabel one. |
| `transform_set` | Reposition, scale, rotate, fade — in place. Give only what changes. |
| `text_update` | Change a title's words or its typography, keeping its id, placement and animation. |
| `effect_add` / `effect_set` / `effect_remove` | Attach, retune, or take off a picture effect. |
| `blend_set` | How a clip composites over what is under it. |
| `audio_set` | Level, mute, in-point — and `duckUnder`, which is `duck` under the name a session already has. |
| `duck` | **Duck a bed under narration**: four volume keyframes per line, on ONE clip. You give depth / attack / release; bay knows where the lines are. Returns the keys it wrote. Never cut a bed into pieces with stepped gains — that is a cliff at every seam and it cannot be adjusted afterwards. |
| `fade_set` | Fade a clip up at its head and down at its tail — opacity on picture, level on sound. |
| `transition_add` | Cross-dissolve between two overlapping clips on one lane. |
| `crop_set` | Reframe: cut away part of the source so 16:9 footage fills a 9:16 frame without squashing. |
| `mask_set` | Limit a clip to a shape — vignette, spotlight, split screen. Feathered on the GPU. |
| `element_ripple_delete` | Delete and close the gap, on that clip's lane only. |
| `marker_add` | Mark a moment. Markers show on the ruler and clips snap to them. |
| `timeline` | Dump every layer, element, timing, transform, in-point and animation. |
| `snapshot` | **Render one frame to a PNG so you can look at it.** |
| `shots_detect` | **Find the cuts in footage you have not watched.** Returns a job id. |
| `sfx_search` | **One search over both halves of the sound library** — synthesised and installed. |
| `sfx_list` / `sfx_add` | Whooshes, risers, clicks, impacts — synthesised at the length the edit needs, placed in one call. |
| `sound_add` | Place a recorded sound from an installed CC0 pack. |
| `looks_list` | The built-in grades, with what each is for. Apply one with `effect_add`'s `look`. |
| `templates_list` / `template_place` | Lower thirds, kickers, end cards — and whatever the user saved. Placed in one call, with words. |
| `check` | **What will look wrong, before you spend the encode finding out.** A fill too close in colour to what it sits on, a card with nothing legible in it, a curve that overshoots a bar past its own number, an opening emptier than the video's own median frame, off-canvas elements, illegible type, missing media, black gaps, a silent export. Answers `status` (`clean`/`findings`/`unevaluated`), at most 12 findings drawn one per code, a `rollup` of the full counts, and **`skipped`** — read that before treating anything as a pass. Every code and what it was measured on: [`check-codes.md`](check-codes.md). |
| `render` | Encode, picture and sound. Codec, CRF, range, and `social`/`youtube`/`master` presets; the mix is normalised to −14 LUFS unless told otherwise. Returns a job id. **Runs `check` first and refuses while any error stands** — the one escape is `ignoreChecks` with a `reason` of at least 40 characters, which is written into the MP4's own comment metadata. There is no per-code suppression. |
| `project_save` | Save to the user's project library (no `path`), so it appears in the desktop app's launcher — or to an explicit `path`. |
| `project_list` | The projects in the library: id, name, canvas, duration, path. |
| `project_load` | Reopen one by `id` from the library, or by `path`. |

### Making versus revising

The tools split cleanly in two. `add_*` put things on the timeline; everything from
`element_move` down changes what is already there. **Prefer revising.** A rebuilt element is a
new id with no animation on it, and every later call that named the old one now fails — which
is why "snapshot, look, fix" needs the second half to exist at all.

Three edits that are easy to confuse, and are genuinely different:

| | Clip's position | Clip's length | Which footage plays |
|---|---|---|---|
| `element_move` | changes | — | — |
| `element_trim` | head may move | changes | follows the head |
| `element_source` | — | — | changes |

Both revising paths — the editor window and the headless server — plan through the same code
(`bay_agent::plan`), so a trim cannot come to mean one thing in the app and another over the
wire.

### Coordinates

Positions are fractions of the canvas — `x: 0.5, y: 0.5` is dead centre. `scale` is the
fraction of the canvas the element spans; for text it is the box the type is laid out in.

`anchorX` / `anchorY` choose which point of the element sits at `(x, y)`. This is what makes
charts possible: `anchorX: 0` pins a bar's left edge so animating `scaleX` grows it rightward
instead of outward from its middle. `anchorY: 1` pins a column's baseline so `scaleY` grows it
upward.

`layer` is the stacking order — `0` is the bottom, higher numbers draw on top, and missing
layers are created on demand.

### Role and provenance

Every visual element carries a **role** — what it is *for*, not what it looks like: `hook`,
`headline`, `kicker`, `label`, `caption`, `lockup`, `data`, `ground`, `chrome`. `add_text` and
`add_shape` require it; `add_image` and `add_video` accept it and default to `label`. An audio
clip carries `speech` / `bed` / `sfx` instead, which is what a duck is measured against.

Every element also carries a **source**, and it is *not* settable from the wire: `narrate`,
`subtitles_add` and `subtitles_to_video` stamp their output `tool`, everything else is
`author`, and ids of the form `caption-<number>` are refused from a caller. `timeline` reports
both fields and `project_info` reports `authoredElements` / `toolElements`.

This exists because bay's own captions were being counted as authored work. In one 61-second
project, 38 of the 73 text elements were `narrate`'s — one font size, one y, one three-frame
opacity fade each — and including them reversed the ranking of four separate motion
measurements. Projects written before the fields existed have their provenance recovered on
load from the caption id and the narration WAV's name.

### A bar that grows from its left edge

```jsonc
// add_shape
{ "id": "bar", "role": "data", "start": 0, "duration": 3, "color": "#FF5B5B",
  "x": 0.09, "y": 0.5, "anchorX": 0.0, "scaleX": 0.6, "scaleY": 0.012, "radius": 0.5 }

// animate
{ "elementId": "bar", "property": "scaleX", "easing": "power-out",
  "keys": [{ "t": 0, "value": 0 }, { "t": 0.8, "value": 0.6 }] }
```

Keyframe times are relative to the **element's own start**, not the timeline's.

Easings: `linear`, `ease-in`, `ease-out`, `ease-in-out`, `power-out`, `power-in`, `expo-out`,
`expo-in`, `power4-out`, `power4-in`, `spring-out`, `sine-in-out`, `back-out`, `hold` — all
fourteen, on both transports. (The headless path used to know eight of them and refuse the rest,
`spring-out` among them.)

The bar above is the case for hand-written keys: it is a `fill`, and `apply_move` has it. Prefer
a named move — the same picture, without choosing a duration or a curve:

```jsonc
// apply_move
{ "elementId": "bar", "move": "fill" }
```

---

## Look at your frames

`snapshot` exists because the failures that matter are invisible to any structural check: a
blank frame at a cut, type that collides, a hero number too small to read at thumb size, a
chart whose track has no contrast. Building the reel in `docs/native/reel-recipe.md` turned up
four such defects, and **every one of them was found by looking at a PNG**, not by a test.

Snapshot paths are resolved by the **server** process, so pass absolute paths.

A cheap automated companion to eyeballing: sweep `snapshot` across the timeline and measure
how much of each frame is not background. That catches dead air at cuts, which is easy to
introduce and easy to miss.

---

## Design notes

**Tool failures are results, not protocol errors.** A bad argument comes back as
`isError: true` with a message naming the offending value, so the agent can read it and
correct the call. A JSON-RPC error would not give it that chance.

**Unavailable fonts are refused, not substituted.** cosmic-text does not snap to the nearest
weight — it drops the family and shapes in something else, which is the worst kind of failure:
it survives every automated check and only a human notices the typography is wrong. Measured on
a stock Mac, `Avenir` at 700 comes back as **Menlo Bold** and `Baskerville` at 900 as **Apple SD
Gothic Neo Heavy**, a Korean UI face. So `add_text` shapes one glyph, reads the face id off the
resulting `LayoutGlyph`, and refuses the placement if it is not the face that was asked for —
naming what would have been drawn instead. The same gate runs on captions and on a `customKit`.

**Single-threaded.** The studio owns one GPU device and one project, so concurrent calls would
need a lock around everything anyway. Requests are handled in order.

**`Editor::project_mut` clears the undo history.** Structural edits with no `Command` (adding
a track lane, attaching an animation channel) go through it. Leaving a stale history would let
a later undo replay an inverse patch against a structure that no longer matches; clearing makes
undo unavailable, which is honest, rather than wrong.
