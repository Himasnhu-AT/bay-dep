> **Historical:** describes the Rust engine, deleted; recover what it cites with `git show rust-engine-final:dep/rust/<path>` (e.g. `crates/bay-mcp/src/tools.rs`).

# 23 — Engine + MCP capability audit: what can bay actually DO?

Round 2. Everything below is read from source on `fix/pending-sweep` or measured against the
live `bay --mcp` (pid 92978, `./target/release/bay --mcp`) and the failed project
`~/Library/Application Support/vii/projects/project-1786466680050.json`.

**Note on units:** `MediaTime` ticks are **120,000/second** (`bay-time/src/media_time.rs:7`).
Numbers below are in seconds unless stated.

---

## 0. Headline

The skill does **not** lie about tools — all 55 registered tools are documented and all 55
documented tools are registered. The lie is one level down: **`animate` has two
implementations, and the one the agent actually reaches is crippled.** On the headless MCP
transport `animate` rejects 6 of the 14 advertised easings (including `spring-out`, which the
skill calls "the house entrance"), refuses `property: "volume"` outright, and **silently
discards** per-key `easing` — the three things `motion.md` and `audio.md` teach as the house
style. Every visual symptom in wicks-v2 that people call "taste" has a mechanical cause in that
split, in bay's own caption placement, or in a check that short-circuits.

`check` on wicks-v2 returns **`ok: true`, 0 errors, 24 warnings — 22 of which are
`gain-above-unity` noise produced by the workaround for the `animate volume` bug.**

---

## 1. Tool surface — ground truth

### 1a. The three lists

Extracted mechanically from `rust/crates/bay-mcp/src/tools.rs::definitions()` (55 `tool(...)`
calls), `dispatch()`'s match arms, `bay_agent::plan::planned_tools()` (34 names), and the
`###`/table entries in `.claude/skills/bay/references/tools.md`.

| List | Count | Members |
|---|---|---|
| **documented AND registered** | **55** | all of them |
| **documented but NOT registered** ("the skill lies") | **0** | — |
| **registered but NOT documented** (wasted capability) | **0** | — |
| **registered but NOT dispatchable** | **0** | — |
| **planned but NOT registered** | **0** | — |

The `EVIDENCE.md` note listing a ~30-tool registered set was reading a stale snapshot. The skill
header ("55 tools") is correct.

The full registered set:

```
add_audio add_image add_shape add_text add_video animate animate_many audio_set blend_set
check crop_set effect_add effect_remove effect_set element_delete element_duplicate
element_move element_rename element_ripple_delete element_source element_split element_trim
fade_set fonts_check job_cancel job_status looks_list marker_add mask_set media_import narrate
project_create project_info project_list project_load project_save render runtime_install
runtime_status sfx_add sfx_list sfx_search shots_detect snapshot sound_add speech_status
subtitles_add subtitles_export subtitles_to_video template_place templates_list text_update
timeline transform_set transition_add
```

### 1b. The real negative space — engine capability with **no MCP tool at all**

| Engine capability | Where it lives | Reachable over MCP? |
|---|---|---|
| Create / delete a scene | `Command::AddScene` / `RemoveScene` (`command.rs:191,193`); UI button `editor_view.rs:1839` | **No tool.** |
| Switch the active scene | `Editor::set_active_scene` (`editor.rs:211-217`) — not even a `Command` | **No tool.** |
| Add / remove / hide / mute a track | `Command::AddTrack`, `RemoveTrack`, `SetTrackHidden` | **No tool** (layers auto-create as a side effect of `layer:`) |
| Remove a marker; list markers | `Command::RemoveMarker`; `Scene::markers` | `marker_add` only. Markers are **not** in `timeline` output. |
| Save a template | `TemplateLibrary::save` (`templates.rs:359`) | **No tool.** An agent can place templates, never author one. |
| Blur background | `Background::Blur { blur_intensity }` (`settings.rs:50`) | **No tool.** `project_create` takes a `#rrggbb` string only. |
| Change the background after creation | `ProjectSettings::background` | **No tool at all.** Background is immutable after `project_create`. |
| Read back keyframes | `AnimationChannel::keys` | **No.** `timeline` returns only channel *names* — see §2c. |
| Measure rendered text extents | nothing exists — `bay-text` exposes only `render()` and `has_family()` | **No.** Text collision/overflow is undetectable. |
| Measure anything about a rendered frame | `snapshot` returns `{path, atSeconds, width, height}` | **No.** No luma, no coverage, no diff. |
| Install the recorded SFX packs | `library.rs` doc says `runtime_install sfx` | **No.** `runtime_install` enum is `["video","speech"]` only. `sound_add` is therefore dead on a fresh machine. |

