# bay — the six-page editor

**Status: under development. Not shipped, not finished, and not yet looked at.** This is the
contract every page milestone builds against, plus a running record of which parts of it are real.
Written 2026-08-27 against an audit of DaVinci Resolve 21's page model and bay's own crates.

Read the state table below before believing anything else in this file: several pages exist as
code and have never been rendered on screen by a person. A page that compiles and passes its unit
tests is not a page that works, and this document has already been wrong in that direction once.

## Where this actually stands

Nothing here has had a visual check. The engine work underneath is verified; the surface is not.

| | State | Evidence |
|---|---|---|
| **The page bar** | Built | `page.rs`, GPUI-free; the responsive ladder is `BarLayout::for_width`, asserted down to 320px |
| **The widget + drawing layer** | Built | `draw.rs` (paths, 80 µs per 1,000-point polyline), `controls.rs`, `drag.rs` — see `drawing.md` |
| **Keyframe engine** | Built | bezier handles, `animatable_paths`, descriptor table, `MoveKeyframe`/`SetKeyframeEasing` |
| **Scopes** | Built + measured | four reductions, 0.98 ms at 640×360 — see `benchmarks.md` |
| **Streaming audio engine** | Built, **called by nothing** | `fixes.md` entry 15: `start_audio` still pre-mixes the whole timeline, so a fader is not audible mid-playback |
| **Lift/gamma/gain** | Built | `lift_gamma_gain.wgsl`, all six enforced places wired |
| **Scalar pass fusion** | Built + measured | 64 → 256 distinct levels through a squeeze-and-stretch |
| **Media page** | Code landed, unseen | |
| **Motion page** | Code landed, unseen | |
| **Audio page** | Code landed, unseen | faders bound to real commands; meters deliberately dark until the engine is wired |
| **Deliver page** | Code landed, unseen | export moved off the UI thread through `slow::run`, so it now passes `render_gate` |
| **Cut page** | Not started | still the pre-migration editor body |
| **Color page** | Not started | placeholder |

### What still has to happen

1. **A visual check of every page**, at 1440×900 and at a small window. For a layout migration this
   is the verification nothing substitutes for, and it has not been done once.
2. **Wire the streaming audio engine to playback** — `fixes.md` entry 15. Until then the Audio
   page's faders change the *next* play, not the current one.
3. **The Cut page** — Resolve's actual Cut page, with the dual timeline.
4. **The Color page** — the one XL left, and the only page still on a placeholder.
5. **A full green gate on a quiet tree.** The last one was at `d60f379`; everything since has been
   verified per-crate or not at all.

## Why a page bar at all

bay has two screens: a launcher and one editor, and that editor is a single 4,671-line
`editor_view.rs` in which every job the app can do competes for one window. There is no room in
that window for a grading surface *and* a mixer *and* a curve editor. The page bar is what creates
the room. It is not a restyle.

## The six pages

| Page | Owns | The one thing it must not become |
|---|---|---|
| **Media** | Getting footage off disk and describing it. The only page that touches the filesystem; every other page browses the pool. | A second file picker. |
| **Cut** | Fast assembly. Source tape, dual timeline, the smart-edit set. | Resolve's *Edit* page under another name — deliberately a smaller vocabulary. |
| **Motion** | How a thing moves. Curve and keyframe editors, layer composition over one clip, masks and shapes. | A node graph. Ruled out. |
| **Color** | Per-shot image manipulation. Node list, palettes, scopes, gallery. | A place where a wheel turns and nothing renders. |
| **Audio** | Everything that happens to sound. Mixer, buses, meters, loudness, automation. | A mixer whose faders are not audible. |
| **Deliver** | Output. Settings, range, queue. | A second, ungated output path beside the toolbar's Export. |

No Fusion. No separate Edit page. Six is the ceiling, not the target — if Media and Deliver stay
thin they are the two to fold back into Cut.

## The shell

Two fixed chrome strips sandwich a page-owned body. Nothing else is global.

- **Top chrome** — three clusters on one baseline. Left: panel toggles for the page's *source-side*
  panels. Centre: project name, optically centred **on the window**, not on the gap between
  clusters. Right: toggles for the *destination-side* panels, then the app-wide actions. A toggle's
  on-state is a brightened glyph, never a moved element, so the strip does not reflow as panels
  open. Contents vary per page; the strip does not.
- **Body** — owned by the page. Five of six honour a three-band vertical rhythm: browser + viewer,
  transport, timeline. **The transport band is the horizon line of the app** — it must land at the
  same distance from the window top on every page that has one. If a page's bands cannot absorb the
  remainder around a pinned transport, the claim is false and should be deleted rather than
  approximated. Media drops the timeline band; Deliver replaces the browser column with render
  settings and keeps a reduced timeline for range only.
