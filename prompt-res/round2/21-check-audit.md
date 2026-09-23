> **Historical:** describes the Rust engine, deleted; recover what it cites with `git show rust-engine-final:dep/rust/<path>` (e.g. `crates/bay-mcp/src/tools.rs`).

# 21 — Audit of the check suite: why it passed `wicks-v2`

Source: `rust/crates/bay-core/src/check.rs` (2193 lines, 27 finding codes), read in full and
executed against
`~/Library/Application Support/vii/projects/project-1786466680050.json` (the wicks-v2 project).

**Method.** Two independent executions, agreeing exactly:

1. The real Rust checker, via a throwaway integration test that deserialises the project off
   disk and calls `bay_core::check` (`cargo test -p bay-core`, test since deleted).
2. A Python reimplementation of every check in the file (`scratchpad/sim.py`), which reproduces
   the Rust output element-for-element and additionally prints each check's *intermediate*
   quantity, so every "did not fire" below is a traced number, not an inference.

---

## 0. Verdict

```
bay_core::check(wicks-v2)  →  ok: true   errors: 0   warnings: 24   notes: 0
    22 × gain-above-unity   ("audio-1" plays at 1.15× gain — above unity it can clip)
     2 × small-text         ("rnote"/"sqcap" render 39px on a 1920px canvas)
```

**Zero of the 24 findings describes anything a viewer would complain about.** Six of the 22
gain findings are bay's own `narrate` output, which is peak-normalised and written at 1.15×
by bay itself — the check fires on the tool's own house style.

Twenty-five of the 27 codes cannot fire on this project by construction. The two that can are
a per-clip gain warning and a legibility floor set at **2.2 % of canvas height (42 px)** —
below the bottom of the *label* tier in the skill's own type scale (`layout.md:56`, label =
43–71 px). `check` will certify a video typeset entirely in labels.

The suite has two independent failure modes, and this project demonstrates both at different
points in time:

| | run | result |
|---|---|---|
| **Noise** | the version the agent actually ran mid-session (session `1ba87d60`, tool call `toolu_01KVXU3s`) | **242 warnings, `ok: true`** — 92 `overlap`, 69 `small-text`, 60 `invisible`, 15 `gain-above-unity`, 6 `flat-mix`. ~236 of 242 were false positives (overlay layering, the `font_size × scale` bug, fade-in-from-zero). The 6 real ones (`flat-mix`) sat at position ~237 of 242. |
| **Silence** | HEAD, after those three false positives were fixed | **24 warnings, `ok: true`** — and nothing perceptual fires at all. |

The fixes were correct. They did not add a single true positive; they removed 218 false ones
and left a report that says nothing. `check` went from unreadable to uninformative without
ever passing through useful.

---

## 1. Every finding code

`rendered_font_px(fs, h) = max(fs × h / 1080, 8)`. Canvas is 1080×1920, so a quoted
`fontSize` renders at **1.778×** its number. `MIN_LEGIBLE_TEXT_FRACTION = 0.022`.

