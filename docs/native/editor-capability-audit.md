# Editor capability audit — what bay can do, and what a real edit needs

**Read against the code on 2026-08-10** (`fix/pending-sweep`). Every claim below names the file
that proves it. Companion to [`parity-status.md`](parity-status.md) (what landed and what verifies
it) and [`../todo.pending.md`](../todo.pending.md) (shell, provisioning and AI work, which this
does not duplicate).

Scope of the question: what stands between bay today and an editor someone would cut a real film
in — and, specifically, what makes AI-authored video come out sub-par.

---

## The one-sentence version

bay was a very good **compositor with a timeline in front of it**, not yet an **editor**: it
could place, transform, animate and encode, but it could not cut. Three structural holes —
**source in/out points**, **transitions**, and **audio shaping** — and every one of them
invisible from the MCP surface too, which is why an agent's output plateaued at "layout, not
edit".

> **Update, 2026-08-11.** Items 1–9 of §9 have landed. The sections below are kept as the
> record of what was wrong; each closed one says what closed it. What remains is items 10–11 —
> shot detection and media bins, and the content packs — plus the smaller gaps listed inside
> §2.2, §3.4 and §5 that were never in the top nine.

---

## 1. What actually works today

Not a wish list — this is verified by tests in the tree.

| Area | State |
|---|---|
| Project model | 5 element kinds, scenes, 3 lane kinds, kebab-case wire format pinned by round-trip tests |
| Compositing | wgpu, 17 blend modes, `fit_contain`, sub-pixel transforms, NaN/tiny-canvas safe |
| Transform | x, y, scale, scale_x/scale_y, rotation, opacity, anchor_x/anchor_y (`element.rs:246`) |
| Animation | 7 properties keyframable, 8 easings incl. `expo-out`/`back-out`/`hold` (`element.rs:36`) |
| Text | family, weight, size, colour, align, letter-spacing, line-height, real shaping via cosmic-text |
| Decode | off the render path, budget-bounded LRU preview cache, source-resolution streamed export |
| Audio | per-clip gain + mute, multi-clip mix into the export via `amix` (`bay-preview:1128`) |
| Speech | Kokoro TTS with word-synced captions from one synthesis, SRT in/out |
| Undo | every edit is a `Command` → self-inverting `ProjectPatch`; agent edits undo with Cmd+Z |
| Provisioning | ffmpeg + Python + Kokoro from a pinned, SHA-256-verified manifest |
| MCP | <!-- bay-tool-count -->95<!-- /bay-tool-count --> generated tools; an agent can build a reel end to end and look at frames before rendering |

---

## 2. Precise editing — the biggest hole

### 2.1 Trimming does not trim the footage — **closed**

`Command::TrimElement` writes `start` + `duration` only (`command.rs:68`). **Nothing in the
codebase ever writes `VideoElement::trim_start` / `trim_end` after creation** — the only writer is
`add_video`'s creation path (`plan.rs:605`, `studio.rs:612`). The decoder honours `trim_start`
(`bay-preview:1415`), so the field works; there is simply no verb to change it.

What that means in practice: dragging a clip's left edge moves *when the clip plays*, not *which
part of the source plays*. You cannot choose the in-point of a shot after placing it. That is not
a missing convenience — it is the definition of editing.

`AudioElement` has no trim field at all, and the export mixer hardcodes `trim_start_seconds: 0.0`
with a comment saying so (`bay-preview:1648`). A song can only ever start at bar one, so
"picture cut to music" cannot start at the drop.

**Closed.** `TrimElement` now consumes source when the head moves, and both edges stop at the
media boundary; `SetSourceStart` slips a clip without moving it; `SplitElement` advances the
second half's in-point; `AudioElement` has a `trim_start` that reaches the export mixer and the
preview; `MediaAsset` carries its probed length, so a trim has an end to stop at and `check`
has something to measure against. The timeline's edge-drag and the inspector's "Source in" row
are the same commands. 15 tests in `bay-core/tests/editor.rs`, wire format pinned in
`bay-project/tests/model.rs`.

### 2.2 The edit verbs that do not exist

| Missing | Consequence |
|---|---|
| Ripple delete / close gap | deleting a clip leaves a hole; every later clip must be dragged by hand |
| Roll, slip, slide | the three edits that fix a cut without re-laying the timeline |
| Snapping (playhead, clip edges, markers) | at 48 px/s a frame is 1.6 px — mouse-accurate cutting is impossible |
| Multi-select | model holds `Vec<ElementRef>` (`editor.rs:227`) but the UI only ever calls `select(vec![one])` (`editor_view.rs:821`) — no marquee, no shift-click, no group move |
| Markers, in/out points, ranged export | no way to mark a moment or render only part of the timeline |
| Frame stepping | `←`/`→` are ±1 second (`key_bindings()`); there is no ±1 frame, no J/K/L, no Home/End, no timecode entry — though `geometry.rs` already has exact frame math |
| Speed / retime | no speed field anywhere. No slow motion, no reverse, no ramps, no freeze frame |
| Nesting / compound clips | scenes exist but cannot be placed inside one another |

