> **Historical:** describes the Rust engine, deleted; recover what it cites with `git show rust-engine-final:dep/rust/<path>` (e.g. `crates/bay-mcp/src/tools.rs`).

# Capability map — bay today vs. what kick-ass motion graphics need

Read against the code on **2026-08-11**, branch `fix/pending-sweep`. Every "have" below names
the file that proves it. Companion to
[`docs/native/editor-capability-audit.md`](../docs/native/editor-capability-audit.md), which
answered "can you cut a film in this?" — **this file answers a narrower question: can an agent
express a professional motion graphic with this instruction set?**

Legend: ✅ have · ⚠️ partial · ❌ absent

---

## 0. The summary

bay is now a **competent editor** — the previous audit's top nine all landed. It is not yet a
**motion-graphics instrument.** The distinction is precise:

- An editor arranges existing images in time. bay does this well.
- A motion-graphics tool *generates* images from primitives and gives motion enough expressive
  range that the result reads as designed rather than as animated-by-defaults.

The three structural holes on the motion-graphics side:

1. **Motion has one gear.** Seven scalar channels, one easing per channel, no groups, no
   stagger, no paths, no animatable blur or colour. Every move that isn't translate/scale/fade
   is inexpressible, which is why every move *is* translate/scale/fade.
2. **The drawing primitives stop at filled rectangles.** No stroke, no path, no gradient, no
   text outline. That single gap blocks line charts, self-draw reveals, underlines, callouts,
   connectors, ring progress, glow backgrounds, and legible captions over footage.
3. **Nothing in the loop measures perceptual quality.** `check` is well-built and catches
   structural defects. Every failure in [`01-why-ai-video-is-bad.md`](01-why-ai-video-is-bad.md)
   passes it.

---

## 1. Motion and animation

| Capability | bay | Notes |
|---|---|---|
| Keyframable properties | ⚠️ 7 | opacity, scale, x, y, rotation, scaleX, scaleY (`element.rs:972`) + audio `volume` |
| Easing curves | ⚠️ 8 | linear, ease-in/out/in-out, power-out, expo-out, back-out, hold (`element.rs:90`) |
| **Per-segment easing** | ❌ | `AnimationChannel` carries **one** `easing` for *all* segments (`element.rs:148`). You cannot ease into a hold and ease out of it on one channel — every segment of a channel shares a curve |
| Spring / critically-damped settle | ❌ | the doctrine's default (§02) is unavailable; the only characterful curve is `back-out`, the one the doctrine says to avoid |
| Custom / bezier easing | ❌ | no control points |
| Stagger primitive | ❌ | N elements = N `animate` calls with hand-computed offsets and a hand-computed decay |
| Motion path / arcs | ❌ | x and y are independent channels; every move is a straight line or an accidental parabola |
| **Animatable blur** | ❌ | effect params are `BTreeMap<String, f32>` with no channels (`element.rs:17`). This blocks velocity-matched cuts, rack focus, motion-blur streaks, and depth-of-field — the whole depth toolkit |
| Animatable colour | ❌ | colour is a `String`; a colour change means two elements cross-faded |
| Animatable font size / tracking | ❌ | so no scale-on-value counters that grow type, no tracking reveals |
| Animatable mask / crop / anchor | ❌ | so no wipe reveals, no reframing moves, no origin changes mid-shot |
| **Group / parent transform (a camera)** | ❌ | a scene push is N `animate` calls that must agree; a camera move over 12 elements is 12 calls and any drift is visible |
| 3D transforms / perspective | ❌ | no rotateX/Y, no translateZ — no card flips, no depth scatter, no camera flight, no zoom-through |
| Jitter / noise primitive | ❌ | the only sanctioned aliveness (§02 rule 3) can't be expressed; the agent falls back to a slow zoom, which the doctrine forbids |
| Render-time motion blur | ❌ | no shutter-angle sampling; fast moves are unnaturally crisp (§02) |
| Determinism | ✅ | keyframes sampled as a pure function of time; no wall-clock, no randomness |
| Undo of agent edits | ✅ | every edit is a self-inverting `ProjectPatch` |

**The compounding effect:** items 3, 5, 7, 8, 9, 10 and 11 together mean the *only* entrance an
agent can author is "translate and fade, on one of eight curves." Failure mode #2 in §01 is
not a taste problem.

