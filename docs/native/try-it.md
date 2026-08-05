# Try it — the native `vii` editor

A hands-on guide to running and exercising the native GPUI desktop editor
(`rust/desktop`). Everything here is on branch `phase-0/native-gpu-foundation`.

---

## 1. Prerequisites

| Need | Why | Check |
|------|-----|-------|
| Rust (stable) | builds the workspace | `rustc --version` |
| `ffmpeg` on `PATH` | decodes video/audio + encodes MP4 export (sidecar) | `which ffmpeg` |
| A GPU (Metal on macOS) | the compositor preview | any Mac; falls back to a placeholder preview if no adapter |

`ffmpeg` is already installed here (`/opt/homebrew/bin/ffmpeg`). Without it, images
and text still work but video/audio decode, waveforms, and MP4 export are skipped.

---

## 2. Run it

```bash
# from the repo root
RELEASE=1 ./run.sh
```

(equivalently: `cd rust && cargo run --release -p opencut-desktop` — the Rust workspace lives in
`rust/`, so bare `cargo` commands must be run from there.)

- **`--release` is recommended** — playback and decode are much smoother than a debug build.
- First build takes a few minutes (wgpu + GPUI compile once, then it's cached).
- The window is titled `vii — <project name>`.

> The binary is named `opencut`; `./run.sh` is the simplest way to launch it.

---

## 3. What you'll see on first launch

The starter project is a **skeleton scene**, intentionally shipping with no media files:

- A live **"Hello, vii" text title** — this renders for real (cosmic-text).
- **Colored placeholder blocks** for the demo logo/clip — they have no file on disk yet,
  so the compositor draws solid-color stand-ins.

To see **real decoded frames**, click **Import Media…** (top toolbar) and pick an
image / video / audio file. **It is placed straight onto the timeline at the playhead** with its
real probed duration.

> **Known gap.** The left **MEDIA** column still shows three hardcoded demo tiles
> (`Clip.mp4`, `Logo.png`, `Music.mp3`) and does *not* yet list what you imported — that is
> task T-203 in [`palmier-parity-todo.md`](palmier-parity-todo.md). Imported media is really in
> the project (it renders, plays and exports); only the panel listing is missing.

---

## 4. Five-minute guided tour (hits every feature)

1. **Import** — `Import Media…` → pick a short `.mp4` and a `.png`, and a `.mp3`/`.wav`.
2. **Add to timeline** — `Import Media…` puts the file on the timeline at the playhead directly.
   (The left **MEDIA** column's three tiles are demo placeholders, not your imports — see above.)
3. **Select + move** — click a block in the timeline, drag its **middle** to move it.
4. **Trim** — drag a block's **left/right edge** to trim start/end.
5. **Split** — put the playhead mid-clip, press **`s`**.
6. **Transform** — with a clip selected, use the inspector's **−/+ steppers** for position,
   scale, rotation, opacity.
7. **Effects** — in the inspector, click **+ Bright / + Contrast / + Sat / + Blur**, then tune
   each with its **± amount** stepper. Watch the preview update.
8. **Keyframe an animation** — move the playhead, change a transform value, click the
   **◇ keyframe** row to record a key; move the playhead again and change it → the preview
   interpolates between them.
9. **Save / apply a preset** — **Save Preset** captures the clip's effects + animations;
   select another clip and **Apply <name>**.
10. **Edit text** — select the text clip, click **Edit Text**, type (shortcuts are suppressed
    while editing), click out to commit.
11. **Play** — press **Space**. The playhead animates; video plays smoothly (whole clip is
    decoded once and cached); **audio plays**, mixing every active clip.
12. **Export** — **Export Frame** writes a PNG of the current frame; **Export Video** renders
    the whole timeline to an MP4.

---

## 5. Reference

### Toolbar
`Save` · `Load` · `+ Text` · `Delete` · `Split` · `Copy` · `Paste` · `Undo` · `Redo` ·
`Import Media…` · `Export Frame` · `Export Video`

### Scene bar
A tab per scene (active highlighted) + **＋ Scene**. Click a tab to switch scenes.

### Keyboard shortcuts
| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `←` / `→` | Seek −1s / +1s |
| `s` | Split selected clip at the playhead |
| `Backspace` / `Delete` | Delete selected clip |
| `Cmd+C` / `Cmd+V` | Copy / Paste clip |
| `Cmd+Z` / `Cmd+Shift+Z` | Undo / Redo |

> While the inline **text editor** is active, typing goes to the text buffer and these
> shortcuts are suppressed (a `TextEdit` key-context). Click out to re-enable them.

### Timeline
- Three lanes: **overlay**, **main**, **audio**.
- Each block has three zones: left edge (trim start) · middle (move) · right edge (trim end).
- Audio blocks draw **waveform bars**.
- A vertical **playhead** line; transport buttons `|◀  ◀1s  ▶Play  1s▶  ▶|` with a
  `playhead / duration` readout.

### Inspector (selected clip)
Name · Kind · Text · transform steppers (position / scale / rotation / opacity) ·
effects list (toggle / remove / ± amount) · **◇ keyframe** row · **PRESETS** · **Edit Text**.

### Where files land (your home directory)
| File | Written by |
|------|-----------|
| `~/vii-project.json` | **Save** (same JSON wire format as the web app) |
| `~/vii-frame.png` | **Export Frame** |
| `~/vii-export.mp4` | **Export Video** |

**Load** reads `~/vii-project.json` back.

---

## 6. What's new this session (and how to feel it)

| Optimization | How to exercise it |
|---|---|
| **Contrast / saturation / blur effects** | Inspector → `+ Contrast`, `+ Sat`, `+ Blur`; tune the amount. |
| **Hardware-accelerated decode** (`-hwaccel auto`) | Import a longer/HD `.mp4`; decode offloads to VideoToolbox. |
| **Cached text rasters** | Put a big static caption on screen and hit Play — text is no longer re-shaped every frame. |
| **Native-order readback** | Invisible, but playback does less per-frame work (no redundant channel swizzle). |
| **Multi-clip audio mixing** | Stack two overlapping audio clips on the audio lane and Play — you hear both, summed. |

The one deferred item is **true zero-copy preview** — see the "remaining item" section of
[`desktop-architecture.md`](desktop-architecture.md) for exactly why (a wgpu-29 Metal-hal limitation).

---

## 7. Run the tests

```bash
./test.sh            # fmt + clippy + tests
# or: cd rust && cargo test --workspace
```

**66 tests, all passing** — model round-trips, every engine command + reversible undo/redo,
the view-model mapping, GPU compositor render/readback, real image/video decode, MP4 export,
effect uniform packing + on-GPU effect render, text rasterization, audio PCM/peaks, and the
audio mixer. GPU/ffmpeg-dependent tests **skip gracefully** (not fail) when no adapter or
`ffmpeg` is present.

Test a single crate, e.g. the mixer:

```bash
cd rust && cargo test -p opencut-audio
```

---

## 8. Troubleshooting

- **Preview is a flat placeholder** → no GPU adapter was found; the app still runs, just without
  the composited preview.
- **Video/audio clips show solid blocks, no sound** → `ffmpeg` isn't on `PATH`, or the media
  file path doesn't resolve. Re-import via `Import Media…`.
- **Playback stutters** → build with `--release`.
- **Export did nothing** → check `ffmpeg` is installed; `Export Video` needs it to encode.