---

## 2. The two-transport split — the highest-value finding in this file

`bay-mcp` has two dispatch paths (`server.rs:133-140`):

- **attached** (a desktop window is open): every tool → `bay_agent::plan` → `Command`s.
- **headless** (`bay --mcp` with no window — **what the agent uses**): `tools::dispatch` →
  `Studio` methods, falling through to `apply_planned` only for names not matched explicitly.

`dispatch` matches `"animate"` **explicitly**, so `animate` never reaches the planner headlessly.
`Studio::animate` + `studio::parse_keys` + `studio::parse_easing` are a second, older
implementation of the same verb. They disagree with the schema the same file advertises.

### 2a. Measured, on the live server

| Probe | Result |
|---|---|
| `animate{elementId:"panel", property:"rotation", easing:"spring-out", keys:[…]}` | **error:** `unknown easing "spring-out" — use one of linear, ease-in, ease-out, ease-in-out, power-out, expo-out, back-out, hold` |
| `animate{… easing:"power-out", keys:[{t:0,v:0,easing:"hold"},{t:1,v:0},{t:2,v:90,easing:"expo-out"}]}` then `project_save` | **accepted; saved channel has NO per-key easing.** Both overrides silently dropped. |
| `animate{elementId:"bed1", property:"volume", keys:[…]}` | **error:** `"volume" is not animatable — pick one of ["opacity","scale","x","y","rotation","scaleX","scaleY"]` |
| `animate_many{elementIds:["bed1"], property:"volume", easing:"spring-out", …}` | **`{"applied":1}`** — same server, same project, same second |

### 2b. What the skill teaches vs what the transport does

| Skill text | Headless reality |
|---|---|
| `motion.md:25,126` — "**`spring-out` is the house entrance**" | `animate` rejects it. Only `animate_many` accepts it. |
| `motion.md:146-162` — a 4-key `animate` example with per-key `hold` / `spring-out` / `power4-in` | Every per-key easing is dropped; the example renders as one channel-wide curve. |
| `audio.md:52-65` — "`animate` takes `volume` on an audio clip, so the bed ducks with keyframes rather than being set" | Hard error. |
| `tools.rs:308` schema — `property` enum includes `"volume"`; `keys[].easing` enum lists all 14 | Both are lies on this transport. |

Root cause per symptom:

- `studio.rs:1183 parse_keys` returns `Vec<(f64, f32)>` — the `easing` field is never read.
- `studio.rs:1203 parse_easing` handles 8 names. Missing: `power-in`, `expo-in`, `power4-out`,
  `power4-in`, `spring-out`, `sine-in-out`.
- `studio.rs:741 animate` checks `Element::ANIMATABLE` (the 7 transform props) instead of
  `element.animatable()` (which returns `["volume"]` for audio, `element.rs:1080`).

### 2c. `timeline` diverges too

There are two `describe_element` functions. `plan.rs:373` returns `trimStartSeconds`, `mediaId`
and `effects`; `studio.rs`'s copy returns none of them. **Neither returns keyframes.** An agent
gets `"animated": ["opacity","y"]` and nothing else — no times, no values, no easings, no
durations. It also never sees `fontFamily`, `fontWeight`, `align`, `letterSpacing`,
`lineHeight`, `blendMode`, `mask`, crop, fades, `volume`/`muted`, or markers.

**Consequence:** an agent physically cannot audit its own motion, typography or mix. Any
doctrine phrased as "vary your easings" or "don't reuse one duration" is unverifiable by the
author, which is why it degenerated into satisfying a counter.

---

## 3. The project model

### 3.1 `Transform` (`element.rs:394`) — 13 fields

`x, y, scale, rotation, opacity, scale_x, scale_y, anchor_x, anchor_y, crop_left, crop_top,
crop_right, crop_bottom`.

**Animatable: 7** (`Element::ANIMATABLE`, `element.rs:1070`) —
`opacity, scale, x, y, rotation, scaleX, scaleY`.
**Not animatable:** `anchorX/anchorY`, all four crops, colour, font size, blend mode, mask
geometry, fades, effect params. Audio animates exactly one thing: `volume`
(`ANIMATABLE_AUDIO`).