## 2. Drawing primitives

| Capability | bay | Notes |
|---|---|---|
| Rect (with corner radius), ellipse | ✅ | `ShapeKind` (`element.rs:504`) |
| Solid fill | ✅ | `#rrggbb` |
| **Stroke / outline** | ❌ | fills only — no ring charts, no outlined tracks, no key-line frames |
| **Path / polyline / line / arrow** | ❌ | no line charts, no sparklines, no connectors, no underlines, no SVG-style self-draw, no diagrams |
| Gradient fill (linear / radial) | ❌ | no glow backgrounds, no light falloff, no gradient panels — every fill is flat |
| Polygon / star / custom shape | ❌ | |
| Drop shadow on a shape | ❌ | no elevation, so no depth from stacking |
| Image | ✅ | with crop and transform |
| Video | ✅ | source-range trimmed, streamed at source res on export |

## 3. Text

| Capability | bay | Notes |
|---|---|---|
| Family, weight, size, colour, align, tracking, line-height | ✅ | real shaping via cosmic-text (`bay-text/src/lib.rs:22`) |
| System font check before use | ✅ | `fonts_check` |
| Word-synced captions from TTS | ✅ | one synthesis produces both audio and word timings |
| SRT in / out | ✅ | |
| **Stroke / outline on glyphs** | ❌ | the #1 caption legibility rule (§03) — over arbitrary footage, plain fill text will land on a same-value background |
| **Drop shadow / glow on text** | ❌ | same |
| Background plate / pill behind text | ❌ | the other standard caption treatment |
| **Per-character / per-word animation** | ❌ | a text element is one layer. Kinetic typography means one element per word, hand-staggered — and each word then needs its own `animate` call |
| Rich runs (mixed style in one block) | ❌ | no emphasised word inside a sentence |
| Gradient / image fill on type | ❌ | |
| Auto-fit / shrink-to-box | ❌ | a too-long string silently wraps, and the defect is invisible until you look at the frame |
| Tabular figures | ❌ | count-ups jitter horizontally as digit widths change (§08) |
| Text on a path | ❌ | |

## 4. Look, colour and texture

| Capability | bay | Notes |
|---|---|---|
| Brightness, contrast, saturation, gaussian blur | ✅ | `bay-effects/src/shaders/` |
| LUT (`.cube`) | ✅ | parsed, uploaded as a filterable 3D texture |
| Built-in generated looks | ✅ | **6**, generated in code — no download, no licence question (`looks.rs`) |
| Blend modes | ✅ | 17, matching the compositor |
| Masks | ⚠️ | one per element, ellipse or rect, feathered, invertible — **not animatable, not path-based, one per element** |
| Crop | ✅ | per-side, for genuine reframing |
| **Grain / noise** | ❌ | the single most cost-effective "not synthetic" treatment (§06) |
| **Vignette** | ❌ | second most |
| **Glow / bloom** | ❌ | bright elements read as bright rectangles, not as light |
| Sharpen | ❌ | |
| Chromatic aberration / glitch | ❌ | |
| Curves / wheels / white balance | ❌ | LUT covers the *look*; there is no correction stage under it |
| Chroma key | ❌ | |
| **Adjustment layer / track-level effect** | ❌ | grading 20 clips means 20 stacks that drift independently |
| Keyframable effect params | ❌ | see §1 |

## 5. Seams and transitions

| Capability | bay | Notes |
|---|---|---|
| Fades (in/out, per element, picture and sound) | ✅ | linear, correct for both |
| Cross-dissolve | ✅ | `transition_add` — the incoming clip fading in over the outgoing one on the same lane (`plan.rs:1378`); no dip through the background |
| **Wipe / slide / push** | ❌ | needs geometry; masks are not animatable |
| **Dip to colour / flash** | ❌ | |
| **Iris / clip reveal** | ❌ | |
| **Whip pan / directional blur** | ❌ | needs animatable blur |
| **Zoom-through / velocity-matched cut** | ❌ | needs animatable blur + scale on a group |
| Glitch / light leak / film burn | ❌ | |
| Seam vocabulary in the skill | ❌ | nothing tells the agent that a seam has a grammar at all |

## 6. Audio

