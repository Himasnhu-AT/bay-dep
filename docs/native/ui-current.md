# bay — current desktop UI, as built

**Read against the code on 2026-08-22** (`fix/pending-sweep`). This is a description of what the
GPUI app draws today, not a proposal. Every number here is a literal from the source, with the
file and line that holds it, so a redesign can argue with specifics rather than impressions.

The whole UI is five files, ~7,150 lines:

| File | Lines | What it owns |
|---|---|---|
| `rust/crates/bay-ui/src/theme.rs` | 30 | The entire palette |
| `rust/crates/bay-ui/src/lib.rs` | 80 | Window creation, app boot |
| `rust/crates/bay-ui/src/menus.rs` | 152 | macOS menu bar |
| `rust/crates/bay-ui/src/app_view.rs` | 1,698 | Project launcher + agent routing |
| `rust/crates/bay-ui/src/editor_view.rs` | 3,522 | The editor: toolbar, panels, timeline |
| `rust/crates/bay-ui/src/view_model.rs` | 516 | Pure presentation model (what text each panel shows) |
| `rust/crates/bay-ui/src/geometry.rs` | 1,157 | Timeline px↔time math, ruler ticks, snapping |

There are exactly **two screens**: the project launcher and the editor. No modals, no dialogs
(except the OS file picker), no preferences window, no onboarding.

---

## 0. Constraints a redesign has to respect