| # | code | sev | what it measures | threshold | fires? | traced reason |
|---|---|---|---|---|---|---|
| 1 | `zero-length` | error | `duration ≤ 0` | any | no | min duration 0.04 s |
| 2 | `before-zero` | error | `start < 0` | any | no | min start 0 |
| 3 | `missing-media` | error | `media_id` not in `project.media` | any | no | all 10 assets present |
| 4 | `past-source-end` | error | `source_start + duration > asset.duration` | any | no | only checked when the asset was probed; audio clips fit |
| 5 | `missing-effect-asset` | error | LUT path not on disk | any | no | **0 effects on 188 elements** |
| 6 | `transform-not-finite` | error | non-finite x/y | any | no | all finite |
| 7 | `off-canvas` | error | anchor outside `0..1` | any | no | x∈[0.04,0.94], y∈[0.06,0.735] |
| 8 | `empty-text` | error | blank `content` | any | no | none blank |
| 9 | `nothing-visual` | error | no picture element anywhere | any | no | 119 picture elements |
| 10 | `invisible` | warn | `opacity ≤ 0` **and** no opacity key `> 0` | any | no | every element with base opacity 0 has a rising key (the fix) |
| 11 | `zero-scale` | warn | any scale axis `≤ 0` | any | no | min scale 0.02 |
| 12 | `small-text` | warn | `rendered_px / H < 0.022` | fs < 23.76 | **2×** | only `rnote`/`sqcap` at fs 22. The modal size, fs 34 → 60 px → 3.15 %, passes |
| 13 | `gain-above-unity` | warn | `audio.volume > 1.0` | > 1.0 | **22×** | 6 narration @1.15 (bay's own), 5 bed @2.0, impacts 1.1–1.3, chime 1.5 |
| 14 | `animation-overruns` | warn | last key time > clip duration | any | no | 0 of 435 segments overrun |
| 15 | `hidden-track-has-content` | warn | hidden track with elements | any | no | no track hidden |
| 16 | `overlap` | warn | two clips overlap **on the main lane only**, absent a covering fade-in | any | no | **main lane holds exactly 1 element** (`panel`, 0–62 s) → zero pairs to test |
| 17 | `black-start` | warn | first picture span starts > 0.025 s | > 0.025 s | no | `panel` starts at 0 |
| 18 | `gap` | warn | hole in merged main+overlay coverage | > 0.025 s | no | `panel` covers 0–62 s alone |
| 19 | `silent` | note | no audible audio clip | any | no | 69 audio clips |
| 20 | `front-loaded` | warn | keys in first `0.25 × L` ≥ 90 % of keys in span | ≥ 0.9 | no | **196/607 = 0.323** in first 15.5 s |
| 21 | `inert-scene` | warn | last arrival/move ≤ 1.0 s after span start | ≤ 1.0 s | no | **last move at 59.90 s**, Δ = 59.90 s |
| 22 | `no-accumulation` | warn | last arrival within first 20 % of span | ≤ 0.2 | no | **last arrival 58.51 s = 0.944 of span** |
| 23 | `monotone-easing` | warn | **count** of distinct segment easings == 1, over ≥ 8 channels | == 1 | no | **11 distinct** segment easings over 172 channels |
| 24 | `monotone-duration` (moves) | warn | longest/shortest channel length < 1.25× | < 1.25 | no | **454×** (0.100 s … 45.400 s) |
| 25 | `monotone-duration` (tempo) | warn | longest/shortest span < 1.5×, needs ≥ 3 spans | < 1.5 | no | **1 span**; the check needs 3 and returns before measuring |
| 26 | `flat-mix` | warn | two audio clips overlapping ≥ 2 s never separate by ≥ 6 dB | < 6 dB | no | 6 overlapping pairs, all duck ≥ 6 dB in the *saved* project (this fired 6× mid-session, before the agent added the duck) |
| 27 | `no-bed` | warn | ≥ 2 audio clips, ≥ 50 % coverage, **zero** overlaps | 0 overlaps | no | 6 overlapping pairs exist |
| 28 | `no-hook` | warn | nothing ≥ 5.5 % of H on screen in first 2 s | < 0.055 | **no — aborted** | see §1.1 |

### 1.1 `no-hook` is the worst of them: it aborts, and it aborts on an invisible element

```rust
Element::Shape(shape) => {
    let (across, down) = (scale * scale_x, scale * scale_y);
    if across < GROUND_SCALE || down < GROUND_SCALE { return Vec::new(); }   // ← whole check off
}
```

Three defects, all confirmed against the project:

1. **Any non-full-frame shape overlapping 0–2 s disables the entire hook check.** On wicks-v2
   the aborting element is `panel` (`across 0.911`, `down 0.375`) — and `panel`'s opacity
   animation is `0.0 @ 0 s → 0.0 @ 0.15 s → 1.0 @ 1.55 s`, so it is **fully transparent for the
   first 0.15 s and below 60 % opacity until ≈ 1.0 s**. An element you cannot see certifies the
   hook. The check never reads opacity at all.
2. **It uses the discredited glyph formula.** `hook_findings` computes
   `font_size × scale × scale_y / canvas_height`, which is exactly the formula `small-text`
   was fixed to abandon (see the 40-line doc comment on `rendered_font_px`, which names *this
   project*: "a 26 pt kicker at `scale: 0.744` … reported 67 legible titles as illegible").
   `check.rs` now contains two disagreeing formulas for one number. Measured on `head1`
   (fs 62, scale 0.744): hook formula **0.0240**, renderer **0.0574** — a 2.4× understatement.
3. Consequently a *correct* hook check would have fired loudly. Traced ground truth: at
   t = 0.0 s **6 elements visible, all shapes**; at t = 0.5 s **14 visible, all shapes, zero
   text**; first text is a 26 px kicker at t ≈ 1.0 s; the headline `head1` does not reach full
   opacity until t ≈ 1.55 s. `biggest_type` inside the window computes to **0.0000**. The video
   genuinely opens on nothing, the check knew, and one transparent rectangle silenced it.

---

## 2. The one-scene question — half proven, half disproven

**Proven, mechanically.** `spans()` derives scene boundaries from cuts on the **main lane**:

```rust
if cuts.len() > 1 { return cuts; }        // otherwise fall through to one bounding span
```

wicks-v2's main lane holds **exactly one element** (`panel`, a background card, 0 → 62 s).
So `spans()` returns `[(0.0, 62.0)]` — one span for a ten-beat video. Downstream:

| check | normalised by | with 1 span of 62 s it demands |
|---|---|---|
| `front-loaded` | `0.25 × L` | 90 % of all 607 keyframes inside the first **15.5 s** |
| `inert-scene` | absolute 1.0 s | every move in the video to stop by **t = 1.0 s** |
| `no-accumulation` | `0.2 × L` | all 119 element starts inside the first **12.4 s** |
| `monotone-duration` (tempo) | needs ≥ 3 spans | disabled outright |

Three of the four are thresholds *proportional to span length*, so merging N beats into one
span divides their sensitivity by roughly N. They are anti-scaled: the longer the video, the
harder they are to trip. That is the structural bug EVIDENCE §8 names, and it is real.

**Disproven, empirically — and this matters more.** I re-derived beats by clustering element
starts (gap > 1.2 s → 10 beats) and re-ran all three checks per beat:

```
 beat  span(s)     len   front-load          inert(Δ last)   accum(last/len)
  0.0- 3.4    3.4   68/ 99=0.69              +3.39            0.61
  3.4- 8.4    5.0   10/ 57=0.18              +5.01            0.26
  8.4-18.0    9.6   32/ 99=0.32              +9.55            0.48
 18.0-21.2    3.2   50/ 72=0.69              +3.23            0.61
 21.2-33.0   11.8   31/ 89=0.35             +11.73            0.56
 33.0-38.2    5.2   35/ 70=0.50              +5.25            0.77
 38.2-45.2    7.0   10/ 55=0.18              +6.95            0.24
 45.2-54.6    9.4   67/120=0.56              +9.40            0.45
 54.6-55.9    1.2   25/ 27=0.93              +0.33            0.00   (< 4 s / < 6 s: exempt)
 55.9-62.0    6.1   16/ 36=0.44              +4.05            0.43
beat lengths 1.2 … 11.8 s → tempo ratio 9.42×  (monotone-duration fires below 1.5×)
```

**Not one of the three fires on any beat.** Fixing `spans()` is necessary — it re-enables the
tempo check and is a precondition for any future per-beat rule — but **it would not have caught
this video.** wicks-v2's pacing is genuinely fine: ten beats, 9.4× tempo range, arrivals spread
across every beat. Its defects are vocabulary, typography, scale and layout, and `check.rs`
measures exactly one of those four (type size) at a threshold three times too permissive.

Do not let round 3 spend itself on `spans()` and declare victory.

**Compounding fact:** `planned_tools()` (`bay-agent/src/plan.rs:44`) exposes **no scene tool** —
no `scene_add`, no `scene_switch`. An MCP-driven agent *cannot* create a second scene. And
`layer` defaults to `0` = the main lane, so the main lane is either "whatever the agent put
first" or, as here, one background plate. The suite's central abstraction is keyed on a
structure the tool surface cannot express.

---

## 3. Diversity counts vs distributions

Every perceptual check added in round 1 is a **count of distinct values** or a **min/max ratio**
— both are order-statistics that ignore where the mass sits.

| check | statistic | wicks-v2 | why it passes |
|---|---|---|---|
| `monotone-easing` | `len(distinct segment easings) == 1` | 11 distinct | one non-default easing anywhere clears it. Actual mass: `ease-out` 161, **`hold` 130**, `linear` 62, `power4-out` 24, `power-out` 18, `expo-out` 12, `sine-in-out` 10, `power4-in` 8, **`spring-out` 6**, `expo-in` 3, `back-out` 1. The house entrance is used 6 times in 435 segments; the second-commonest curve is *no motion at all*. |
| `monotone-duration` (moves) | `max/min < 1.25` | 454× | one 45.4 s opacity ramp and one 0.10 s pop clear it forever. Mass: **86 of 435 segments are exactly 0.10 s (3 frames)**; of the 245 segments whose value actually changes, **31.0 % are ≤ 0.10 s and 34.3 % are < 0.20 s**. |
| `monotone-duration` (tempo) | `max/min < 1.5` over ≥ 3 spans | 1 span | disabled |
| `small-text` | per-element floor, no aggregate | 2 fire | says nothing about the *distribution* of sizes: 41 of 73 texts are fs 34, the largest is fs 96 (171 px), and the skill's own doctrine says hero figures must be ≥ 200 px (`layout.md:59`) |
| `no-hook` | max over window | aborts | one transparent shape short-circuits it |
| `flat-mix` / `no-bed` | pairwise / existence | pass | one 6 dB duck anywhere in an overlap clears the pair |

Add the round-1 metrics that live outside `check.rs` and the picture is complete: element
count (188 ✓), LUFS (−13.9 ✓), audio-layer count (69 ✓). Every one of them is a count.

**The empirical proof that diversity is the wrong axis.** I computed each animated element's
*entrance signature* = (set of animated properties, duration rounded to 0.01 s, set of segment
easings). wicks-v2 has **85 distinct signatures across 119 animated elements; the largest
covers 4.2 %.** By any diversity metric this video is maximally varied. It looks like one
template repeated eight times. Variety of *parameters* is not variety of *moves* — and a
project with 85 different entrances has no house style, which is its own defect.

---

## 4. Replacement checks

Design rule for everything below: **a diversity count paired with a mass cap**, on a
*bounded, normalised* statistic, with an **amplitude floor** so that sub-visible parameter
churn cannot satisfy it.

> **Amplitude floor** (used by C1–C4, C8). A keyframe segment counts as a *move* only if its
> value changes by at least: `x`/`y` ≥ 0.02 of canvas (21 px on 1080), `scale`/`scaleX`/`scaleY`
> ≥ 0.08, `rotation` ≥ 2°, `opacity` ≥ 0.15. Everything below it is churn, and every rule that
> counts moves must count only these. Without this floor every check here is gameable in one
> line of code.

| id | replaces | statistic | threshold | wicks-v2 | justification | what maximal gaming looks like |
|---|---|---|---|---|---|---|
| **C1** `property-monotony` | nothing | share of qualifying moves whose property is `opacity` | ≤ **0.50**, and ≥ 2 non-opacity properties each ≥ 10 % of moves | **0.726** of segments (0.622 of channels) — FIRES | 6 animatable channels exist; if one is more than half the motion the video has one move. 0.5 is the loosest bound that still forbids "everything is a fade" | half the moves are ≥ 21 px slides. That is already a different, better video, and the direction of each slide is a design decision |
| **C2** `pop-moves` | nothing | share of qualifying moves shorter than 0.20 s | ≤ **0.15**; and **zero** moves < 0.10 s with amplitude above the floor | **0.343** < 0.2 s, **0.310** ≤ 0.1 s (86 segments at exactly 0.100 s) — FIRES | 0.20 s = 6 frames @30 is the shortest interval over which the eye reads a trajectory instead of a jump; below 0.10 s a move is a cut | moves get slower. There is no bad version of this |
| **C3** `move-duration-mass` | `monotone-duration` (moves) | share of qualifying moves in the modal 0.05 s bucket; count of buckets holding ≥ 10 % | modal ≤ **0.25** and ≥ **3** buckets at ≥ 10 % | modal bucket 0.10 s holds **76/245 = 0.31** — FIRES (the current ratio test passes at 454×) | replaces an order statistic with a histogram-shape statistic; two thresholds means neither "all the same" nor "all different" satisfies it | durations spread over 3–5 buckets. Combined with C4 the buckets have to mean something |
| **C4** `move-vocabulary` | `monotone-easing` | distinct entrance signatures `S` over `N` animated elements (`N ≥ 20`); and share covered by the top 3 | **3 ≤ S ≤ 8** and top-3 share ≥ **0.60** | **S = 85**, top-3 share **0.10** — FIRES on the *upper* bound | inverts the Goodhart gradient: randomising parameters now *fails*. A designed video reuses a small vocabulary deliberately; monotony fails the lower bound, noise fails the upper | a small set of named entrances, applied consistently. That is what a motion system is |
| **C5** `typeface-monotony` | nothing | share of text elements in the modal `fontFamily`; monospace share | modal ≤ **0.80**; monospace ≤ **0.30** unless every such element's content is numeric/code-shaped | **Menlo 69/73 = 0.945**, all monospace — FIRES twice | monospace is a semantic choice (code, ticker, tabular data); as headline and body it reads as terminal output. 0.80 permits the standard display+text pairing | two families at ~80/20 — the classic display/text pairing. The gamed output is the desired output |
| **C6** `hero-type` | strengthens `small-text` | max rendered glyph height on screen (opacity ≥ 0.6) at 4 Hz; the share of runtime below the hero floor | ≥ 1 text at **≥ 200 px** (`layout.md:59`) visible for ≥ **10 %** of runtime; biggest-visible-type ≥ 0.07 × H for ≥ **60 %** of runtime | max ever **171 px** (one `W²` glyph); median biggest-visible **107 px**; **49 %** of samples below 0.055 × H; 2 samples with no text at all — FIRES | anchored in the repo's own type scale: hero 320–530 px, headline 110–170 px, label 43–71 px. `small-text`'s floor (42 px) sits *below* the label tier | one genuinely large line per beat. That is a hook |
| **C7** `hold-stuffing` | nothing | share of segments whose two keys hold the same value; share of segments eased `hold` | value-holds ≤ **0.30**; `hold` easing ≤ **0.15** | value-holds **190/435 = 0.437**; `hold` **130/435 = 0.299** — FIRES twice | fast-in / hold / slow-out legitimately puts one hold in a 3-key channel (~0.33 of *that channel*), never a third of the project. The value-identical half is load-bearing: dropping the `hold` easing and re-using the same value with `linear` is the obvious dodge | fewer padding keys. Neutral to good |
| **C8** `scheduled-stillness` | `inert-scene` | evaluate every element's transform at project fps; fraction of consecutive frame pairs whose state vectors are identical, and the longest identical run | longest run ≤ **1.2 s**; time inside runs ≥ 0.8 s ≤ **25 %** of runtime | **59.5 %** of the 1829 frame pairs are identical by construction; longest run **2.77 s**; **15.4 s (25.2 %)** inside runs ≥ 1.0 s — FIRES | scene-free, span-free, works on a one-scene project, costs ~1 s of pure CPU for a 61 s timeline (measured). Directly indexes the "frames 5 s apart are pixel-identical" defect that motivated `inert-scene` and that `inert-scene` cannot see | one persistently-moving element. Gate it with the amplitude floor **and** require the changing set to include an element whose box is ≥ 1 % of the frame, or a 4-px rotating dot satisfies it |
| **C9** `hook` | `no-hook` | at t = 0.30 s and t = 1.00 s: opacity-and-fade-evaluated element set; box-union ink coverage; max rendered glyph height | ink ≥ **4 %** of frame at t = 0.30 s; a text ≥ 0.07 × H **or** an image/video at opacity ≥ 0.6 by t = **1.00 s** | ink at t = 0.5 s ≈ 0.387 (box union, overstates — actual frame is near-blank); **zero text visible before t ≈ 1.0 s**; first text is a 26 px kicker — FIRES | removes all three defects: no `return Vec::new()` abort, one glyph formula (`rendered_font_px`), opacity respected | something legible lands in the first second. That is the ask |
| **C10** `position-mass` | nothing | share of visible elements in any 0.05 × 0.05 anchor cell; share in the modal x-bucket | cell ≤ **0.20**; modal x-bucket ≤ **0.40** | **38/119 = 0.319** at y = 0.73; **63/119 = 0.529** at x ∈ {0.08, 0.09} | Gini(x) = 0.466 is not diagnostic; modal share is | jittered anchors — **gameable in one line**. See §6: this one needs frames to be real, and see the warning below |
| **C11** `beat-structure` | `spans()` | beats = clusters of element starts with gap > 1.2 s, or scene markers if any exist | ≥ 3 beats before running any per-beat rule; run C1–C3 and the tempo test per beat as well as globally | 10 beats, tempo ratio 9.42× (passes) | restores four disabled checks; needed for anything per-beat. **Not sufficient — see §2** | more cuts. Harmless |
| **C12** `gain-above-unity` (fix) | itself | as-is | exempt elements whose media was produced by `narrate` (peak-normalised at 1.15× by bay itself); raise the floor to **> 1.6×**; add a check on the *sum* of concurrent gains | 22 findings → ~6 | 22 of the 24 findings on this project are this check, and 6 of them fire on bay's own output. A check that fires on the tool's house style is the definition of noise | nothing. Pure noise reduction |

**C10 carries a conflict that must be resolved before it is written.** `layout.md:27–29`
prescribes a *single* left gutter (`x: 0.089`), a *single* content width (`scale: 0.744`) and
a *single* type colour (`#EDECE6`, `layout.md:82`). wicks-v2's 63 elements at x ≈ 0.085, 48
elements in `#EDECE6` and 38 in the y = 0.73 caption slot are the skill's own doctrine executed
faithfully. Shipping C10 against the current `layout.md` makes `check` fail every video the
skill tells the agent to build. Either the skill grows a second and third column position and
a real palette, or C10 must not exist. **This is the sharpest instance of the general problem:
the checks and the skill were written by different rounds and do not agree on what good is.**

---

## 5. Checks that are missing entirely

| id | defect (EVIDENCE §) | why nothing catches it | checkable from |
|---|---|---|---|
| M1 | **Property monotony** — 90 % of animation is opacity (§1) | no code in `check.rs` reads the animation *key* of the `BTreeMap`; `animated_channels()` calls `.values()` and discards the property name | project model (C1) |
| M2 | **Pop moves** — 76 moves of 3 frames (§2) | `monotone-duration` reads only min and max | project model (C2) |
| M3 | **Hold stuffing** — `hold` is the 2nd-commonest curve (§3) | `channel_easings()` counts `hold` as motion vocabulary | project model (C7) |
| M4 | **Typeface monotony** — Menlo ×69 (§4) | `font_family` is never read | project model (C5) |
| M5 | **Hero type** — max 171 px vs 200 px doctrine (§5) | `small-text` is a per-element floor with no aggregate | project model (C6) |
| M6 | **Palette monotony** (§6) | `color` is never read by any check | project model — measured: 11 distinct, `#EDECE6` on 48/119 (40 %), only 1 saturated value (`#FF5B5B`, S ≈ 0.64) on 15 |
| M7 | **Dead zones** (§7) | nothing computes a box | model *partially*: I computed per-band occupancy (bands y 0.8–1.0 occupied in **0 %** of 122 samples; y 0.2–0.3 in 84 %; all others ≥ 99 %). Note the bottom 420 px (y ≥ 0.781) is *prescribed* keep-out (`layout.md:29`), so the model-only signal is weak — the real statistic is the **largest empty axis-aligned rectangle in the rendered frame**, which needs pixels |
| M8 | **Empty card at t ≈ 19 s / 24 s** (§9) | a shape with no child renders as a gridded rectangle; nothing in the model says a container is empty | frames only, or a container/child relation the model does not have |
| M9 | **Text collision at t ≈ 19 s** (§9) | I built a box-overlap detector from the model: text-on-text > 25 % overlap → **2 sample-hits in 244 samples**; text under an opaque shape drawn above it → **0 hits**. The model does not know a glyph run's true width, so it cannot see this | frames, or `bay-text` metrics exposed to `check` (see §7) |
| M10 | **Blank opening** (§9) | `no-hook` aborts (§1.1) | model (C9) + frames |
| M11 | **Same frame 5 s apart** (§9) | `inert-scene` needs *all* motion to stop within 1 s of the span start | model (C8) |
| M12 | **Contrast under motion** | nothing reads colour or composite alpha | frames |
| M13 | **No image, no video, no effect in 188 elements** | nothing counts element *kinds*. Measured: 73 text, 46 shapes, **0 images, 0 video, 0 effects, 0 masks, 0 markers, 0 transitions** | model — trivial, and a strong single-number smell test |
| M14 | **Multi-scene blindness** | `check(project)` runs over `project.active_scene()` only. A project with 3 scenes is checked one scene at a time and the report never says so | model — one line |

---

## 6. Is `check` registered, and was it run?

**Yes to both.** The EVIDENCE note that it may be unregistered is wrong.

- Registered: `rust/crates/bay-mcp/src/tools.rs:708`, schema `{}`, no required args.
- Dispatched: not in the explicit `match` in `tools.rs:920`, but caught by
  `other if bay_agent::planned_tools().contains(&other) => studio.apply_planned(other, args)`
  (`tools.rs:1152`). `"check"` is in `planned_tools()` (`bay-agent/src/plan.rs:48`) and planned
  at `plan.rs:596` → `bay_core::check(project)` → `Planned::Read`.
- Returned shape: `{ok, errors, warnings, notes, findings[]}`.
- Called **twice** in the producing session (94 `animate`, 64 `add_audio`, 46 `add_shape`,
  35 `add_text`, 15 `snapshot`, 5 `render`, **2 `check`**).

**But nothing gates on it.** `render` does not call `check`; `Report::is_clean()` is
`errors == 0`, so every perceptual finding is a warning by design and `ok: true` is returned
alongside 242 of them. The second call returned a **59 KB** payload that the harness truncated
to a 2 KB preview and spilled to a file — the agent, in practice, read the first ~20 of 242
findings, all of which were `invisible` false positives. **A report that does not fit in the
context window is not a report.**

Required regardless of which checks ship:

1. **Cap and rank.** Return at most 12 findings plus `{code: count}` totals for the rest,
   worst-first by severity *then by count* — one line saying `invisible ×60` is more useful
   than 60 lines of it.
2. **Promote the perceptual codes to `error` behind an opt-out**, or add a third field
   (`ok`, `clean`, `dead`) so `ok: true` stops meaning "216 things are wrong but none of them
   are fatal".
3. **Make `render` run `check` and echo the summary into its result.** It costs microseconds.

---

## 7. Engine gaps

| gap | why this area needs it | effort | unlocks |
|---|---|---|---|
| **Frame-sampled checking.** `check` is pure by charter ("No GPU, no ffmpeg, no file reads"). Every defect in EVIDENCE §9 is a pixel fact. bay already renders one frame headlessly (`snapshot` → `bay-preview`). Add `check(project, frames: N)` that renders N frames at 1/8 scale (135×240) and computes: ink coverage, largest empty rectangle, 8×4 ink-histogram cosine between samples, frame-to-frame delta, min text/background contrast, connected-component count | M7 M8 M9 M12, and the non-gameable half of C10. My model-only collision detector finds **0 hits** where the frame plainly shows one — that is the measured proof the model is not enough | medium | dead zones, collisions, empty containers, contrast, true stillness, layout repetition |
| **Text metrics in `bay-text`, callable from `bay-core`.** The model cannot compute a glyph run's box, so no text-collision, text-overflow or line-count check can exist headlessly | M9, and makes C6/C10 exact rather than approximate | small | collision, overflow, orphan-word, wrap-into-keep-out |
| **A beat/marker concept the MCP surface can express.** `marker_add` exists and is planned, but `scene.markers` is empty here and there is no `scene_add`. `spans()` guesses from the main lane and gets 1 | §2, C11 | small | four disabled checks; per-beat pacing |
| **`check` sees only `active_scene()`** | M14 | small | multi-scene projects reported honestly |
| **A capped/ranked report envelope** | §6 — a 59 KB report is not read | small | the findings actually reach the agent |
| **Element kind/effect census in `project_info`** | M13 | small | "0 images, 0 effects, 0 masks in 188 elements" as a one-line smell test |

---

## Appendix — measured quantities (all from the saved project JSON)

```
elements                 188 = 119 picture (73 text, 46 shape, 0 image, 0 video) + 69 audio
tracks                   main ×1 (1 element), overlay ×12 (4 empty), audio ×1
scenes                   1 · markers 0 · effects 0 · masks 0 · media assets 10
spans() returns          [(0.00, 62.00)]              derived beats (gap>1.2s): 10
animated channels        172 (≥2 keys, incl. audio) · animated picture elements 119/119
animated segments        435 · of which value-holding 190 (43.7 %)
  by property (segments) opacity 316 (72.6 %), x 36, y 34, scaleY 20, scaleX 16, scale 13
  by property (channels) opacity 107 (62.2 %), x 19, y 17, scale 11, scaleY 10, scaleX 8
  only-opacity elements  66 of 119 (55.5 %)
segment easings          ease-out 161, hold 130, linear 62, power4-out 24, power-out 18,
                         expo-out 12, sine-in-out 10, power4-in 8, spring-out 6, expo-in 3,
                         back-out 1   → 11 distinct
segment durations        0.10 ×86, 0.25 ×41, 0.35 ×20, 0.30 ×18, 0.40 ×17, … max 45.4
value-changing moves     245 · median 0.25 s · ≤0.10 s 31.0 % · <0.20 s 34.3 %
entrance signatures      85 distinct over 119 animated elements · top share 4.2 %
text families            Menlo 69, Baskerville 4        weights: 700 ×51, 400 ×22
text sizes (quoted)      34 ×41, 26 ×11, 30 ×4, 38 ×4, 24 ×3, 62 ×2, 58 ×2, 22 ×2, 96 ×1 …
  rendered              ×1.778 → modal 60 px (3.15 % H); max 171 px (8.9 % H, 15.8 % W)
  biggest visible type   median 107 px; 49 % of samples < 105 px; 2 samples with no text
colours                  #EDECE6 ×48, #73737E ×19, #FF5B5B ×15, #3A3A48 ×14, #8A93A3 ×7,
                         #33333F ×5, #40404E ×4, #A8A8B0 ×3, #606070 ×2, #191922, #4A4A58
x anchors                0.08 ×38, 0.09 ×25, 0.70 ×8, 0.28 ×5, 0.61 ×5, 0.30 ×5 …  Gini 0.466
y anchors                0.73 ×38, 0.60 ×13, 0.09 ×12, 0.36 ×5 …  max 0.735, none below
band occupancy (y)       0–.1 .99 | .1–.2 .99 | .2–.3 .84 | .3–.8 ≥.99 | .8–1.0 0.00
scheduled stillness      1088/1829 identical frame pairs (59.5 %); longest run 2.77 s;
                         8 runs ≥1.0 s; 15.4 s (25.2 % of runtime) inside them
audio                    69 clips; 22 above unity (narration 1.15 ×6, bed 2.0 ×5, impacts,
                         chime 1.5); 6 overlapping pairs ≥2 s, all ducking ≥6 dB in the save
check @ HEAD             ok:true, 0 errors, 24 warnings = 22 gain-above-unity + 2 small-text
check @ session run      ok:true, 0 errors, 242 warnings = 92 overlap + 69 small-text
                         + 60 invisible + 15 gain-above-unity + 6 flat-mix (~236 false)
```