### 3.2 Element kinds and what each carries

| Kind | Payload beyond `id/name/start/duration/fadeIn/fadeOut/transform/effects/animations/blendMode/mask` |
|---|---|
| `Text` | `content` (`\n` only), `font_size: f32`, `color: String` (`#rrggbb`, **no alpha**), `font_family: Option<String>`, `font_weight: u16`, `align`, `letter_spacing` (em), `line_height` |
| `Shape` | `shape: Rect{radius} \| Ellipse`, `color` |
| `Video` | `media_id`, `trim_start`, `trim_end` (derived, no speed control) |
| `Image` | `media_id` |
| `Audio` | `media_id`, `muted`, `volume`, `trim_start` — **no transform, no effects, no mask, no blend** |

**`TextElement` has NO:** stroke, outline, drop shadow, background plate/box, padding, rich
runs, per-word or per-character control, gradient fill, italic/oblique style, uppercase
transform, max-width or explicit wrap, vertical alignment, baseline control, opacity separate
from the transform. One style per element, one colour, one size. (`editor-capability-audit.md`
§3.4 already records this.)

**`ShapeElement` has NO:** stroke, line, arrow, polygon, path, gradient fill. Two primitives,
fill only. No callouts, no connectors, no diagram work.

### 3.3 `Keyframe` and `AnimationChannel`

`Keyframe { time, value: f32, easing: Option<Easing> }` — per-key easing governs the segment
**leaving** the key. `AnimationChannel { keys, easing }`. Interpolation is scalar-linear through
the eased progress (`element.rs:232-258`). No bezier handles, no spatial paths, no
value-over-value curves.

---

## 4. Effects

`bay-effects` exposes exactly **5 shader types** (`plan.rs:299 SUPPORTED_EFFECTS`):
`brightness`, `contrast`, `saturation`, `blur`, `lut`.

| Effect | Parameter | Notes |
|---|---|---|
| brightness / contrast / saturation | `amount` (1.0 = unchanged) | scalar uniform |
| blur | `amount` = sigma in **pixels** | Gaussian, two-pass |
| lut | `amount` = grade mix, plus `look` (built-in id) or `lut` (`.cube` path) | 6 built-in looks, generated at load, 33³ cube |

Built-in looks (`looks.rs:37`): `neutral-contrast`, `teal-orange`, `bleach-bypass`, `warm-film`,
`cool-night`, `mono`.

**Effect parameters are NOT animatable.** `Effect.params: BTreeMap<String, f32>` — no
`AnimationChannel`. `effect_set` is a state change, which the skill states correctly. There is
no glow, no bloom, no grain, no vignette (a mask can fake one), no chromatic aberration, no
displacement, no motion blur, no 3D. Effects live on elements only — no adjustment layers, no
track-level effects.

**Measured usage in wicks-v2: 0 of 119 visual elements carry an effect. 0 use a blend mode
other than `normal`. 1 uses a mask. 0 use crop. 0 use rotation.**

---

## 5. The new uncommitted modules

### `bay-project/src/templates.rs` (519 lines) — wired to `templates_list` / `template_place`

3 built-ins, confirmed live:

| id | slots | elements | duration | max fontSize | animation |
|---|---|---|---|---|---|
| `lower-third` | name, role | 3 (rule + 2 text) | 4.0 s | 64 | **none** — `fade_in/out: 0.25` only |
| `kicker` | kicker, headline | 2 | 3.0 s | 96 | **none** |
| `end-card` | closing, cta | 2 | 3.0 s | 82 | **none** |

Saved templates live under `bay_paths::data_dir()/templates/*.json` and override a built-in of
the same id. **There is no `template_save` MCP tool**, so an agent can never promote its own
arrangement.

**This matters:** the skill says "Prefer a template to building the same arrangement". Following
that advice produces *static fade cards with ≤96px type* — the house's own reference
implementation exhibits two of wicks-v2's named failures.

### `bay-audio/src/sfx.rs` (654 lines) — wired to `sfx_list` / `sfx_add` / `sfx_search`

13 synthesised effects at 48 kHz, rendered to any requested length:
`whoosh` (0.45s), `whoosh-reverse` (0.5), `riser` (1.6), `sub-drop` (0.9), `impact` (0.7),
`click` (0.06), `tick` (0.04), `pop` (0.16), `chime` (0.9), `error` (0.45), `beep` (0.12),
`glitch` (0.35), `swell` (2.5). Parameters: `duration`, `tone` (0–1 brightness), `level`,
`volume`.