- **Framework is GPUI 0.2.2** (Zed's), rendering through `blade-graphics` — not a web view, not
  SwiftUI. The styling API is Tailwind-shaped (`div().flex().px_3().rounded_md()`), so anything
  expressible in flexbox + absolute positioning + solid fills is cheap. There is **no** grid, no
  CSS gradient helper, no box-shadow helper, no blur/backdrop, and no built-in component library
  in this tree — every button, toggle and field below is a hand-rolled `div`.
- **No text input widget exists.** Both "text fields" in the app (project name, text-clip
  content) are `String` buffers assembled from raw key events with a fake caret glyph appended.
  See `app_view.rs:639` and `editor_view.rs:478`.
- **Logic may not move into the UI crate.** `CLAUDE.md`: `rust/` owns all non-UI logic; the same
  engine drives the GPUI app, a wasm build and an MCP server. A redesign may re-arrange and
  re-style anything in `bay-ui`, but a new behaviour usually belongs in `bay-core` as a
  `Command`.
- **Everything is one window.** 1440×900, centred, standard macOS titlebar (`lib.rs:56`).
- No hover states, no focus rings, no cursor changes (one exception), no tooltips, no
  animation/transition of any kind exist anywhere in the app today.

---

## 1. Design tokens as they exist

### Palette — the complete list (`theme.rs`)

| Token | Hex | Used for |
|---|---|---|
| `BG` | `#0f0f14` | Window background, preview stage backdrop |
| `PANEL` | `#16161d` | Toolbar, media panel, inspector, timeline, project cards |
| `PANEL_ALT` | `#1d1d26` | Every button fill, scene bar, status chip, media item |
| `LANE` | `#121218` | Timeline lane troughs, the name-field trough |
| `BORDER` | `#2a2a36` | Every 1px divider and outline, ruler tick marks |
| `TEXT` | `#e7e7ee` | Primary text |
| `MUTED` | `#8a8a9a` | Secondary text, section labels, disabled buttons |
| `ACCENT` | `#5b8cff` | Playhead, waveform bars, primary button on the launcher |
| `SELECTED` | `#2d3a66` | Active scene tab, active track toggle, agent chip, text-edit field |
| `SELECTED_BORDER` | `#8fb0ff` | Selected clip outline, **and both trim handles on every clip** |
| `MARKER` | `#f2b03c` | Marker pips on the ruler |

Two colours are hardcoded outside the theme: the armed Delete button (`#7a2f3a` fill, `#ffdde3`
text, `app_view.rs:855`) and the layout-fallback stage fill `#202028` (`editor_view.rs:1952`).

**Clip colour by kind** (`theme.rs:17`) — the app's only categorical scale, used for timeline
blocks, media-panel left borders, and fallback preview rects:

| Kind | Hex |
|---|---|
| Video | `#33628f` (blue) |
| Image | `#7a4f95` (purple) |
| Text | `#8f6a33` (amber) |
| Audio | `#2f8f63` (green) |
| unknown | `#444455` |

There is **no** hover, pressed, focus, error, warning or success colour. Failure and success are
both reported in the same grey chip.

### Type

No font family is ever set, so everything renders in GPUI's fallback — **Helvetica** at the
platform default weight. No monospace anywhere, including timecode and numeric readouts.

| Helper | px (rem = 16) | Where |
|---|---|---|
| `text_2xl` | 24 | Launcher wordmark "bay" |
| `text_lg` | 18 | Project name on a launcher card |
| `text_sm` | 14 | Button labels, values, most body text |
| `text_xs` | 12 | Section headers, all secondary text, ruler labels, clip labels |
| `text_size(px(11.))` | 11 | The agent chip only (`editor_view.rs:1655`) |

So the usable scale is effectively **12 / 14** with two one-off larger sizes on the launcher. No
weight or letter-spacing variation is used to separate hierarchy — only colour (`TEXT` vs
`MUTED`).

### Spacing and radius

Tailwind scale: `_1` = 4px, `_2` = 8px, `_3` = 12px, `_4` = 16px, `_6` = 24px, `_8` = 32px,
`_10` = 40px, `_16` = 64px. Radii: `rounded_sm` = 4, `rounded_md` = 6, `rounded_lg` = 8.
Borders are always `1px` except clip trim handles.

Timeline layout constants are raw floats, because the scrub math has to read them
(`editor_view.rs:118`):

```
DEFAULT_PIXELS_PER_SECOND 48    MIN_ZOOM 8       MAX_ZOOM 400
TRACK_LABEL_WIDTH 132           LANE_HEIGHT 40   RULER_HEIGHT 22
TIMELINE_PADDING 8              TRACK_GAP 8      MIN_BLOCK_WIDTH 10
TRIM_HANDLE_WIDTH 7             SNAP_TOLERANCE_PX 8 (geometry.rs:265)
```

---

## 2. Screen 1 — the project launcher (`app_view.rs`)

Opens here on every launch; a project opens *into* the editor and "‹ Projects" comes back.
Single centred column, **880px wide** on a 1440px window (so ~280px of empty background either
side), `px_8 py_10`, vertically scrollable.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│        bay                                    [Open File…] [New Project]     │  header, mb_6
│        3 projects                                                            │  24px + 12px muted
│                                                                              │
│        ┌────────────────────────────────────────────────────────────────┐    │
│        │ NEW PROJECT — type a name, Enter to create, Esc to cancel       │    │  only while naming
│        │ ┌──────────────────────────────────┐ ┌──────────────┐ ┌──────┐  │    │  accent-bordered
│        │ │ My Film|                         │ │16:9·1920×1080│ │Create│  │    │
│        │ └──────────────────────────────────┘ └──────────────┘ └──────┘  │    │
│        └────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│        ┌────────────────────────────────────────────────────────────────┐    │
│        │ Crash of 1929                                 0:47   [Delete]  │    │  p_4, rounded_lg
│        │ 1080 × 1920 · 30 fps · 14 clips          2 hours ago           │    │  PANEL on BG
│        └────────────────────────────────────────────────────────────────┘    │
│        ┌────────────────────────────────────────────────────────────────┐    │  mb_2 between
│        │ Untitled                                      0:00   [Delete]  │    │
│        │ 1920 × 1080 · 30 fps · 0 clips            just now             │    │
│        └────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Row anatomy** (`app_view.rs:791`): the whole left block (name + detail) is one click target
that opens the project. Right block is duration (`m:ss`) over relative modified time
("just now" / "4 minutes ago" / "3 days ago", `view_model.rs:80`). Then a Delete button that
**arms on first click and deletes on second** — the label flips `Delete` → `Confirm` and the fill
turns dark red. Nothing else on the screen changes, and the armed state has no timeout.

**Empty state** (`app_view.rs:874`): a bordered box, 64px vertical padding, "No projects yet" /
"Create one to start editing, or open an existing project file." No illustration, no primary CTA
inside it (the CTA is up in the header).

**New-project flow** (`app_view.rs:738`): "New Project" reveals an inline row, not a dialog. The
name field is a fake input — a `LANE`-coloured box showing the typed buffer with a literal `|`
appended, placeholder "Untitled" in muted grey. Canvas size is a **cycling button** through two
presets only (16:9 1920×1080, 9:16 1080×1920); fps is not offered and is always 30. Enter
creates, Esc cancels. There is no way to type a custom size in the UI.

**Notices** (`app_view.rs:949`): a grey `PANEL_ALT` bar above the list, one line, used for
library errors, import results, agent activity ("Claude created "…""), and the agent-unavailable
note. Not dismissible here, no severity distinction.

Also on this screen: "Open File…" opens a native `rfd` file picker filtered to `.json`, and
imports the picked project into the library.

---

## 3. Screen 2 — the editor (`editor_view.rs:3144`)

Four stacked regions; the middle one is three columns. Fixed heights everywhere except the
middle row, which takes the remainder.

```
1440 × 900 window
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ ‹ Projects  bay — Crash of 1929  ●Claude·text  clipboard: 0  [Save][Export Frame][Export…]│ 50px  toolbar
│                                       [+ Text][Delete][Split][Duplicate][Copy][Paste][Undo][Redo]
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ SCENES  [Main] [Scene 2]  [＋ Scene]                                                      │ 40px  scene bar
├────────────┬──────────────────────────────────────────────────────┬──────────────────────┤
│ MEDIA      │                                                      │ INSPECTOR            │
│ [Import…]  │                                                      │ Name      Title      │
│ Click to   │              ┌────────────────────────┐              │ Kind      Text       │
│ add at     │              │                        │              │ Start  [−] 0.00s [+] │
│ playhead   │              │   512 × 288 preview    │              │ Duration[−] 3.00s[+] │
│ ▏music.mp3 │              │   (fixed size, always) │              │ Fade in [−] 0.00s[+] │
│ ▏logo.png  │              │                        │              │ …                    │
│ ▏b-roll.mp4│              └────────────────────────┘              │ EFFECTS  BLEND       │
│            │       1920 × 1080 · 3 layer(s) · compositor          │ PRESETS              │
│  200px     │                    flex-1 (≈980px)                   │        260px         │
├────────────┴──────────────────────────────────────────────────────┴──────────────────────┤
│ [▶ Play][|◀][◀ 1s][1s ▶][▶|]  2.40s / 7.00s  [− zoom][zoom +]                            │ 300px timeline
│              ┌──────────────────────────────────────────────────────────────────────┐    │
│              │ 0:00:01:00      0:00:02:00 ▮   0:00:03:00        ◆ marker            │    │ ruler 22px
│ Overlay  H M │ ░░░░░[ Caption ]░░░░░░░░░░░░░░░│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │    │ lane 40px
│ Main     H M │ [ Title       ][ Logo         ]│                                      │    │
│ Audio    H M │ [▁▃▅▇▅▃▁▂▄▆▄▂▁▃▅▇▅▃▁▂▄▆▄▂▁▃▅▇▅│▃▁▂▄▆▄▂▁                            ] │    │
│   132px      │                          lane (window width − 148 − 8)               │    │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Toolbar — 50px, `PANEL`, bottom border (`editor_view.rs:1614`)

Left cluster, in DOM order: `‹ Projects` (saves, then leaves) · the title string
`bay — <project name>` as plain 16px text · the agent chip (conditional) · `clipboard: N` in
12px muted · the status chip (conditional) · runtime install offers (conditional) · `Save` ·
`Export Frame` · `Export Video`.

Right cluster: `+ Text` · `Delete` · `Split` · `Duplicate` · `Copy` · `Paste` · `Undo` · `Redo`.

Every one of these is the same button: `px_3 py_1 rounded_md`, `PANEL_ALT` fill, 14px label.
**Disabled is expressed only by the text going grey** — same fill, same size, and the click
handler is simply not attached (`editor_view.rs:1573`). Enable rules: Delete/Split/Duplicate/Copy
need a selection; Paste needs a non-empty clipboard; Undo/Redo need history; the two Exports need
a GPU adapter.

Conditional chips in the same row:

- **Agent chip** — `● Claude · <tool name>`, `SELECTED` fill with a `SELECTED_BORDER` outline,
  11px. Appears when an MCP tool edits the open project and expires 2.5s after the last edit
  (`editor_view.rs:1604`).
- **Status chip** — `PANEL_ALT`, 12px, click to dismiss. This is **the app's only feedback
  channel**: save results, export paths, export failures, install progress and install errors all
  render as the same undifferentiated grey line. One at a time; a new message replaces the old.
- **Install offers** — e.g. `Install narration (1.2 GB)`, one per missing runtime, styled
  identically to every other button. Hidden while an install runs; progress then appears in the
  status chip as `Downloading Python — 42% of 57.3 MB`.

The toolbar has no wrapping behaviour: on a narrow window the two clusters collide.

### 3.2 Scene bar — 40px, `PANEL_ALT`, bottom border (`editor_view.rs:1813`)

`SCENES` label in 12px muted, then one pill per scene (`SELECTED` fill + `TEXT` when active,
`PANEL_ALT` + `MUTED` when not), then `＋ Scene`. Scenes cannot be renamed, reordered, or deleted
from the UI. The bar is always present, even for the overwhelmingly common one-scene project.

### 3.3 Media panel — 200px fixed, `PANEL`, right border (`editor_view.rs:1869`)

`MEDIA` header, an `Import Media…` button (native file picker), then either the empty message
("No media yet. Import a video, image or audio file and it appears here.") or the hint "Click to
add at playhead" over a scrollable list.

Each item is a `PANEL_ALT` row with a **2px left border in the kind colour** and the file name in
14px, clipped with `overflow_hidden` — no ellipsis, no thumbnail, no duration, no kind label, no
tooltip with the full path. Clicking places the asset on the timeline at the playhead. There is
no drag-and-drop from the panel to a lane, and no drop target for files from Finder.

### 3.4 Preview — flexes to fill (`editor_view.rs:1946`)

The stage is **hardcoded 512×288** regardless of the window size, the project's canvas size, or
its aspect ratio (`PREVIEW_W`/`PREVIEW_H`, `editor_view.rs:1954`). On a 1440×900 window the
column around it is ~980×510, so roughly **60% of the largest region in the app is empty
background**. A 9:16 vertical project — one of the two presets the launcher offers — is composited
into a 16:9 letterbox at 512×288.

Under it, one 12px muted line: `1920 × 1080 · 3 layer(s) · compositor` (or `layout`).

Two render paths:

- **compositor** — the real wgpu frame, read back to CPU and drawn as an image
  (`editor_view.rs:811`, re-rendered when a content hash changes).
- **layout** — the no-GPU fallback: each visible element as a rounded rect in its kind colour at
  its transform, with its name centred in it.

The preview has **no** zoom, pan, fit control, safe-area or title-safe guides, grid, canvas
outline handles, or direct manipulation. Nothing on the stage is clickable or draggable —
position and scale are changed only through the inspector's ± steppers.

### 3.5 Inspector — 260px fixed, `PANEL`, left border (`editor_view.rs:2263`)

With nothing selected: `INSPECTOR` + "Select a clip to inspect it."

With a clip selected, a flat single-column stack, no collapsible sections, no scroll container:

| Row | Control |
|---|---|
| Name, Kind | Read-only label/value |
| Start, Duration | `[−] 0.00s [+]` — fixed 0.5s step, 22px square buttons |
| Fade in, Fade out | Same stepper, 0.5s step |
| Source in | Same stepper, shown only for clips with a source timeline: `2.50s of 31.00s` |
| Text | Value + `Edit Text` → replaces the row with a `SELECTED`-filled box holding the typed buffer + `▏` caret, "Enter = save, Esc = cancel" |
| Opacity, Scale, X, Y | `[−] 80% [+]` — steps of 0.1 / 0.1 / 0.05 / 0.05 |
| `◇ keyframe (2 animated):` | Four 12px buttons — `opacity` `scale` `x` `y` — each writes a keyframe at the playhead |
| `EFFECTS` | One row per effect: type name, `[−] 1.4 [+]` amount, an `on`/`off` toggle, `✕` remove |
| add-effect row | `+ Bright` `+ Contrast` `+ Sat` `+ Blur` (wraps) |
| `BLEND` | One button showing the current mode; clicking **cycles through all 17 modes** with no list or menu |
| `PRESETS` | `Save Preset` (in-memory, this window only), `Save as Template` (written to the library), then one `Apply <name>` button per saved preset |

Every numeric value in the panel is adjust-only-by-stepper: no typing, no drag-scrub, no slider,
no arrow-key repeat. Setting opacity from 100% to 30% is seven clicks. There is no rotation
control (the model has one), no audio volume control (the model has one), no colour picker for
text, no font controls, and no mask/crop controls.

### 3.6 Timeline — 300px fixed, `PANEL`, top border (`editor_view.rs:2727`)

Three stacked parts inside 8px padding.

**Transport row** — `▶ Play`/`⏸ Pause`, `|◀`, `◀ 1s`, `1s ▶`, `▶|`, then the readout
`2.40s / 7.00s` in 12px muted, then `− zoom` / `zoom +`. These are a *smaller* button variant
(`px_2 py_1`, 12px text) than the toolbar's — the app has two button sizes and they sit 300px
apart. Time is shown in decimal seconds here, but as SMPTE timecode (`00:00:02:14`, with `;` for
drop-frame) on the ruler; two formats for one quantity.

**Ruler** — 22px, offset by the 132px label gutter so it aligns with the lanes. Minor ticks
(25% height) and major ticks (50% height) in `BORDER`, labels 12px muted, spacing chosen by a
ladder that keeps labels ≥80px apart (`geometry.rs:205`). Markers are 7×7 amber squares at the
bottom edge. The playhead is a 9×9 accent square handle. Pressing anywhere on the ruler starts a
scrub that continues until mouse-up, tracked at window level so it survives leaving the strip.
This is the only element in the app with `cursor_pointer`.

**Track rows** — vertically scrollable; ~5 of the 46px rows fit before scrolling. Each row is:

- **Label gutter (132px)**: track name in 12px muted, clipped, plus two 20px square toggles `H`
  (hidden) and `M` (muted). Active toggles fill `SELECTED`. There is no add-track, delete-track,
  rename, reorder, solo, lock, or height control anywhere in the UI.
- **Lane**: `LANE` trough, `rounded_md`, clips absolutely positioned. A 2px accent playhead line
  is drawn per lane (there is no continuous playhead through the whole stack). Pressing empty
  lane space scrubs, exactly like the ruler.

**Clip block**: fill = kind colour, 32px tall, 6px radius, label in 12px `TEXT`. Selected clips
get a 1px `SELECTED_BORDER` outline. Each block is three regions: a **7px solid
`SELECTED_BORDER` bar at each end** (trim handles) and the body (move). The handles are drawn in
the selection colour on *every* clip whether selected or not, which reads as a permanent pale
frame rather than an affordance. Audio clips with a decoded waveform draw 2px accent peak bars
instead of a label.

**Timeline interaction**: drag body = move (all selected clips move together); drag either
handle = trim; both snap within 8px to clip edges, markers and t=0. Two-finger horizontal scroll
pans the lanes (vertical is left to the track list). Zoom is buttons only — 1.5× per press,
clamped to 8–400 px/s, anchored on the playhead; there is no pinch-zoom, no zoom-to-fit, no
scrollbar, and no minimap. Playback pages the view when the playhead leaves the viewport,
landing it a fifth of the way in.

---

## 4. Interaction model

### Mouse

| Gesture | Result |
|---|---|
| Click clip body | Select (drag to move) |
| Click clip end handle | Trim that end |
| Click empty lane / ruler | Scrub playhead (continues until release) |
| Two-finger horizontal | Pan lanes |
| Click media item | Add at playhead |
| Click launcher card | Open project |
| Click status chip | Dismiss it |

There is no right-click / context menu anywhere, no double-click behaviour, no rubber-band
selection, no shift/cmd-click to extend a selection (multi-select exists in the model and is only
reachable via ⌘A), and no drag-and-drop between panels.

### Keyboard (`editor_view.rs:87`, `menus.rs:115`)

Bound in the `Editor` context; while editing text the context switches to `TextEdit` and every
key goes to the buffer instead.

| Key | Action | | Key | Action |
|---|---|---|---|---|
| `Space` | Play/pause | | `⌘Z` / `⌘⇧Z` | Undo / redo |
| `←` `→` | Step one frame | | `⌘A` | Select all |
| `⇧←` `⇧→` | Step one second | | `⌘C` / `⌘V` | Copy / paste |
| `Home` / `End` | Go to start / end | | `S` | Split at playhead |
| `Backspace` / `Delete` | Delete selected | | `M` | Add marker |
| `⇧Backspace` | Ripple delete | | `⌘S` `⌘W` `⌘M` `⌘Q` | Save, close, minimise, quit |

None of these shortcuts are shown anywhere in the UI except in the menu bar; buttons carry no
shortcut hints.

### Menu bar (`menus.rs:52`)

`bay` (Services, Quit) · `File` (Save, Close Window) · `Edit` (Undo, Redo, Cut, Copy, Paste — via
`os_action`, so they behave correctly in text) · `Timeline` (Play/Pause, Split, Delete, Step
forward/back) · `Window` (Minimize) · `Help` (documentation link). Quitting saves the open
project.

---

## 5. What the UI does not have

Grouped for a design pass; each is a statement about the current build, not a complaint about the
engine — most of these capabilities exist in `bay-core` and are only unreachable from the screen.

**Affordance and feedback**
1. No hover state on any control. Nothing in the app responds to the pointer before a click.
2. No focus ring or keyboard navigation between controls; Tab does nothing.
3. No cursor changes — a trim handle, a draggable clip and a static label all show an arrow.
4. No pressed/active state on buttons; a click has no visual acknowledgement at all.
5. Disabled = grey text on an identical fill, which reads as a style variant rather than "off".
6. One status line for everything, with no severity, no icon, no persistence, and no history —
   a failed 1.2 GB install and a successful save look the same.
7. No progress bar; install progress is a percentage inside that same text line.
8. No tooltips, no empty-state guidance inside the editor, no shortcut discovery.

**Input**
9. No real text fields — two fake ones with hand-rolled key handling, no selection, no cursor
   movement, no paste, no IME.
10. Every number is stepper-only, at a fixed step, with no typing, dragging or repeat-on-hold.
11. Blend mode cycles through 17 values on one button; there is no picker.
12. Canvas size is two presets, only at creation, never editable afterwards; fps is not
    exposed at all.

**Layout**
13. The preview is a fixed 512×288 box in a ~980×510 region, and does not follow the project's
    aspect ratio — the single largest piece of screen is mostly unused.
14. Fixed panel widths (200 / 260) with no resize, collapse or hide; no layout memory.
15. The timeline is a fixed 300px whatever the window height; no way to give a dense project
    more room.
16. Toolbar controls do not wrap or collapse; the layout has no small-window story.
17. Nothing in the app scales with window size except the lanes and the empty preview backdrop.

**Missing controls for things the engine already does**
18. No track management at all — add, remove, rename, reorder, solo, lock, resize.
19. No rotation, audio volume, speed, mask/crop, or text styling (font, weight, alignment,
    colour) controls, all of which exist in the model.
20. No keyframe *view* — you can add keyframes but not see, move or delete them.
21. No transitions UI.
22. No preview interaction: no on-canvas selection, drag, resize, guides, or fit/zoom.
23. Export is two fixed buttons writing to fixed paths with no settings, no destination
    picker, no progress and no cancel; video export is silently capped at 1280px wide
    (`editor_view.rs:1227`).

**Consistency**
24. Two button sizes (toolbar 14px, transport 12px) with no rule about which is used where.
25. Section headers (`MEDIA`, `INSPECTOR`, `SCENES`, `EFFECTS`, `BLEND`, `PRESETS`) are
    uppercase 12px muted text with no rule, background or spacing system around them.
26. Iconography is text glyphs mixed from several registers — `‹`, `＋`, `◇`, `✕`, `▶`, `|◀`,
    `⏸`, `−`, `H`, `M`, `●`. No icon set.
27. Time is decimal seconds in the transport and inspector, SMPTE timecode on the ruler, and
    `m:ss` on the launcher.
28. Selection blue (`SELECTED_BORDER`) is also the fill of both trim handles on every clip, so
    the strongest colour in the timeline does not mean "selected".

**Two silent no-ops worth knowing about** (behaviour, but they surface as "the UI did nothing"):
- A new project has only `track-main`; importing an **audio** file targets `track-audio`, which
  does not exist, so the command lowers to `None` and nothing happens with no message
  (`editor_view.rs:1108`, `bay-core/src/command.rs:880`).
- Scenes added with `＋ Scene` name their main track `<scene-id>-main`, but `+ Text` and media
  placement always target the literal `track-main` — so on any scene after the first, adding a
  clip silently does nothing (`bay-project/src/scene.rs:113`).

---

## 6. Where each thing lives, for whoever implements the redesign

| Region | Function |
|---|---|
| Window, menu bar | `lib.rs:36`, `menus.rs:52` |
| Launcher screen | `app_view.rs:894` (`home`), rows at `:791`, header `:698`, new-project `:738` |
| Editor root + key/mouse handling | `editor_view.rs:3145` |
| Toolbar | `editor_view.rs:1614` |
| Scene bar | `editor_view.rs:1813` |
| Media panel | `editor_view.rs:1869` |
| Preview | `editor_view.rs:1946` |
| Inspector | `editor_view.rs:2263` (helpers `info_row` `:2038`, `mini_button` `:2058`, `nudge_row` `:2130`, `stepper_row` `:2184`) |
| Timeline shell + transport | `editor_view.rs:2727` |
| Ruler | `editor_view.rs:2825` |
| Track row + clip blocks | `editor_view.rs:2912` |
| What text each panel shows | `view_model.rs` (`EditorViewModel::build`, `HomeViewModel::build`) |
| Timeline px↔time, ticks, snapping, timecode | `geometry.rs` |
| Palette | `theme.rs` |
