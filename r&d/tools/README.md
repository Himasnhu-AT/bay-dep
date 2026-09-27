# Recording tools

Small scripts for making footage that is worth editing, and for recording bay itself. All of them talk
Chrome DevTools Protocol (CDP) directly: no npm installs, Node 22+ (global `WebSocket`), ffmpeg on PATH.

| File | What it does |
|---|---|
| `screencast.mjs` | `node screencast.mjs <browser-ws> <out.mp4> <seconds> [urlMatch]`. Records one page for N seconds. Frames arrive on repaint (measured 40–96 fps) and each is held until the next, then encoded to 60 fps CFR. A static page yields one frame, so use a screenshot instead. |
| `record-stream.mjs` | `node record-stream.mjs <port> <urlMatch> <out.mp4> <stopFile> [maxWidth]`. Long takes: pipes every frame straight into ffmpeg with wall-clock timestamps and stops when `<stopFile>` exists. Writing a label to `<stopFile>.mark` appends `seconds\tlabel` to `<out>.marks.txt`. Used for the 35 min bay run. |
| `drop.mjs` | `node drop.mjs <port> <urlMatch> <x> <y> <file...>`. Drops real files onto a page as if dragged from Finder (`Input.dispatchDragEvent` with `files`). Imports into bay on camera. |
| `prep.js` | Injected into RedAssay's `/demo`: body zoom 2 (so a 3840×2160 viewport lays out like 1920×1080 at 2×) and hides the demo chrome. |
| `film.js` | Injected after `prep.js`. Defines `window.__film`, listed below. |
| `takes.js` | The eight shot choreographies for the Attest film (`__takes.setup(name)` runs before recording starts, then `__takes[name]()` runs). |
| `take.sh` | `take.sh <name> <query> <seconds>`. Opens `/demo?<query>`, injects everything, sets up the camera, records, runs the take and saves the click log. Output dir: `$OUT` (default `~/Movies/redassay-launch/v2`). |
| `sheet.sh` | `sheet.sh <video> <out.png> [n]`. A contact sheet of n evenly spaced frames, for checking a take without watching it. |

## What `window.__film` (from `film.js`) provides

| Call | What it does |
|---|---|
| `click('text=Label' \| selector \| element, ms, hold)` | Curved move, press, ring, real `el.click()`. Logged with a timestamp. |
| `shot(target, {s, rx, ry, rz, dx, dy}, ms, easing)` | Animated 3D camera aimed at an element. |
| `cut(target, opts)` | Sets the camera instantly. |
| `focus(target)` / `unfocus()` | Depth of field: siblings blur and dim; the target lifts. |
| `fit()` | Sizes the page to its content so a tilted window has no empty tail. |
| `start()` / `log` | Click timing, in seconds from `start()`. |

## Gotchas measured

- **Coordinates:** `getBoundingClientRect` under body `zoom:2` returns viewport (4K) px, so the cursor
  lives on `<html>`, outside the zoom.
- **Stage buttons:** RedAssay's hidden stage buttons share text with the numbered risk markers. `byText`
  searches only visible elements in `<main>`.
- **Offset of the click log:** a take's click log is relative to `start()`, which runs ≈0.7 s after the
  recording begins. Confirm each click on the frame where the cursor shrinks and the ring appears.
- **`agent-browser record`:** capped at ~10 fps; use `screencast.mjs` instead.
