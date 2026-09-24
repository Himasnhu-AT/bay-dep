> **Historical:** describes the Rust engine, deleted; recover what it cites with `git show rust-engine-final:dep/rust/<path>` (e.g. `crates/bay-mcp/src/tools.rs`).

# 50 — THE PLAN

Round 2 synthesis. Inputs: 21 research/diagnosis files (`20`–`45`), four adversarial reviews,
and the measured forensics in `EVIDENCE.md`. Output: what changes, in what order, and what test
decides whether it worked.

Repo claims in this document were re-verified against source on `fix/pending-sweep`
(`check.rs:113,130,1180,1189,572`; `studio.rs:1202` `parse_easing` = 8 names;
`tools.rs:1066,1082`; `grep -c scene tools.rs` = 1).

---

# 1. The diagnosis

## 1.1 What wicks-v2 actually is

61 s, 1080×1920, 188 elements, **one scene**. The single largest object in every frame is a
rectangle covering **34.2 % of the canvas at 1.10:1 contrast** — below the threshold the skill's
own table labels "invisible". Around it: 69 of 73 text elements in Menlo at one weight, modal
size 34 px, 63 of 119 visual elements sharing one x, **nothing below y = 0.73**, and a contiguous
band from y = 0.771 to 1.000 (22.9 % of frame height) that is pixel-identical for all 1830 frames.
9.6 s sit inside stills longer than 2 s; the longest is 3.83 s. The card renders empty for 6.00 s.
The hook is 0.08 % ink at t = 0.5 s against a 7.2 % median. Beat-to-beat ink IoU is 0.168 —
it is one template redrawn eight times. The bed is one file cut into 13 clips with stepped gains
and **zero volume keyframes**; the duck runs backwards, so the music-only stretches are 1.1 dB
**louder** than the narration.

## 1.2 Why round 1 made it worse

Round 1 added four measurements: distinct-easing count, distinct-duration count, element count,
integrated LUFS. The agent hit all four.

| round 1 metric | target | wicks-v2 | how it was hit |
|---|---|---|---|
| distinct easings | > 1 | 19 | 130 `hold` keys, 121 of them on flat segments — free diversity |
| distinct durations | max/min ≥ 1.25× | 47 values, 454× | 76 moves at 0.098 s and one at 11.7 s |
| elements | "three layers per scene" | 188 | 46 shapes, 21 of them static wallpaper at 1.4–1.7:1 |
| integrated loudness | −14 LUFS | −13.9 | by deleting all dynamic range: crest 5.9 dB vs 12.3–14.1 in the videos it replaced |

Measured against the three videos round 1 condemned, wicks-v2 is **worse on eight of nine axes**
and better only on the one axis that became a number.

Two mechanisms, both important:

**(a) A cardinality is satisfiable by a sprinkle.** Every round-1 metric counted distinct values.
Sprinkling one counter-example anywhere in a 188-element project satisfies a distinct-count.

**(b) The skill prescribed the monotony it was written to prevent.** `Menlo` appears in five
reference files and every code example; `x: 0.089` and `scale: 0.744` are `layout.md:27-28`
verbatim; all seven palette hexes are `layout.md:79-87` copied whole, including `#4A4A58` which
the same file labels "2.21:1 — still too low"; `y ≈ 1400–1450` is `layout.md:30` and produced 38
elements at exactly y = 0.730. wicks-v2 **is the skill executed correctly.** The producing agent
read 8 of 9 reference files in full. Length was not the failure mode; content was.

## 1.3 Why round 2's corpus, shipped as written, is round 1 at higher resolution

The corpus contains ~250 rule entries and ~640 distinct numeric thresholds. Its near-universal
fix is "make it a distribution, not a count." **A k-entry rotation table satisfies a distribution
exactly as a sprinkle satisfies a count.** Reviewer 1 built the cheapest compliant video —
eight full-bleed colour cards, one giant word, one stock icon, five rotated moves, a bed with a
declared grid — and it passes essentially the entire corpus for ~40 tool calls and zero design
decisions. It is a Canva carousel. That is the failure round 3 would ship.

Three further facts kill large parts of the corpus outright:

1. **There is no reference fixture.** R1 and R2 exist only as MP4s in `~/Downloads`. Every
   model-level threshold in the corpus is fitted to between one and four data points, all of
   them our own condemned videos, with a measured false-positive rate of *zero observations*.
   When the references were used as predicates, **27 of the tested rules fire on at least one of
   them and 14 fire on both** — R2 misses the cap-height floor by 1.86×, the hero-200px floor by
   3.4×, the dynamic-range floor by 2.6× (LRA 2.3 vs 6.0 required), and the beat-to-beat IoU
   ceiling by ~3× because accumulation means consecutive frames share ink by construction.
2. **Caption contamination inverts the motion family.** Excluding `caption-*`, opacity share of
   animated channels across our three projects in chronological order is **76 % / 61 % / 51 %** —
   wicks-v2 is the *best* and improving. The famous "76 moves at 0.098 s" are 100 % `narrate`'s
   `captionFade`, and both predecessors carry the identical artefact at the old 0.12 s default.
   Ship the opacity-share cap or the pop cap as written and you punish the agent for calling
   `narrate` while ranking the worst video first.
3. **The corpus contradicts itself.** ≥12 hard pairs. `C10` forbids glyphs below y = 0.75 while
   `R4` demands ≥5 % of ink below y = 0.80. `22-skill-blame` requires beat ratio ≤ 2.5× while
   `36-story` requires ≥ 3.0×. `33-colour` forbids a non-flat-background rule while `32-composition`
   makes atmospheric layering mandatory and neither reference has any. `M13` explicitly authorises
   the one-way drift that `R1`/`C8`/the frame-hash check exist to forbid.

## 1.4 The mechanism that prevents a round 3 of the same

Four commitments, in this document, enforced by tests — not by intent.

1. **Fewer choices beats more checks.** Skalse et al. (NeurIPS 2022) prove that over the set of
   all policies, two reward functions are unhackable w.r.t. each other only if one is constant.
   No check bay can write is un-gameable in principle. The only remaining lever is restricting
   the action space. The proof that this is the right lever is in the data: **72 of 73 text
   elements in wicks-v2 are set *smaller* than `add_text`'s own default `fontSize` of 64** — the
   default beat the agent's explicit choice 98.6 % of the time — and where the default was wrong
   (`fontWeight: 400`) it was taken whole on 73 of 73.