### `bay-audio/src/library.rs` (276 lines) — wired to `sfx_search` / `sound_add`

An index over recorded packs under `<runtime>/sfx/<pack>/`. **Nothing can install a pack:**
`runtime_install` accepts only `video` and `speech`. The recorded half of the library is
unreachable in practice.

### `bay-effects/src/looks.rs`, `lut.rs` — wired to `looks_list` / `effect_add`. Used 0 times in wicks-v2.

---

## 6. The easing set — 14 curves

`bay_agent::plan::EASINGS` (`plan.rs:432`), implemented in `Easing::apply` (`element.rs:167`):

| name | shape | headless `animate` accepts? |
|---|---|---|
| `linear` | t | yes |
| `ease-in` | power2.in | yes |
| `ease-out` | power2.out | yes |
| `ease-in-out` | power2.inOut | yes |
| `power-out` | power3.out | yes |
| `power-in` | power3.in | **NO** |
| `expo-out` | 1−2^(−10t) | yes |
| `expo-in` | 2^(10t−10) | **NO** |
| `power4-out` | 1−(1−t)⁴ | **NO** |
| `power4-in` | t⁴ | **NO** |
| `spring-out` | critically damped ζ=1, normalised to land exactly on 1 | **NO** |
| `sine-in-out` | ½(1−cos πt) | **NO** |
| `back-out` | overshoot c₁=1.70158 | yes |
| `hold` | returns 0 → hard cut at the next key | yes |

Only `back-out` leaves the unit interval. `animate_many` and the attached path accept all 14.

---

## 7. The scene model — EVIDENCE §8, mechanically

- `Project { scenes: Vec<Scene>, current_scene_id }`. A project **can** hold many scenes.
- A `Scene` is `{ id, name, is_main, tracks: {main, overlay[], audio[]}, markers[] }`.
- **`PreviewRenderer::export_video(scene: &Scene, …)` takes ONE scene** (`bay-preview/src/lib.rs:1358`).
  So does `render()` (`:1613`) and `snapshot`. **Scenes do not concatenate into an export.**
  A scene is an alternate comp, not a story beat. Multi-scene is useless for delivery today.
- There is **no MCP tool** to create, delete, or switch scenes.
- `bay_core::check::check()` reads `project.active_scene()` (`check.rs:140`). Every check is
  therefore single-scene by construction.

### What `check` actually means by "scene"

`check.rs:572 spans()` derives beats from **clips on the main lane**, and only if there are
**more than one**:

```rust
if cuts.len() > 1 { return cuts; }          // main-lane clips are the beats
… otherwise: one span = union of every picture element
```

**wicks-v2's main lane holds exactly one element** — `panel`, a 7.44 s shape. 118 of 119 visual
elements are on `track-overlay-1..12`. So `spans()` returned **one span, 0.00–62.00 s**, and
`front_loaded`, `inert_span`, `no_accumulation` and the span-rhythm arm of `monotone-duration`
each evaluated once over a 62-second bucket where they are arithmetically incapable of firing.

This is not "the agent forgot to make scenes". **bay has no object for a beat**, and the proxy
it uses is a lane the agent has no reason to populate.

---

## 8. `check` on wicks-v2 — measured ground truth

Ran live against the loaded project.

```
{"ok": true, "errors": 0, "warnings": 24, "notes": 0}
```

| code | count | what it was |
|---|---|---|
| `gain-above-unity` | **22** | 13 bed segments at 1.6–2.0×, 9 SFX/narration at 1.1–1.7× |
| `small-text` | **2** | `rnote`, `sqcap` — the only two 22px elements |
| everything else | **0** | — |

**Signal-to-noise: 2 useful findings in 24. The verdict is `ok: true`.** The agent was told to
render.

### Why every meaningful check stayed silent