- **Page bar** — fixed, identical on every page, never scrolls. Wordmark left (a signature, not a
  menu; it anchors the left edge so the centred group reads as centred). Six buttons centred on the
  window in pipeline order, icon over label. Project library and settings at the right inset,
  outside the centred group, so a mis-aimed click never leaves the project.
- **Active page** — full-white icon and label plus a red underline on the bar's bottom edge. It
  **cuts, never animates between positions**, because the page beneath it also cuts. This is the
  only place the accent appears outside selection and record states, and without it the whole model
  collapses: nothing else on screen names which mode you are in.

## Rules that bind every page

1. **A page is a method on `EditorView`, not its own GPUI view.** Every piece of editor state
   already lives on that struct and survives a page switch for free. The moment a page becomes its
   own view, the `PreviewRenderer` and its atlas bookkeeping, audio, waveforms, undo history and
   presets must all be hoisted — the same reason the shell keeps one editor entity across projects.
2. **A control must do what it says.** A control the engine cannot back is drawn as an ordinary
   control and **disabled**. Not hidden, not faked. The disabled controls are the map of the
   remaining engine work, and that map is worth having on screen.
3. **The global playhead survives a page switch.** This single behaviour is what makes six pages
   feel like one application instead of six tools.
4. **No logic in `bay-ui`.** If the MCP server or a headless test cannot reach a behaviour, it is in
   the wrong crate. The standing temptation is a page whose state looks like view state and is not.
5. **Per-page state is a value type.** `pixels_per_second` and `scroll_x` are single fields on
   `EditorView` today, so two timelines on one page fight. The Cut page's ribbon and detail views
   share a playhead and must not share a zoom.
6. **Watch the window budget.** The page bar adds 44px of permanent chrome to every page. Colour
   spends roughly 480px of an ~872px content height on fixed bands before the viewer gets anything,
   and roughly 691px of 1440 width on fixed side columns. The toolbar already collides with itself
   on a narrow window; every page milestone is done only after it has been looked at, at 1440×900
   **and** at a small window.

## What each page needs from the engine

Recorded so a page is never built on an assumption. Several entries here have since been **closed**
and are kept, struck through in prose, because the record of what was missing is what stops the
next person re-deriving it. Detail and evidence in `fixes.md` and the milestone list.

- **Motion — closed.** It needed bezier handles per keyframe (bay interpolated by named easing
  only; there were no tangents anywhere in the repo), stable keyframe identity, a `MoveKeyframe`
  verb, and a property descriptor table so a value axis has units to draw. M5 landed all four.
- **Color — partly closed.** Lift/gamma/gain **now exists** (`lift_gamma_gain.wgsl`, all six
  enforced places wired), so **five** colour operations compile to a shader today: brightness,
  contrast, saturation, a 3D LUT, and the three-way wheels. Still absent: curves, the HSL
  qualifier, and power windows — the qualifier and windows both need a per-effect mask the
  compositor does not have, which is why they are the expensive two rather than the next two.
  Scopes,
  by contrast, need **no** GPU work — they are a CPU reduction over a readback that already
  happens, and that reduction has now been measured rather than assumed: all four over the
  640×360 buffer bay's preview composites cost **0.98 ms** single-threaded — six percent of a
  frame, and about half what the readback they measure costs — so the Color page can show four
  live scopes without sampling. At 3840×2160 they cost **35 ms**, which is two frames, and no
  choice of scopes rescues that: a caller reading a source-resolution frame passes a stride.
  [`benchmarks.md`](benchmarks.md#scopes--the-color-pages-four-reductions) has the per-scope
  table and the stride the Color page needs above preview size. Neither page changes the intermediate render-target format: that is decided and
  deferred in [`intermediate-format.md`](intermediate-format.md), which also names the cheaper
  win (collapse consecutive scalar effects into one pass) and the signal that reopens it.
- **Audio — built, and not yet reachable.** Pan, track gain and solo all exist now
  (`bay-project/src/track.rs`, `bay-audio/src/stream.rs`), together with a callback block mixer,
  a lock-free ring and peak/K-weighted metering. **But nothing calls any of it**:
  `editor/transport.rs` still pre-mixes the whole remaining timeline into one buffer, so a fader
  moved during playback changes the *next* play and not this one, and there is no running meter to
  read. `fixes.md` entry 15. The Audio page draws its meters dark on purpose until this is wired,
  which is the disabled-control rule being followed rather than dodged.

  Still genuinely absent: EQ, compression and aux sends as editable controls, and
  `ANIMATABLE_AUDIO` is still literally `["volume"]`.
- **Deliver** — export runs synchronously on the UI thread, so a progress bar cannot move.