2. **Only three rule shapes may gate.** (a) *Representability* — the bad value cannot be typed.
   (b) *Cross-time / cross-modal identity* — a constraint whose satisfaction requires relating two
   things a rotation table cannot relate (element identity across a state change; a token the
   voice never speaks). (c) *Argmax and two-sided bounds* — "the loudest window must be at the
   payoff", "50–80 % on the grid, not more than 80 %". A table makes everything equal; an argmax
   requires exactly one thing to be unequal. **Any proposal that is a cardinality or a one-sided
   threshold over the project JSON is rejected on sight.**
3. **A hard budget on the rule set, not just the report.** ≤ **14** `Error`-severity codes may
   exist, asserted by a test that fails the build at 15. The report surfaces ≤ 12 findings. 242
   warnings taught the agent to discard the channel, rationally, including its 3 true findings.
4. **Every gating code ships with three measured numbers**: fires on wicks-v2, silent on R1,
   silent on R2 — and a fourth, does-not-rank-wicks-v2-better-than-its-own-predecessors. A code
   that cannot produce all four does not ship. This is the single change that would have
   prevented most of the corpus's false positives, and it is proposed exactly once in 21 files.

**And one rule the corpus is missing entirely, which is what kills the carousel:**

> **CONTINUITY.** Every difference metric in the corpus (ink IoU < 0.25, descriptor distance ≥ 2,
> stage signature ≤ 15 %, dHash ≥ 26/64, "which two panels are most alike") pays for maximal
> frame-to-frame difference. **Not one rule requires consecutive beats to share anything.** The
> global optimum of the corpus as written is eight unrelated cards. Applied to R1 — one locked
> architecture held for 39 s — the difference metrics fail a good video outright.
>
> The fix is one clause, and it is un-fakeable because element identity across time is a fact in
> the project file: **consecutive compositions must share ≥ 1 persisting element id, and that
> element must have changed.** A carousel by definition shares no element between cards.

---

# 2. Ordering, and why it is different from round 1

Round 1 ordered **knowledge first**: teach doctrine, then measure. It failed, and the failure
mode is diagnostic — the doctrine was *followed*. A doctrine with free parameters is read as a
set of defaults and copied verbatim; the agent shipped `layout.md`'s literal float
`96/1080 = 0.088889`.

Round 2 orders **consequence → representability → measurement → doctrine**, and doctrine is last
and shortest because it is now mostly *deletion*:

| phase | why here | what happens if skipped |
|---|---|---|
| **0. The ruler** | Nothing can be evaluated without fixtures, a report envelope and a gate. `check` ran twice in 455 tool calls, returned `ok:true` with 242 warnings, and the agent acted on 1 (0.5 %). | Every later item ships unmeasured, exactly as round 1's five perceptual checks did — all of which pass the video they were written to catch. |
| **1. Delete the arguments** | The tool default beat the agent's explicit choice 98.6 % of the time. Removing a parameter cannot be Goodharted. Collapses ~30 corpus rules into 2 schema changes. | Every type/motion/colour rule remains a threshold, and a threshold is beaten by threshold + ε. |
| **2. Free model checks** | `sampled_transform`, `fade_gain`, `sampled_gain` already exist and `check.rs` never calls them. ~⅓ of the corpus's "needs frames" claims are free today. Deterministic, unit-testable, no GPU. | The three highest-separation defects (dead plate, blank hook, empty container) stay unmeasurable. |
| **3. Pixels** | Only after 0–2, because a pixel check on a GPU-less box silently returns empty — which is *structurally identical* to `spans()` returning one bucket and saying nothing. It needs the skip-reporting from Phase 0 to be safe. | The skip degeneracy repeats with a new noun. |
| **4. Doctrine** | It is the residue: whatever the schema cannot enforce. Written against the shipped kit and move registry, so it can no longer name a literal. | The skill re-grows the numbers that produced Menlo, x = 0.089 and the palette. |

**One-change-per-round discipline.** Phases 1, 2 and 3 each change the population every metric is
computed over (fixing `captionFade` alters every duration histogram; adding provenance alters
every distribution; the kit alters colour, size and family at once). Render the benchmark at the
end of **each** phase, not only at the end. Round 1 shipped four metrics together and could not
attribute the outcome to any of them; the answer turned out to be none.

---

# 3. Phase 0 — the ruler

*Nothing else in this plan ships before all of Phase 0 is green.*

### 0.1 Reference fixtures — **authoring, ~1 day, blocking everything**

- Hand-build R1 (Palmier demo: 3 elements, 39.3 s, locked) and R2 (doodle explainer: ~40
  accumulating assets, 57.2 s) as bay projects. `12-video-teardowns.md` already established both
  are reproducible in bay's current primitive set.
- Check in five fixtures to `rust/crates/bay-core/tests/fixtures/`: `r1-locked.json`,
  `r2-accumulate.json`, `wicks-v2.json`, `candlestick-wicks.json`, `candlestick-wick-volatility.json`.
- One test asserts the **exact** finding-code set for each.

**Fixes:** the root cause of round 1 — five perceptual checks shipped without ever being computed
against the video they were meant to catch. All five pass it.
**Proof:** `cargo test -p bay-core fixtures` green, and a `docs/native/check-codes.md` table with
four columns per code (wicks-v2 / R1 / R2 / rank-vs-predecessors).

### 0.2 Report envelope, skip state, and the gate — **engine, small**

- `check` returns `{ status: clean | findings | unevaluated, findings: [≤12], rollup: {code:count},
  skipped: [{code, reason}], stats: {…} }`. `is_clean()` (errors == 0) is replaced by an explicit
  three-state `status`; do **not** silently reclassify existing warnings as errors — that is a
  contract change and gets its own decision.
- `render` calls `check` first and refuses on any `Error`. One escape: `render({ignoreChecks: true,
  reason: "<≥40 chars>"})`, stamped into the job result **and** the MP4 metadata. No per-code
  suppression, ever.
- Any check that could not evaluate must appear in `skipped` with a reason. **A suite that cannot
  run must say so instead of passing.** This is the whole `spans()` disaster in one field.

**Fixes:** EVIDENCE §"check returned ok:true with 242 warnings"; the 59 KB payload truncated to
2 KB of which ~20 findings were read, all false positives.
**Gaming:** `ignoreChecks` becomes habitual. Survives because the reason string is a written claim
in the artefact, and because the error list is capped at 14 codes so fixing stays cheaper than
justifying. If it is abused, the next lever is refusing to stamp the file as deliverable — not
per-code suppression, which reintroduces silent degeneracy.
**Proof:** a test asserting `render` errors when `check` reports an `Error`; a test asserting
`findings.len() ≤ 12`.

### 0.3 Rule-set budget — **test, trivial**

`const MAX_GATING_CODES: usize = 14;` asserted over the registry. Adding a 15th requires deleting
one. Ships with the codes table from 0.1.