| check | threshold | wicks-v2 | gaming vector |
|---|---|---|---|
| `front-loaded` | ≥90% of keys in the first 25% of a span, span ≥4 s | one 62 s span → window 15.5 s | put anything on the main lane, or don't; either way one span |
| `inert-scene` | last arrival ≤1 s after span start | last arrival ≈59 s | same |
| `no-accumulation` | last *element start* inside first 20% of span | spread over 62 s | same |
| `monotone-easing` | fires only when `curves.len() == 1` | 11 distinct curves | **use two curves, ever** |
| `monotone-duration` (channels) | longest/shortest `< 1.25×` | 0.10 s … 45.4 s = 454× | **one long channel and one short one** |
| `monotone-duration` (spans) | needs ≥3 spans | 1 span | one main-lane clip |
| `no-hook` | see below | suppressed | **one small shape at t=0** |
| `flat-mix` | see below | suppressed | **fade any bed clip** |
| `black-start` / `gap` | picture coverage | covered | — |
| `silent` / `no-bed` | audio presence | 69 clips | — |

#### `no-hook` is disabled by one small rectangle

`check.rs:1183-1192`: any `Shape` in the first 2 s whose `scale × scaleX < 0.95` **or**
`scale × scaleY < 0.95` causes `hook_findings` to `return Vec::new()` — the whole check, not
just that element. `panel` is `scale 1.0, scaleX 0.911, scaleY 0.375` at t=0, so it killed the
check. **`panel`'s base opacity at t=0 is 0.0.** The check never consults opacity or the
opacity channel. A one-pixel invisible rect at t=0 disables the hook check permanently.

#### `flat-mix` is disabled by a fade

`check.rs:1067`: `if quiet <= 0.0 { return None; }` — one sample where either clip's gain
reaches zero aborts the pair. I recomputed all 69 audio clips: **6 pairs overlap ≥2 s; all 6
short-circuit on a zero-gain sample** from the beds' 0.30 s fades. Without the short circuit the
widest separation on those pairs is ~4.3 dB, well under `MIN_DUCK_DB = 6.0`. `flat-mix` cannot
fire on any project whose bed carries fades.

#### And that bed shape is caused by the `animate volume` bug

**0 of 69 audio clips carry a volume keyframe.** The agent cut the music bed into **13 clips**
alternating static `0.70` / `2.00` gain with 0.30 s crossfades — the exact anti-pattern
`audio.md` warns against — because `animate property:"volume"` is a hard error on this
transport. Those 13 clips produced 13 of the 22 `gain-above-unity` warnings that buried the two
real findings.

Complete chain: **`Studio::animate` uses the wrong animatable set → agent cannot duck → agent
splits the bed into 13 faded clips → the fades short-circuit `flat-mix` → `check` returns
`ok: true` on a mix with 4.3 dB of separation, plus 13 warnings of pure noise.**

---

## 9. Re-measured facts about wicks-v2 (corrections to EVIDENCE.md)

Recomputed from the project JSON at the correct tick rate (120,000/s).

| EVIDENCE claim | Measured | Verdict |
|---|---|---|
| "119 animated channels" | **172** animated channels over 188 elements | undercount (119 is the *visual element* count) |
| "opacity 107 of 119" | 107 of 172 = 62%. **38 of those 107 are bay's own caption fades.** Agent-authored: 69 opacity of 134 = **51%** | half the opacity monoculture is the engine's |
| "76 of ~150 moves are 0.098 s" | **76 value-changing segments are exactly 0.100 s — 100% of them are `caption-N.opacity`, written by `Studio::add_caption_element` (`studio.rs:220-232`), 2 per caption × 38 captions.** Agent-authored segments ≤0.12 s: **9**, all `scale` | **the 3-frame-pop histogram is bay's caption fade, not the agent's motion** |
| "`hold` used 130 times" | 130 `hold` segments, of which **99 change no value** (a legitimate wait-for-cue) and **22 are real hard cuts**, all opacity | mostly not stuffing |
| "every element is fontWeight 400" | **700 ×51, 400 ×22** | wrong — there IS weight variation |
| "5 colours, one used 48×" | **10 distinct**: `#EDECE6`×48, `#73737E`×19, `#FF5B5B`×15, `#3A3A48`×14, `#8A93A3`×7, `#33333F`×5, `#40404E`×4, `#A8A8B0`×3, `#606070`×2, `#191922`×1 | 4 of the 10 are near-identical dark greys (gridlines); the *perceptual* palette is ~4 |
| "nothing sits below y = 0.73" | **max anchor y = 0.735**, and 38 of those are captions at bay's hardcoded caption placement | confirmed |
| "63 elements share x ≈ 0.085" | `x = 0.08` ×38 — **all 38 are captions**, which `add_caption_element` hardcodes to `x: 0.08, scale: 0.84, anchorX: 0.0, align: Center` (`studio.rs:191-206`) | the left column is half engine |
| "one scene, 188 elements" | confirmed; **1 element on the main lane, 118 on overlays 1/2/3/4/12, plus 7 empty overlay tracks** created as a side effect of asking for `layer: 12` | confirmed + a new artifact |
| "linear" | **62 of 169 agent-authored value-changing segments are `linear` = 37%** | the real motion failure, unmeasured by anything |

