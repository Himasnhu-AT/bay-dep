# vii as an MCP server

vii exposes its editor engine as [Model Context Protocol](https://modelcontextprotocol.io)
tools, so an agent can build a timeline and render it to MP4 with no GUI.

```
MCP client ──JSON-RPC──▶ server.rs ──▶ tools.rs ──▶ studio.rs ──▶ Editor + PreviewRenderer
                         transport      schemas       engine
```

The crate is `rust/crates/vii-mcp`. It has no async runtime and no MCP SDK — the protocol
we need is "read a JSON-RPC request, return a JSON-RPC response", and the transport is ~200
lines of `std::net`.

---

## Run it

```bash
cd rust
cargo build --release -p vii-desktop
./target/release/vii --mcp               # HTTP on 127.0.0.1:7333
./target/release/vii --mcp --port 8080   # a specific port (0 = OS picks)
./target/release/vii --stdio             # JSON-RPC on stdin/stdout instead
```

Register with Claude Code:

```bash
claude mcp add --transport http vii http://127.0.0.1:7333/mcp
```

MCP servers are loaded at session start, so the tools appear as `mcp__vii__*` in the **next**
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
| `project_create` | Start an empty project. 1080×1920 @ 30 for a vertical reel. |
| `project_info` | Canvas, fps, duration, element counts. |
| `fonts_check` | **Which families are actually installed.** Call before `add_text`. |
| `media_import` | Register a file and probe its real duration/size → `mediaId`. |
| `add_text` | Text, with family / weight / align / tracking / line height. |
| `add_shape` | Rect or ellipse — bars, rules, dots, panels, underlines. |
| `add_image` / `add_video` | Place imported media, fitted without distortion. |
| `add_audio` | Music bed or SFX. Mixed into the exported MP4. |
| `animate` | Keyframe one property of one element, with easing. |
| `element_delete` | Remove by id. |
| `timeline` | Dump every layer, element, timing, transform and animation. |
| `snapshot` | **Render one frame to a PNG so you can look at it.** |
| `render` | Encode the whole timeline to MP4, picture and sound. |
| `project_save` | Save to the user's project library (no `path`), so it appears in the desktop app's launcher — or to an explicit `path`. |
| `project_list` | The projects in the library: id, name, canvas, duration, path. |
| `project_load` | Reopen one by `id` from the library, or by `path`. |

### Coordinates

Positions are fractions of the canvas — `x: 0.5, y: 0.5` is dead centre. `scale` is the
fraction of the canvas the element spans; for text it is the box the type is laid out in.

`anchorX` / `anchorY` choose which point of the element sits at `(x, y)`. This is what makes
charts possible: `anchorX: 0` pins a bar's left edge so animating `scaleX` grows it rightward
instead of outward from its middle. `anchorY: 1` pins a column's baseline so `scaleY` grows it
upward.

`layer` is the stacking order — `0` is the bottom, higher numbers draw on top, and missing
layers are created on demand.

### A bar that grows from its left edge

```jsonc
// add_shape
{ "id": "bar", "start": 0, "duration": 3, "color": "#FF5B5B",
  "x": 0.09, "y": 0.5, "anchorX": 0.0, "scaleX": 0.6, "scaleY": 0.012, "radius": 0.5 }

// animate
{ "elementId": "bar", "property": "scaleX", "easing": "power-out",
  "keys": [{ "t": 0, "value": 0 }, { "t": 0.8, "value": 0.6 }] }
```

Keyframe times are relative to the **element's own start**, not the timeline's.

Easings: `linear`, `ease-in`, `ease-out`, `ease-in-out`, `power-out`, `expo-out`, `back-out`,
`hold`.

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

**Unavailable fonts are refused, not substituted.** cosmic-text silently falls back to another
face, which is the worst kind of failure: it survives every automated check and only a human
notices the typography is wrong. `add_text` rejects a family that `fonts_check` would not list.

**Single-threaded.** The studio owns one GPU device and one project, so concurrent calls would
need a lock around everything anyway. Requests are handled in order.

**`Editor::project_mut` clears the undo history.** Structural edits with no `Command` (adding
a track lane, attaching an animation channel) go through it. Leaving a stale history would let
a later undo replay an inverse patch against a structure that no longer matches; clearing makes
undo unavailable, which is honest, rather than wrong.