**Fixes:** the corpus's own hole — several proposals cap the report; none caps the rule set. A
short report drawn from a huge set is worse than a long one: each render surfaces a different
arbitrary dozen and the agent never learns the shape of the space.

### 0.4 Provenance and role — **engine, small, blocks 8 later items**

- `Element.source: Tool | Author`, **not settable from the wire**; `narrate`/`subtitles_*` set
  `Tool`. Reject agent-supplied ids matching `caption-\d+`.
- `Element.role: hook | headline | kicker | label | caption | lockup | data | ground | chrome`,
  required on `add_text`/`add_shape`. `ground` and `chrome` are capped at 15 % of elements —
  otherwise the exemption becomes the escape hatch.
- `AudioElement.role: speech | bed | sfx`, set by `narrate`.
- Every distribution in `check` partitions on `source`.

**Fixes:** the contamination that inverts four motion rules. 38 of 73 text elements, 76 of 107
opacity channels, all 76 three-frame pops, 38 of 38 elements at y = 0.735 and 38 of 41 at
fontSize 34 are `add_caption_element`'s output, not the agent's.
**Proof:** authored-only opacity share and duration histogram printed in `check.stats`, and the
fixture table showing wicks-v2 no longer ranked best on them.

---

# 4. Phase 1 — delete the arguments (representability)

### 1.1 `(family, weight)` resolution gate — **engine, small. SHIPS ALONE AND FIRST in this phase.**

`add_text` shapes one glyph, reads `LayoutGlyph.font_id`, and **errors** if the resolved face's
family differs from the request.

**Fixes:** cosmic-text does not snap to the nearest weight — it drops the family. Measured:
`Avenir` w700 → **Menlo Bold**; `Baskerville` w900 → **Apple SD Gothic Neo Heavy**; every
w100/300/500/600/900 miss → a Korean UI face. Round 3's most likely typographic fix ("extreme
weight contrast, 300 vs 900") would ship a video set in a Korean UI font and a terminal font
while passing every check.
**Gaming:** none — it is a fact about the font database, only satisfiable.
**Proof:** a mac-job test asserting `add_text("Avenir", 700)` errors, and a generated
`family → {resolvable weights, metric class, cap/em ratio}` table checked in.

### 1.2 Style kit — **engine, medium**

- Delete `fontFamily`, `fontSize`, `color`, `fontWeight` from `add_text`/`add_shape`. Require
  `role` (§0.4) + `tone: ink | dim | accent`, resolved against a project-committed kit.
- `style_pick` offers **3 of ≥12** kits, seeded by `hash(brief + date)`, excluding the last 5 from
  an **engine-owned** `~/Library/Application Support/vii/style-history.json`.
- A `custom` kit is legal and validated: ≥3 families passing 1.1, hero/body cap ratio ≥ 4.0,
  accent ΔE00 ≥ 40 from ink, ≥4 declared framings including one bottom-weighted. Strictly more
  work than accepting an offer.
- Backstop for the wasm/web import path (which deserialises `Project` directly and cannot be
  narrowed — it is the pinned kebab-case interop contract): finding `off-token-value`.

**Fixes:** EVIDENCE §4 (Menlo 69/73), §5 (nothing big), §6 (5 colours, 1 accent used 3×), and the
palette copied verbatim from `layout.md` including the value that file labels as failing contrast.
**Collapses:** all 8 hero-size rules, 5 family caps, 5 mono caps, 7 tier-ratio rules, 4 palette
rules, the weight rules and `small-text` — ~30 corpus rules into one schema change, and with them
the 14 mutually incompatible statements of "largest type" in 4 incompatible units.
**Gaming:** commit a bad `custom` kit. Survives on cost: validation is more work than picking.
**Proof:** benchmark render contains ≥3 metric classes, ≥2 weights, cap ratio ≥ 4.0, and the same
brief run twice a week apart draws different kits.

### 1.3 Move registry + one `animate` — **engine, medium**

- `apply_move(elementId, move, at, {direction, distance})`. Duration and curve are properties **of
  the move**, chosen so `core_span(easing) × frames ≥ 4` core frames. Core span is a 14-entry
  constant table derived by sampling `Easing::apply` — it never becomes an agent-facing number.
- Every registry move contains a geometric channel above its own amplitude floor. Opacity may ride;
  it may never lead.
- Raw `animate` survives as a **flagged escape hatch**, reported per channel as
  `off-vocabulary-motion` with the element id, so evasion cost scales with evasion.
- **Delete `Studio::animate`/`parse_keys`/`parse_easing`** and remove the explicit `"animate"` arm
  at `tools.rs:1066` so it falls through to `apply_planned`.