**The single most important correction:** a rule that punishes short moves, or opacity-heavy
animation, or `ease-out`, would be scoring bay's own caption placement. Any motion statistic
must exclude `caption-*` elements or fix `add_caption_element` first.

---

## 10. Engine limitation vs agent failure — the verdict

| wicks-v2 symptom | Cause | Fix is |
|---|---|---|
| Animation is 90% opacity | **Both.** 38/107 opacity channels are engine captions. But `animate` rejecting `spring-out`/`power4-*`/`sine-in-out` pushes the agent toward the one property that reads fine on `linear`/`ease-out`. | **code** (route `animate` through the planner) + doctrine |
| 76 moves of 3 frames | **Engine.** 100% are `add_caption_element`'s 2×`fade` opacity ramps. | **code** (or: exclude from any metric) |
| `hold` is the most-used easing | **Neither, mostly.** 99/130 are no-op waits, the documented `animate_many` shape. 22 are real pop-ons. | doctrine (cap hard cuts), low priority |
| Everything set in Menlo | **Agent.** `fonts_check` + `add_text{fontFamily}` + `text_update` all work. Nothing in the engine prefers mono. | **doctrine + a checkable rule** |
| Max font size 96px on 1080 | **Agent.** `fontSize` is unbounded; `add_text`'s own description asks for 200–320 for a hero figure. The agent ignored it. `small-text` floors at 2.2% of canvas height ≈ 24px quoted — it certifies 34px as fine. | **doctrine + raise/replace the floor with a *hero* rule** |
| Monochrome palette | **Agent.** 10 colours were available and used; the problem is 4 of them are the same grey. | doctrine (perceptual-distance rule) |
| One left column, bottom 27% empty | **Half engine.** Captions are hardcoded to `x: 0.08`, and `captionY` is the only positional knob. | **code** (expose caption x/scale/align) + doctrine |
| Card renders empty at t≈19 s, 24 s | **Engine-adjacent.** No tool can measure a frame, and `check` cannot see inside a composition. Undetectable today. | **code** (frame statistics from `snapshot`) |
| "Different day." occluded by the card | **Engine.** `bay-text` has no `measure()`; nothing can compute a text element's ink box without rasterising. Collision is undetectable. | **code** (text measurement API) |
| Same frame 5 s apart | **Engine.** No frame-diff capability. `inert-scene` is the model-only proxy and it collapsed. | **code** (frame statistics) + fix `spans()` |
| One 61 s scene | **Engine.** No scene tool, and scenes don't concatenate anyway; `check`'s beat proxy is main-lane clips. | **code** (a beat partition that is not the main lane) |
| No music ducking; 13 bed segments | **Engine.** `animate volume` is a hard error headlessly. | **code** — one-line class of fix |
| No images, no video, no effects, no blends | **Agent** (all tools exist and work) — but there is **no asset pipeline**, so "use an image" means "have an image". | doctrine + (out of scope here) |

**Roughly:** four of the twelve are pure agent failure and are fixable by doctrine *if* the
doctrine is enforced by a rule the agent cannot satisfy by counting. Five are code. Three are
both.

---

## 11. Already known / planned — do not re-propose

From `docs/native/editor-capability-audit.md` and `todo.pending.md`:

- **Known and closed:** MCP edit verbs, `check` itself, transitions, audio fades + LUFS, export
  presets, timeline precision, LUT + look packs, masks + crop, ripple delete, markers.