| Capability | bay | Notes |
|---|---|---|
| Per-clip gain, mute, fades | ✅ | |
| Volume keyframes | ✅ | with eased segments subdivided so an `expo-out` duck is a curve in the file, not a straight line (`element.rs:732`) |
| Audio trim (start anywhere in a bed) | ✅ | `trim_start` reaches both preview and export |
| **Synthesised SFX at the requested length** | ✅ | **13** effects — whoosh, reverse whoosh, riser, impact, click… (`sfx.rs`). Genuinely better than a sample pack for this job (§07) |
| Kokoro TTS narration + word timings | ✅ | |
| **Loudness normalisation** | ✅ | one-pass `loudnorm` to −14 LUFS, TP −1.5, LRA 11; `social` / `youtube` / `master` export presets (`bay-preview:1466`) |
| Multi-clip mix into export | ✅ | |
| **Automatic ducking** | ❌ | must be keyframed by hand; the flat-mix failure (§07) is the default outcome |
| **Beat / BPM detection, music cue extraction** | ❌ | the agent has no beat grid, so "cut to the music" is guesswork |
| Pan, EQ, compressor/limiter | ❌ | |
| Audio scrubbing in preview | ❌ | you cannot hear where you are cutting |
| Waveform display | ✅ | |

## 7. The MCP surface (what the agent can actually do)

**~45 tools.** Create, revise, inspect and render are all covered — this was the previous
audit's biggest win and it is genuinely closed.

✅ `project_create/load/save/info` · `media_import` · `add_text/shape/image/video/audio` ·
`animate` · `element_move/trim/split/duplicate/delete/rename/ripple_delete/source` ·
`transform_set` · `crop_set` · `mask_set` · `fade_set` · `text_update` · `blend_set` ·
`effect_add/set/remove` · `looks_list` · `templates_list` · `template_place` ·
`transition_add` · `marker_add` · `audio_set` · `sfx_list/search/add` · `sound_add` ·
`narrate` · `subtitles_add/export` · `subtitles_to_video` · `shots_detect` · `fonts_check` ·
`timeline` · `check` · `snapshot` · `render` · `job_status/cancel` · `runtime_status/install`

Gaps that matter for quality rather than for coverage:

| Missing | Consequence |
|---|---|
| `animate_many` / stagger | a 6-word kinetic headline is 6 elements × 2 channels = 12 calls with hand-computed offsets. The agent gets it wrong or gives up and uses one text element |
| `contact_sheet` | `snapshot` is one frame per call; checking 8 moments is 8 calls and 8 image attachments. Batched inspection is both cheaper and better (§09) |
| `beats` / `music_analyze` | no beat grid, so no beat sync |
| `duck` | ducking is the single most-needed audio verb and it is hand-keyframed |
| `preset_apply` (style, not grade) | a "look" today is a LUT; there is no way to apply palette + type + motion energy as one decision |
| `storyboard` / plan artifact | there is no object between "the prompt" and "45 tool calls" |

## 8. The quality gate