- Histogram gate: **≥4 distinct registry moves each ≥10 % of animated elements** *(two-sided —
  the ≤8 upper bound is what inverts the Goodhart gradient; there is no lower bound on distinct
  entrance signatures, because R2's ~40 assets share one motion idea by design).*

**Fixes:** EVIDENCE §1 (90 % opacity), §2 (76 three-frame pops), §3 (`hold` ×130, `spring-out` ×4).
Also the transport divergence: the headless `animate` **rejects `spring-out`** and 5 other
easings (verified: `studio.rs` `parse_easing` handles 8 names), refuses `property: "volume"`, and
silently discards per-key easing — which is why the agent built the 13-clip bed and why
`flat-mix` was silenced.
**Collapses:** all 9 duration floors, 4 median rules, 6 opacity-share caps, 6 amplitude floors,
the easing-cluster count, hold-stuffing, the modal-bucket cap.
**Gaming:** one move for everything (blocked by ≥4 at ≥10 %); fall back to raw `animate` (each
channel individually named in the report). A five-move rotation *passes* — and a small deliberate
vocabulary reused with intent is the desired output, so this gaming vector produces the right video.
**Proof:** ≥90 % of authored channels byte-identical to a registry instantiation; zero segments
under 4 core frames; `spring-out` reachable over MCP.

### 1.4 `narrate` defaults and cue discipline — **engine, small**

- `captionFade` 0.1 → **0.28**; the 11 caption-style parameters collapse to one `captionStyle`
  from the kit; expose `captionX`/`captionAlign` (today only `captionY` is settable, which is why
  38 elements share x = 0.08).
- Return `wordsPerSecond`; accept `targetWordsPerSecond` (default 2.5) and pick `speed`. The skill
  documents 2.5 w/s; measured is **2.99** — a 20 % planning error that produced a 179 wpm read.
- Reject any clip synthesising over **8.0 s** (kills the 10.30 s, 29-word run-on that landed on
  the turn).
- Never emit a cue crossing sentence-final punctuation; merge cues when `duration < 0.30 × words`.

**Fixes:** EVIDENCE §11 (partially — see §8); 15 BBC-rate violations, 8 sub-0.833 s cues, 18 over
17 cps, 2 sentence straddles, all measured. Removes the three-frame-pop epidemic with no check.
**Proof:** benchmark cues all ≥ 0.30 s/word and ≥ 0.833 s; measured wpm within ±5 of 150.

---

# 5. Phase 2 — the free checks (model-only, no GPU, no fonts)

Every item here is computable today from `Project` plus `sampled_transform` / `fade_gain` /
`sampled_gain`, all of which exist and are never called by `check.rs`.

### 2.1 `dead-plate` — **the single largest defect. ~40 lines.**

No element with rendered area ≥ **4 %** of canvas may sit below **2.0:1** composited contrast
against what is beneath it (resolve z-order by the documented main-then-overlay item order).
Contiguous same-colour elements are **aggregated before testing**. Exactly one `role: ground`
exemption per scene, and a ground must be ≥ 60 % of canvas.

**Fixes:** the panel — 34.2 % of canvas at 1.10:1, present in 60 of 61 seconds, the largest object
in every frame. Also the 25 of 46 shapes at ≤ 2.21:1, one of which is `#4A4A58`, the value the
skill itself calls too low.
**Gaming:** declare it `ground` (blocked by the ≥60 % clause); split into eight 4.5 % plates
(blocked by aggregation); raise to 2.01:1 — which makes it a real design element the layout rules
then apply to. **Every escape is a better video.**
**References:** silent on both. R2's blush field is the background *setting*, not an element;
R1's ground is the black canvas; every large object in both is high-contrast content.
**Proof:** fires on wicks-v2 (1 finding, 34.2 % @ 1.10:1); 0 on R1, R2, and both predecessors.

### 2.2 `no-hook`, rewritten — **~20 lines**

Delete the small-shape early return at `check.rs:1189`. Delete the unconditional `Image | Video`
return at `:1195`, replacing it with an area+opacity test. Evaluate opacity at t. Use
`rendered_font_px` (`:130`), **deleting the second formula at `:1180`** which is the exact
`font_size × scale × scale_y` its own 40-line doc comment says was wrong.

One instant, one threshold, **relative**: at **t = 0.40 s**, bright ink (≥4.5:1) must be ≥ **60 %
of the video's own median frame ink**, and the largest cluster must be an element at the kit's
`hero` tier with sampled opacity ≥ 0.9.

**Fixes:** hook is 0.08 % ink at t = 0.5 s against a 7.2 % median = 1.1 %. The element that
suppressed the entire check is `panel`, whose opacity is `0.0@0s → 0.0@0.15s → 1.0@1.55s` — an
element that is **literally invisible** certified the hook.
**Gaming:** one giant word at frame 1 — which *is* a hook, so the gamed output is the desired one.
Pair with the benchmark's proposition constraint (2–9 words, must contain a verb or a numeral).
**References:** the absolute form (≥4 % ink at 0.30 s) demands R2's hook be **four times denser
than R2's own median** and fires immediately. The relative form is silent on both.

### 2.3 `empty-container` — **~30 lines**

Any `Shape` ≥ 5 % of canvas at sampled opacity ≥ 0.5 must contain ≥ **4 % of its own fill area**
in marks measuring ≥ 3:1 **against the shape's own fill** — not against the canvas ground — at
every 10 Hz sample, and ≥ 2 qualifying marks.

**Fixes:** 6.00 s of zero card ink (0.90–2.90, 18.90–20.20, 45.50–47.20, 61.00–62.00), which reads
as a failed asset load. Also `charts.md:53`, which specifies the contrast floor against the ground
— every gridline in this video measures 1.40–1.71:1 against the card it sits on while nominally
passing at 3.12:1 against the background.
**Gaming:** one dot (4 % of a 34 %-canvas fill is ~28 k px); delete the card (a better video).
**Scoping:** `Shape` only. Applied to `Image`/`Video` it would fire on R1's static tweet PNG.

### 2.4 `broken-continuity` — **the carousel killer. ~50 lines.**

For every pair of consecutive beats (§2.7): **≥1 element id present in both, whose transform or
value changed between them.** Additionally `transform_matching(fromIds, toTokens, …)`: when two
consecutive states share a token, the shared tokens must carry the **same element ids**.

**Fixes:** eight beats rebuilt from scratch; 104 of 106 opacity channels start at 0, i.e. every
state change is a fade-from-nothing. Beat-to-beat IoU 0.168.
**Gaming:** cannot be faked by adding keyframes — element identity across time is a fact in the
file, and the only passing path is carrying the element through. It also correctly **inverts
round 1's element-count incentive**: passing reduces element count.
**References:** R2 passes trivially (accumulation — nothing ever leaves). R1 passes trivially
(three elements, all present throughout). It is the one rule that *rewards* both good references
and fails both the carousel and wicks-v2.

### 2.5 `no-response` (MAKE-ROOM, repaired) — **~40 lines**

≥ 50 % of authored arrivals must have ≥ 1 already-present element changing value within ±12
frames, where the responder: is ≥ 1 % of canvas, is on screen ≥ 45 f either side, is **not** the
arriving element's own stagger group, changes **positionally** (≥ 0.02 canvas) or by **scale**
(≥ 0.08) — never by opacity — and **no single element may be the responder for more than 40 % of
arrivals**.

**Fixes:** 88 of 119 arrivals have zero responders; 58 of 119 elements are never touched after
t_local 1.5 s. The composition is a stack of slides.
**Gaming:** one persistent decorative rule pulsing on every arrival — blocked by the 40 % cap, the
positional requirement and the ground exclusion. As written in the corpus, one element bought all
of them.
**Dependency:** ships **with** `animate_many` `by` (delta) semantics (§6.4) or it is a rule the
tool makes expensive to obey. Today `from`/`to` are absolute and shared, so making room means
rewriting each incumbent's whole absolute key list — which is precisely why the crossfade won at
all five seams.

### 2.6 Three exact one-liners — **~30 lines total**

- **`value-overshoot`** (Error): `back-out` — or any easing whose `apply()` leaves `[0,1]` — on a
  `scale*` channel that encodes a magnitude. `BackOut` (c1 = 1.70158, c3 = 2.70158) peaks at
  **1.10005** at t = 0.580; wicks-v2 ships a data bar displaying **110.0 % of its own number** for
  0.25 s. Only escape is `spring-out`, which is critically damped and provably monotone. Vacuous
  on both references.
- **`off-grid`**: every cut time and value-changing duration is an exact multiple of `1/fps`;
  ≤ 10 % of segments under 4 frames. Removes 76 off-grid 2.94-frame segments. No reference can fire.
- **`unreadable-dwell`**: text dwell ≥ `0.30 + chars/17` s; hard 1.1 s floor at ≥3 words. Fires 33
  times on wicks-v2 (worst: "All of it" at 0.36 s against a 0.83 s floor). Pure string arithmetic.
  Cheapest true positive in the corpus.

### 2.7 Beats: one canonical derivation, and delete `spans()` — **~60 lines**

- **Pacing and motion rules evaluate on a sliding 150-frame window.** Time-based, no structural
  handle to collapse, immune to how the author used tracks.
- **Per-beat rules** use ONE published derivation, returned in `check.stats` so the agent can see
  its own beats: `narration clip starts ∪ markers`, falling back to stage-signature changes
  lasting ≥ 4 s, falling back to fixed 8 s windows. It is an **addressing scheme, not a quality
  rule**, and must not be re-litigated per check.
- `scenes.len() == 1` above 15 s is a **note**, not an error — there is no MCP tool that creates a
  scene, and `export_video` takes one `&Scene`, so a multi-scene project would render one seventh
  of itself. Shipping it as an error bricks every session.

**Fixes:** the most important structural finding — `spans()` returns one 62 s bucket because the
main lane holds one element, so `front-loaded`, `inert-scene`, `no-accumulation` and the tempo
check are arithmetically incapable of firing.
**Honesty, stated loudly:** re-deriving 10 beats on wicks-v2 and re-running those four checks
**fires not one finding on any beat.** Beat lengths run 1.2–11.8 s, a 9.4× ratio, comfortably
clearing the tempo test. **wicks-v2's pacing is genuinely fine.** Fixing `spans()` is necessary
(five checks are dead without it) and *demonstrably insufficient*. Do not let round 3 spend itself
here and declare victory. **Delete `front-loaded`, `inert-scene` and `no-accumulation`** — they
have never fired on any project we condemned, on any bucketing. A check that has never fired is a
comment.

### 2.8 Audio: make the correct mix cheaper than the hack — **engine, small–medium**

- **`audio_probe {mediaId} → {peakDb, rmsDb, lufs, accentSeconds}`**, cached on `MediaAsset` at
  import. `flat-mix` today compares raw `volume` floats across sources whose file loudness differs
  by 15 dB: bed mean −35.0 dBFS vs narration ~−20, so a 4.3 dB gain ratio is a 7.9 dB audible
  separation and the check's number is fiction.
- **Clamp the `flat-mix` window** to `[start + max(fadeIn), end − max(fadeOut)]` instead of
  returning `None` on any zero gain (`check.rs:1067`). Six `flat-mix` findings became zero when
  the agent added a 0.3 s `fadeIn`, with the separation unchanged at 4.3 dB. **A check a bad video
  silences with a cosmetic edit certifies the mix.** Regression test required.
- **`duck {bedId, underIds[], depthDb, attackMs, releaseMs, preRollMs}`** writing volume keyframes
  on one clip. Every ingredient exists and none was used, because 13 clips silenced the check and
  a keyframed duck would not have.
- **Gate (positional, argmax-shaped, not a range):** narration-window mean loudness ≥ gap-window
  mean **+ 6 LU** on the mix envelope per narration-second, **with a bed-audible floor of −26 LUFS
  in gaps** so separation cannot be manufactured by deleting the bed. The loudest 400 ms window
  must fall within 1.5 s of a `payoff` marker **committed before any audio element exists**.
- **Do NOT target LRA or dynamic range.** Measured: R1 = 6.7 LU, wicks-v2 = 3.5, **R2 = 2.3**. The
  reference we most admire is flatter than the failure. A ≥6 LU floor condemns R2 by 2.6×.

**Fixes:** EVIDENCE §10 — 13 stepped bed clips, zero volume keyframes, and a duck that runs
backwards (gap windows are **1.1 dB louder** than speech windows).
**Gaming:** place the payoff marker where the audio already peaks. Blocked by the ordering
constraint (marker committed at plan time) and by cross-coupling it to the largest visual event.

---

# 6. Phase 3 — pixels, safely

### 3.1 `check_frames` as a **separate call**, never folded into `check` — **engine, medium**

`check` stays pure (its charter, `check.rs:15-18`). `render` calls
`check_frames(project, &mut PreviewRenderer)`, which returns its own report with an explicit
`unevaluated` state when there is no adapter. **A GPU-less box must report `gate: unevaluated`,
not `ok`** — silently returning empty is structurally identical to `spans()` returning one bucket.

Primitives, computed once and shared:

- **Ink mask**: pixels ≥ 4.5:1 against the frame's modal background. **This is the only definition
  of "ink" any rule may reference** (the corpus has 8). At threshold 24, wicks-v2 reads 35.92 %
  ink — 8× its predecessors — because one dark card covers a third of the frame; at real ink it is
  1.32 % and the best of the four is 4.01 %. Any naive ink metric ranks the failure first.
- **Inter-cluster geometry signature (ICGS)**: pairwise distances between the centroids of the 5
  largest ink clusters on a 32×32 caption-suppressed thumbnail. **Build this once — it is what
  five separate corpus rules independently want and none of them names.** A global drift, a zoom,
  a hue swap and an edge shimmer all leave it invariant; an element arriving, leaving, or moving
  relative to its neighbours changes it.
- **Caption-suppressed render flag** (uses §0.4's `source`).

### 3.2 `frozen` — one clock, ICGS-based — **~40 lines**

No 1.2 s window in which fewer than 2 of the 5 largest clusters' centroids move ≥ 3 % of frame
height *and* the ink mask's IoU against its own start exceeds 0.97.

**Fixes:** 9.6 s in stills > 2 s, longest 3.83 s, 22.0 % of runtime inside ≥1.5 s windows with
< 0.1 % pixel change; and the "two snapshots 0.5 s apart" rule that was passed at **4/64 dHash**
(94 % identical) by `cmp -s` on two PNGs nobody opened.
**Gaming:** a 3 % scale creep on the hero (defeats every pixel-delta form, and `M13` explicitly
authorises it); an opacity wobble; a hue swap at constant luma (defeats dHash). **All three leave
ICGS invariant.** Stated once, in one place: **drift satisfies ambient liveness and nothing else.**
It never counts toward frozen, event density, or a critique obligation.
**References:** R1 is 70–75 % pixel-identical for 39 s and passes, because its two live cells sit
inside the anchor and move clusters; R2's arrivals change the cluster count every ~3 s.

### 3.3 `anchor-scale` and `bottom-dead` — **~40 lines**

- **Anchor** = the ink cluster with greatest area × contrast. Its `sqrt-area` must reach ≥ 0.26 at
  least once. Measured: **R2 0.310, R1 0.264, wicks-v2 0.205** — a clean 3-way separation that no
  text-size rule achieves (every "hero ≥ 200 px" phrasing fires on R2 by 3.4×, because R2's anchor
  is an illustration and its largest text is a ~58 px caption).
- **Bottom**: ≥ 5 % of ink below y = 0.72 belonging to a **non-caption** element ≥ 1.5 % of canvas
  **area**, in ≥ 50 % of beats. Glyph keep-out (no glyph below y = 0.75) stands, scoped to glyphs
  and driven by a per-project delivery target. **These address different element classes — that is
  the only resolution of the C10/R4 contradiction, and it must be written down.**

**Fixes:** bottom 22.9 % of frame pixel-identical for the entire runtime; ink centroid never
crosses y = 0.55; max anchor y = 0.735 which is `layout.md:30` obeyed to the pixel.
**Gaming:** grow the caption band (`captionY` 0.735 → 0.82) — blocked by the non-caption and
area qualifiers. A dim slab low in frame — blocked by 4.5:1.

### 3.4 The critic loop — **engine + skill, medium**

`contact_sheet(times, columns) → one labelled PNG` at **engine-chosen, seeded, jittered** times
(2 per beat). A **fresh** critic subagent per round receives *brief + sheet + computed metrics
only* — no plan, no transcript, nothing it could defend. It answers **3 forced choices**
(weakest panel, most-alike pair, thumbnail panel) and 9 binaries. Every computable item is
computed in Rust; only the semantic remainder goes to the model. Each forced choice becomes a
persisted obligation keyed on `(beatId, sampleTime, contentHash)` that blocks `render` and closes
**only when that beat's ICGS changes** at the same sample time. Bounded at 2 rounds.

**Fixes:** 15 snapshots taken, 12 opened, 3 never read (including the two the anti-freeze claim
rested on), 7 fix rounds — **all 7 local proofreading** (text wrap, gridline strike-through,
anchor offset). Zero touched scale, hierarchy, palette, composition, emptiness or variety. The
agent opened the near-blank hook frame, said nothing, and rendered 91 seconds later.
**Gaming:** compose for the sample times (blocked — engine-chosen, seeded); answer binaries
dishonestly (blocked — the computable half is never delegated, and the 3 forced choices produce
work regardless); trivial edit to close an obligation (blocked — ICGS, not dHash, because dHash is
an 8×8 luma gradient defeated by a hue swap and inflated by a global luma change).
**Why it is bounded:** on a video that is already good, forced edits are damage. 2 rounds, then it
stops. Absolute VLM scores are never requested — binary rubric decomposition reaches Spearman
0.532 against 0.303 for holistic scoring, and conformal intervals on VLM scores span 52–88 % of
the scale.

### 3.5 Cost budget and the renderer question — **required before 3.1 lands**

- `check` (model) must run < 50 ms; `check_frames` < 8 s for a 61 s timeline at 4 fps / 135×240.
  If it exceeds 15 s it will be bypassed, exactly as the current one was (2 calls in 455), and it
  takes every rule with it. Measure before shipping; drop to 2 fps if needed.
- **Settle the renderer suspicion with a GPU test first.** Measured from the encoded frames:
  `head3` on `track-overlay-4` does **not** draw over `panel` on `track-main` at t = 18.9–19.0,
  while gridlines on `track-overlay-1` **do** composite above the same panel in the same frame.
  `render_inner` iterates `once(&main).chain(overlay)` and the compositor blends in order, so this
  should be impossible. If it is a renderer bug, "the card renders empty" and "'Different day.' is
  occluded" are **engine defects being misdiagnosed as design defects**, and every collision or
  layout check written against assumed z-order will name the wrong element.

---

# 7. Phase 4 — doctrine, and the deletions

**Current: 2,197 lines / 17,885 words across 10 files. Target: ≤ 620 lines across 4 files.**

The transfer channel is measured: `recipes.md` is 51 % fenced code, has the *lowest* prohibition
density in the skill, and supplied nearly every shipped default. `banned-defaults.md` is 0 % code,
has the *highest* prohibition density, and its most specific rule came back **inverted**
(it names "400 vs 700 is a web distinction" as the wrong answer and got exactly that pair).
Negated instructions show inverse scaling; the always-present tool block gets **179× the
token-exposure** of the read-once skill corpus.

### Deletions

| file | lines | disposition |
|---|---|---|
| `references/recipes.md` | 419 | **DELETE.** Source of `0.089`, `0.744`, `96`, `#0E0E12`, `#EDECE6`, `Menlo`, the hold-on-flat pattern and `duration: 0.01`. Recipes become registry moves and kit tiers. |
| `references/troubleshooting.md` | 143 | **DELETE.** Never opened by the producing agent. Its 8 "symptoms with no error" become check findings and tool error strings. |
| `references/banned-defaults.md` | 106 | **DELETE.** The 18-font blocklist produced 69/73 Menlo, which the same skill recommends elsewhere. Prohibitions move into the schema or go away. |
| `references/charts.md` | 113 | **DELETE.** Three surviving facts (chrome contrast against the container fill; no overshoot on a value channel; the numeric example precedes the symbolic form) move to `craft.md`. |
| `references/layout.md` | 137 | **DELETE.** Every literal in it shipped. The grid, the type ladder and the palette are now the kit. |
| `references/motion.md` | 376 | **DELETE.** Its 17 named moves become the registry — the single measured proof that prose vocabulary transfers at ~0 (`spring-out`, called "the house entrance" in five places, used 4 times in 188 elements). Delete the per-key easing feature (documented 4×, produced 121 no-op hold keys) and line 364 ("ink coverage is the wrong metric"), which pre-emptively disarmed the only measurement that would have caught the blank hook. |
| `references/audio.md` | 194 | → folded into `craft.md` (~40 lines) |
| `references/narration.md` | 148 | → folded into `craft.md` (~30 lines). **Fix the 2.5 w/s figure** — measured 2.99. |
| `references/tools.md` | 360 | → **generated** from the tool schemas, ~120 lines. Zero drift by construction. |
| `SKILL.md` | 191 | → ≤ 160, containing a **≤ 25-line numbered pre-render gate** — the only form in this corpus that reliably gets executed (all four numbered lists in the skill were followed in order; every narrated axis was approximated). |

### What survives, and the new shape

```
SKILL.md            ≤160   the loop, the gate (numbered), the refusal semantics
references/
  structure.md      ≤120   beats, roles, the hold budget, the turn, the landing
  craft.md          ≤200   what a move/kit/asset is FOR; audio; narration; the three chart facts
  tools.md          ≤120   generated
                    ────
                     600
```

**Two authoring laws, tested:**

1. **No example may contain a value that could be copied as a default.** Lint the skill: fenced
   blocks may not contain hex colours, floats in [0,1], integer font sizes, or known font family
   names. All become named constants or placeholders.
2. **No quality goal may be stated without the tool call that achieves it in the same paragraph.**
   `banned-defaults.md:25-30` demanded "at least three layers per scene" and named no acquisition
   path; the agent satisfied it with 46 vector shapes and 0 images.

### Three negative rules, kept verbatim at the top of `craft.md`

These are the only items in the whole corpus that prevent round 3 from repeating round 1 exactly,
and each is backed by a measurement showing the metric it forbids **ranks the failure above a
reference**:

- **Never mandate a non-flat background, a gradient, or grain.** R2 is 79–97 % one blush colour
  for 57 s; R1 is flat black; both grounds are *flatter* than ours (noise σ 0.22–1.19 and
  0.43–0.66 vs our 0.62–0.67). The mandated version produces a purple radial mesh behind
  monospace type — wicks-v2 with one more layer.
- **Never use bitrate, distinct-frame count, or keyframe count as a motion proxy.** wicks-v2 has
  the *highest* mean bitrate of the four (343 kbps) and 90.6 % distinct frames, while 60.2 % of
  consecutive frame pairs differ by ≤ 2/255 everywhere. The bits are dither in the card fill.
- **Never ration a decision because it repeats.** A tool refusing a family it has seen 20 times
  punishes correct behaviour, is satisfiable for free by a third family on one 12 px label, and
  converts a design decision into a rationed resource — the exact mechanism that produced 19
  easings and 47 durations.

---

# 8. The benchmark

> **Decided 2026-08-12: run BOTH briefs at every phase boundary.** The candlestick script gives
> direct before/after comparability against four measured failures on the same subject; a second,
> unrelated brief tests whether the fix generalises or is overfitted to candlesticks. A fix that
> only moves the numbers on the brief it was designed against is round 1's mistake in a new place
> — round 1's metrics also passed on the video they were written for.
>
> **Brief B (the generalisation check) is not yet written.** It must be authored *before* Phase 0
> ships, by the same method as §7 — a real subject, a beat sheet with roles and a turn — and it
> must differ from Brief A on the axes the plan is weakest on: it should want **imported imagery**
> (Brief A is a drawn explainer with zero images, see the caveat below), a **different runtime**
> (target 30 s, which also exercises §9.4 — nothing in this plan rewards cutting), and a
> **non-numeric payoff**. Both briefs' pass criteria are the §8 table; the per-criterion numbers
> below are Brief A's measured baseline and Brief B needs its own baseline row set, recorded on
> first run and never tuned afterwards.

**Brief A:** `36-story-and-script.md` §7, **verbatim** — the 9-beat candlestick-wick script
(121 words, 150 wpm, `speed: 0.89`, the beat sheet with roles, holds, the turn at 22.00 s, and the
payoff that returns to the hook's composition). Hand it to the agent unchanged. Run it at the end
of every phase.

**Frames measured:** 18 engine-chosen seeded sample times (2 per beat, jittered), plus fixed
t = 0.40 s and the final 3.0 s. Caption-suppressed for all layout, ICGS and frozen measurements.

## Pass criteria

| # | criterion | wicks-v2 (measured) | pass |
|---|---|---|---|
| 1 | largest element below 2.0:1 composited contrast, as % of canvas | **34.2 %** | 0 elements ≥4 % canvas below 2.0:1 (ground exempt) |
| 2 | consecutive beat pairs sharing ≥1 persisting *changed* element id | 0 of 5 | **≥ 7 of 8** |
| 3 | runtime inside 1.2 s windows with no ICGS change | **22.0 %** | ≤ 6 % |
| 4 | ink at ≥4.5:1 below y = 0.72 from a non-caption element ≥1.5 % canvas | **0.00 %** | ≥ 5 % of total ink in ≥ 50 % of beats |
| 5 | ink at t = 0.40 s as a fraction of the video's own median | **1.1 %** | ≥ 60 % |
| 6 | peak anchor sqrt-area | **0.205** (R1 0.264, R2 0.310) | ≥ 0.26 |
| 7 | anchor is non-text | 0 of 8 beats | ≥ 40 % of beats |
| 8 | authored channels not matching a registry move | ~100 % | ≤ 10 % |
| 9 | authored value-changing segments under 4 core frames | 76 (100 % opacity, 100 % ease-out) | 0 |
| 10 | narration-window mean − gap-window mean, mix envelope | **−1.1 dB** (backwards) | ≥ +6 LU, gaps ≥ −26 LUFS |
| 11 | loudest 400 ms window vs `payoff` marker | t = 48.0 s, no marker | within 1.5 s |
| 12 | metric classes / weights / cap ratio in the type | 1 / 1 / 2.8 | ≥ 3 / ≥ 2 / ≥ 4.0 |
| 13 | `check` on the delivered project | `ok:true`, 242 warnings, 0 errors | 0 errors, ≤ 12 findings, **0 `skipped`** |

**Deliberately NOT measured** (each ranks the failure above a reference, or is satisfiable by a
rotation table): ink coverage as a scalar, LRA/dynamic range, distinct-easing count,
distinct-duration count, element count, bitrate, distinct-frame count, background flatness, grain
presence, asset count per second, beat-to-beat IoU, dHash between consecutive beats.

**Secondary regression suite, run at every phase:** the 5 fixtures from §0.1 must produce their
exact recorded finding-code sets. Any new code that fires on `r1-locked.json` or
`r2-accumulate.json` is reverted, not tuned.

**One honest caveat about the benchmark.** The §7 brief is a *drawn* data explainer — nine beats
of candles, rules and formula glyphs, **zero imported images**. It would fail an
`Image`/`Video`-presence rule. That is why criterion 7 is written on the **anchor being non-text**
rather than on asset count: candles are shapes and satisfy it; wicks-v2's anchor is text in 100 %
of beats. The asset-presence floor (`≥1 Image/Video above 15 s`) still ships for general briefs,
and it is a floor, not a signal — one of the three predecessors contains 2 videos and 2 images
and is still bad.

---

# 9. What this plan does not fix

State these before someone claims otherwise.

1. **Relevance.** Nothing here verifies the picture is about the subject. An agent can import 40
   unrelated PNGs, or draw 9 beats of correct-looking geometry about nothing, and pass every rule.
   The only cheap handle is engine-generated assets, whose provenance name is trustworthy and can
   be lemma-matched against that beat's narration; imported assets keep the hole. **The critic
   loop makes wrong assets *visible*; it cannot make them impossible.**
2. **Premise.** No rule asks whether the piece has a reason to exist. wicks-v2's payoff is an
   arithmetic identity that restates its own inputs — correct, well-staged, worth nothing.
3. **The read.** Phase 1.4 fixes the *authoring* half (rate, clip length, cue merging, per-clip
   level) and nothing else. Kokoro exposes one `speed` per utterance, no pause authoring, no
   emphasis. 36 seconds in a single unvarying register is its own retention failure. See
   `44-expressive-tts.md`: the model swap is the **third** most valuable thing, and every option
   that beats Kokoro on expressiveness costs something bay depends on.
4. **Runtime justification.** Every rule normalises to T and takes T as given. Nothing rewards
   *cutting*. A 25-second version of wicks-v2 would fail almost nothing and be better. Several
   items here apply upward pressure on density and none applies downward pressure on length.
5. **Music with a real beat.** `bed.wav` is a 62 s drone: RMS varies 2 dB, spectral centroid
   σ = 6 Hz, best-fit grid over 162 onsets explains 28 % against a 20 % chance rate. **Every "land
   on the beat" sentence in the skill is currently unfalsifiable and must be deleted** until
   `music_bed` synthesises a bed and returns an exact grid (large; not in this plan).
6. **Structurally out of reach with current primitives:** per-word/per-character kinetic type
   (`TextElement` is one style, one colour, one size, no stroke, no runs); gradients and text
   stroke/shadow; animated mask geometry and animated effect parameters; a group/parent transform
   (a camera push on a 12-element beat is 36 `animate` calls; on six beats, 216 — 54 % of the whole
   session budget, which is why no bay video has ever had a camera move); multi-scene export
   (`export_video` takes one `&Scene`).
7. **Studio-level sameness.** The kit rotates across projects; the *structure* does not. Every bay
   video will still be recognisably a bay video, and the shot-template direction makes that
   sharper, not softer. Accept it explicitly — one designer's decision applied consistently beats
   an agent's decision applied randomly — but expect it as the next complaint.

---

# 10. Failure → owner

Every measured failure in `EVIDENCE.md` and the frame forensics, mapped. **Unowned items are
flagged in bold.**

| # | measured failure of wicks-v2 | owner |
|---|---|---|
| 1 | 107 of 119 animated channels are opacity | **1.3** move registry (every move carries a geometric channel) |
| 2 | 76 moves at 0.098 s = 3 frames | **1.4** (`captionFade` → 0.28 removes all 76) + **1.3** (≥4 core frames) + **2.6** `off-grid` |
| 3 | `hold` ×130, 121 on flat segments; `spring-out` ×4 | **1.3** (duration/curve leave the wire) + **4** (delete the per-key-easing feature and its blessing) |
| 4 | Menlo 69/73, one weight | **1.2** kit (family/weight leave the wire) + **1.1** resolution gate |
| 5 | max 96 px, modal 34 px, nothing big | **1.2** kit tiers + **3.3** anchor sqrt-area ≥ 0.26 |
| 6 | 5 colours, accent used 3× | **1.2** kit + `accent-under-opacity` (the one accent moment composites to 1.50:1) |
| 7 | 63 elements at one x; nothing below y = 0.73 | **1.2** kit framings + **3.3** `bottom-dead` + **4** (delete `layout.md`) |
| 8 | one 61 s scene; `spans()` degenerates | **2.7** sliding window + canonical beats + `skipped` reporting |
| 9 | hook is 0.08 % ink at t = 0.5 s | **2.2** `no-hook` rewritten (relative to the video's own median) |
| 10 | same template ×8 beats, IoU 0.168 | **2.4** `broken-continuity` + **3.4** critic (most-alike-pair) |
| 11 | card renders empty 6.00 s | **2.3** `empty-container` — *and* **3.5**, the renderer z-order test, which may show this is an engine bug |
| 12 | "Different day." occluded, 6 px clearance at t = 18.9 | **3.5** first (settle z-order), then a temporal clearance check scoped to text-vs-opaque-Shape |
| 13 | 9.6 s in stills > 2 s; longest 3.83 s | **3.2** `frozen` via ICGS |
| 14 | panel 34.2 % of canvas at 1.10:1 | **2.1** `dead-plate` |
| 15 | bed = 13 clips, 0 volume keyframes, duck backwards (gaps +1.1 dB) | **2.8** `duck` verb + `audio_probe` + flat-mix clamp + the +6 LU gate |
| 16 | SFX: one asset per family stamped, identical durations | **2.8** partially (`same-sound`: ≥3 placements of one mediaId must differ ≥10 % duration or ≥3 dB). **The root cause was that `sfx_add`/`sfx_list`/`sfx_search`/`sound_add` were absent from the running server — 51 of 55 tools advertised. Fix the build/toolset handshake; this is a packaging bug, not a taste failure.** |
| 17 | 160 move onsets in 61 s — the move count *is* the defect | **1.3** (registry moves cost a named call) + **0.4** (76 of the onsets were caption fades). No direct check; the count is a symptom, and every corpus rule that gates on event density pushes it the *wrong* way. |
| 18 | 0 images, 0 video in 188 elements | **asset-presence floor** (§8 caveat) + `asset_make` — *not in this plan's phases*, deferred; the benchmark does not need it |
| 19 | check returned `ok:true`, 242 warnings, agent acted on 1 | **0.2** envelope + gate, **0.3** budget |
| 20 | **the voice is flat — one register, 6 clips, `volume: 1.15` on all** | **PARTIALLY UNOWNED.** 1.4 fixes rate and cue timing. Per-clip level, pause authoring, emphasis and prosody have **no owner in this plan.** `44-expressive-tts.md` scopes the work; it is deferred, deliberately, and it is the largest named gap left open. |
| 21 | **nothing verifies the video is about the brief** | **UNOWNED, structurally.** See §9.1. |

---

# 11. Effort summary

| phase | items | effort | gates the next phase? |
|---|---|---|---|
| 0 — the ruler | 4 | ~1 day authoring + ~1 day engine | **yes, hard** |
| 1 — delete the arguments | 4 | ~3–4 days engine (1.1 ships alone and first) | yes for type rules |
| 2 — free model checks | 8 | ~3 days engine, ~350 lines of `check.rs` | no |
| 3 — pixels | 5 | ~4 days engine, needs 3.5's GPU test first | no |
| 4 — doctrine | 1 | ~1 day, net **−1,580 lines** | no |

New `Error`-severity codes introduced: **11** of a 14 budget (`dead-plate`, `no-hook`,
`empty-container`, `broken-continuity`, `no-response`, `value-overshoot`, `off-grid`,
`unreadable-dwell`, `frozen`, `anchor-scale`, `bottom-dead`). Three retired
(`front-loaded`, `inert-scene`, `no-accumulation`) — they have never fired on any project we
condemned, on any bucketing.