- **Known and OPEN:**
  - `check` cannot see the render `duration` — 48 of 119 elements started after the rendered
    61 s in a previous run. Size S. Proposed: `render` warns on truncation; `check` takes a
    `duration`. (`todo.pending.md:46`)
  - A `check` finding for *speech longer than the timeline / timeline far longer than the
    brief*. (`todo.pending.md:60`)
  - `check` false positives: `small-text` formula (**fixed in the working tree** —
    `rendered_font_px`, `check.rs:130`), `invisible` ignoring the opacity channel, `overlap`
    firing on overlay lanes. `todo.pending.md:30-41` is stale on the first.
  - Text is one style per element; no per-word/per-character animation. (audit §3.4)
  - Shapes are rect + ellipse, fill only; no stroke, line, arrow, path. (audit §3.4)
  - No adjustment layers / track-level effects; no motion blur; no 3D. (audit §3.4)
  - No speed / retime / freeze frame. (audit §2.2)
  - "Scenes exist but cannot be placed inside one another" — nesting. (audit §2.2)
  - Music packs on `bay-provision`, gated on a licence audit. (audit §8)
  - Shot detection + media bins (§9 item 10) — `shots_detect` has since shipped.

Not previously recorded anywhere I can find: **the headless/attached `animate` divergence**, the
`no-hook` shape short-circuit, the `flat-mix` zero-gain short-circuit, `spans()` depending on the
main lane, `timeline` omitting keyframes, and `runtime_install` having no `sfx` component.

---

## 12. Rules this audit supports

Every rule is stated so that satisfying it requires a design decision, and each names how an
agent would try to cheat.

**Partition principle:** stop measuring "the project". Measure **every 5-second window** of the
delivered duration, and **every narration beat** (the gaps ≥0.35 s between narration clips —
semantic, one per line of script, and not fakeable without changing the script). An agent cannot
collapse a partition imposed by the clock or by its own voiceover, which is exactly what it did
to `spans()`.

**Exclusion principle:** every motion/typography statistic must exclude `caption-*` elements, or
it scores bay's own caption placement (76 of 245 segments, 38 of 107 opacity channels, 38 of the
38 elements at `x = 0.08`).

| # | Rule | Numbers | wicks-v2 |
|---|---|---|---|
| R1 | In every 5 s window with ≥3 agent-authored value-changing segments, **≤60% may be `opacity`**, and a segment counts as non-opacity only if it moves ≥0.03 canvas (x/y) or ≥0.08 (scale/scaleX/scaleY) | 60%, 0.03, 0.08 | 51% overall but concentrated; per-window it fails in the caption-heavy stretches |
| R2 | **≤15% of agent-authored value-changing segments on x/y/scale\* may use `linear`** | 15% | **37%** — fails |
| R3 | In every 5 s window holding ≥2 text elements: `max fontSize / min fontSize ≥ 2.5`, and the largest text in the window renders **≥8% of canvas height** (fontSize ≥ 86 quoted, i.e. ≥154px on 1920) and is on screen ≥1.5 s | 2.5×, 8%, 1.5 s | max 96 once in 62 s; mode 34 → **fails every window** |
| R4 | In every 5 s window, the anchor-y of visible elements must span **≥0.45 of the canvas**, and ≥1 element's anchor must sit below **y = 0.80** | 0.45, 0.80 | max y = 0.735 → **fails** |
| R5 | ≤3 font families in a project, **≥2**, and the largest text in each window must not be a monospace family | 2–3 | Menlo ×69, Baskerville ×4, hero is Menlo → **fails** |
| R6 | Palette: ≤6 colours whose pairwise CIEDE2000 ≥ 8; count near-duplicates as one | ΔE 8 | 10 hexes collapse to ~4 → the "10 colours" defence disappears |
| R7 | Every narration second must have non-narration audio **≥8 dB below** it, measured on the mix envelope **with the `quiet <= 0` short-circuit removed** | 8 dB | 4.3 dB → **fails** once `flat_mix` is fixed |
| R8 | Beat partition = narration gaps. Within each beat: ≥1 arrival after the beat's first 40%, and beat lengths must span ≥2× shortest→longest across the video | 40%, 2× | 6 beats over 62 s; currently 1 bucket |
| R9 | `no-hook` must consult the **sampled** opacity and must not be short-circuited by a shape; the hook window needs ≥1 element rendering ≥8% of canvas height with sampled opacity ≥0.5 at t = 0.5 s | 8%, 0.5, t=0.5 | frame at 0.5 s is blank → **fails** |
| R10 | `check` must return a **stats block** (per-window property shares, easing histogram over value-changing segments, font-size ladder, y-span, dB separation) alongside findings, and `render` must refuse when `ok: false` unless overridden | — | makes every rule above auditable by the author, which `timeline` currently prevents |

