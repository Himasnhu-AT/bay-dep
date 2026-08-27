# bay — the six-page editor

**Status: designed, not shipped.** This is the contract every page milestone builds against.
Written 2026-08-27 against the audit of DaVinci Resolve 21's page model and bay's own crates.
A prototype of the whole shell exists and was approved before implementation began.

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

## What each page needs from the engine that does not exist yet

Recorded so a page is never built on an assumption. Detail and evidence in `fixes.md` and the
milestone list.

- **Motion** — bezier handles per keyframe (bay interpolates by named easing today; there are no
  tangents anywhere in the repo), stable keyframe identity, a `MoveKeyframe` verb, and a property
  descriptor table so a value axis has units to draw.
- **Color** — lift/gamma/gain, curves, qualifier and windows are all absent; exactly four colour
  operations compile to a shader today (brightness, contrast, saturation, and a 3D LUT). Scopes,
  by contrast, need **no** GPU work — they are a CPU reduction over a readback that already
  happens, and that reduction has now been measured rather than assumed: all four over a
  854×480 preview frame cost **1.8 ms** single-threaded, of which the vectorscope is more than
  half; at 3840×2160 they cost **36 ms**, which is two frames.
  [`benchmarks.md`](benchmarks.md#scopes--the-color-pages-four-reductions) has the per-scope
  table and the stride the Color page needs above preview size. Neither page changes the intermediate render-target format: that is decided and
  deferred in [`intermediate-format.md`](intermediate-format.md), which also names the cheaper
  win (collapse consecutive scalar effects into one pass) and the signal that reopens it.
- **Audio** — there is no real-time audio path at all. No pan anywhere in the codebase, no
  track-level gain or solo, and `ANIMATABLE_AUDIO` is literally `["volume"]`.
- **Deliver** — export runs synchronously on the UI thread, so a progress bar cannot move.