---

## 3. Look — why AI-authored frames read as cheap

### 3.1 Four effects — **closed**

`brightness`, `contrast`, `saturation`, `gaussian_blur` (`bay-effects/src/shaders/`). That is the
whole grading toolkit.

Missing and load-bearing for a professional look: **LUT (.cube)**, curves, lift/gamma/gain wheels,
white balance, sharpen, glow/bloom, grain, vignette, chroma key, denoise, stabilisation.

A LUT effect is the highest-leverage single item on this page: one shader unlocks an entire
purchasable/creatable *look library*, and it is how a grade gets applied consistently to twenty
clips instead of dialled by hand on each.


**Closed for grading.** A `lut` effect parses `.cube` files, uploads them as a filterable 3D texture and samples at texel centres. The rest of the list — curves, wheels, white balance, sharpen, glow, grain, vignette, chroma key, denoise, stabilisation — is still absent, but a LUT covers the *look* half of it, which is what a grade actually is.

### 3.2 There are no transitions. At all. — **closed**

Not in the model, not in the compositor, not in MCP. Every cut in every bay video is a hard cut.
A cross-dissolve is the most-used edit in the medium and bay cannot produce one.

This needs a deliberate model decision before code: a transition as an **element that owns the
overlap between two clips** (Premiere/Resolve) versus **per-clip in/out transitions** (simpler,
weaker). The compositor already renders N layers per frame with blend modes, so a dissolve, dip to
colour, wipe and slide are shader-and-schedule work once the model exists.


**Closed.** Not as a transition object: a cross-dissolve is the incoming clip fading in over the outgoing one, which needs no track-level structure and does not dip through the background. Fades live on every element kind and serve picture and sound alike. Wipes and slides — which need geometry, not alpha — are still absent.

### 3.3 Masks are built, tested, and switched off — **closed**

`bay-masks` implements a JFA SDF feather pipeline; `compositor.rs` passes `multiview_mask: None`
at five call sites (199, 232, 265, 543, 639). There is no mask field on `Element`, so nothing can
ever request one. Cost of activation is a model field plus plumbing — the hard part is already
written and paid for. It unlocks shape masks, vignettes, split screens and reveal wipes.


**Closed.** An optional `Mask` on every visual element, rasterised to a frame-space coverage texture and handed to the pipeline that was already there.

### 3.4 Other gaps in the picture path

- **No crop.** `scale_x`/`scale_y` squash; they do not reframe. Turning 16:9 footage into a 9:16
  reel currently means letterboxing or scaling past the frame edge and hoping.
- **No adjustment layers, no track-level effects.** Effects live on elements only, so grading a
  20-clip sequence means 20 copies of the same effect stack, each drifting independently.
- **Text is one style per element.** No rich runs, no per-word or per-character animation — the
  exact thing that makes modern captions look modern. Kokoro's word-synced captions land as plain
  text elements and inherit that ceiling.
- **Shapes are rect and ellipse, fill only** (`element.rs:373`). No stroke, line, arrow, polygon or
  path, so no callouts, no underlines, no diagram work.
- **No motion blur**, no 3D transforms.

---

## 4. Audio — half of perceived quality — **closed**

- **No fades and no crossfades.** Every audio edit is a click.
- **Volume cannot be keyframed.** `animate` covers 7 visual properties only (`tools.rs:303`), so a
  music bed cannot duck under narration except by splitting the clip and setting gains by hand.
- **No ducking, no pan, no EQ, no compressor/limiter.**
- **No loudness normalisation.** Social platforms target ≈ −14 LUFS; bay exports whatever the mix
  happens to be, so AI-authored reels arrive quiet or clipped.
- **Preview mixes the whole timeline up front** and there is no audio scrubbing — you cannot hear
  where you are cutting.

---

## 5. Media handling

- **No proxies / optimised media.** Long clips still play as a low-fps ≤480px proxy — known, and
  the remainder of M9.
- **No shot or scene detection.** Hand an agent an hour of footage and it has no way to find the
  three usable seconds. This is the prerequisite the vision work already flags.