**Why these resist Goodharting:** R1/R2/R3/R4 are *shares and spans over an imposed partition* —
adding one instance anywhere does not move a share, and moving a share means changing most of the
video. R3/R5's "largest text in the window" cannot be satisfied by adding a decoy, because the
constraint attaches to whatever is biggest. R7 is measured on the rendered envelope, so the only
way to pass is to actually duck. R9 samples the animation instead of the base value, so an
invisible plate no longer counts.

**Why they are not enough on their own:** R1–R9 are all model-only. "The card renders empty",
"the same frame twice, 5 s apart", and "the headline is behind the card" are invisible to every
one of them. Those need §13-G3 and §13-G4.

---

## 13. Engine gaps this area needs

| # | Gap | Effort | Unlocks |
|---|---|---|---|
| G1 | **Delete `Studio::animate` / `studio::parse_keys` / `studio::parse_easing`; route `animate` through `bay_agent::plan` like every other verb** (remove the explicit `"animate" =>` arm in `tools.rs::dispatch`) | **small** | All 14 easings, per-key easing, and `volume` ducking on the transport agents use. Kills the 13-clip bed, the 22 noise warnings, and half the opacity monoculture in one edit. Add a test that every schema `enum` value round-trips through both transports. |
| G2 | **`timeline` returns keyframes** (`t`, `value`, per-key `easing`, channel `easing`), typography (`fontFamily/Weight/align/letterSpacing/lineHeight`), `fadeIn/Out`, `blendMode`, `mask`, crop, audio `volume/muted`, and the scene's `markers` | **small** | The agent can audit its own motion, type and mix. Every rule in §12 becomes self-checkable instead of only post-hoc. Also unify the two `describe_element`s. |
| G3 | **A text measurement API** — `bay_text::measure(content, family, weight, size, letter_spacing, line_height, box) -> ink rect` — and a `bay-core` dependency on it | **medium** | Text collision, overflow, real ink coverage, auto-fit hero type, and a `small-text` check that measures the glyph box rather than a proxy. Today `bay-text` exposes only `render()` and `has_family()`. |
| G4 | **Frame statistics from `snapshot`** — return mean/p5/p95 luma, ink-coverage fraction, per-quadrant coverage, and (given a previous snapshot path) a mean-absolute-difference | **medium** | "bottom half empty", "the card is empty", "two frames 5 s apart are identical" become numbers. These three are undetectable from the project model in principle. |
| G5 | **A beat partition that is not the main lane.** Either (a) `spans()` derives beats from narration-clip gaps and markers, or (b) `scene_add`/`scene_select`/`scene_list` tools **plus** an export that concatenates scenes | (a) **small** / (b) **large** | (a) restores `front-loaded`, `inert-scene`, `no-accumulation` and span rhythm on 6 buckets instead of 1. (b) is the honest model but requires `export_video` to stop taking one `&Scene`. **Do (a) first.** |
| G6 | **Per-word / per-character text reveal** — either a `text_reveal` verb that explodes a string into per-word elements with a stagger, or runs inside `TextElement` | **large** | The single biggest expressive ceiling for a text-only video. Today every kinetic-type effect must be hand-built as N `add_text` calls + `animate_many`, which is why captions are one flat block. |
| G7 | **`background_set` tool + a gradient/image background** (`Background` already has a `Blur` variant no tool can reach) | **small–medium** | The background is immutable after `project_create` and can only be a flat `#rrggbb`. wicks-v2's flat `#0E0E12` field is not a taste failure, it is the only option. |
| G8 | **Animatable effect params** — `Effect.params` becomes `BTreeMap<String, AnimationChannel>` or gains a parallel `animations` map | **medium** | Blur-in reveals, exposure ramps, a grade that arrives with a cut. Currently every effect is a constant. |
| G9 | **`template_save` MCP tool, and animation inside built-in templates** | **small** | An agent can promote an arrangement it got right. And the three built-ins stop teaching "static card + 0.25 s fade + 96px type", which is three of wicks-v2's failures in the house's own reference. |
| G10 | **`runtime_install` gains an `sfx` component** | **small** | `sound_add` and half of `sfx_search` are dead on every machine today; the code, the index and the tools all exist. |
| G11 | **`check` returns a measured stats block, and `render` refuses on `ok: false` unless overridden** | **small** | Turns findings from a list into a report. Also the only way a human reviewing a run can see what was measured versus what merely did not fire. |
