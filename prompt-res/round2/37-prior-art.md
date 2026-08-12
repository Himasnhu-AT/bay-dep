# 37 — Prior art: what other tools do, and what is actually worth stealing

Round 2. Read `EVIDENCE.md` first. This file does **not** repeat round 1's survey of the
HyperFrames family (`prompt-res/09`). It looks at professional motion tools, code-driven video
frameworks, template products, design systems, and the published evidence on steering and
judging generative visual output — and asks one question of each finding: *if an agent optimised
for this and nothing else, what would the video look like?*

---

## 0. The finding that reframes everything else

**Round 1 already wrote the move vocabulary.** `references/motion.md:177–338` defines 17 named
moves — RISE, SETTLE, SLIDE, FADE, WIPE, STAGGER, COUNT-UP, GROW, DRAW, PUNCH, HOLD, JITTER,
CUT-THE-CURVE, RECEDE/ARRIVE, KEN BURNS, DISSOLVE, TYPE-ON — each with channels, keys, easings
and durations. It also wrote an easing-allocation table giving all 14 easings a job.

The video that came out: **107 of 119 animated channels are `opacity`**, 104 of those 106 opacity
channels start at 0 (i.e. they are all the same fade-in), the modal move duration is **0.098 s
(3 frames, ×76)**, `hold` is the most-used per-key easing (×130), and `spring-out` — the file's
declared house entrance — appears **4 times in 188 elements**.

Adoption of a prose vocabulary was approximately zero. Adoption of the *counting* rules
("no two independent moves in a scene share an easing", "the slowest move is ~3× the fastest",
`banned-defaults.md:17`) was total and perverse: 19 distinct easings, 47 distinct durations, and
a duration histogram whose mass sits in an unusable bucket.