| Check | bay | Notes |
|---|---|---|
| Off-canvas elements | ✅ | anchor outside 0..1 |
| Type below legible size | ✅ | 2.2% of canvas height ≈ 24 px on 1080 — the right threshold, and scale-aware |
| Gaps in the picture | ✅ | with a rounding-artifact floor |
| Overlapping clips on one lane | ✅ | |
| Clip reading past the end of its media | ✅ | |
| Silent timeline | ✅ | |
| Low-ink frames | ⚠️ | `scripts/inkcheck.py`, a script rather than a tool |
| **Contrast measured against the actual backdrop** | ❌ | the §03 table exists in prose; nothing computes it |
| **Everything-arrives-in-the-first-25%** | ❌ | the primary failure mode (§01 #1) is trivially detectable from keyframe times |
| **Motion monotony** (one ease / one duration / one direction) | ❌ | also trivially detectable: histogram the easings and durations across the project |
| **Caption legibility over its own backdrop** | ❌ | |
| **Audio balance** (bed vs narration levels over time) | ❌ | both envelopes are already computable via `gain_points()` |
| **Dead air at seams** | ⚠️ | inkcheck approximates it |
| **Rhythm** (beat-length variance, reveal density) | ❌ | |

Every one of the ❌ rows is computable from the project model plus a few sampled frames. **This
is the cheapest large win in the document** — it converts a taste problem into a test, which is
the only form of quality that survives being run at scale by an agent.

## 9. The knowledge layer (the skill)

| | bay | Reference (§09) |
|---|---|---|
| API reference | ✅ good | ✅ |
| Canvas grid, keep-outs, type scale | ✅ good (`layout.md`) | ✅ |
| Contrast table with measured values | ✅ good | ✅ |
| Chart recipes | ✅ (`charts.md`) | ✅ |
| Narration and caption timing | ✅ (`narration.md`) | ✅ |
| Worked end-to-end recipes | ✅ (`recipes.md`) | ✅ |
| **Motion doctrine** (smooth > bouncy, sequential reveal, no bad aliveness, velocity-matched seams) | ❌ | ✅ 150+ lines |
| **A named move vocabulary to cite** | ❌ | ✅ ~45 rules |
| **Whole-shot blueprints** | ❌ | ✅ 22, mined from 178 real clips |
| **Style specs coupling palette + type + motion** | ❌ | ✅ 8 named styles |
| **Banned defaults** (fonts, colours, patterns) | ❌ | ✅ |
| **Story structure, hooks, emotional arc** | ❌ | ✅ 255 lines |
| **Cut catalog with exact numbers** | ❌ | ✅ 215 lines |
| Doctrine written as prohibitions | ⚠️ partial | ✅ |
| **Stale content** | ⚠️ | `troubleshooting.md`'s "Still missing" table lists masks and audio trim as missing — both shipped. A stale gap list makes the agent design around constraints that no longer exist |

---

## 10. The ranked gap

Ordered by **quality unlocked per unit of work**, not by size. Detail and sequencing in
[`11-action-plan.md`](11-action-plan.md).

> **Revised after measurement — read [`12-video-teardowns.md`](12-video-teardowns.md) with this
> table.** Five videos were analysed frame by frame. Both reference videos turned out to be
> reproducible in bay's *current* primitive set — neither needs paths, gradients, animatable
> blur, animatable masks or 3D. So rows 4, 5, 9, 14 and 15 below are real gaps that are **not**
> the binding constraint on the videos we are actually trying to make. Rows 1, 2 and 6 were
> confirmed. Two items missing from this table were promoted above most of it: **audio defaults**
> (bed + SFX + the −14 LUFS export preset, all of which already exist and go unused — our videos
> measure −16.5, −25.3 and −27.5 LUFS against both references' −14.0) and an **asset pipeline**
> (the references are made of imported illustration and screen capture; ours are text on black).

| # | Gap | Size | Unlocks |
|---|---|---|---|
| 1 | **The knowledge layer** — doctrine, move vocabulary, blueprints, banned defaults | M | Fixes 8 of the 14 failure modes with zero engine work |
| 2 | **The perceptual `check`** — motion monotony, front-loading, contrast-in-place, audio balance | S–M | Turns taste into a test; catches regressions at scale |
| 3 | **Per-segment easing + a spring curve + a stagger verb** | S–M | Motion stops having one gear; kinetic type becomes one call |
| 4 | **Keyframable effect params (blur first)** | M | Velocity-matched cuts, rack focus, depth — the entire depth toolkit |
| 5 | **Stroked paths / polylines** | M–L | Line charts, self-draw, underlines, callouts, connectors, rings |
| 6 | **Text stroke, shadow and plate** | S | Captions become legible over footage — the most-watched text in every video |
| 7 | **A group/camera transform** | M | One push instead of twelve; parallax; makes seam moves affordable |
| 8 | **Texture effects: grain, vignette, glow** | S–M each | The "expensive" look; the cheapest anti-synthetic treatment there is |
| 9 | **Gradients (linear + radial)** | S–M | Background layers stop being flat; light gets falloff |
| 10 | **Per-word text animation inside one element** | M | Modern captions, kinetic type without N elements |
| 11 | **Auto-duck + beat grid** | M | The flat-mix failure and the "not actually synced" failure, both closed |
| 12 | **Style presets (palette + type + motion), not just LUTs** | M | One coherent decision instead of forty independent ones |
| 13 | **`contact_sheet`** | S | Makes looking-at-frames cheap enough to actually do |
| 14 | **Animatable masks → wipes and reveals** | M | The transition family that needs geometry |
| 15 | **3D transforms** | L | Flips, zoom-through, depth scatter, camera flight |
| 16 | **Speed / retime / freeze** | M | A whole grammar (slow-mo emphasis, freeze on the punchline) that is simply absent |