- **The media panel is a flat list** (as of today's change). No bins, tags, search, ratings, or
  duplicate detection.
- **No image-sequence import, no GIF/WebM export, no still-export presets.**

---

## 6. Export — **closed**

The encoder was invoked with `-pix_fmt yuv420p` and nothing else (`bay-preview:1162`). There is no
`-c:v`, no CRF, no bitrate, no profile/level.

Missing: codec choice (H.264/HEVC/ProRes/VP9), quality control, alpha output, two-pass, per-platform
presets (Reels/TikTok/Shorts/YouTube with their own size, fps and loudness), ranged export, a render
queue (the jobs infrastructure to run one already exists), and a "reveal in Finder" afterwards.

---

## 7. The MCP surface — where AI quality is actually capped — **closed**

The original surface could **create** almost anything and **revise** almost nothing.

| Exists | Missing |
|---|---|
| `add_text` `add_shape` `add_image` `add_video` `add_audio` | `element_move` `element_trim` `element_split` `element_set_source_range` `element_duplicate` |
| `animate` (7 visual properties) | `audio_gain` `audio_fade` `animate` on volume |
| `element_delete` | `effect_add` `effect_set` `blend_set` `text_update` `transform_set` |
| `timeline` (read) | `transition_add` (nothing to add yet) `track_add` `undo` |
| `snapshot` `render` | `check` — a QA pass over the timeline |
| `fonts_check` (names you already guessed) | `music_search` `effects_list` `transitions_list` `templates_list` `fonts_list` |

**Closed.** 13 revising tools plus `check`, defined once in `bay_agent::plan` and routed to by
the headless studio, so the window and the wire share one definition of what an edit means.
`timeline` now also reports each clip's in-point, its media id and its effects, so an agent can
read what it is about to change. The two consequences below were the reason:

1. **An agent that looks at a snapshot and sees the title sitting too low cannot nudge it.** Its
   only recourse is `element_delete` and re-add, losing every animation attached to it. The
   snapshot-and-look loop the tool descriptions rightly insist on is therefore half a loop.
2. **A `check` tool is missing and would be cheap.** Off-canvas elements, type below a legible size
   at thumbnail scale, clipped or silent audio, accidental gaps, overlapping clips on one lane,
   all-black frames, captions running past their clip — every one is mechanically detectable from
   the project model plus a few sampled frames. This is the single highest-yield item for stopping
   sub-par AI output *at scale*, because it turns a taste problem into a test.

---

## 8. Libraries — music, looks, transitions, templates

The ask is a library the MCP server and the user reach the same way. The mechanism already exists
and should be reused rather than reinvented: `bay-provision` fetches pinned, SHA-256-verified
archives whose URLs must be immutable and whose licences must be redistributable — both enforced
by tests. A content pack is a manifest entry, and it inherits the digest verification, the
resume-safe staging, the background job and the progress UI for free.

Four pack kinds, in the order their prerequisites clear:

| Pack | Prerequisite | Shape |
|---|---|---|
| **Looks** | a LUT effect (§3.1) | `.cube` files + parameter presets; `effects_list` returns them, `effect_add` applies one |
| **Templates / titles** | promote `MotionPreset` out of memory | lower thirds, kickers, end cards as parameterised element bundles. `MotionPreset` exists today but lives in `EditorView` and dies with the window (`editor_view.rs: presets`) — it is never written to disk |
| **Music** | metadata schema + licence audit | beds with BPM, key, mood, duration and loop points; `music_search(mood, bpm, duration)` returns an already-imported media id. Licensing is the real work: the manifest's redistributable-licence test is a hard gate, and correctly so |
| **Transitions** | §3.2, the model decision | a transition pack is meaningless until transitions exist |

Two constraints from the manifesto that shape this: nothing downloads unless the user asks, and
packs must be genuinely redistributable. Both are already enforced in code — do not route around
them for content.

---

## 9. What I would do, in order

Ranked by quality unlocked per unit of work, not by size.

| # | Item | Size | Unlocks |
|---|---|---|---|
| ~~1~~ | ~~**Source in/out**~~ — **done** | M | Editing at all. Everything below assumed it |
| ~~2~~ | ~~**MCP edit verbs**~~ — **done** | M | The agent's snapshot-and-revise loop closes |
| ~~3~~ | ~~**`check` QA tool**~~ — **done** | S–M | Turns "is this any good?" into a test that runs before render |
| ~~4~~ | ~~**Transitions**~~ — **done** — model decision, then dissolve / dip-to-colour / wipe | M–L | Every cut stops being hard |
| ~~5~~ | ~~**Audio shaping**~~ — **done** — fades, volume keyframes, ducking, −14 LUFS on export | M | Half of perceived quality, currently untouched |
| ~~6~~ | ~~**Export control**~~ — **done** — codec, CRF, platform presets, ranged export | S–M | Deliverables that match where they are posted |
| ~~7~~ | ~~**Timeline precision**~~ — **done** — snapping, frame stepping, multi-select, ripple delete, markers | M | Makes the GUI usable for a real cut |
| ~~8~~ | ~~**LUT effect + look packs**~~ — **done** | M | A grade, and the first content library |
| ~~9~~ | ~~**Masks activation + crop**~~ — **done** | M | Already-built code switched on; reframing without hacks |
| 10 | **Shot detection + media bins** | L | An agent can find the good three seconds in an hour |
| 11 | **Music + template packs on `bay-provision`** | L | The library the question asked for, once its prerequisites are met |

Items 1–9 are done. What is left is items 10–11 — shot detection with media bins, and the
content packs — plus the smaller gaps recorded inside the sections above that were never in the
top nine: ripple/roll/slip gestures beyond the ones that landed, speed and retime, nesting,
adjustment layers, per-word text animation, stroked shapes, and the rest of the colour toolkit
beyond a LUT.