Every system surveyed below that reliably gets good output from a weak author does the same
thing: **it makes the vocabulary the API and removes the free-form verb.** The measured effect of
doing that is the largest single number in this document — SlidesLib takes LLaMA-8B from 33.5 to
55.0 (+31.0 points) and cuts generated program length from 170 lines to 13
([AutoPresent, arXiv:2501.00912](https://arxiv.org/html/2501.00912v1)). Documented taste moves
nothing. Typed taste moves 31 points.

A second framing, equally load-bearing:

> Professional tools' abstractions split into **freedom amplifiers** (expressions, graph editor,
> time remapping, per-key easing, arbitrary duration floats) and **coherence enforcers**
> (parenting/nulls, precomps, adjustment layers, behaviors, duplicators, state machines, tokens).
> A human with taste is bottlenecked on (a). **An agent that fails from too much freedom needs
> only (b).** Round 1 shipped per-keyframe easing and a 14-curve set — both category (a) — to an
> author whose disease is unconstrained choice. It used the extra freedom to stuff 130 `hold`
> keys.

---

## 1. Professional tools — the abstraction table

| Abstraction | Where | Quality problem it solves | Category | Agent needs it? | bay today |
|---|---|---|---|---|---|
| **Precomp / nested composition** | AE, Motion | a shot is one addressable object with its own timebase; you can move/retime/effect a whole scene as a unit | enforcer | **Yes** — a "scene" that cannot be addressed as a unit is why bay got one 61 s scene | scenes exist but `check()` only reads `active_scene()` (`check.rs:140`) |
| **Parenting + null objects** | AE, Motion | N layers move together and *cannot drift*; a camera push is one keyframe set | enforcer | **Yes** | absent — a push over 12 elements is 12 `animate` calls |
| **Adjustment layer** | AE | one grade/effect over everything below it; 20 clips can't drift into 20 different looks | enforcer | **Yes, weakly** — bay's failure is flatness, not drift | absent |
| **Track matte / traveling matte** | AE | reveal geometry decoupled from the revealed content; matte can be parented to what it mattes | mixed | Low priority | static `mask_set`, not animatable |
| **Graph editor** | AE, Motion | per-keyframe velocity control | **amplifier** | **No — actively harmful** | partially shipped in round 1 (per-key easing) and immediately abused |
| **Expressions** | AE | procedural relationships (`wiggle`, `loopOut`, links) | **amplifier** | **No** — an agent already generates code; it does not need a second scripting layer | absent |
| **Time remapping** | AE | retime, freeze, ramp | amplifier | No, not yet | absent |
| **Behaviors** (preset, already-animated) | Apple Motion | "Sequence Text" + preset classes (Text-Basic / -Continuous / -Energetic / -Glow) where the parameters *arrive pre-animated*; the author picks a behavior, not curves | **enforcer** | **Yes — this is the single most transferable object in the survey** | absent; the 17 moves are prose |
| **Duplicator + Falloff + Behaviours** | Cavalry | "build animation systems instead of stacking layers" — N copies derived from one source, per-item offsets from a falloff, so stagger is *structurally* consistent | enforcer | **Yes** — bay's agent hand-computed offsets for 188 elements and produced 76 three-frame pops | absent |
| **State machine + layers** | Rive | timelines are stateless value containers; a supervisor layer decides what plays and blends | enforcer | Not for linear video | n/a |
| **Artboard** | Rive | self-contained, reusable, each with its own logic | enforcer | Yes — same idea as a shot template | thin (`templates.rs`) |

**Apple Motion's Sequence Text is the model to copy.** Its `Add` menu enumerates the channels a
text sequence may touch — Position, Opacity, Scale, Rotation, Tracking, Baseline, Slant,
Character Offset — and the *preset* behaviors ship with those parameters already keyframed. The
author's decision is "which behavior", not "which curve over which milliseconds". That is
exactly the decision we want bay's agent making.
([Apple: preset text behaviors](https://support.apple.com/guide/motion/preset-text-behaviors-motn96989825/mac),
[Sequence Text controls](https://support.apple.com/guide/motion/sequence-text-behavior-controls-motn1607df2b/mac))

**Cavalry's framing is the sentence to put in the skill**: you build a *system*, not a stack.
([School of Motion](https://schoolofmotion.com/blog/getting-started-with-cavalry-5-things-every-beginner-should-know),
[Cavalry Duplicator docs](https://cavalry.studio/docs/nodes/shapes/duplicator/))

---

## 2. Code-driven video — the unit of composition

| System | Unit of composition | How time is expressed | What it makes impossible | Steal |
|---|---|---|---|---|
| **Remotion** | a React component | `useCurrentFrame()`; every frame is a pure function of the frame number | non-determinism (`Math.random` banned; seeded `random()` required); `<Series>` blocks declare *durations*, the container computes starts; `<TransitionSeries>` overlaps neighbours and **shortens total duration** | **the Series contract**: a block declares a duration, never a start |
| **Motion Canvas** | a generator function; `yield` = "this frame is ready" | position in the program *is* the time; `all/any/chain/sequence/loop/waitFor/delay` | accidental simultaneity; unreadable absolute-time arithmetic | `sequence(delay, ...)` = the stagger primitive; **no absolute `start` in the authoring surface** |
| **Manim** | a `Mobject` — a persistent object with identity and submobject structure | `self.play(Animation(mobject), run_time=…)` | animating a thing that does not exist as an object | **correspondence transforms** — see §2b |
| **Revideo** | a Motion Canvas scene parameterised by props, rendered headless | same as MC | drift between "the design" and "this instance" | one shot definition, many data fills — the template contract |

Remotion's published LLM system prompt is worth noting for what is *absent*: it is 100%
mechanics — ban `Math.random`, use seeded `random()`, default `extrapolateLeft/Right: 'clamp'`,
fps 30, 1920×1080, `AbsoluteFill` for stacking, `Series`/`TransitionSeries` for sequencing,
`spring()` has no fixed duration. **Zero lines of taste.** The leading code-video framework does
not attempt to encode design judgement in prose to a model; it constrains the API and lets
components carry the design. ([remotion.dev/llms.txt](https://www.remotion.dev/llms.txt),
[docs/ai/system-prompt](https://www.remotion.dev/docs/ai/system-prompt))

### 2b. The Manim principle, extracted precisely — and it is the formula video

Manim distinguishes three things that bay collapses into one:

| Manim animation | Mechanism | When correct |
|---|---|---|
| `Transform(a, b)` | interpolates a's **points/paths** into b's; `a` survives, holding b's data | the two states share structure |
| `ReplacementTransform(a, b)` | same interpolation, but `b` replaces `a` in the scene graph | same, when identity should transfer |
| `TransformMatchingTex(a, b)` | **matches submobjects whose `tex_string` is equal**, transforms the matched pairs, and transforms-or-fades only the *mismatches*; `key_map` declares correspondences the string match misses | two formulas that share tokens |
| `FadeTransform(a, b)` | cross-fade | **only when there is no correspondence at all** |

([Manim: TransformMatchingTex](https://docs.manim.community/en/stable/reference/manim.animation.transform_matching_parts.TransformMatchingTex.html),
[transform module](https://docs.manim.community/en/stable/reference/manim.animation.transform.html))

**The doctrine in one line: when two states share structure, animate the correspondence; cross-fade
only what has no counterpart.** A cross-fade between two states that share most of their content
asserts "these are two unrelated pictures." That assertion is false, and wicks-v2 makes it 107
times.

This is implementable in bay **today**, with no new primitive:

1. A formula/label/list is N text elements, one per token — never one string.
2. Between state *i* and *i+1*, take the LCS of the token lists.
3. **Common tokens keep their element id** and get `x`/`y` channels from old position to new.
4. Removed tokens exit; added tokens enter. Only these two sets use opacity.
5. Ship it as a tool — `transform_matching(fromIds[], toTokens[], duration, easing)` — because
   as prose it will be ignored exactly as the 17 moves were.

**Why it is Goodhart-resistant:** the check is *element identity across a transition*, which is a
fact in the project file. "Two consecutive states share ≥1 token ⇒ those tokens must be the same
element ids." An agent cannot fake it by adding keyframes; the only way to pass is to actually
carry the element through. It also **inverts round 1's element-count metric**: the fix here
*reduces* element count. The 188 elements are not a success — they are 8 beats rebuilt from
scratch instead of transformed.

---

## 3. Template systems — the shape of a template for an agent

| Product | Fixed by the template | Filled by the user | Constraint on the fill |
|---|---|---|---|
| **CapCut templates** | per-segment duration **and total length**; all filters, motion graphics and audio | marked-replaceable clips only | **max duration per slot, media-type restriction (e.g. "image only")**; you cannot drag the timeline longer or reallocate a segment's time |
| **Canva brand kit / Magic Design** | layout, type roles, spacing | copy, images, brand colours/fonts | palette and font set come from the kit, not free choice |
| **Opus Clip** | one layout family (vertical, subject-tracked, caption band); caption preset as a CSS preset at team level | source video, words | platform aspect enforced; "constrained JSON output fields with platform-specific tone constraints proved more effective than freeform instructions" |

([CapCut: replaceable material clips](https://www.capcut.com/help/how-to-set-replaceable-material-clips),
[OpusClip preset templates](https://www.futurepedia.io/courses/opus-clip-ai/lessons/preset-templates))

**bay's templates today** (`rust/crates/bay-project/src/templates.rs`):

| Property | State | Line |
|---|---|---|
| built-ins | 3 — `lower-third`, `kicker`, `end-card` | `:161, :220, :260` |
| motion | **none** — every template element is `animations: Default::default()` | `:123, :146` |
| slots | `text_slots: Vec<String>`, filled by ordinal | `:39, :71` |
| slot constraints | none — no max chars, no media kind, no required flag | — |
| duration | derived from the elements; no declared range | `:44` |
| style | none; hardcoded `#ffffff`, weight 700 | `:127, :158` |
| stated design intent | *"Deliberately few and deliberately plain. A template that imposes a strong look is one people have to undo"* | `:154–156` |

**That comment is right for a human and exactly backwards for an agent.** A human's cost is
undoing a look. An agent's cost is not having one. The template layer is where the look must
live, because it is the only layer the agent cannot dilute.

The shot contract that follows:

| Field | Owner | Enforcement |
|---|---|---|
| `duration_range: (min,max)` | template | `template_place` rejects outside it |
| slot roles (`bg`, `kicker`, `display`, `support`, `accent`, `media`) | template | fixed set |
| slot position, size, anchor | template | not exposed |
| slot motion (named move + offset) | template | not exposed |
| type role → family/weight/size/tracking | style tokens | not exposed |
| words per text slot | **agent** | `max_chars` enforced at instantiate; over-length is an error, not a wrap |
| media per media slot | **agent** | `media_kind` + `min_px` + aspect enforced |
| accent colour | **agent** | must be a palette token |
| which shot | **agent** | from a library of ≥12 |

The Goodhart test: an agent that picks shots at random still produces a *designed* video, because
every shot in the library was designed. **The floor of a constrained space is far above the floor
of a free space.** That is the entire argument for templates, and it is the only mechanism in
this document that raises the floor without depending on the agent's judgement at all.

---

## 4. Design tokens — how to make 34px-Menlo unrepresentable rather than discouraged

Design systems do not prevent bad work with documentation. They prevent it with **three tiers and
a lint**: primitive → semantic → component, referenced in one direction only (a component may
never reference a primitive), with the semantic layer as the insulation. The build fails on a raw
hex. ([Token tiers](https://honcho.agency/design-systems/glossary/token-tiers),
[Contentful](https://www.contentful.com/blog/design-token-system/))

**Material 3 proves motion is tokenisable**, with exact values:

| Duration token | ms | | Easing token | cubic-bezier |
|---|---:|---|---|---|
| `short1`–`short4` | 50 / 100 / 150 / 200 | | `emphasized` | 0.2, 0, 0, 1 |
| `medium1`–`medium4` | 250 / 300 / 350 / 400 | | `emphasized-decelerate` | 0.05, 0.7, 0.1, 1 |
| `long1`–`long4` | 450 / 500 / 550 / 600 | | `emphasized-accelerate` | 0.3, 0, 0.8, 0.15 |
| | | | `standard` / `-decelerate` / `-accelerate` | 0.2,0,0,1 / 0,0,0,1 / 0.3,0,1,1 |

([m3.material.io easing-and-duration tokens](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs),
[material-components-android Motion.md](https://github.com/material-components/material-components-android/blob/master/docs/theming/Motion.md))

**The point is not the numbers. The point is that 98 ms does not exist in the system.** 76 moves
at 0.098 s were only possible because duration is an `f64` on the wire. Material's *longest*
token is 600 ms; bay produced both 98 ms and 11.7 s moves in one project.

### What a bay token block would contain, and what it kills

| Token family | Shape | Measured failure it makes unrepresentable |
|---|---|---|
| **type** | 6 roles (`display`, `headline`, `subhead`, `body`, `label`, `kicker`) → {family, weight, size, tracking, case}; adjacent ratio ≥ 1.35; `display / median ≥ 4.0` | wicks-v2 max/median = **2.82×** (96 / 34 over 73 text elements); 41 elements at exactly 34 px |
| **family roles** | `mono` is reachable only via roles `figure`, `ticker`, `code`, `kicker`; forbidden for `display`/`body` | **Menlo ×69 of 73.** Note the current skill *recommends* it — `layout.md`: "Helvetica Neue + Menlo is a solid default pair", "mono for every figure, label, ticker and formula" |
| **weight** | each role pins a weight; ≥2 distinct weights required per project | every element `fontWeight: 400` |
| **palette** | `ground`, `surface`, `line`, `ink-{primary,secondary,muted}`, `accent`; accent capped at ≤1 element per shot; `surface` and `line` **required** to be used | 5 colours, one used 48×, one accent used 3× in 61 s, no surface, no texture |
| **space** | 6-column grid; x snaps to a column; 8-step vertical scale | 63 of 187 elements at x ∈ {0.08, 0.09} — **one column** |
| **motion** | 6 duration tokens (e.g. 0.18 / 0.28 / 0.42 / 0.60 / 0.90 / 2.40 s) × 6 easing tokens with declared jobs; `animate` takes a **token name**, not a float | 0.098 s ×76; 11.7 s singleton; `hold` ×130 |

Then `check` **errors** (not warns) on `off-token-color`, `off-token-size`, `off-token-duration`,
`off-token-family`. This is the design-system lint, transplanted. The agent's remaining freedom is
*which token per element* — which is the design decision we want it making, and the only one.

**Why floors failed and ratios will not.** `layout.md` says "Hero figures must be ≥200px on
screen" and `check` has `small-text` at 2.2% of canvas height. Result: max font 96 px, 41
elements at the same 34 px. **A floor is a target.** A *ratio between roles* cannot be satisfied
by clustering, and cannot be satisfied by shrinking the caption because the caption's size is a
token.

---

## 5. How AI systems encode taste — what works, what fails, measured

| Technique | Evidence | Verdict | bay-specific reading |
|---|---|---|---|
| **Constrained verb library** | SlidesLib: LLaMA-8B 33.5 → 55.0 (**+31.0**), LLaVA-7B +9.7, GPT-4o +2–3; program length **170 → 13 lines** ([arXiv:2501.00912](https://arxiv.org/html/2501.00912v1)) | **Works — largest measured effect available** | `apply_move` / `place_shot` / role-typed `add_text`. Note the gradient: the weaker the author *on that axis*, the bigger the gain. Our agent is strong at reasoning, weak at taste — it is the LLaMA-8B of design |
| **Prohibitions / banned lists** | Negated prompts show **inverse scaling** — larger models get *worse* at instructions containing negation ([NeQA / Inverse Scaling, arXiv:2306.09479](https://arxiv.org/html/2306.09479v1); [arXiv:2209.12711](https://arxiv.org/pdf/2209.12711); [not naysayers, arXiv:2306.08189](https://arxiv.org/pdf/2306.08189)) | **Fails as a primary mechanism** | `banned-defaults.md` bans 18 fonts by name; the agent used Menlo — which the *same repo* recommends. A blocklist leaves an infinite allowed set; the model takes the nearest sanctioned item. Useful only as a tiebreak *inside an already-closed set* |
| **Numeric floors** | in-repo | **Fails — floors become targets** | ≥200 px demanded, 96 px delivered; 2.2% floor, 41 elements just above it |
| **Diversity counts** | in-repo | **Fails — count ≠ distribution** | 47 distinct durations, modal duration 3 frames; 19 easings, `hold` ×130 |
| **Decision tables / named vocabulary in prose** | in-repo | **Fails unless it is the API** | 17 named moves, 0 measurable adoption; the easing table produced diversity-gaming |
| **Worked examples** | in-repo | **Works, and is dangerous** | `recipes.md:32` — "Every text reveal in a good reel is this" — produced one motion behaviour across three videos. Examples are copied verbatim. Ship ≥5 or none; never one canonical |
| **Adjectives / encouragement** | — | **No measurable effect** | unfalsifiable, unmeasurable, and it costs context |
| **Mechanics-only prompts + design in components** | Remotion's shipped LLM prompt | **The industry default** | constrain the API; put taste in the template library |

---

## 6. The critique loop — why bay's does nothing, and what would change that

Four published results that jointly determine the design:

1. **Intrinsic self-correction does not work.** Without external feedback, LLMs fail to judge
   the correctness of their own prior output and performance often *degrades* after a
   self-correction pass ([Huang et al., ICLR'24, arXiv:2310.01798](https://arxiv.org/abs/2310.01798);
   survey: [Kamoi et al., TACL 2024](https://arxiv.org/html/2406.01297v3)).
   **`SKILL.md` step 9 — "snapshot and actually look at the PNG" — is precisely this failing
   configuration.** wicks-v2 was snapshotted and shipped.
2. **VLM judges rank reliably and score unreliably.** Conformal interval widths of 2.08–3.50 on a
   4-point scale (52–88% of the range); ChartQA reaches Pearson 0.507 while producing 3.08-wide
   intervals. Recommendation: where intervals are wide, **use pairwise comparison, not absolute
   scores** ([arXiv:2604.25235](https://arxiv.org/html/2604.25235)).
3. **Rubric decomposition beats holistic judging.** PresentBench: ~54.1 **binary** checklist items
   per instance; agreement with human preference Spearman **0.532**, versus 0.303 for an
   MLLM-as-judge baseline and 0.258 for MLLM ranking, against a human ceiling of 0.664
   ([arXiv:2603.07244](https://arxiv.org/html/2603.07244v1)). SlidesBench's reference-free design
   axes (text / image / layout / colour, 0–5) reached 73.8–85.3% agreement with human raters.
4. **Closed-loop visual refinement helps.** UI-to-code reframed as execute → visually inspect →
   refine improves monotonically with iterations ([arXiv:2511.08195](https://arxiv.org/abs/2511.08195)).

### The loop bay should run

| Rule | Why | Implementation |
|---|---|---|
| **Never ask "is this good?"** | (2),(3) — holistic scores are the least reliable operation | ~15 **binary** items per contact sheet, each with a stable finding code |
| **Compute every item that is computable; ask the VLM only the semantic remainder** | a judge that can be argued with will be | contrast-in-place, largest empty band, type ratio, motion mass, frame-hash equality → engine. "Does the hook state a claim?" → VLM |
| **Force a comparison, not a score** | (2) | show the sheet **and a reference sheet**, ask "A or B better on <axis>" for 5 axes |
| **One contact sheet, not N stills** | rhythm is invisible one frame at a time | `contact_sheet(times[], columns) → one PNG`. wicks-v2's "same frame 5 s apart" is instantly visible in a 4×4 grid |
| **Every look must produce a diff** | (1) — a look with no obligation is a no-op | session state: `render` refuses if the last `snapshot`/`contact_sheet` was not followed by ≥1 mutating call |
| **The judge must not hold the build plan** | otherwise the model defends its plan | separate critique call with the brief + sheet only, not the tool history |

**Unfakeable primitive worth building first:** perceptual frame hashing. Sample every 0.5 s, hash,
and fire `frozen-scene` on equal consecutive hashes. EVIDENCE §9 reports several sample pairs
5 s apart with identical content; a hash makes that a hard fact, not a judgement, and there is no
way to game it except by making the picture change.

---

## 7. The five mechanisms most worth adopting, ranked by quality-per-unit-work

### 1. Move library as the API — `apply_move` (steal: SlidesLib, Motion behaviors, Cavalry)

**Effort M.** `bay-project/src/moves.rs` encodes the 17 moves already written at
`motion.md:177–338` as *data*: channels, key values, easing token, duration token, direction
parameter. MCP verb `apply_move(elementId, move, at, {direction, distance, duration})`.
`animate` survives for genuine one-offs but `check` emits `off-vocabulary-motion` for any channel
not byte-identical to a vocabulary instantiation.

Kills: 3-frame pops, 90%-opacity animation, `hold`-stuffing, easing roulette — all four become
*unrepresentable*, not merely detected. Replaces round 1's diversity counters with one metric that
cannot be gamed by sprinkling: **≥90% of animated elements' channels reproduce a vocabulary move
exactly**, and **the vocabulary usage histogram has ≥4 moves each ≥10%**.

### 2. Style tokens + role-typed constructors (steal: design systems, Material motion tokens)

**Effort S–M.** `StyleTokens` on `Project.settings` (type roles, palette, space scale, motion
tokens); `add_text(role:)` / `add_shape(role:)` / `apply_move(duration: token)`. `check` errors on
off-token colour, size, family, duration. Ships with 4–6 named style sets so choosing one is a
single decision.

Kills: 34 px Menlo everywhere, monochrome palette, single-column layout, 2.82× type ratio, 98 ms
durations. The agent's remaining choice is which role — which is the decision worth having.

### 3. Shot templates with typed slots and owned motion (steal: CapCut)

**Effort M.** Extend `templates.rs`: `Slot { role, kind: Text{max_chars} | Media{kind,min_px,aspect} | Number, required }`,
`duration_range`, and elements that **carry moves**. Ship 12–16 shots. `template_place` fails on an
unfilled required slot or over-length text rather than wrapping silently. A `shot` is also the
scene container — with a max duration, which makes "one 61-second scene" impossible and repairs
the fact that `check()` degenerates to nothing on a one-scene project.

Kills: 8 identical beats, the empty bottom half (composition is the template's, not the agent's),
one-scene degeneration.

### 4. Correspondence transforms — `transform_matching` (steal: Manim)

**Effort S–M, pure project-model work, no new primitive.** Token-level LCS between two states;
shared tokens keep their element ids and animate position; only the diff fades. The check is
element identity across a transition and is unfakeable.

Kills: the cross-fade lie; unblocks the formula video specifically; reduces element count, which
correctly inverts round 1's incentive.

### 5. Contact sheet + binary rubric + mandatory diff (steal: PresentBench, VLM-judge literature)

**Effort S for `contact_sheet` + `frame_hash`, M for the rubric.** One grid image; ~15 binary
items of which the computable ones are computed in Rust and only the semantic remainder is asked
of the model; forced A/B against a reference sheet rather than a 1–10 score; `render` blocked
unless the last look produced an edit.

Kills: shipping a video whose defects were visible in frames the agent already generated.

**Explicitly not recommended:** expressions, a graph editor, time remapping, more easing curves,
more keyframe granularity. Every one is a freedom amplifier, and round 1 demonstrated what this
author does with freedom.

---

## 8. Anti-Goodhart appendix — the test every new rule must pass

**Cheapest-fix alignment: a rule is only worth adding if the cheapest way to satisfy it is the
design decision you wanted.** Round 1's rules fail this test — the cheapest way to get 19 distinct
easings is to sprinkle easings; the cheapest way to get 47 distinct durations is to jitter floats;
the cheapest way to get 188 elements is to rebuild the same beat 8 times.

| Proposed rule | Cheapest way to satisfy it | Aligned? |
|---|---|---|
| ≥90% of channels reproduce a vocabulary move | call `apply_move` | **Yes** — the cheap path is the correct path |
| ≥4 moves each ≥10% of usage | use four designed moves | **Yes** |
| all durations are tokens | pass a token name | **Yes** — floats are rejected at the type boundary |
| `display / median` type ratio ≥ 4.0 | make one thing big | **Yes** — and shrinking captions is blocked by the token set |
| ≥2 distinct font weights, mono ≤ 25% of text elements | pick a display face | **Yes** |
| largest empty horizontal band ≤ 22% of frame height (measured on ink, from frames) | put something in the empty band | **Yes** — the cheap fix is a footer rule, panel or accent, which improves the frame. Compare `layout.md`'s "last element around y≈1400", which was satisfied by one small caption at y=0.73 while the frame stayed empty |
| no two sampled frames 0.5 s apart share a perceptual hash | make the picture change | **Yes** — no cheap fake exists |
| shared tokens across a state change keep their element ids | use `transform_matching` | **Yes** |
| shot ids: none exceeds 40% of runtime | use a second shot type | **Yes** — random selection from a designed library still yields designed frames |
| `render` blocked unless the last look produced an edit | make one edit | **Weak** — gameable by a trivial edit. Mitigate by requiring the edit to touch an element named in a finding |

---

## Sources

Manim: [transform module](https://docs.manim.community/en/stable/reference/manim.animation.transform.html) ·
[TransformMatchingTex](https://docs.manim.community/en/stable/reference/manim.animation.transform_matching_parts.TransformMatchingTex.html) ·
[FadeTransform](https://docs.manim.community/en/stable/reference/manim.animation.transform.FadeTransform.html) ·
Motion Canvas: [animation flow](https://github.com/motion-canvas/motion-canvas/blob/main/packages/docs/docs/getting-started/flow.mdx) ·
Remotion: [llms.txt](https://www.remotion.dev/llms.txt) · [system prompt](https://www.remotion.dev/docs/ai/system-prompt) · [TransitionSeries](https://www.remotion.dev/docs/transitions/transitionseries) ·
Apple Motion: [preset text behaviors](https://support.apple.com/guide/motion/preset-text-behaviors-motn96989825/mac) · [Sequence Text controls](https://support.apple.com/guide/motion/sequence-text-behavior-controls-motn1607df2b/mac) ·
After Effects: [track mattes](https://helpx.adobe.com/after-effects/using/track-mattes-and-traveling-mattes.html) · [null controllers](https://helpx.adobe.com/nz/after-effects/desktop/drawing-painting-and-paths/null-controllers/create-nulls-for-positional-properties-and-paths.html) ·
Cavalry: [Duplicator](https://cavalry.studio/docs/nodes/shapes/duplicator/) · [5 things](https://schoolofmotion.com/blog/getting-started-with-cavalry-5-things-every-beginner-should-know) ·
Rive: [state machines](https://rive.app/blog/how-state-machines-work-in-rive) ·
CapCut: [replaceable clips](https://www.capcut.com/help/how-to-set-replaceable-material-clips) ·
OpusClip: [preset templates](https://www.futurepedia.io/courses/opus-clip-ai/lessons/preset-templates) ·
Tokens: [tiers](https://honcho.agency/design-systems/glossary/token-tiers) · [Material 3 motion tokens](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs) · [material-components-android](https://github.com/material-components/material-components-android/blob/master/docs/theming/Motion.md) ·
Papers: [AutoPresent/SlidesLib 2501.00912](https://arxiv.org/html/2501.00912v1) · [PresentBench 2603.07244](https://arxiv.org/html/2603.07244v1) · [VLM judges rank not score 2604.25235](https://arxiv.org/html/2604.25235) · [LLMs cannot self-correct 2310.01798](https://arxiv.org/abs/2310.01798) · [self-correction survey 2406.01297](https://arxiv.org/html/2406.01297v3) · [inverse scaling 2306.09479](https://arxiv.org/html/2306.09479v1) · [negated prompts 2209.12711](https://arxiv.org/pdf/2209.12711) · [UI2Code^N 2511.08195](https://arxiv.org/abs/2511.08195)

In-repo measurements taken 2026-08-12 from
`~/Library/Application Support/vii/projects/project-1786466680050.json`:
187 elements, 73 text, fontSize max 96 / median 34 (ratio 2.82), animated channels
`{opacity: 106, x: 19, y: 17, scale: 11, scaleY: 10, scaleX: 8}`, 104/106 opacity channels
starting at 0, 36 positional channels with **median travel 0.0241 of the canvas (≈26 px on 1080)**
and max 0.213.
