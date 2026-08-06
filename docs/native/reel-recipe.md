# Building an infographic reel with vii

A record of making one 21.4s vertical reel end to end through the MCP server — what vii needed
before it was possible, what the build turned up, and what is still missing.

The reel: **"Volatility Drag"**, 1080×1920 · 30fps · 21.429s · h264 + AAC.
Build script: driven entirely by `vii-mcp` tool calls (see [`mcp.md`](mcp.md)).

---

## What vii could not do before this

An infographic reel is picture cut to music, made of type and shapes. vii could do neither
half. Five gaps, all now closed:

| Gap | Why it blocked the reel | Fix |
|---|---|---|
| **Export had no audio** | `export_video` piped one rawvideo input, no `-c:a`, and never read `tracks.audio`. Every export was silent. | Audio lanes are mixed in via `adelay`/`atrim`/`volume`/`amix` |
| **No shape primitive** | `Element` was Video/Image/Text/Audio. Every bar, rule, dot and panel was unrepresentable. | `Element::Shape` — rect (with corner radius) or ellipse |
| **Uniform scale only** | One `scale` field, always centred. A bar chart needs one axis to grow while the other holds, from a fixed edge. | `scale_x`/`scale_y` + `anchor_x`/`anchor_y` on `Transform` |
| **Linear keyframes only** | Everything moved at constant speed, which reads as mechanical. | `Easing` on `AnimationChannel` (8 curves) |
| **Text was size + colour** | No family, weight, alignment, tracking or line height — no house typography. | All five on `TextElement`, honoured by `vii-text` |

Plus the surface to drive it: `vii-mcp`, 16 tools over HTTP or stdio.

---

## Four defects the build found

Every one was caught by **looking at a rendered frame**, not by a test. Each now has a test.

### 1. Letter spacing was ~30× too wide
`Attrs::letter_spacing` adds straight onto a glyph advance *while the advance is still in em*
(`x_advance / font_scale`), before layout multiplies by the font size. Treating it as pixels
and scaling by `font_size` inflated tracking by the font size itself, wrapping every
letterspaced kicker onto three lines.
→ `letter_spacing_is_em_not_pixels`, `a_tracked_kicker_stays_on_one_line`

### 2. Rounded bars rendered as pointed lenses
Shapes were rasterized into a **square** buffer, so `radius: 0.5` was a circle — and stretching
a circle to a 390×24 bar gives a lens, not a pill. Rasters are now drawn at the layer's own
aspect (quantized, so a growing bar reuses a handful of textures).
→ `a_wide_pill_has_a_flat_top_not_a_pointed_lens`, `shape_raster_sizes_are_quantized`

### 3. The raster cache could evict a texture the current frame was using
Eviction ran inside `remember_raster`, i.e. while the frame was still being assembled. Once a
single frame needed more than 64 distinct rasters, the earliest layers' textures were released
before the draw and the compositor died with `MissingTexture` — **crashing the process
mid-render**. Eviction now happens after the frame is submitted and skips anything that frame
referenced.
→ `a_frame_with_more_rasters_than_the_cache_cap_still_renders`

### 4. `scale` on text was a wrap box, not a scale
Text was rasterized at the *sampled* scale, so animating `scale` reflowed the paragraph and
re-shaped every glyph instead of scaling it — a scale-punch could make the text *smaller*. The
raster is now built at the element's **base** scale and reported as the layer's natural size,
so `fit_contain` scales the finished raster.
→ `an_animated_scale_actually_changes_a_texts_rendered_size`

---

## Craft notes that generalize

**Measure contrast, don't eyeball it.** The house panel colour `#26262E` is **1.28:1** against
the `#0E0E12` ground — a chart track at that value is invisible, so the bar has no denominator.
`#606070` measures 3.12:1. And opacity defeats the measurement: the same `#606070` at 28% alpha
composites back to ~1.3:1.

**Land reveals on the beat, don't start them on one.** Passing a beat time as an animation's
start makes the element *begin* moving on the beat and arrive ~0.5s late — nothing is actually
synced. The build script computes `start = beat − duration` instead.

**Sweep for dead air.** Rendering ~110 frames across the timeline and measuring non-background
pixel fraction found that every scene opened with only its kicker for ~0.5s. Widening the
crossfade to 0.45s and pulling each scene's hero element earlier fixed it. Only the opening cut
from black is now empty.

**A tiny element is not a blank frame.** A 34px kicker is ~0.1% of a 1080×1920 frame and
perfectly legible; the first threshold flagged it as blank. Blank has to mean *no ink at all*.

**Put chart values on one grid.** Floating each value above its own column put the short
column's label straight through the reference gridline and into that gridline's label. Captions
and values below the axis: one grid, no collisions, same reading order for every column.

---

## Still missing

| Gap | Consequence | Where it would go |
|---|---|---|
| **Masks** | The compositor has a JFA mask pipeline, but the preview passes `mask: None` unconditionally. No wipe reveals — entrances are rise + fade only. | `vii-preview::render` |
| **Per-character / per-word animation** | A whole text element is one layer, so staggered word-by-word entrances need one element per word. | new element kind or a text-run animation channel |
| **Stroke / outline shapes** | Fills only, so an outlined chart track or a ring chart is unrepresentable. | `ShapeKind` + the shape rasterizer |
| **Path / polyline** | No line charts, no equity curves — the most natural trading graphic. | new `ShapeKind::Path` |
| **Rotation about the anchor** | `anchor_x/y` govern placement only; rotation is still about the quad centre. | `QuadTransformDescriptor` |
| **Audio trim** | `AudioElement` has no `trim_start`, so a clip always plays from its head. The mixer already threads the value through. | `vii-project::AudioElement` |
| **Text auto-fit** | Font sizes are chosen by hand and a too-long string silently wraps. A "shrink to fit this box" mode would remove a whole class of layout defect. | `vii-text` |

The reel worked around masks (fade + rise instead of wipes) and paths (columns instead of a
curve). Nothing else was compromised.
