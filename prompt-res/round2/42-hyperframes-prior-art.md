> **Historical:** describes the Rust engine, deleted; recover what it cites with `git show rust-engine-final:dep/rust/<path>` (e.g. `crates/bay-mcp/src/tools.rs`).

# Hyperframes as prior art

> **PART I — VERDICT (written second, read first).** Part II was written on the assumption that
> hyperframes is authoritative. That assumption was not established, and Part I tests it by
> measurement. **Part II is not retracted, but every claim in it that begins "hyperframes says"
> should be read through Part I's Section V, which states which of its eight recommendations
> survive and at what line budget.** Where Part I and Part II disagree, Part I wins.

---

# PART I — Is hyperframes actually good?

## 0. The verdict in five sentences

**It is real craft with absent verification — not slop, and not evidence.** There are zero rendered
frames, zero MP4s, and zero tests asserting a visual property anywhere in 24,300 lines; the only
grounding is 13 runnable HTML compositions (9,124 lines) that back 11 of 22 blueprints, and one of
them verifiably implements a discipline a fade-machine author would not produce by accident.
The load-bearing claim — *"reverse-engineered from 178 golden product-launch clips"* — appears
**exactly once in the entire family and resolves to nothing**, though the provenance structure
around it is internally stratified in a way that is detectable by measurement and that a
fabricator would not bother to produce. The taste layer is 26–85% unfalsifiable prose, the 22
blueprints reduce to about **5 distinct motion grammars**, and the "24 named text effects" is a
4×6 cross-product borrowed from a third party.
**Of 24,300 lines, roughly 700 survive as content bay should carry — about 3% — and most of what
survives is *format and mechanism*, not taste.** bay must derive its own taste content from the two
good teardowns it actually has; importing hyperframes' would be importing an unverified aesthetic
on someone else's authority, which is the exact failure mode of round 1.

---

## I. The provenance claim, tested

### The number resolves to nothing

```
$ grep -rn "178" ~/.claude/skills/hyperframes*
hyperframes-animation/blueprints-index.md:5:  ...reverse-engineered from 178 golden
                                              product-launch clips across two mining rounds...
```

One hit, in one sentence, in one file. There is no clip list, no manifest, no timestamps, no
per-clip measurements, no source URLs. The index itself routes the evidence off-artifact:

> Variant provenance (`from <shape-name>`) names the mined golden shape a variant was
> reverse-engineered from; **the case-level golden map lives with the c2v-bench mining reports
> (maintainers only — consuming agents need only the shape names).**

That is an unfalsifiable citation: the evidence is asserted to exist, elsewhere, for someone else.
**Treat "178 clips" as unverified.** My earlier draft repeated it as fact; that was credulous.

### The shape names are 84% self-referential

88 `(from <shape-name>)` tags across 22 blueprints, 84 distinct names. Testing whether each name
resolves anywhere outside the file citing it:

| | count |
|---|---:|
| Distinct mined-shape names cited | **84** |
| That appear in exactly one file (the blueprint citing them) | **71** |
| That have a runnable `examples/*.html` of the same name | **13** |
| Blueprints with ≥1 backing example | **11 of 22** |
| Blueprints carrying an external case ID (`001_claudeai`, `CSS_39.0`, `071_bolt`) | **4 of 22** |

So 71 of 84 "mined shapes" are names that point at themselves. That is the vocabulary-inflation
tell: **naming a thing is being used as evidence that the thing was observed.**

### But the provenance *structure* survives a fingerprint test — and that matters

`blueprints-index.md` claims a specific stratification:

> Five shapes — `comparison-split`, `overwhelm-surround`, `ticker-takeover`, `video-text-pivot`,
> `cta-morph-press` — were added from the hyperframes-animation blueprints; seven more —
> `prompt-type-submit-generate`, `agent-progress-theater`, `panel-edit-live-sync`,
> `camera-journey`, `transcript-scroll-artifact-reveal`, `zoom-out-workspace-reveal`,
> `fixed-anchor-cycle` — were mined from the golden-clip corpus.

I tested this against a signal the prose never mentions: **decimal precision in the `duration`
field.** Measured durations carry decimals and per-case breakdowns; asserted ones are round.

| Group | Durations observed |
|---|---|
| The 5 "added from existing blueprints" | `4–6s`, `6–9s`, `5–7s`, `6–8s`, `4–6s` — **all integer, no breakdown** |
| The 7 "mined from the corpus" | `5.6–11.1s (001 5.6s · 066 8.6s · 004 9.0s)`, `5–11.8s (feed-rush 5.4s · pan-to-workspace 5.0s · selection-pivot 9.3s)`, `5.3–11.9s`, `4.2–11.6s` — **decimal, per-case** |

The split is exact, and it is corroborated a third way: **all 5 of the "added from existing
blueprints" group have a backing `examples/*.html`**, and the 4 blueprints carrying external case
IDs are all in the "mined" group. `titlecard-reveal` even writes `~5s / observed 4.7s`.

A generator producing confident filler does not encode a three-way-consistent provenance
stratification detectable only by counting decimal places. **The mining process was real. Its
scale is unverified.** Those are different claims and my Part II conflated them.

### One blueprint traced to its source, line by line

The strongest available test: does `comparison-split.md` actually abstract
`examples/comparison-split-cards.html` (649 lines), or was the example generated from the blueprint?

```js
const TIMING = {
  titleAt: 0.17,  titleDur: 0.67,                       // blueprint: "Scene 1 (0.0–~0.8s)"  → 0.84 ✓
  leftAt: 0.5,    rightAt: 0.83,  entryDur: 0.7,        // blueprint: "right ~0.2s behind"   → 0.33 ✗
  baseTilt: 18,   slideDist: 100,
  badgeLeftAt: 1.67, badgeRightAt: 2.0, badgeEntryDur: 0.5,  // "~0.3s apart" → 0.33 ✓ ; "Scene 3 ~1.9s" → 1.67 ✗
  floatYSpeed: 0.02*30, floatYAmp: 6, floatRSpeed: 0.015*30, floatRAmp: 1,
};
const lY = Math.sin(t * TIMING.floatYSpeed) * TIMING.floatYAmp;
const rY = Math.sin(t * TIMING.floatYSpeed + Math.PI) * TIMING.floatYAmp;   // blueprint: "left sin(t), right sin(t+π)" ✓
gsap.set(leftTilt,  { rotationY:  TIMING.baseTilt + lR });
gsap.set(rightTilt, { rotationY: -TIMING.baseTilt + rR });                  // blueprint: "+tilt left, −tilt right" ✓
```

And the blueprint's sharpest claim — *"This is the lone overshoot in the shot — it earns the
punctuation"* — checks out mechanically:

```
$ grep -oE 'ease: *"[^"]*"' comparison-split-cards.html | sort | uniq -c
   2 ease: "back.out(1.7)"     ← the two badges, and nothing else
   1 ease: "none"
   3 ease: "power3.out"
```

**Verdict on this blueprint: the mechanism is real and faithfully abstracted; the scene time codes
have drifted 0.2–0.3s from the artifact.** Trust hyperframes' *shapes*; re-derive its *numbers*.

Two side-findings from the same file. First, it contradicts hyperframes' own doctrine: three
independent tweens share `power3.out`, against `motion-principles.md`'s *"no more than 2
independent tweens with the same ease in a scene"* — and the file is the better artifact, because
3 eases used deliberately beats 19 used to satisfy a counter. **The prose rule is the weaker
thing.** Second, note what this example is: **authored input, not verified output.** Nobody has
shown that rendering it produces a good video.

---

## II. Is there any evidence it produces good video?

**No.** This is the cleanest result in the audit.

```
$ find ~/.claude/skills/hyperframes* -iregex '.*\.\(png\|jpg\|mp4\|webm\|gif\)$' | wc -l
0
```

Zero rendered frames. Zero videos. Zero golden images. Zero visual regression fixtures.

Four `.test.mjs` files exist. Here is everything they assert:

| File | Assertions |
|---|---|
| `package-loader.test.mjs` ×2 (byte-identical copies) | env override wins · in-repo version pins · unresolvable falls back to `@latest` |
| `animation-map-sampling.test.mjs` | "samples every tween time in one browser evaluation" |
| `animation-map.test.mjs` (288 lines) | package-loader parity · transient-init retry · "prefers the producer" |

**Not one test asserts a visual property.** They test npm resolution and browser-session plumbing.
The `check` CLI does audit contrast, layout and motion at runtime — but that is a tool shipped
*alongside* the guidance, and nothing in the artifact demonstrates the guidance passing it.

The comparison that matters: **bay's skill was also comprehensive, internally consistent,
cross-referenced, and confident — and produced a fade machine in Menlo.** Hyperframes is in the
same epistemic position, one layer better only because 13 runnable compositions exist. Volume,
internal consistency, and cross-referencing are not evidence. They are what generated prose looks
like when it is good at looking like prose.

---

## III. Slop-lens measurements

### III.1 Numbers vs adjectives — with bay as the control

Numeric units (`Ns`, `Npx`, `Nms`, `N%`, `Nem`, `Ndeg`) per 100 lines:

| Corpus | Lines | Units | per 100L |
|---|---:|---:|---:|
| `hyperframes-animation/blueprints` | 1,443 | 207 | **14.3** |
| `hyperframes-creative/references` | 1,813 | 215 | **11.8** |
| `hyperframes-animation/rules` | 6,213 | 323 | **5.2** |
| **bay's entire skill (control)** | **2,187** | **110** | **5.0** |
| `hyperframes-core/references` | 1,618 | 32 | 2.0 |
| `hyperframes/references` | 212 | 0 | **0.0** |

Two honest readings. Hyperframes' **taste layer is 2.4× more numeric than bay's whole skill** —
that is a real difference and it is the part worth taking. But its **rules layer is exactly as
numeric as bay's** (5.2 vs 5.0), so "hyperframes is more rigorous than bay" is false as a general
claim. And its router layer is *zero* numbers in 212 lines — pure procedural prose.

Structural rigour in `rules/` is genuinely high:

| | count |
|---|---:|
| Rules with a `## Values` token/range table | **44 / 48** |
| Rules with `## Critical Constraints` | 44 / 48 |
| Rules with runnable `js` code | **48 / 48** |
| Rules with an `## Anti-patterns` Don't/Instead table | **2 / 48** |

44/48 carrying a range table with stated consequences is the single best structural signal in the
family. The 4 without (`css-marker-patterns`, `gsap-effects`, `nudge-curve`, `waterfall-entry`)
inline their numbers instead — `nudge-curve` is 47 lines and almost pure arithmetic.

### III.2 Unfalsifiable advice

Bullet directives carrying no number (digit or spelled), no code token, and no mechanical predicate
(`never` / `no` / `only` / `every` / `must`):

| File | Bullets | Soft | % soft |
|---|---:|---:|---:|
| `beat-direction.md` | 28 | 24 | **85%** |
| `house-style.md` | 17 | 11 | 64% |
| `typography.md` | 24 | 11 | 45% |
| `video-composition.md` | 15 | 6 | 40% |
| `story-spine.md` | 5 | 2 | 40% |
| `motion-principles.md` | 41 | 11 | **26%** |
| `data-in-motion.md` | 5 | 0 | **0%** |

`beat-direction.md` at 85% is the family's worst file and I over-credited it in Part II. Its
mediocre-vs-great example is genuinely good writing, and its motion-verb vocabulary is a real
authoring aid — but *"Each beat is a WORLD, not a layout"*, *"describe what the viewer
EXPERIENCES"*, and *"if you can't name the verb, the element is not yet designed"* cannot fail.
They steer nothing an agent wasn't already going to do, and an agent will happily emit a verb per
element and still ship 76 three-frame pops. **This is the file bay should copy least and it is the
one whose format is most tempting.**

`motion-principles.md` at 26% and `data-in-motion.md` at 0% are the opposite: nearly every line is
a number or a mechanical prohibition. Those are the two files worth reading closely.

### III.3 The 22 blueprints reduce to ~5 motion grammars

21 of 22 share an identical field skeleton (`intent · roles served · duration · shot structure ·
motion vocabulary · rule mapping · camera modifier`); only `panel-edit-live-sync` (+provenance,
+signature move), `titlecard-reveal` (+stillness note) and `camera-journey` (camera *grammar*)
deviate. Field identity is fine — that is what a template is. The real test is the engine and the
camera law. Clustering on those:

| Grammar | Blueprints | n |
|---|---|---:|
| **A · Serial replacement** — one thing at a time in a fixed slot | `kinetic-type-beats`, `ticker-takeover`, `fixed-anchor-cycle`, `typewriter-reveal`, `titlecard-reveal` | 5 |
| **B · Parallel assembly** — N items arrive into a layout and hold | `grid-card-assemble`, `constellation-hub`, `comparison-split`, `overwhelm-surround` | 4 |
| **C · Same-center morph** — A becomes B at one anchor | `cta-morph-press`, `logo-assemble-lockup`, `video-text-pivot` | 3 |
| **D · Camera traversal** — the frame moves through a world | `spatial-pan-stations`, `camera-journey`, `zoom-out-workspace-reveal`, `dataviz-countup`, `transcript-scroll-artifact-reveal` | 5 |
| **E · UI performs** — a reconstructed product surface changes state | `cursor-ui-demo`, `device-surface-showcase`, `panel-edit-live-sync`, `prompt-type-submit-generate`, `agent-progress-theater` | 5 |

**5 grammars, 22 files.** Group D is the honourable exception: its five members carry genuinely
different *camera laws* (repeated pans / multi-leg motivated legs / outward-only, one move /
push-through / at most two moves bracketing a hinge), and those laws are real constraints that
change the output. Call D four sub-grammars and the total is **~8**. Group E is five files
distinguished by *who acts* (cursor / nobody / caret / machine) — a content distinction wearing a
shape distinction's clothes.

For bay this is the most actionable measurement in the audit. **E is entirely inapplicable** (bay
has no product-UI-demo genre and no per-character text). **D is mostly inapplicable** (bay has no
group/camera node — see Part II §7.2). What is left is **A, B, C — three grammars.** bay does not
need 22 blueprints. It needs about six files covering three grammars.

### III.4 The "24 named text-animation effects" — 4×6, and not hyperframes'

First, an honesty credit: hyperframes does **not** claim these. `adapters/animate-text.md` says
plainly:

> this skill defers to the separate **`animate-text`** skill maintained by Pixel Point …
> **We do NOT ship the catalog inside this repo.** … vendoring its files here would violate the
> upstream's licensing … **(do NOT use this as the implementation source)**

That is better sourcing hygiene than most of the family. But the catalog itself is inflated. The 24
IDs are a cross-product of **4 subdivision units × ~6 channels**:

| | opacity | translate | scale | blur | mask | sweep |
|---|---|---|---|---|---|---|
| **char** | — | `per-character-rise`, `bottom-up-letters`, `top-down-letters`, `stagger-from-center`, `stagger-from-edges` | — | `soft-blur-in` | `typewriter` | — |
| **word** | `per-word-crossfade` | `shared-axis-y`, `short-slide-right`, `short-slide-down`, `depth-parallax-words` | `spring-scale-in` | `blur-out-up` | `kinetic-center-build` | — |
| **line** | — | `line-by-line-slide` | — | — | `mask-reveal-up` | — |
| **element** | `fade-through` | `shared-axis-x`, `shared-axis-z` | `micro-scale-fade`, `scale-down-fade` | `focus-blur-resolve` | — | `shimmer-sweep` |

`bottom-up-letters` / `top-down-letters` / `per-character-rise` are one idea with the sign flipped.
`stagger-from-center` / `stagger-from-edges` are one idea with the order flipped.
`short-slide-right` / `short-slide-down` / `shared-axis-y` are one idea on three axes.
`micro-scale-fade` / `scale-down-fade` are in and out. **≈15 mechanisms named 24 ways**, and the
two the doc itself flags as needing custom layout algorithms (`kinetic-center-build`,
`depth-parallax-words`) are the only two that are more than a parameter set.

For bay this is moot regardless — **all 15 char/word-level effects require per-glyph or per-word
elements bay does not have.** Only the ~7 whole-element ones are even expressible.

### III.5 Duplication — genuinely low, and this is a real credit

I expected restatement across 7 skills. There is very little:

| Probe | Result |
|---|---|
| Filenames appearing in two skills | 3 (`SKILL.md`, `FRAME.md`, `composition-patterns.md`) |
| `composition-patterns.md` core (263L) vs creative (199L) | **16 identical lines** — substantially different files |
| `"Two focal points"` | 2 files |
| `"Three layers minimum"` | 1 file |
| `"Anchor to edges"`, `"Split frames"`, `"Smooth beats bouncy"` | 2 files each |
| `"Stillness after motion"`, `"Video sizes, not web sizes"` | 1 file each |

bay's own skill, by contrast, mentions `spring-out` across **6 of 10 files**, `easing` in 8, and
`snapshot` in 7 — with each restatement a chance to drift. **Hyperframes is markedly DRYer than
bay.** The mechanism that achieves it — the shared contract stated once in `rules-index.md`, with
each rule's `Critical Constraints` carrying only its delta — is real engineering and is the
architecture finding in Part II §1.5(a) that I would still defend without reservation.

### III.6 Round numbers, and where the specificity is fabricated-looking

Suspiciously round, presented as findings: `2-5 decoratives per scene`, `6–10 visual roles`,
`3+ different eases`, `2-4 rules`, `60-70% of scene changes`, `2.5 words per second`, `500ms`
stagger cap, `~0.5s` group-arrival cap. None is sourced. Several are self-hedged in the same
sentence — *"roughly 6–10 visual roles can be a useful starting point, **not a contract**"*,
*"the menu is **not a checklist**"* — which is honest and also means they steer nothing.

Against that, the specificity that reads as measured and that I would not expect a generator to
produce: `springEase` at ζ = 0.80–0.85 → "~1–1.5% overshoot, the iOS system register"; *"the true
spring front-loads harder (~67% vs ~58% travelled at quarter-time)"*; the nudge curve's
`10/65/25 distance, 20/18/62 time, tail ≥3× ramp-in`; `EB Garamond headline 4.6cqw … display-cover
9.9cqw, tracking −0.012..−0.028em`; `FFT_SIZE 4096 → ~10.8 Hz/bin` with the reason inline. These
are either measured or derived, and they carry their derivations.

**The tell that separates the two: load-bearing numbers here come with a mechanism or a
consequence; filler numbers come with a hedge.** That is a usable filter for bay's own rewrite.

---

## IV. The ratio, plainly

Of ~24,300 lines, classified by whether I would defend the content on its merits to someone who
had never heard of hyperframes:

| Class | Lines | Share | What |
|---|---:|---:|---|
| **Load-bearing craft** | **~2,600** | **~11%** | 3 script algorithms (1,340) · 44 `## Values` tables (~660) · `motion-principles` + `data-in-motion` + `video-composition` numeric content (~230) · 9 palettes (126) · the two index headers + picking method (~90) · `design-spec`/`design-adherence` (~74) · `story-spine` (37) · narration tables (~30) |
| **Real but unverified taste** | ~4,100 | ~17% | 22 blueprints (1,443) · 8 visual styles (457) · 1 FRAME preset as a format (286) · typography prose (~150) · transitions selection tables (~280) · rule prose framing (~1,500) |
| **Framework-specific, non-transferable** | ~9,900 | ~41% | `core` contract · adapters · CLI · registry · `keyframes` · the router/interview |
| **Redundant or filler** | ~7,700 | ~32% | 12 duplicate FRAME presets (3,434) · `beat-direction` soft prose (~140) · `techniques.md` overlap with `rules/` (~507) · blueprint variant sprawl (~600) · the 12 near-identical `caption-skin.html` / `frame-showcase.html` pairs |

**For bay specifically the number is much smaller.** After removing what is web-only (Part II §7),
what is genre-irrelevant (grammar E), what bay cannot express (per-glyph, 3D, stroke, blur channel,
colour tween), and what is unverified taste bay should derive itself:

> **~700 lines of skill content and ~400 lines of Rust survive. That is ~3% of the artifact.**

**The right way to state it: the architecture is worth stealing, most of the taste content is
unverifiable assertion, and the three scripts are worth more than the other 23,000 lines combined
because they are the only parts that touch a rendered pixel.**

---

## V. The eight ideas, re-examined under the verdict

The question for each: *would I defend this to someone who had never heard of hyperframes?* And:
*am I importing a format or an aesthetic?* Format survives scrutiny; aesthetic does not, because
hyperframes' aesthetic has never been measured against a frame either.

| # | Idea | Verdict | What actually transfers | bay line budget |
|---|---|---|---|---:|
| 1 | Blueprints | **KEEP — format only** | The time-coded template. **Not** the 22 shapes. bay needs ~6 files over 3 grammars (A/B/C); D needs a camera node, E is inapplicable. | index 60 + 6 × 55 = **~390** |
| 2 | Design spec + adherence | **KEEP — mechanism only** | Closed-world set membership. **Not** the 8 styles or 13 presets. | skill ~80 + Rust ~120 |
| 3 | Distribution checks | **KEEP — strongest** | Share/ratio metrics over bay's own measured failure. Independent of hyperframes entirely. | skill ~25 + Rust ~150 |
| 4 | Refuse-to-certify | **KEEP — strongest** | Epistemics, not taste. | skill ~15 + Rust ~60 |
| 5 | `motion.json` sidecar | **KEEP** | Per-video assertions. Un-gameable by construction. | skill ~40 + Rust ~130 |
| 6 | Storyboard proposal + SFX cues | **KEEP — partially** | The frame table with Blueprint + Why columns, and the SFX-cue field. **Drop** `beat-direction`'s Concept/Mood prose (85% soft). | **~60** |
| 7 | Registers + doctrine notes | **KEEP — as a writing technique** | Named points in parameter space instead of counts. Rewrites existing text; adds nothing. | **0 net** |
| 8 | Scale table + brand-strict/composition-free | **KEEP — with re-derivation** | The consumption contract, and the scale table *recalculated for 1080×1920 in-feed*. | ~40 + Rust ~90 |

### Why each is right independent of its source

1. **Blueprints.** A time-coded template makes structural failure arithmetically impossible rather
   than discouraged — `Scene 1 (0.0–0.8s) … Scene 3 (1.9–end)` cannot become one 61-second scene.
   That is true of any time-coded template; hyperframes did not discover it and nothing about its
   authority is load-bearing. **The critical consequence of the verdict:** the *content* of its 22
   blueprints is unverified, so bay must write its ~6 from `12-video-teardowns.md` and its own
   measured failures. Copying hyperframes' shapes would import an aesthetic nobody has rendered.
2. **Design spec + adherence.** Right because of its logical form: a closed-world membership test
   (*every hex must appear in the spec*) has no quantity to maximise, so the round-1 gaming
   dynamic cannot arise. Its *content* — the 8 styles, the 13 presets — is exactly the unverified
   taste this audit flags, and bay should pick its own three palettes and two typefaces.
3. **Distribution checks.** Justified entirely by EVIDENCE.md's arithmetic: 107/119 opacity, 76
   moves at 0.098s, 19 easings passing a diversity counter. A share is not gameable by adding
   elements; a count is. Hyperframes contributes one useful calibration — its analysis tool
   discards tweens under 0.15s as noise, **and bay's modal move is below that floor** — but the
   idea stands without it.
4. **Refuse-to-certify.** "When the analysis's preconditions fail, report that, not a pass" is a
   principle from testing, not from video. The strongest of the eight and the cheapest.
5. **`motion.json`.** Assertions derived from this video's plan have no global threshold to
   satisfy, so weak assertions produce a video that visibly contradicts its own storyboard — which
   a human reads. This is the only mechanism in the family that is un-gameable by construction,
   and it is the one hyperframes itself invested least prose in.
6. **Storyboard proposal.** *"A frame whose why cannot be traced to the message is a frame to cut"*
   is a real editorial test, and the Blueprint column makes eight-identical-beats visible before a
   tool call. The SFX-cue field is right because eleven beats that each described a sound cannot
   collapse into one asset stamped eleven times. Drop the rest of `beat-direction.md`.
7. **Registers.** Right because it is the precise inverse of what failed: a named register is a
   *point* chosen for a reason; a diversity count is a *quantity* to maximise. Costs nothing.
8. **Scale table.** The only piece of hyperframes' taste content with a *physical* justification —
   H.264 banding, letter-detail loss under compression, thumbnail legibility. That is why it
   survives while the palettes and styles do not. **But its numbers are for 1920×1080 desktop;
   bay ships 1080×1920 in-feed and must recompute rather than copy.**

### What is dropped, and why

The 8 visual styles, 13 FRAME presets, 22 blueprints as content, 48 rules as content,
`techniques.md`, the transitions catalog, `beat-direction.md`'s Concept/Mood prose, and the 24 text
effects. Reasons, in order of frequency: **unverified taste** (styles, presets, blueprint content);
**inexpressible in bay** (per-glyph, 3D, stroke draw, blur-as-channel, colour tween, clip-path
animation — Part II §7.1); **wrong genre** (grammar E); **unfalsifiable** (beat-direction prose).

### Size discipline — the point that matters most

bay's skill is **2,197 lines** and its length, duplication, and prose-vs-list split were
*contributing causes* of the failure: its numbered lists were executed and its prose was
approximated. Hyperframes is **11× larger** and has no evidence it works.

**The budget above totals ~650 lines of skill content and ~550 lines of Rust.** That is not an
addition to bay's 2,197 — it is a **replacement for most of it**. If this round ends with a longer
bay skill, it has repeated round 1 with better vocabulary. The correct outcome is a **shorter** one
in which nearly every line is a number, a mechanical prohibition, or a slot in a template — and in
which the parts that touch a rendered pixel (the three algorithms) do the work the prose was
failing to do.

---

# PART II — Extraction (written first, under the assumption Part I tests)

**Scope.** Every file in `~/.claude/skills/hyperframes*` was read: 7 skills, ~24,300 lines. This
report extracts the *architecture* (how knowledge is split so that following it produces good
work), the *formats* worth copying verbatim, the *taste substance* (numbers, named sets, palettes,
scales), the *algorithms* in the two scripts, and a rigorous account of what is web-only.

The framing question throughout is EVIDENCE.md's: **a check a bad video can pass is worse than no
check.** Hyperframes' answer is not better checks. It is that the model is never asked to invent a
shot in the first place — it is asked to *instantiate a named, time-coded template that already
contains the taste*. That is the finding.

---

## 1. The knowledge architecture

### 1.1 The seven skills, and why the split is what it is

The split is **by kind of knowledge, not by pipeline stage.** Each skill answers a different
question, and a given task loads only the ones whose question it is currently asking.

| Skill | Question it answers | Lines | Loaded |
|---|---|---:|---|
| `hyperframes` | *Which workflow owns this request, and what did the user actually confirm?* | ~453 | Always, first, mandatory |
| `hyperframes-core` | *What will actually render? What is the contract?* | ~1,907 | Before writing any composition |
| `hyperframes-animation` | *How do I make this move?* (mechanism) | ~12,372 | When authoring motion |
| `hyperframes-creative` | *What should this look and feel like?* (taste) | ~6,912 | When choosing colour/type/beats |
| `hyperframes-keyframes` | *Is my keyframe actually provable?* | 335 | When motion is hard or wrong |
| `hyperframes-cli` | *How do I verify it?* | ~1,199 | At the gate |
| `hyperframes-registry` | *Where do reusable blocks come from?* | ~1,147 | When installing a block |

The two boundaries that matter most:

- **`animation` vs `creative` is mechanism vs taste, and it is policed in both directions.**
  `creative/SKILL.md`: *"For motion patterns, scene blueprints, transitions, and CSS marker
  effects, use `hyperframes-animation` — this skill is intentionally non-animation."*
  `animation/SKILL.md` points back: *"`hyperframes-creative` — palettes, typography, narration,
  beat planning (non-animation creative direction)."* Neither file is allowed to contain the
  other's content. This means the model can load *taste without mechanism* while planning, and
  *mechanism without taste* while implementing — halving the context cost of each phase.
- **`core` owns "will it render", nothing else.** Determinism bans, the timing attribute contract,
  the animatable-property allowlist. It is the only skill whose rules are hard errors.

`bay` currently collapses all seven into one `SKILL.md` + 9 sibling references. That is not
automatically wrong at bay's scale, but it means bay has **no layer that is loaded before the
model starts placing elements and that contains a decision.**

### 1.2 File-by-file map with line counts

```
hyperframes/                                    ~453   the router / intent layer
├── SKILL.md                                     111   state table → route table → install → domain map
├── references/
│   ├── intent-interview.md                       71   the 8-step conversation that produces BRIEF.md
│   ├── capability-menu.md                        47   what can be offered, in plain language
│   ├── pitch-round.md                            40   5 concepts along 5 different paths, 2 from the tail
│   ├── skill-lifecycle.md                        33   lazy-install mechanics
│   ├── route-briefs.md                           11
│   ├── workflow-catalog.md                       10
│   └── routes/*.md (10 files)                   130   ~12 lines each: input/output/trigger contract + that route's interview

hyperframes-core/                              ~1,907   the technical contract
├── SKILL.md                                      89   two root forms · one paused timeline · non-negotiables
└── references/ (17 files)                     1,818
    ├── composition-patterns.md                  263
    ├── sub-compositions.md                      237
    ├── storyboard-format.md                     130   ← the plan file format
    ├── tailwind.md                              123
    ├── brief-contract.md                        108   ← mode derivation, field registry, question invariants
    ├── variables-and-media.md                   105
    ├── minimal-composition.md / determinism-rules.md / frame-worker-core.md / tracks-and-clips.md /
        brief-format.md / data-attributes.md / full-screen-motion.md / script-format.md /
        review-loop.md (41) / production-loop.md (26) / subagent-dispatch.md

hyperframes-animation/                        ~12,372   all mechanism
├── SKILL.md                                      84   "Default: compose atomic rules. Load a blueprint when…"
├── rules-index.md                               113   ← THE MENU. 48 rules in 8 categories, one line each, tagged
├── blueprints-index.md                          202   ← THE OTHER MENU. 22 shapes + role→blueprint menu + picker
├── techniques.md                                507   13 broader motion-design techniques w/ code
├── blueprints/ (22 files)                     1,443   mean 66 lines. Time-coded shot templates.
├── rules/ (48 files)                          6,213   mean 129 lines. Atomic recipes w/ HTML+CSS+JS+values table.
├── adapters/ (12 files)                       1,888   per-runtime API (GSAP, Lottie, Three, Anime, WAAPI, TypeGPU…)
├── transitions/ (15 files)                      908   overview (153) + catalog (127) + registry (167) + 12 categories
└── scripts/                                   1,434   animation-map.mjs (612) + tests + sampling + loader

hyperframes-creative/                          ~6,912   all taste
├── SKILL.md                                      71   "Read these two FIRST … skipping these is the single biggest cause of generic output"
├── references/ (16 files)                     1,823
│   ├── visual-styles.md                         457   ← 8 named styles as complete YAML token blocks
│   ├── typography.md                            218   ← 18 embedded families, banned list, guardrails, font-discovery script
│   ├── composition-patterns.md                  199
│   ├── beat-direction.md                        164   ← per-beat direction format + motion-verb vocabulary + transition tables
│   ├── motion-principles.md                     150   ← guardrails + build/breathe/resolve + load-bearing GSAP rules
│   ├── design-picker.md                         123   ← the interactive commit-to-a-style mechanism
│   ├── narration.md                              92
│   ├── audio-reactive.md                         76
│   ├── house-style.md                            73   ← lazy-defaults list, background-layer recipe, palette router
│   ├── prompt-expansion.md                       68
│   ├── video-composition.md                      63   ← the web→video scale table. The densest 63 lines in the family.
│   ├── design-spec.md                            55   ← precedence, frontmatter-is-normative, preset table
│   ├── story-spine.md                            37   ← hook language, reverse iceberg, storyboard-as-proposal
│   ├── data-in-motion.md                          19
│   └── design-adherence.md                       19   ← the 6-point post-authoring audit
├── palettes/ (9 files)                          126   40 hex values each, 8 rows × 5 colours
├── frame-presets/ (13 dirs)                   3,720   FRAME.md (mean 286) + caption-skin.html + frame-showcase.html
└── scripts/                                   1,172   contrast-report.mjs (538) + extract-audio-data.py (188) + loader

hyperframes-keyframes/    335    the pose contract + CLI proof loop
hyperframes-cli/        ~1,199    lint / check / snapshot / render / publish / cloud
hyperframes-registry/   ~1,147    blocks & components
```

### 1.3 What lives where — the rule

| Artifact | Contains | Never contains |
|---|---|---|
| **SKILL.md** | A routing table and 3–6 non-negotiables. Nothing you can copy-paste into a composition. | Recipes, values, code |
| **An index** (`rules-index`, `blueprints-index`) | A one-line-per-item menu with the **trigger** ("reach for it when…"), plus the shared contract stated once | Any implementation |
| **A reference** | One topic exhaustively — every number, every hex, every threshold | Anything about another topic |
| **A blueprint** | One *shot* end-to-end as time-coded prose with `[slots]` | Code |
| **A rule** | One *move* as runnable HTML+CSS+JS + a token/range table | Story, brand, or scene structure |
| **A script** | An algorithm that measures the render | Advice |

### 1.4 The progressive-disclosure strategy

Five gates, each cheap, each carrying a decision:

1. **Frontmatter `description`** — `hyperframes`' description is 9 lines and enumerates every
   trigger phrase and input type. Selection happens before a byte of body is read.
2. **`hyperframes/SKILL.md` (111 lines)** — a *state table* first (`Apply the first matching row;
   do not evaluate lower state rows`), then a *route table* (10 priority-ordered rows). The output
   is a route name, and then: `Before finalizing the route, read references/routes/<workflow>.md
   — one small file per route … Read only the matched route's file.` So a ~1KB read confirms a
   choice, rather than a 200KB read informing one.
3. **`BRIEF.md`** — the interview's carry-away artifact. *"The brief is the only routing artifact
   the workflow reads; nothing later re-opens this skill or the interview. Answer every later
   'what did the route require?' from `BRIEF.md`."* The 71-line interview is read **once** and
   compressed to ~1KB that everything downstream re-reads. This is the family's context-management
   trick: the expensive reasoning happens once and is written down.
4. **The two indexes** — `rules-index.md` is 113 lines standing in for 6,213 lines of rules;
   `blueprints-index.md` is 202 lines standing in for 1,443. A ~50:1 and ~7:1 compression. Each
   entry is written as a *trigger*, not a description, so choosing does not require loading.
5. **The item file** — one blueprint (~66 lines) or 2–4 rules (~130 each). A well-formed motion
   task therefore costs roughly `111 + 12 + 202 + 66 + 4×130 = ~910 lines`, not 24,000.

The lazy-install layer extends this off-disk: `blueprints-index.md` cites `visual-design.md` and
`motion-language.md`, which **are not present in this install** — they ship with the workflow
skill fetched by `npx hyperframes skills update <workflow-name>`. Domain skills deliberately do
not contain the workflow's step-by-step method.

### 1.5 The three inventions inside the architecture

**(a) The shared contract stated once, in the index.** `rules-index.md` opens with:

> ## The contract — every rule assumes this
>
> Stated once here so individual rules don't repeat it. Every recipe in `rules/`:
> - runs on ONE **paused** GSAP timeline registered on `window.__timelines` …
> - is **seek-safe both directions** …
> - is **deterministic** …
> - animates **transforms and paint-only properties** …
> - caps group staggers so an arrival reads as one beat (`items × stagger ≤ ~0.5s`);
> - puts **no CSS `transition`** on animated elements …
> - measures DOM … at build time only in a **single-scene** composition …
> - lives inside a standard scene clip per `hyperframes-core` …
>
> A rule's own **Critical Constraints** section lists only what is SPECIFIC to that rule beyond
> this contract.

48 rules × ~8 repeated constraints eliminated. And it means a rule's `Critical Constraints` is
*always* worth reading, because it is always new information.

**(b) Cross-references are typed and directional.** Every rule ends with `## See also` naming its
*near neighbours and how they differ*: `spring-pop-entrance` — *"Distinct from
`press-release-spring` (a click/press reaction)."* `fixed-anchor-cycle` spends its whole opening
paragraph distinguishing itself from `kinetic-type-beats` sub-shape A and from `ticker-takeover`.
The boundaries are load-bearing content, not bookkeeping.

**(c) Doctrine can override a rule that exists.** `sine-wave-loop` — an existing, documented,
mapped rule — opens with:

> **Reach for this last.** Per the motion doctrine …: circular breathing — scaling text/cards up
> and down to look "alive" — is cheap, the agent's reflexive cheat, and reads weak. "I'd rather
> have NO motion than BAD motion."

And `cursor-ui-demo`'s rule mapping carries `→ sine-wave-loop — CAUTION: motion-doctrine bans idle
wobble; prefer a settle-and-hold`. The library contains capabilities it actively discourages, with
the discouragement attached at the point of use. This is how you stop a diversity metric from
being gamed: the cheap move is *present, named, and marked cheap*.

---

## 2. The blueprint format

This is the most valuable artifact in the family and the one bay is missing entirely.

### 2.1 What a blueprint is, in the system's own words

From `blueprints-index.md`:

> A **blueprint** is a product-agnostic, **time-coded shot template** — `Scene N (a–b s): …` with
> `[slots]` and one named **signature move** — reverse-engineered from 178 golden product-launch
> clips across two mining rounds (plus 13 legacy blueprints reverse-translated to the same brief
> format). It encodes a whole shot across its full duration — reveals paced to the spoken line,
> not dumped at t=0 — so instantiating one structurally keeps content arriving instead of
> freezing.

> ⚠ **Part I §I qualifies this.** "178 clips" appears exactly once in 24,300 lines and resolves to
> no manifest, clip list, or measurement; 71 of its 84 mined-shape names appear only in the file
> citing them. The provenance *structure* survives a decimal-precision fingerprint test and 11 of
> 22 blueprints have a runnable backing example — so the mining was real but its scale is
> unverified. Read the claims below as describing a **format**, not as certifying its **content**.

Three claims in that paragraph do the work:

- **product-agnostic + `[slots]`** — reusable without being generic, because the *structure* is
  fixed and only the *content* is filled.
- **time-coded across its full duration** — the anti-freeze mechanism is structural, not a check.
  You cannot instantiate `kinetic-type-beats` and have one scene that animates once and stops,
  because the template's Scene 2 is literally titled "beats replace each other in place (the
  engine)".
- **reverse-engineered from 178 golden clips** — the taste is *observed*, not asserted. Every
  variant line carries a provenance tag (`from hook-kinetic-type-flash`) naming the mined shape.

### 2.2 The reverse-engineered template

Every one of the 22 files follows this, in this order. Fields marked **fixed** are the same words
in every file; fields marked **filled** vary.

```markdown
# <id> — <Human Name>                                      [fixed heading form]

**intent**: <2–4 sentences. What the shot IS, stated as a mechanism, ending in what the
            motion "IS" — "the motion IS the words changing", "the motion IS the symmetry",
            "the motion IS the causality".>

**boundary**: <OPTIONAL. Only when confusable. Explicit "This is NOT <other-blueprint> —
              there X, here Y." One clause per confusable neighbour.>

**provenance**: <OPTIONAL. Which mined clips, how many products, and a concentration caveat
                when the evidence leans on one source. See panel-edit-live-sync.>

**roles served**
- <Role> (from `<mined-shape-name>`): when <the trigger condition>, <what happens>.
- <Role> (from `<mined-shape-name>`): when …
  [Roles are the storyboard frame `type` enum: Hook · Problem · Product_Intro · Key_Feature ·
   Benefits · Social_Proof · CTA · Brand_Outro. One bullet per mined variant, and the bullet
   always begins "when" — it is a trigger, not a description.]

**duration**: <range, then a parenthetical breakdown per role/variant with real observed numbers>

**shot structure** (<parenthetical: the stage — background, type treatment, camera default,
                    and the named sub-shapes, e.g. "two folded sub-shapes — (A) fixed-line
                    token swap and (B) multi-beat statement build">)

- **Scene 1 (0.0–~Xs) — <what this beat DOES, named as a verb phrase>.** <Concrete motion
  prose with `[slots]` for every product-specific noun.>
  - _Variant — <Role> (<sub-name>)_: <how this role diverges in this scene>
  - _Variant — <Role>_: …
- **Scene 2 (~Xs–~Ys) — <verb phrase> (the engine).** <The repeating middle. Almost always
  labelled "(the engine)" or "(signature move)".>
  - **Sub-shape A (<name>)**: <mechanism>
  - **Sub-shape B (<name>)**: <mechanism>
  - _Variant — <Role>_: …
- **Scene N (final beat → end) — resolve and HOLD.** <How it lands and what holds.>
  - _Variant — <Role>_: …

**signature move**: <OPTIONAL as its own field; more often inlined as "(signature move)" on the
                    scene that carries it. One named move per blueprint.>

**motion vocabulary**: <A single semicolon- or ·-separated run-on list of EVERY move the shot
                       may use, in verb form. 20–90 items. This is the shot's complete
                       lexicon — deliberately exhaustive, deliberately unstructured.>

**rule mapping**
- <motion verb from the vocabulary above> → `<rule-id>` (<why / which variation / what to tune>)
- <composite verb> → composition: `<rule-a>` (<part>) + `<rule-b>` (<part>) at the same
  timeline position
- <verb with no rule> → **flagged special — needs <capability>, NOT a motion-shape rule.**
  [Every verb in the vocabulary must appear here. Gaps are declared, not hidden.]

**camera modifier** / **camera grammar** / **camera law**: <The default (usually "camera-static")
  and the sanctioned exceptions, each mapped to a rule. Blueprints whose camera IS the subject
  promote this to "camera grammar" (camera-journey) or "camera law" (zoom-out-workspace-reveal,
  transcript-scroll-artifact-reveal) and make it non-negotiable.>

**<hard constraint sections>**: <OPTIONAL, blueprint-specific. Examples actually present:
  "Seek-safety (non-negotiable for this much camera)", "Overflow (required for a clean check)",
  "stillness note", "doctrine note (idle-motion ban)", "Merge tension", "boundary vs X".>
```

Two structural properties are worth naming explicitly:

- **The variant is a leaf, not a fork.** Variants never restructure the scene list; they only
  substitute *content and treatment inside a fixed beat*. This is why 22 blueprints cover ~60
  mined shapes without the file count exploding, and why instantiating one cannot produce an
  arbitrary shot.
- **`rule mapping` is a total function.** Every verb in `motion vocabulary` has a row. When no
  rule exists, the row says so loudly (`flagged special`) and names the capability tier. Compare
  `grid-card-assemble`'s footer, which asserts coverage as a machine-checkable claim:

```
BLUEPRINT: grid-card-assemble — serves Key_Feature, Benefits, Social_Proof (folded 4 drafts + 2 mined clusters: live-data-populate-board, item-field-to-payoff-card)
RULE COVERAGE: complete, no gaps — traveling-glow sweep → ambient-glow-bloom; motion-blur slide-out sweep (exit) → motion-blur-streak; grid slide-up fly-out (exit) → gsap-effects (plain translate); skeleton-fill populate → stat-bars-and-fills + discrete-text-sequence; push-through-hero exit → multi-phase-camera + coordinate-target-zoom
```

### 2.3 A complete blueprint, verbatim

`comparison-split.md` is the shortest complete instance (27 lines) and shows every field. Quoted
in full:

```markdown
# comparison-split — Comparison Split-Cards

**intent**: Two paired items of equal weight shown side-by-side with mirrored 3D "book-open" tilts — the eye reads them as a balanced comparison, then a pill badge lands at each card's inner edge to punctuate. The motion IS the symmetry: two cards arriving from opposite wings into a held spread.

**roles served**

- Key_Feature (from `comparison-split-cards`): when two complementary features / capabilities of equal weight should be presented **simultaneously, not sequentially** — an A/B, a "X + Y together," paired concepts the viewer must weigh side-by-side. Not for >2 items (use `grid-card-assemble`) or sequential steps.

**duration**: 4–6s

**shot structure** (a `[bg]` canvas carrying two faint ambient glow blooms — `[accent A]` near 30%, `[accent B]` near 70% — so each side owns a color identity across a 50% symmetry axis; equal-width cards under one shared perspective parent)

- **Scene 1 (0.0–~0.8s) — title sets the concept.** A centered `[title line]` with an `[accent keyword]` slides DOWN into place from just above (a short smooth settle). The downward arrival is deliberate: it forms a non-conflicting T-shape against the cards, which arrive from the sides next.
- **Scene 2 (~0.4–1.9s) — the split-tilt entry (signature move).** Two equal-width feature cards arrive from opposite wings — `[left card]` from the left, `[right card]` from the right ~0.2s behind — each carrying a **mirrored 3D `rotateY` tilt** (left faces right, right faces left, opening like a book) and scaling ~0.85→1 as it lands. The entry overlaps the title's tail so the whole thing reads as ONE arrival, not two beats. Each card holds `[image / label / subtitle]`; box-shadows fall **outward** from the tilt (left shadow right, right shadow left).
- **Scene 3 (~1.9–end) — badges punctuate, then hold.** A pill `[badge]` lands at each card's **inner edge** (left then right, ~0.3s apart), overlapping its card ~15% so it reads as attached, not orbiting. This is the lone overshoot in the shot — it earns the punctuation. Settles and holds.

**motion vocabulary**: title slide-down from above; mirrored opposite-wing card entry; static book-open `rotateY` tilt (`+tilt` left, `−tilt` right); tilt-matched outward box-shadow; inner-edge badge spring-pop; gentle phase-opposed idle float (left vs right, never synchronized) registered as subtle jitter; dual side-glow ambient.

**rule mapping**

- two cards entering from opposite wings with mirrored `rotateY` tilts + tilt-matched shadow → `split-tilt-cards` (the signature; keep the two-layer split so the entry `x`/`scale` and the idle never collide on one alias)
- title slide-down settle → `gsap-effects` (translate + opacity on a long-tail `power3`)
- inner-edge pill badge pop (the one overshoot) → `spring-pop-entrance` (overshoot register — earns the punctuation)
- phase-opposed idle float on the pair → `sine-wave-loop` (low-amplitude register — subtle jitter, NOT lazy breathing; left `sin(t)`, right `sin(t+π)` so they never conveyor-belt)
- the two faint side glows behind the cards → `ambient-glow-bloom` (un-triggered soft bloom, one per accent)

**camera modifier**: camera-static by default — the symmetry is the subject and a move would break the balance.
```

Note the density of *reasons* in 27 lines: why the title arrives downward (non-conflicting T-shape),
why the card entry overlaps the title's tail (reads as one arrival), why the badge overlaps 15%
(attached not orbiting), why exactly one overshoot exists in the shot (it earns the punctuation),
why the idle floats are phase-opposed (never conveyor-belt), why the camera is static (a move would
break the balance). Every constraint carries its justification inline. A model that follows this
cannot produce a symmetric-comparison shot that is wrong, and can produce fifty different ones.

### 2.4 The picker that sits above the blueprints

`blueprints-index.md` supplies a `Role → blueprint menu` with 4–11 options per role, each written
as a **trigger sentence**, and then four numbered picking steps:

> A **SOFT** menu: story truth comes first. Story-design reaches in **when the product's own beat
> calls for that shape** — it suggests a proven shape, it never dictates which beats exist. Each
> role has 4–11 options; if none fits the beat, compose freely (the menu is not a checklist). Each
> line is the **trigger** that should make you reach for that blueprint.

> 1. Find the frame's **role** in the menu above; pick the blueprint whose **shape fits this beat**
>    (story may already have named a candidate id — confirm or override). If two fit, prefer the one
>    whose motions are closer to your plan.
> 2. Open `blueprints/<id>.md` — read its time-coded template, `[slots]`, and named **signature move**.
> 3. Choose a posture — **Reproduce** (slots map cleanly), **Adapt** (structure fits, content/surface
>    differs; keep the signature move), or **Compose** (nothing fits → build from the motion
>    vocabulary).
> 4. If nothing in the menu fits the beat, **compose** from the motion vocabulary in
>    `motion-language.md` — still pace the reveals to the VO across the shot. Don't force a wrong
>    blueprint.

**Reproduce / Adapt / Compose** is the whole governance model in three words. It names the escape
hatch, so the library never becomes a straitjacket, while making "Compose" the *third* option
rather than the default.

The index also self-audits coverage:

> Coverage: every role has ≥2 options; every blueprint serves ≥1 role. `kinetic-type-beats` is the
> workhorse (6 roles); `dataviz-countup` now spans 5 …

### 2.5 Judgement: does this format survive 150 tool calls?

**Yes, and it is close to the only thing here that would.** The reasons:

1. **It is read once and produces a plan, not a constraint to remember.** A blueprint is consumed
   at planning time and emitted as a per-frame spec. The 66 lines don't need to stay in working
   memory; the resulting `Scene 1 (0.0–0.8s): title slides down…` does. Rules like "vary your
   easings" have to survive in working memory across every call — which is exactly why bay's
   round-1 rewrite failed.
2. **Its unit is the shot, which matches the unit of work.** The model instantiates one blueprint,
   builds it, moves on. Fatigue degrades the *last* frame's quality, not the *whole video's*
   structure — because the structure was decided in one place before any tool call.
3. **The rule mapping is a shopping list.** By the time the model reaches call 150 it is not
   deciding *what move to use*; it is executing `spring-pop-entrance` because the blueprint told it
   to, three hours ago, in writing.
4. **The scene time codes make monotony arithmetically impossible.** Scene 1 is 0.0–0.8s and Scene
   3 runs 1.9→end. There is no way to instantiate this and end up with one 61-second scene.

Weaknesses, honestly:

- **The `motion vocabulary` field is the weakest.** `kinetic-type-beats`' is a single ~90-item
  run-on paragraph. It functions as a coverage ledger for the maintainers (every item must appear
  in `rule mapping`) more than as an authoring aid. A fatigued model will skim it. If bay copies
  the format, keep the field but cap it at ~12 items — or split it into "the moves this shot must
  have" and "the moves it may have".
- **Variant proliferation is real.** `kinetic-type-beats` at 133 lines with 16 role-variants is
  past the point where a tired model reads it end to end. The 27–70-line blueprints are the ones
  that work. **66 lines is the target; 130 is the failure mode.**
- **It presumes a planning step exists.** Blueprints are cited by a storyboard (`production-loop.md`:
  *"a scene planned on a blueprint or on named rules is built by reading that recipe's body …
  names come from the indexes, never invented"*). Without a plan artifact that names blueprint ids
  per scene, nothing forces the model back to the file. **Porting blueprints without porting the
  storyboard is porting half the mechanism.**

---

## 3. The rules format

### 3.1 How an atomic rule is written

Verbatim, `nudge-curve.md` in full (47 lines — the shortest, and complete):

```markdown
---
name: nudge-curve
description: Slow-fast-slow three-phase group slide — reposition a composed group (word rows, card stacks, lists) to reveal content or make room. No single built-in ease produces it; chain power3.in ramp → linear burst → power4.out tail (10/65/25 distance, tail ≥3× ramp-in in time).
metadata:
  tags: slide, reposition, group-motion, easing, nudge, slow-fast-slow, reveal, layout
---

# Nudge Curve

Slow-fast-slow repositioning of a composed group (word rows, card stacks, lists) to
reveal content or make room. **In-scene group slide — not a seam.** No single built-in
ease produces it — `power4.inOut` smacks to a stop. Chain three tweens on one property:

| Phase     | Ease            | Distance | Time | Feel                                     |
| --------- | --------------- | -------- | ---- | ---------------------------------------- |
| 1 ramp-in | `power3.in`     | ~10%     | ~20% | barely moves — motion registers, no jolt |
| 2 burst   | `none` (linear) | ~65%     | ~18% | ~2× average px/frame — purposeful        |
| 3 tail    | `power4.out`    | ~25%     | ~62% | decaying creep to rest — kills the smack |

## Rules

- The tail is ≥3× the ramp-in in TIME. If it still smacks: extend the tail's time (not
  distance) or use `power5.out`.
- Phase 2 stays linear — easing it loses the burst contrast.
- Reveal new content DURING phase 2 — the burst masks its appearance.
- Same ratios vertical; scale distances proportionally, keep the time ratios.
- A cascade arrival usually precedes this slide — see [waterfall-entry.md](waterfall-entry.md).

## JS

Reference values for a 270px leftward slide (0.57s total). Scale distances
proportionally for other travels; preserve the TIME ratios; tail ≥3× ramp-in.

```js
var t = /* start after content settles */;
tl.to(".text-row", { x: -30,  duration: 0.12, ease: "power3.in"  }, t);          // ramp-in: 11% dist / 21% time
tl.to(".text-row", { x: -210, duration: 0.10, ease: "none"       }, t + 0.12);   // burst:   67% dist / 18% time
tl.to(".text-row", { x: -270, duration: 0.35, ease: "power4.out" }, t + 0.22);   // tail:    22% dist / 61% time
// vertical: same ratios on y. 150px variant: -15 / -115 / -150 at the same times.
```

## Anti-patterns

| Don't                                                    | Instead                                  |
| -------------------------------------------------------- | ---------------------------------------- |
| Single ease for a group slide (`power4.inOut`, `slow()`) | The three-phase chain above              |
| Nudge tail shorter than 3× the ramp-in                   | Extend the tail's TIME, not its distance |
```

The full-length rule template (from the 48 files) is:

```markdown
---
name: <kebab-id>
description: <1–3 sentences. States the mechanism AND the key numbers. This is the
             string that appears in rules-index.md.>
metadata:
  tags: <comma-separated, used for trigger matching>
---

# <Human Name>

[OPTIONAL doctrine blockquote — when the move is one the model over-reaches for.
 spring-pop-entrance and sine-wave-loop both open with one.]

<2–5 sentences: what it is, and explicitly what it is NOT — naming the confusable rule.>

## How It Works
<The mechanism in prose. Which channel carries the load, which is garnish.>

## Recipe
```html … ```   [mechanism DOM only — never the scene scaffold]
```css  … ```   [with inline comments explaining WHY each declaration exists]
```js   … ```   [SCREAMING_SNAKE tokens, never literals]

## Variations
- **<Named register>** (<when>): <parameter deltas>
[Registers are named by *feel*, not by number: "Calm settle (premium/enterprise)",
 "Firm settle (everyday default)", "Bouncy pop (RARE — explicitly-playful only)"]

## Values
| token | range | notes |
[Every SCREAMING_SNAKE token from the JS, with a range and a note that says what
 happens outside it. This is the taste, quantified.]

## Critical Constraints
- <ONLY what is specific to this rule beyond rules-index.md's shared contract>

## See also
`<neighbour>` (<how it differs>) · `<neighbour>` (<how it differs>)
```

Three things this format does that a bay-style prose reference does not:

- **The `Values` table is the taste made numeric, with consequences.** `POP_DUR 0.4–0.7s — shorter
  = tight snap; hero must be visible by t ≤ 0.5s`. `STAGGER 0.04–0.08s — min(0.06, 0.5 /
  ITEM_COUNT) — self-caps the window`. `ITEM_COUNT 3–9 — >9 makes the stagger vanish — switch to a
  wipe/sweep reveal`. Every row tells you what breaks.
- **`Anti-patterns` is a two-column Don't/Instead table**, not a prohibition list. A ban with no
  replacement is a ban the model routes around.
- **Named registers replace numeric diversity.** `sine-wave-loop` has "low-amplitude register",
  "bounded ambient"; `spring-pop-entrance` has "Calm settle", "Firm settle", "Bouncy pop (RARE)".
  Blueprints then cite the *register* — `comparison-split`: `→ sine-wave-loop (low-amplitude
  register — subtle jitter, NOT lazy breathing)`. **This is the anti-gaming mechanism.** You cannot
  satisfy "low-amplitude register" by counting distinct values; it is a named point in the
  parameter space that the blueprint selected for a stated reason.

### 3.2 Composition: "pick 2-4 rules"

`animation/SKILL.md`:

> ## Default: compose atomic rules
>
> Pick 2-4 rules from `rules-index.md`, glue them together with a single paused GSAP timeline,
> done. This is faster and produces less code than starting from a blueprint.
>
> ## Load a blueprint when
> - The scene matches an existing pre-designed multi-phase template … and reusing its phase
>   pipeline saves real authoring time
> - You want runnable ground-truth code for a complex 4-5 phase choreography
>
> Blueprints live in `blueprints-index.md` … **Do not read it speculatively; load it when you've
> already decided you need scene-level orchestration.**

Composition is not free-form. Three composition idioms appear across the rule mappings, and they
are the grammar:

1. **`A + B at the same timeline position`** — one perceptual beat from two rules. `camera-journey`:
   *"`stat-bars-and-fills` (bars `scaleY` → baseline) + `svg-path-draw` (node-dotted line draws
   left→right) at the same timeline position — no single rule names the coordinated chart-type
   morph, but no new rule needed."*
2. **`A, then B` (sequenced)** — `spring-pop-entrance` then `sine-wave-loop`: *"This is a finite
   arrival — idle motion on a held element is a separate, later `sine-wave-loop` tween."*
3. **`A restyled as B`** — the same mechanism wearing different clothes. `camera-journey`:
   *"focus-ring travel between fields → `ai-tracking-box` restyled as a plain outline"*;
   `grid-card-assemble`: *"pulsing marker rings → `cursor-click-ripple` (its expanding-ring +
   attack-decay opacity envelope, minus the cursor/click, on a bounded repeat)"*.

### 3.3 How the system stops the same rule being used every time

Not with a diversity counter. Five distinct mechanisms, all of which are structural:

1. **The blueprint chooses the rules.** The model doesn't pick a rule per element; it picks a shot,
   and the shot's `rule mapping` assigns rules per verb. Repetition would require choosing the same
   *blueprint* for every beat, and the role→blueprint menu makes that visibly wrong.
2. **Roles partition the library.** A Hook and a CTA draw from different menu rows. A video with 6
   beats spans 6 role rows.
3. **The one-shot budget is stated per blueprint.** `comparison-split`: *"This is the lone overshoot
   in the shot — it earns the punctuation."* `titlecard-reveal`: *"exactly ONE restrained move …
   No second development phase."* `agent-progress-theater`: *"at most ONE real move per shot."*
   `transcript-scroll-artifact-reveal`: *"at most TWO real camera moves in the whole shot,
   bracketing the hinge."* Scarcity is declared per shot, not measured across the file.
4. **The cheap move is named and marked cheap where you'd reach for it.**
5. **Variety is required by *character*, not by count.** From `gsap-easing-and-stagger.md`:

> Easings are tone of voice: a video that only whispers is boring; one that varies between whisper,
> normal, and punch is engaging. A composition should draw on ~3 easing characters across its beats
> — but vary **within the smooth families by energy** (`sine` / `power1` calm → `power3` standard →
> `power4` / `expo` punch); don't reach for overshoot to add variety. Overshoot is a _register_
> (explicitly playful), not a spice. One ease everywhere reads flat; bounce everywhere reads cheap
> — the second failure is worse.

That last clause is the direct answer to EVIDENCE.md #3 (`hold` × 130, 19 distinct easings, still a
fade machine). *Vary within a family by energy; do not treat register-switching as variety.* A
model optimising "19 distinct easings" fails this instruction, because 19 easings drawn from 6
character families is not the same as 3 characters used deliberately.

And `kinetic-beat-slam` states the same idea as a hard constraint on a *specific* shot:

> - **One beat array, not scattered offsets** — every element times off `BEATS[]` / `PULSE`; this
>   is the single biggest lever for "rhythmic".
> - **Different entrance per phrase** — a reused `punchIn()` for all lines is the flat-but-competent
>   tell. Vary the motion axis, reuse the ease _family_.

**Vary the axis, reuse the ease family.** bay's round-1 skill told the agent the opposite: vary the
easing. The agent varied the easing and kept one axis (opacity ×107 of 119 channels).

---

## 4. The design-picker / design-spec / design-adherence mechanism

This is the "commit to a style BEFORE placing anything" machinery. It is three files plus a
gate, and it works because the commitment produces a *file*, not a memory.

### 4.1 The three-file division

| File | Role | Lines |
|---|---|---:|
| `design-picker.md` | **How to generate and present the choice** — the mechanism that forces a decision | 123 |
| `design-spec.md` | **What the artifact is, where it lives, how to parse it** — resolution + normativity | 55 |
| `design-adherence.md` | **The post-authoring audit against the artifact** | 19 |

Plus two supply-side stores the picker draws from: `visual-styles.md` (8 complete named styles) and
`frame-presets/` (13 ready-made `FRAME.md` specs, mean 286 lines each).

### 4.2 What forces the choice

`creative/SKILL.md` step 2 makes it a four-way exhaustive routing, so "no style" is not reachable:

> 2. If no design spec exists and the user asks for visual direction, choose a route:
>    - Ready-made frame-preset (optional) → `frame-presets/` (adopt a `FRAME.md` as `frame.md`)
>    - Named style or mood → `references/visual-styles.md`
>    - Fast defaults → `references/house-style.md`
>    - Interactive selection → `references/design-picker.md`

And `house-style.md` — the "fast defaults" leaf — still forces the same three commitments before
any HTML:

> ## Before Writing HTML
> 1. **Interpret the prompt.** Generate real content. A recipe lists real ingredients. A HUD has
>    real readouts.
> 2. **Pick a palette.** Light or dark? Declare bg, fg, accent before writing code.
> 3. **Pick typefaces.** Run the font discovery script …

The picker itself is a two-phase mood-board UI. The forcing content is its option-generation
constraints — these are the decision structures, quoted:

> 1. Generate options **deeply contextual to the user's prompt**. Every category — not just
>    architectures — must reflect the specific product, brand, audience, and mood. Generic options
>    that could appear on any picker are a failure.
>
>    **Mood boards** — as many as the creative space warrants (4-8). Every board must tell a
>    different STORY about the brand, not just reshuffle the same elements. Ask: "what are the
>    genuinely different ways to position this product?" A cat food brand might be: playful chaos,
>    premium positioning, comfort/cozy, social-native, flavor showcase, humor-led,
>    sensory/appetizing. Each is a different narrative, not a different font on the same layout.
>
>    **Palettes** (5-6) — named after the brand's world, not generic moods. … Always mix dark +
>    light + tinted. **Every palette must be visually distinct at swatch size.** If two palettes
>    share the same background lightness AND a similar accent hue, cut one. Test: would a user see
>    the difference in a 14px swatch chip? If not, they're duplicates.
>
>    **Type pairings** (5-6) — **RUN the font discovery script from typography.md BEFORE generating
>    pairings.** This is not optional. Download Google Fonts metadata, run the script, and pick from
>    its output. You will otherwise reach for the same 8 fonts every time (Bricolage Grotesque,
>    Instrument Serif, Fraunces, Archivo Black, DM Serif Display, Space Grotesk, Fredoka) — that's
>    your training data default, not a contextual choice.

Three anti-monoculture devices in one page: a **named list of the model's own defaults** so it can
recognise them; a **discriminability test at the size the choice is actually made** (14px swatch);
and an **external randomised source of options** (a script that shuffles the top 5 per category so
the same first result never surfaces twice).

Density is also forced, because a preview the model can fake is a preview that doesn't decide
anything:

> **Density matters.** Each architecture preview must include 15+ distinct elements … headline,
> subhead, body paragraph, label/overline, stat with number, secondary stat, quote/testimonial,
> attribution, card with title+body, second card (different treatment), code/command block, primary
> button, secondary button, list or tags, accent divider/rule, and a data element.
>
> **Every token must be used.** Apply `{{cr}}` to all cards, buttons, and containers. Apply
> `{{shadow}}` to elevated elements … If a token isn't used in the preview_html, that option will
> have no visible effect.

The mood-board object is the decision structure — one object pre-selects one option from *every*
category, so choosing a board is a single act that locks eight variables:

```json
{
  "name": "Terminal Precision",
  "description": "Code-forward, data-dense, CLI energy. Dark canvas, monospace body, sharp corners.",
  "theme": "dark",
  "arch_index": 0,
  "palette_index": 0,
  "type_index": 0,
  "corners_index": 0,
  "density_index": 0,
  "depth_index": 1,
  "easing_index": 0,
  "corners": "0px",
  "padding": "12px",
  "gap": "8px",
  "shadow": "0 2px 16px rgba(0,230,255,0.15)"
}
```

Note `easing_index` sits in the *design* spec, not the motion spec. **Motion character is a brand
token, chosen once with the palette.** That is the structural reason a hyperframes video does not
end up with 19 easings: the easing family was picked at design time, alongside the accent colour.

The user then pastes the picker's output back as `design.md`, and the loop closes:

> 5. Once the user picks, tell them: "Copy the design.md from the picker and paste it here." … Save
>    it verbatim to `design.md` in the project root — it's already in spec format (YAML frontmatter
>    + prose sections).

### 4.3 What the spec contains, and its normativity

From `design-spec.md`:

> A spec is **YAML frontmatter + a markdown body**, and the two layers are not equal:
>
> - **Frontmatter is the normative layer** — `colors`, `typography`, `spacing`, `components` are the
>   real, machine-readable values. Quote them verbatim (exact hex, font family, weight); never
>   invent or round them.
> - **Prose is context** — the `##` sections (Overview, The Frame, Composition Rules, …) carry
>   intent, when-to-use, and constraints the tokens can't hold. Read them for judgment, not for
>   values.

Resolution is a fixed precedence with a one-liner:

> ```
> frame.md  →  design.md  →  DESIGN.md
> ```
> ```bash
> SPEC=$(ls frame.md design.md DESIGN.md 2>/dev/null | head -1)
> ```
> Load the spec **once, in Step 1**; every later step (expansion, authoring, adherence) consumes
> the already-loaded spec rather than re-resolving it.

`frame.md` is the video-first variant — *"the **frame-scale design system** … the video-first
companion to `design.md` (which is written for web / static pages) … it reframes the brand with the
frame as the unit."*

The consumption contract is the key idea, and lives in `video-composition.md`:

> ## The Design Spec Is Brand, Not Layout
>
> The design spec … defines what the brand looks like: colors, fonts, personality, constraints. It
> does NOT define how to compose a video frame. Use brand colors at video-appropriate intensity —
> not at web-UI opacity.
>
> **Strict from the design spec:** hex values (including background color), font families, weight
> relationships, Do's and Don'ts. …
> **Adapt for video:** type sizes, spacing, decorative opacity, border weight, component
> treatments. A web UI card at `border: 1px solid #e2e3e6` with `box-shadow: 0 2px 4px
> rgba(0,0,0,0.06)` is invisible on video. **The brand color is sacred; the application is yours.**

**Strict on atoms, free on composition.** That is what lets one spec produce many different frames
instead of one template repeated eight times — precisely EVIDENCE.md #9's failure ("the same
template repeats for all 8 topic beats").

The `FRAME.md` presets show the full shape. `code-editorial/FRAME.md` frontmatter declares an
8-colour palette, a **two-ramp type scale in container units** (reading/chrome ramp: Inter body
1.5cqw / lead 2.08cqw; display ramp: EB Garamond headline 4.6cqw → display-cover 9.9cqw, all weight
400, tracking −0.012 to −0.028em), a spacing scale, and 8 named components. Then, in the body,
**six named frame treatments** with a fixed recipe grammar:

> > Recipe: ground · container · composes · focal · chrome · accent · Fixed/Free · density.
> > One coral moment per frame; open with a kicker-spike.
>
> ### 4 · Number / Impact (data · move: oversized figure · cream)
>
> **Ground** `{colors.cream}`, `slide-pad`. **Composes** kicker-spike, number-lockup, lead/caption,
> optional `section-rule`. **Focal** a EB Garamond `number-hero` figure with a mono unit over a 1px
> rule … **Chrome** mono tag. **Accent** the figure in ink; at most one coral unit. **Fixed** serif
> figure + mono unit, hairline rule. **Free** the figures (from the script), tag, layout + density.
> **Density** free.

Each treatment explicitly partitions **Fixed** (never negotiable) from **Free** (yours). That is
the same strict-atoms/free-composition contract, restated per frame type.

Also present: a **fit-to-measure rule** that ties type size to content length —

> **Fit-to-measure:** size the headline to its length. Cap the block at **≤ 78cqw**; ≤3 words →
> `display-cover`; 4–6 → `display`; 7+ → `headline`. Reserve the 7.3–9.9cqw tier for cover /
> statement / stat.

— and a **legibility floor** (`any load-bearing line ≥ 1.4cqw`, i.e. ≥27px on 1920). And a hard
fabrication ban:

> ## Numerals & Claims (hard rule)
> Never invent figures, stats, diffs, or counts at frame scale. Render slots as `— figure —`,
> `{metric}`, `+N / −M`.

### 4.4 How adherence is checked afterwards

`design-adherence.md` in full — 19 lines, six points, run before serving:

> Post-authoring verification that the composition follows the design spec. Run it after building,
> before serving the preview.
>
> If a design spec (`frame.md` / `design.md`) exists, read the HTML and check:
>
> 1. **Colors** — every hex value in the composition appears in the spec's palette section (however
>    the user labeled it: Colors, Palette, Theme, etc.). Flag any invented colors.
> 2. **Typography** — font families and weights match the spec's type spec. No substitutions.
> 3. **Corners** — border-radius values match the declared corner style, if specified.
> 4. **Spacing** — padding and gap values fall within the declared density range, if specified.
> 5. **Depth** — shadow usage matches the declared depth level, if specified (flat = none, subtle =
>    light, layered = glows).
> 6. **Avoidance rules** — if the spec has a section listing things to avoid (commonly "What NOT to
>    Do", "Don'ts", "Anti-patterns", or "Do's and Don'ts"), verify none are present.
>
> Report violations as a checklist. Fix each one before serving.
>
> If no design spec exists (house-style-only path), verify:
> 1. **Palette consistency** — the same bg, fg, and accent colors are used across all scenes. No
>    per-scene color invention.
> 2. **No lazy defaults** — check the composition against `house-style.md`'s "Lazy Defaults to
>    Question" list.

**This is a set-membership check against a document the model itself authored earlier, not a
threshold.** It cannot be gamed by diversity, because the winning move is *fewer distinct values,
all of them declared*. It is closed-world: every hex must appear in the spec. There is no number to
maximise.

The presets go further and add a **squint test** as the first gate — `code-editorial`'s
`Frame Craft Bar` and `Pre-Render Self-Audit`:

> - **Squint** — one EB Garamond display moment dominates at 3–6× its neighbour.
> - **Trinity** — cream/tile ground, ink text, coral exactly **once**; warm navy only on the code
>   surface; no cool gray / pure white / fourth hue.
> - **Type** — EB Garamond sentence-case display (negative-tracked); Inter 400 body; JetBrains Mono
>   kickers (uppercase 0.16em, coral ✱) + code; ≥1.4cqw floor.
> - **Depth** — 1px hairline + at most one soft warm shadow; no heavy drop / glow / gradient / tilt.
> - **Fabrication** — every numeral / diff traces to the PR, else placeholder.

`one display moment dominates at 3–6× its neighbour` is a **ratio between the largest and
second-largest type on the frame.** That single number would have caught EVIDENCE.md #5 (max font
96px, mode 34px — a 2.8× ratio held by one glyph, with the actual body ratio at ~1.1×).

---

## 5. The taste content — the actual numbers and named sets

Extracted verbatim. bay should not re-derive any of this.

### 5.1 The web→video scale table (`video-composition.md`)

| Element | Web | Video |
|---|---|---|
| Headlines | 32-48px | **64-120px** |
| Body text | 14-16px | **28-42px** |
| Labels | 12px | **18-24px** |
| Decorative opacity | 3-8% | **12-25%** |
| Borders | 1px | **2-4px** |
| Padding | 16-32px | **60-140px** |

> If you're writing a font-size under 24px in a video composition, justify it. If you're writing
> decorative opacity under 10%, it's invisible.

And the in-feed uplift, from `typography.md`:

> **Video sizes, not web sizes.** Full-screen viewing (YouTube / website embed): body 20px minimum,
> headlines 60px+, data labels 16px. **In-feed viewing** (destination = X / LinkedIn / Instagram
> feed): the video plays small inside a scrolling feed, so scale up — **body ≥32px, headlines ≥90px,
> data labels ≥24px**.

### 5.2 Frame composition rules (`video-composition.md` + `motion-principles.md`)

- **Two focal points minimum per scene.** *"The eye needs somewhere to travel. Never a single text
  block floating in empty space."*
- **Fill the frame.** *"Hero text: 60-80% of frame width."*
- **Three layers minimum per scene.** Background treatment (glow / oversized faded type / colour
  panel) · Foreground content · Accent elements (dividers, labels, data bars).
- **Anchor to edges.** *"Pin content to left/top or right/bottom. Centered-and-floating is a web
  pattern."*
- **Split frames.** *"Data panel on the left, content on the right. Top bar with metadata,
  full-width below. Zone-based layouts, not centered stacks."*
- **Background is not empty.** *"Pure solid #000 reads as 'nothing loaded.'"*
- **Structural elements** — rules, dividers, border panels; *"they create paths for the eye and
  animate well (scaleX from 0)."*
- **Roughly 6–10 visual roles** for produced marketing frames — *"a useful starting point, not a
  contract."*

Colour presence:

> Muted is fine. Flat is not. Every scene should have at least one color that pulls the eye.
> - Brand accent should be VISIBLE — not a 5% opacity glow lost in compression. **15-25% for
>   atmospheric, full saturation for focal elements.**
> - **Light canvases work differently than dark.** On dark: accent glows pop naturally. On light:
>   use bolder borders (2px+ solid), stronger structural elements, and full-saturation accent hits.
>   Light backgrounds need texture (subtle grain, patterns) to avoid the "blank slide" feel.
> - **No full-screen linear gradients on dark backgrounds.** They band visibly under H.264
>   compression. Use a radial gradient, a solid fill, or solid + localized glow instead.
> - Tint neutrals toward the brand hue. Dead gray reads as undesigned.

### 5.3 Typography — the concrete sets

**The 18 pre-bundled families with exact available weights:**

| Family | Weights | Role |
|---|---|---|
| Inter | 400 · 700 · 900 | sans (body/UI) |
| Roboto | 400 · 700 · 900 | sans |
| Open Sans | 400 · 700 | sans |
| Lato | 400 · 700 · 900 | sans |
| Nunito | 400 · 700 · 900 | sans (rounded) |
| Montserrat | 400 · 700 · 900 | geometric sans |
| Poppins | 400 · 700 · 900 | geometric sans |
| Outfit | 400 · 700 · 900 | geometric sans |
| Oswald | 400 · 700 | condensed sans |
| **League Gothic** | **400 only** | condensed display |
| **Archivo Black** | **400 only** | heavy display |
| Playfair Display | 400 · 700 · 900 | serif (display) |
| EB Garamond | 400 · 700 | serif (text) |
| Space Mono | 400 · 700 | mono |
| IBM Plex Mono | 400 · 700 | mono |
| JetBrains Mono | 400 · 700 | mono |
| Source Code Pro | 400 · 700 | mono |
| Noto Sans JP | 400 · 700 | CJK |

**The banned list** (training-data monoculture): *Inter, Roboto, Open Sans, Noto Sans, Arimo, Lato,
Source Sans, PT Sans, Nunito, Poppins, Outfit, Sora, Playfair Display, Cormorant Garamond, Bodoni
Moda, EB Garamond, Cinzel, Prata, Syne.* — *"**Syne in particular** is the most overused
'distinctive' display font. It is an instant AI design tell."*

**The intersection is the recommendation** — this reconciliation is a device worth stealing:

> The families that are **embedded AND not banned** — your safe-and-distinctive picks — are:
> **Montserrat, Oswald, League Gothic, Archivo Black, Space Mono, IBM Plex Mono, JetBrains Mono,
> Source Code Pro, Noto Sans JP.**

**The four guardrails** (headed *"You know these rules but you violate them. Stop."*):

> - **Don't pair two sans-serifs.** You do this constantly … Cross the boundary: serif + sans, or
>   sans + mono.
> - **One expressive font per scene.** You pick two interesting fonts trying to make it "better."
>   One performs, one recedes.
> - **Weight contrast must be extreme.** You default to 400 vs 700. **Video needs 300 vs 900.** The
>   difference must be visible in motion at a glance.
> - **Video sizes, not web sizes.** … You will try to use 14px. Don't.

**Selection thinking** — the four-step de-defaulting procedure:

> 1. **Name the register.** What voice is the content speaking in? Institutional authority? Personal
>    confession? Technical precision? Casual irreverence?
> 2. **Think physically.** Imagine the font as a physical object the brand could ship — a museum
>    exhibit caption, a hand-painted shop sign, a 1970s mainframe terminal manual, a fabric label
>    inside a coat, a children's book printed on cheap newsprint, a tax form.
> 3. **Reject your first instinct.** The first font that feels right is usually your training-data
>    default for that register. If you picked it last time too, find something else.
> 4. **Cross-check the assumption.** An editorial brief does NOT need a serif. A technical brief does
>    NOT need a sans. A children's product does NOT need a rounded display font.

**Other numerics:** tracking `-0.03em to -0.05em` on display sizes (*"Video encoding compresses
letter detail"*). Dark backgrounds: use **350 instead of 400** for body (light-on-dark reads
heavier); `line-height` **+0.05–0.1**; display sizes **+0.01em letter-spacing**. Reading time:
*"3 seconds on screen = must be readable in 2."* OpenType: `tabular-nums` mandatory for any
vertically-stacked numbers.

### 5.4 The 8 named visual styles (`visual-styles.md`)

Each is a complete YAML token block including a `motion` sub-block. The motion tokens are the part
bay most needs — they are the "easing_index picked with the palette" idea made concrete.

| Style (designer) | Mood | Colours | Type | entry / exit / ambient ease | entrance / hold / transition (s) | Atmosphere |
|---|---|---|---|---|---|---|
| **Swiss Pulse** (Müller-Brockmann) | Clinical, precise | `#1a1a1a` `#ffffff` acc `#0066FF` | Helvetica Neue 700 5rem; stat 7rem | `expo.out` / `power4.in` / **none** | 0.4 / 1.5 / 0.6 | grid-lines, registration-marks |
| **Velvet Standard** (Vignelli) | Premium, timeless | `#0a0a0a` `#ffffff` acc `#1a237e` | Inter **300**, 0.15em, UPPERCASE, 3rem | `sine.inOut` / `power1.in` / `sine.inOut` | **1.2 / 3.0 / 1.5** | subtle-grain, hairline-rules |
| **Deconstructed** (Brody) | Industrial, raw | `#1a1a1a` `#f0f0f0` acc `#D4501E` | Space Grotesk 700 4rem; Space Mono labels | `back.out(2.5)` / **`steps(8)`** / `elastic.out(1.2,0.4)` | 0.3 / 1.0 / 0.5 | scan-lines, glitch-artifacts, grain |
| **Maximalist Type** (Scher) | Loud, kinetic | `#0a0a0a` `#ffffff` + `#E63946` + `#FFD60A` | Anton **8rem** UPPERCASE | `expo.out` / `back.out(1.8)` / `power3.out` | **0.3 / 0.8 / 0.4** | type-layers, color-blocks |
| **Data Drift** (Anadol) | Futuristic | `#0a0a0a` `#e0e0e0` + `#7c3aed` + `#06b6d4` | Inter **200**, 0.05em, 2.5rem | `sine.inOut` / `power2.out` / `sine.inOut` | 1.0 / 2.5 / 1.5 | particle-field, light-traces, radial-glow |
| **Soft Signal** (Sagmeister) | Intimate, warm | `#FFF8EC` `#2a2a2a` + amber `#F5A623` + rose `#C4A3A3` + sage `#8FAF8C` | Playfair Display 400 **italic** 3rem | `sine.inOut` / `power1.inOut` / `sine.inOut` | 1.0 / **3.0** / 1.5 | soft-gradient, warm-grain |
| **Folk Frequency** (Terrazas) | Cultural, vivid | `#ffffff` `#1a1a1a` + `#FF1493` `#0047AB` `#FFE000` `#009B77` | Fredoka One 4rem; Nunito 600 | `back.out(1.6)` / `elastic.out(1,0.5)` / `sine.inOut` | 0.5 / 1.5 / 0.8 | pattern-tiles, confetti-burst |
| **Shadow Cut** (Hillmann) | Dark, cinematic | `#0a0a0a` `#f0f0f0` surface `#3a3a3a` acc `#C1121F` | Oswald 700 UPPERCASE 4rem | `power3.out` / `power4.in` / `sine.inOut` | 0.8 / 2.5 / 1.2 | deep-shadow, vignette, grain |

Note the **hold** column: 0.8s (Maximalist) to 3.0s (Velvet/Soft Signal) — a 3.75× spread. Style
determines pacing, not the other way around. And the mood→style router is a flat 8-row lookup.

The creation recipe for new styles is the pattern to copy:

> The pattern: **YAML tokens (what) → prose rationale (why) → components (how they combine).**

### 5.5 The 9 palette files — 40 hex values each, curated

Each file is 8 rows × 5 colours, ready to paste. Complete list of categories with their routing:

| Category | Use for |
|---|---|
| Bold / Energetic | Product launches, social media, announcements |
| Warm / Editorial | Storytelling, documentaries, case studies |
| Dark / Premium | Tech, finance, luxury, cinematic |
| Clean / Corporate | Explainers, tutorials, presentations |
| Nature / Earth | Sustainability, outdoor, organic |
| Neon / Electric | Gaming, tech, nightlife |
| Pastel / Soft | Fashion, beauty, lifestyle, wellness |
| Jewel / Rich | Luxury, events, sophisticated |
| Monochrome | Dramatic, typography-focused |

Representative rows (each row is a usable bg/fg/accent set):

```
Dark / Premium     #000814 #001D3D #003566 #FFC300 #FFD60A
                   #0D1B2A #1B263B #415A77 #778DA9 #E0E1DD
                   #011627 #FDFFFC #2EC4B6 #E71D36 #FF9F1C
Warm / Editorial   #264653 #2A9D8F #E9C46A #F4A261 #E76F51
                   #F4F1DE #E07A5F #3D405B #81B29A #F2CC8F
                   #003049 #D62828 #F77F00 #FCBF49 #EAE2B7
Clean / Corporate  #FFFCF2 #CCC5B9 #403D39 #252422 #EB5E28
                   #2B2D42 #8D99AE #EDF2F4 #EF233C #D90429
Bold / Energetic   #FFBE0B #FB5607 #FF006E #8338EC #3A86FF
                   #EF476F #FFD166 #06D6A0 #118AB2 #073B4C
Nature / Earth     #606C38 #283618 #FEFAE0 #DDA15E #BC6C25
                   #386641 #6A994E #A7C957 #F2E8CF #BC4749
Jewel / Rich       #5F0F40 #9A031E #FB8B24 #E36414 #0F4C5C
                   #355070 #6D597A #B56576 #E56B6F #EAAC8B
```

The alternative generator, stated in one line: *"Or derive from OKLCH — pick a hue, build bg/fg/accent
at different lightnesses, tint everything toward that hue."*

### 5.6 Lazy defaults to question (`house-style.md`)

> These patterns are AI design tells — the first thing every LLM reaches for. If you're about to use
> one, pause and ask: is this a deliberate choice for THIS content, or am I defaulting?
>
> - Gradient text (`background-clip: text` + gradient)
> - Left-edge accent stripes on cards/callouts
> - Cyan-on-dark / purple-to-blue gradients / neon accents
> - Pure `#000` or `#fff` (tint toward your accent hue instead)
> - Identical card grids (same-size cards repeated)
> - Everything centered with equal weight (lead the eye somewhere)
> - Banned fonts
>
> If the content genuinely calls for one of these … use it. **The goal is intentionality, not
> avoidance.**

That last sentence is the whole difference between this and a ban list. And the background-layer
recipe, which directly addresses EVIDENCE.md #6/#7 (flat field, empty bottom half):

> Every scene needs visual depth — persistent decorative elements that stay visible while content
> animates in. Without these, scenes feel empty during entrance staggering.
>
> Ideas (mix and match, **2-5 per scene**):
> - Radial glows (accent-tinted, low opacity, breathing scale)
> - Ghost text (theme words at 3-8% opacity, very large, slow drift)
> - Accent lines (hairline rules, subtle pulse)
> - Grain/noise overlay, geometric shapes, grid patterns
> - Thematic decoratives (orbit rings for space, vinyl grooves for music, grid lines for data)
>
> **Decorative count vs motion count.** The "2-5 per scene" count refers to decorative _elements_.
> … A scene with 4 decoratives sharing one breathing motion is correct; a scene with 1 decorative
> is under-dressed.

### 5.7 Motion principles — the guardrails and the numbers

Six guardrails, all phrased as accusations (`motion-principles.md`):

> - **Don't use the same ease on every tween.** You default to `power2.out` on everything. Vary
>   eases like you vary font weights — **no more than 2 independent tweens with the same ease in a
>   scene.**
> - **Don't use the same speed on everything.** You default to 0.4-0.5s for everything. **The
>   slowest scene should be 3× slower than the fastest.**
> - **Don't enter everything from the same direction.** You default to `y: 30, opacity: 0` on every
>   element. **Vary: from left, from right, from scale, opacity-only, letter-spacing.**
> - **Don't use the same stagger on every scene.** Each scene needs its own rhythm.
> - **Don't use ambient zoom on every scene.** Pick different ambient motion per scene: slow pan,
>   subtle rotation, scale push, color shift, or nothing. **Stillness after motion is powerful.**
> - **Don't start at t=0.** Offset the first animation 0.1-0.3s. Zero-delay feels like a jump cut.

**Speed→weight mapping:**

| Band | Range | Communicates |
|---|---|---|
| Fast | 0.15-0.3s | energy, urgency, confidence |
| Medium | 0.3-0.5s | professional, most content |
| Slow | 0.5-0.8s | gravity, luxury, contemplation |
| Very slow | 0.8-2.0s | cinematic, emotional, atmospheric |

**Direction rules — stated as "not optional":**

> - `.out` for elements entering. Starts fast, decelerates. Feels responsive. This is your default.
> - `.in` for elements leaving. Starts slow, accelerates away. Throws them off.
> - `.inOut` for elements moving between positions.
>
> You get this backwards constantly. Ease-in for entrances feels sluggish. Ease-out for exits feels
> reluctant.

**Scene structure — the anti-freeze law:**

> Every scene has three phases. **You dump everything in the build and leave nothing for breathe or
> resolve.**
> - **Build (0-30%)** — elements enter, staggered. Don't dump everything at once.
> - **Breathe (30-70%)** — content visible, alive with ONE ambient motion.
> - **Resolve (70-100%)** — exit or decisive end. Exits are faster than entrances.

**Choreography, asymmetry, transition semantics:**

> The element that moves first is perceived as most important. Stagger in order of importance, not
> DOM order. Don't wait for completion — overlap entries. **Total stagger sequence under 500ms
> regardless of item count.**
>
> Entrances need longer than exits. A card takes 0.4s to appear but **0.25s** to disappear.
>
> - **Crossfade** = "this continues" · **Hard cut** = "wake up" / disruption · **Slow dissolve** =
>   "drift with me". You crossfade everything.

**The house entrance doctrine** (`spring-pop-entrance.md`, and echoed in the easing adapter):

> **Smooth beats bouncy.** This entrance defaults to a smooth long-tail settle — `power3.out` (or
> `expo.out` for a faster front) — that decelerates cleanly into the resting size with **no
> overshoot**. Bouncy `back.out` is the **#1 instant turn-off** in agent-made videos and is almost
> never executed well.

**Spring physics, with the damping→register table** (`gsap-easing-and-stagger.md`) — a
closed-form damped-spring ease, seek-safe by construction:

| dampingFraction | overshoot | register |
|---|---|---|
| **1.0 (default)** | none (monotone) | House settle. Product / enterprise / serious. |
| 0.80–0.85 | ~1–1.5% | "Alive, not bouncy" — the iOS system register. Felt, not seen. |
| 0.60–0.70 | ~5–10% | Explicitly-playful ONLY (replaces `back.out`). |
| < 0.55 | > 12% | Don't. Cartoon-wobble territory. |

| response | duration (ζ=1) | feel |
|---|---|---|
| 0.25–0.35 | 0.37–0.51s | tight snap — chips, small UI |
| 0.35–0.50 | 0.51–0.74s | standard entrance |
| 0.50–0.70 | 0.74–1.03s | weighted hero landing |

> Why not a real-time spring library: an interactive spring is a stateful integrator … which cannot
> be seeked deterministically. The closed form below is a **pure function of progress** — no state,
> nothing to desync, seek-safe by construction.

**Image motion treatment** — *"Never embed a raw flat image. Every image must have motion
treatment"*: perspective tilt (`rotationY: -8` + box-shadow), Ken Burns (`scale 1 → 1.04` over the
beat), device frame, floating-UI parallax, scroll reveal.

### 5.8 Beat direction — the per-beat spec format and the motion-verb vocabulary

The mediocre-vs-great example is the single most transferable paragraph in the file:

> **Mediocre:** "Dark navy background. '$1.9T' in white, 280px. Logo top-left. Wave image
> bottom-right."
> **Great:** "Camera is already mid-flight over a vast dark canvas. The gradient wave sweeps across
> the frame like aurora borealis — alive, shifting. '$1.9T' SLAMS into existence with such force the
> wave ripples in response. This isn't a slide — it's a moment."
>
> The first describes pixels. The second describes an experience. Write the second, then figure out
> the pixels.

Each beat has five fields: **Concept** (2–3 sentences: what world, what metaphor, what feeling),
**Mood direction** (cultural references, not hex codes), **Animation choreography** (a verb per
element), **Transition**, **Depth layers** (FG/MG/BG), **SFX cues**.

**The motion-verb vocabulary, organised by physical character rather than energy level:**

> **Impact / weight:** SLAMS, CRASHES, PUNCHES, STAMPS, SHATTERS, DROPS (with force)
> **Directional / deliberate:** SLIDES, PUSHES, PULLS, WIPES, CUTS
> **Reveals / builds:** DRAWS, FILLS, GROWS, EXPANDS, ASSEMBLES, COUNTS UP
> **Organic / ambient:** FLOATS, DRIFTS, BREATHES, PULSES, ORBITS, MORPHS
> **Mechanical / precise:** TYPES ON, CLICKS, LOCKS IN, SNAPS, STEPS
>
> **Every element gets a verb. If you can't name the verb, the element is not yet designed.** The
> verb should follow from the beat's concept — not from a lookup of what "high energy" or "low
> energy" beats use.

That last clause is deliberate anti-lookup design: an energy→verb lookup is exactly the mechanism a
model games.

**Rhythm planning:**

> Before writing HTML, declare your scene rhythm: which scenes are quick hits, which are holds,
> where do shaders land, where does energy peak. **Name the pattern — fast-fast-SLOW-fast-SHADER-hold
> — before implementing.**
>
> Derive the rhythm from the storyboard and the brand, not from a lookup. A 15-second social ad for
> an architectural firm and a 15-second social ad for a gaming brand have different rhythms …
>
> A social ad that tries to hook in 2s, showcase 3 features, and end with a CTA in 15s will feel
> like noise. Sometimes "hook-hold-CTA" with one strong feature is the right rhythm for 15 seconds.

**Transition selection tables** (`transitions/overview.md`) — energy → primary transition, with
durations and eases:

| Energy | CSS primary | Accent | Duration | Easing |
|---|---|---|---|---|
| **Calm** (wellness, brand story, luxury) | Blur crossfade, focus pull | Light leak, circle iris | 0.5-0.8s | `sine.inOut`, `power1` |
| **Medium** (corporate, SaaS, explainer) | Push slide, staggered blocks | Squeeze, vertical push | 0.3-0.5s | `power2`, `power3` |
| **High** (promos, sports, music, launch) | Zoom through, overexposure | Staggered blocks, gravity drop | 0.15-0.3s | `power4`, `expo` |

> Pick ONE primary (60-70% of scene changes) + 1-2 accents. **Never use a different transition for
> every scene.**

Blur intensity by energy: Calm 20-30px / 0.8-1.2s / hold 0.3-0.5s · Medium 8-15px / 0.4-0.6s / hold
0.1-0.2s · High 3-6px / 0.2-0.3s / hold 0s.

Narrative-position table: Opening = *"your most distinctive transition, 0.4-0.6s"* · Between related
points = *"your primary, consistent, 0.3s"* · Topic change = *"something different from your
primary"* · Climax = *"your boldest accent"* · Wind-down = *"return to gentle, 0.5-0.7s"* · Outro =
*"slowest, simplest, 0.6-1.0s — don't introduce new energy at the end."*

Presets: `snappy` 0.2s `power4.inOut` · `smooth` 0.4s `power2.inOut` · `gentle` 0.6s `sine.inOut` ·
`dramatic` 0.5s `power3.in`→out · `instant` 0.15s `expo.inOut` · `luxe` 0.7s `power1.inOut`.

**Velocity-matched transitions** (the one motion trick with a hard tolerance):

> Exit the outgoing beat with an accelerating ease (power2.in or power3.in) plus a blur ramp. Enter
> the incoming beat with a decelerating ease (power2.out or power3.out) plus blur clear. The fastest
> point of both easing curves meets at the cut — the viewer perceives continuous camera motion, not
> two discrete animations. **Match exit velocity to entry velocity within ~5% tolerance.**

Quick-picks with exact parameters:
- **Velocity-matched upward**: exit `y:-150, blur:30px, 0.33s power2.in` → entry `y:150→0, blur:30px→0, 1.0s power2.out`
- **Whip pan**: exit `x:-400, blur:24px, 0.3s power3.in` → entry `x:400→0, blur:24px→0, 0.3s power3.out`
- **Blur through**: exit `blur:20px, 0.3s` → entry `blur:20px→0, 0.25s power3.out`
- **Zoom through**: exit `scale:1→1.2, blur:20px, 0.2s power3.in` → entry `scale:0.75→1, blur:20px→0, 0.5s expo.out`

**The exit ban** — the sharpest structural rule in the family (`transitions/overview.md`):

> 1. **Every composition uses transitions.** No exceptions. Scenes without transitions feel like
>    jump cuts.
> 2. **Every scene uses entrance animations.** … No scene should pop fully-formed onto screen.
> 3. **Exit animations are BANNED** except on the final scene. Do NOT use `gsap.to()` to animate
>    elements out before a transition fires. **The transition IS the exit.** Outgoing scene content
>    must be fully visible when the transition starts.
> 4. **Final scene exception:** The last scene MAY fade elements out.

```js
// ❌ BANNED — fading the outgoing scene out, then the next scene just runs its entrance.
//    This is a jump cut with a dip, not a transition.
tl.to("#s1", { opacity: 0, duration: 0.4 }, 4.0);
tl.from("#s2 .headline", { y: 40, opacity: 0 }, 4.4);

// ✅ CORRECT — outgoing and incoming animate AT THE SAME TIME T; the motion IS the handoff.
const T = 4.0;
tl.to("#s1", { yPercent: -100, filter: "blur(8px)", duration: 0.5, ease: "power3.in" }, T);
tl.fromTo("#s2", { yPercent: 100 }, { yPercent: 0, duration: 0.5, ease: "power3.out" }, T);
```

This one rule would have removed a large fraction of bay's 107 opacity channels: half of an
opacity-fade pair is an *exit*, and exits are the transition's job.

### 5.9 Story spine — the ordering doctrine

Three cross-workflow rules (`story-spine.md`):

> **1. The hook speaks the viewer's language.** The first beat answers "why should I care" in
> **outcome language**. Subject-internal vocabulary is banned in the hook: file / function / API
> names for a code change; a feature list for a product; the source article's section headings for
> an explainer. Numbers are welcome only when they carry stakes ("40% faster cold starts"), never
> inventory ("23 files changed").
>
> **2. Reverse iceberg — value before evidence.** The value claim lands **by the second beat**.
> Everything after it is evidence in service of that claim.
>
> Self-check on the finished beat list:
> - Delete every evidence beat — the remaining beats must still state the value on their own.
> - Delete the value beats — if the video still seems to work, it was a feature tour / diff readout,
>   not a story.
>
> **3. The storyboard is a proposal, not a listing.** Open by echoing the strategy line: **"This
> video tells [audience] that [message]."** Present the frames as a markdown table, one row per
> frame … **Why** is the frame's job in the story, traced back to the message — **a frame whose why
> cannot be traced to the message is a frame to cut, not to decorate.**

| Frame | Beat | On screen | Why |
|---|---|---|---|
| 01 — Not anymore | hook · 9s | States the old pain and resolves it in the same breath. | Lands the value claim in beat 1 |

> The proposal shape — echo line → frame table → style / duration footer → "approve or adjust" — is
> **the cheapest place to iterate: a frame change here costs 30 seconds; the same change after build
> costs minutes.**

### 5.10 Narration

> - **2.5 words per second** is natural speaking pace
> - 15s = ~37 words. 30s = ~75 words. 60s = ~150 words
> - Leave room for pauses. Silence between sentences is a feature, not dead air
> - The script should feel SHORTER than the video

**Number pronunciation table** (TTS reads literally; the visual shows the exact figure while the
voice rounds):

| In the product | Write in script as |
|---|---|
| 135+ | more than one hundred thirty five |
| $1.9T | nearly two trillion dollars |
| 99.999% | ninety nine point nine percent |
| 200M+ | over two hundred million |
| 10x | ten times |
| API | A P I |
| stripe.com | stripe dot com |

**Opening-line patterns** (with the anti-default clause):

> - **A bold claim**: "The financial infrastructure that powers the internet economy."
> - **A question that provokes**: "What if your database could think?"
> - **A contrast**: "Your AI agent already knows how to make videos. It just needs the right format."
> - **A number that shocks**: "Nearly two trillion dollars." (**Use sparingly — not every video
>   should open with a stat.**)
>
> If the opening is generic ("Welcome to Stripe" / "Introducing our product"), start over.

Structure: Hook → Story → Proof → CTA, with *"Not every video needs all four."* The worked example
is ~140 words for 62 seconds = 2.3 w/s.

### 5.11 Data in motion

> - **Visual Continuity** — when successive stats belong to the same concept, keep them in the same
>   visual space with the same aesthetic. Only the VALUE changes. **An aesthetic change should
>   signal a new concept, not just a new number.**
> - **Numbers Need Visual Weight** — a number on its own floats in empty space. Pair every metric
>   with a visual element … a proportional fill bar, a background color shift, a shape that
>   represents the value, a progress ring.
> - **Avoid Web Patterns**: No pie charts · No multi-axis charts (*"viewer can't study intersections
>   in a 3-second window"*) · No 6-panel dashboards (*"2-3 related metrics side-by-side is fine, 6+
>   is a web pattern"*) · **No gridlines, tick marks, or legends** (*"visual noise that adds nothing
>   in motion"*) · No chart-library output.

That gridline ban is directly relevant to EVIDENCE.md #9 (a gridded card that renders empty and
reads as a failed asset load).

### 5.12 Audio-reactive

Data format `{ fps, totalFrames, frames: [{ bands: [0..1] }] }`; band 0 = bass, high index = treble.
Mapping table: bass→`scale` (pulse on beat) · treble (bands 12-14)→`textShadow`/`boxShadow` (glow) ·
overall amplitude→`opacity`/`y`/`backgroundColor` · mid (bands 4-8)→`borderRadius`/`width`.

> **Never add:** equalizer bars, spectrum analyzers, waveform displays, musical notes clip art,
> generic particle systems, rainbow color cycling, strobing white on beats, abstract pulsing orbs.
>
> **Instead:** Let content guide the visual and audio drive its behavior. Bass makes warmth _swell_.
> Treble sharpens _contrast_.

Intensity: **3-6% scale variation** for text; **10-30%** for backgrounds/shapes.

### 5.13 Audio and mix — what the prior art actually offers (EVIDENCE.md §10, §11)

Hyperframes has **no mixing doctrine**, no LUFS target, no ducking spec, and no SFX library. It
outsources audio to `media-use`. So the honest answer is: on §10 it contributes three things, and on
§11 it contributes almost nothing.

**(a) The SFX cue is a field in the per-beat spec, authored beside the motion verb.** From
`beat-direction.md`, each beat carries `Concept · Mood direction · Animation choreography ·
Transition · Depth layers · SFX cues`, and the SFX examples name *character*, not a category:

> ### SFX cues
> What sounds at what moment:
> - "On the capture pulse — a soft, warm analog shutter click."
> - "Left side carries a faint low drone. On fold: drone cuts. Silence. Then a single clean chime."

Two properties matter. The sound is chosen **per moment, with a described character**, at the same
time as that moment's motion verb — so it cannot become one asset stamped 11×, because eleven
different beats wrote eleven different descriptions. And **silence is an authored event** ("drone
cuts. Silence. Then a single clean chime") rather than the absence of an entry.

**(b) The continuous-envelope pattern.** `audio-reactive.md` is emphatic that a curve is sampled
per frame, never approximated by a tween — and the failure mode it names is exactly bay's stairstep:

> Audio reactivity requires per-frame sampling via a `for` loop with `tl.call()`, not a single tween
> … Without per-frame sampling, the composition doesn't actually react to audio.

Plus the doctrine that keeps audio from generating its own visual clichés:

> Audio provides **timing and intensity**. The visual vocabulary comes from the narrative.
>
> **Never add:** equalizer bars, spectrum analyzers, waveform displays, musical notes clip art,
> generic particle systems, rainbow color cycling, strobing white on beats, abstract pulsing orbs.

**(c) The move-count constraint that has to come first.** EVIDENCE.md's own conclusion —
*"the SFX layer cannot be filled without first reducing the move count"* — is the one place where
hyperframes' motion doctrine does the audio work. 160 move onsets in 61s is one every 0.38s;
`motion-principles.md`'s *"Stillness after motion is powerful"*, the build/breathe/resolve split, and
every blueprint's declared one-shot budget (`titlecard-reveal`: *"exactly ONE restrained move … No
second development phase"*; `agent-progress-theater`: *"at most ONE real move per shot"`) all cut
that number by construction. **Fixing the motion is a precondition for fixing the mix**, and the
blueprint layer is the mechanism.

**What it does not offer:** nothing on integrated loudness vs dynamic range (EVIDENCE.md's
*"−14 LUFS with LRA 3.5 is a worse mix than −16 with LRA 8"* has no counterpart here), nothing on
gain staging, and — for §11 — **nothing on prosody.** `narration.md` is a script-writing doc: pacing
at 2.5 w/s, the number-pronunciation table, contractions, *"Vary sentence length — short punchy
phrases mixed with longer flowing ones"*, *"Read it out loud. If it sounds robotic, rewrite it."*
Its only lever on delivery is the words. Hyperframes gets word-level timings back from its TTS and
uses them to drive per-word typography, but it does not control emphasis, pace, or pause. **A flat
single-register read is a failure hyperframes would also produce.** Treat §11 as a genuine open
capability question, as EVIDENCE.md says — there is no prior art here to borrow.

---

## 6. The scripts — algorithms

### 6.1 `contrast-report.mjs` (538 lines) — measured contrast against real composited pixels

bay's `check.rs` has no equivalent, and this is the single most directly portable algorithm in the
family.

**The core insight, from the file header:** you cannot compute contrast from declared CSS colours,
and you cannot sample a ring outside the text's bounding box either. You must *hide the glyphs and
photograph what was behind them*.

> Background sampling: each sample time is captured TWICE — once via the producer's normal
> (video-accurate) captureFrameToBuffer for the overlay image, and once via a plain
> page.screenshot() taken right after hiding every candidate element's own text paint (color/fill →
> transparent, layout-neutral). The second capture reveals the REAL composited pixels that were
> directly behind the glyphs …
>
> The previous approach sampled a 4px ring just OUTSIDE the bbox, which breaks down whenever what's
> immediately outside the text differs from what's actually behind it: a neighboring panel/component
> just past the text's edge, a backdrop-filter-blurred glass panel sized only a couple pixels larger
> than the text, or a translucent decoration that only partially overlaps the ring (or sits entirely
> inside the bbox, never touching the ring at all).

**Algorithm:**

1. **Sample times** — `SAMPLES` (default 10) at bucket midpoints: `t_i = ((i + 0.5) / SAMPLES) × duration`.
2. **Candidate discovery** — `TreeWalker` over `document.body`, `SHOW_ELEMENT`. Keep an element iff:
   it has a **direct** text child node with non-empty trimmed content; `visibility !== hidden`;
   `display !== none`; `opacity > 0.01`; bbox `width ≥ 8 && height ≥ 8`; foreground alpha `> 0.01`.
3. **Foreground resolution** — SVG text (`el.ownerSVGElement`) resolves from `fill`, not `color`,
   with a null-returning solid-colour parser so a gradient/`none` paint falls back rather than
   fabricating black. Text stroke (`-webkit-text-stroke-color`) captured separately.
4. **Atomic hide** — set `transition: none !important` *before* `color: transparent !important`
   (*"A `transition` on color/fill would otherwise animate this hide instead of applying it
   instantly — the screenshot taken right after can catch a partially-transparent glyph
   mid-transition"*). Restore list registered on `window` **before** the walk so a mid-walk throw
   still restores.
5. **Background sample — median over a bounded grid inside the bbox:**

```js
const x0 = Math.max(0, Math.round(bbox.x) + 1);
const x1 = Math.min(width - 1, Math.round(bbox.x + bbox.w) - 1);
const y0 = Math.max(0, Math.round(bbox.y) + 1);
const y1 = Math.min(height - 1, Math.round(bbox.y + bbox.h) - 1);
if (x1 <= x0 || y1 <= y0) return null;
const stepX = Math.max(1, Math.floor((x1 - x0) / 12));   // ≤13 columns
const stepY = Math.max(1, Math.floor((y1 - y0) / 6));    // ≤7 rows
// … collect r/g/b at each grid point, return [median(r), median(g), median(b), 1]
```

   1px inset dodges anti-aliased edges; **median, not mean**, so a decorative stripe crossing the
   box doesn't shift the result; the ≤13×7 grid bounds the cost on a wide caption bar.

6. **Alpha flatten, then WCAG 2.1:**

```js
function compositeOver([fr, fg, fb, fa], [br, bg, bb]) {
  return [Math.round(fr*fa + br*(1-fa)), Math.round(fg*fa + bg*(1-fa)),
          Math.round(fb*fa + bb*(1-fa)), 1];
}
function relLum([r, g, b]) {
  const ch = (v) => { const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}
function wcagRatio(a, b) {
  const la = relLum(a), lb = relLum(b);
  const [L1, L2] = la > lb ? [la, lb] : [lb, la];
  return (L1 + 0.05) / (L2 + 0.05);
}
function isLargeText(fontSize, fontWeight) {
  return fontSize >= 24 || (fontSize >= 19 && fontWeight >= 700);
}
```

7. **Stroke rescue** — if the text has a stroke, compute its ratio too and **keep the better of the
   two**; an outlined glyph on a busy background is legible even when the fill isn't.
8. **Verdict** — `wcagAA = large ? ratio ≥ 3 : ratio ≥ 4.5`; `wcagAAA = large ? ratio ≥ 4.5 :
   ratio ≥ 7`. Exit 1 on any AA failure.
9. **Human output** — an annotated overlay sprite: bbox outlines coloured **magenta = fail AA,
   yellow = pass AA only, green = AAA**, each with a `N.N:1` label chip, tiled at 0.25 scale into a
   ≤5-column contact sheet.

The shipped CLI adds the fix payload: *"each finding carries the sampled fg/bg colors, measured vs
required ratio, and a **suggested compliant color in the same palette direction**, so most contrast
fixes need no screenshot at all"* (brighten on dark, darken on light).

**For bay:** bay composites on the GPU, so it can read back the framebuffer directly and skip the
hide/re-screenshot dance entirely — render the frame **with text layers disabled**, sample the
median inside each text element's known box, and compare against the element's declared colour. The
`isLargeText` thresholds, the sRGB linearisation, the median-over-bounded-grid, the stroke rescue,
and the magenta/yellow/green overlay all port unchanged.

### 6.2 `extract-audio-data.py` (188 lines) — per-frame bands

**Parameters, with the reasoning kept in the source:**

```python
SAMPLE_RATE = 44100
FFT_SIZE    = 4096      # ~10.8 Hz/bin. The per-frame slice (44100/30 = 1470 samples)
                        # is too small and causes low bands to map to the same bins.
MIN_FREQ    = 30.0      # below 30Hz is sub-bass most speakers can't reproduce
MAX_FREQ    = 16000.0   # above 16kHz is noise/harmonics that don't contribute to
                        # perceived rhythm or melody
```

**Algorithm:**

1. **Decode** — ffmpeg to mono s16le at 44.1 kHz, `int16 → float32 / 32768.0`.
2. **Log-spaced band edges** — `n_bands + 1` geometric edges:

```python
edges[i] = MIN_FREQ * (MAX_FREQ / MIN_FREQ) ** (i / n_bands)
```

3. **Per output frame `f`** (at target fps, `frame_step = SAMPLE_RATE // fps`):
   - **RMS** over the frame's own slice `[f·step, (f+1)·step)`: `sqrt(mean(x²))`.
   - **FFT** over a **4096-sample window centred on the frame's midpoint**, Hann-windowed, with
     explicit zero-padding at the edges. Decoupling the analysis window from the frame step is the
     key move: temporal resolution comes from the hop, frequency resolution from the window.
   - **Band value = PEAK magnitude in the band's bin range** (`np.max`, not mean) — peaks preserve
     transients that averaging smears.
4. **Two-pass normalisation** — pass 1 collects raw values, pass 2 normalises:
   - RMS divided by its global peak.
   - **Bands normalised PER BAND** (`band_values /= band_values.max(axis=0)`) — *"Per-band
     normalization so treble is visible alongside louder bass."* This is why every band lands in
     0–1 and is directly usable as an animation multiplier.
5. **Output** — `{duration, fps, bands, totalFrames, frames: [{time, rms, bands: [...]}]}`,
   4-decimal rounded.

**For bay:** three uses, in order of value.

1. **A real duck curve.** EVIDENCE.md §10's core defect is a bed cut into 13 slices with stepped
   constant gains and zero volume keyframes — a stairstep, which is what produces LRA 3.5 LU. Run
   this extractor over the **narration** track and you get a per-frame RMS envelope in 0–1. The
   duck is then `bedVolume(t) = base × (1 − depth × smooth(narrationRMS(t)))`, written as volume
   keyframes on **one** bed element, with attack/release applied by asymmetric smoothing (fast
   attack ~20–40ms, slow release ~250–400ms). One element, a continuous curve, never above unity.
   This is precisely the (a) target EVIDENCE.md sets, and the script already computes the only
   input it needs.
2. **A beat grid.** Frames whose `bands[0]` crosses a threshold are the downbeats. bay's SKILL.md
   already says *"Land reveals ON the beat, don't start them on one … Use `start = beat −
   duration`"* but has no source for `beat`. This script is that source.
3. **Audio-reactive motion**, with the bans in `audio-reactive.md` attached (§5.13).

### 6.3 `animation-map.mjs` (612 lines) — the choreography auditor

Structurally the closest existing analogue to `check.rs`, and the metrics it computes are ones bay's
check does not.

1. **Tween enumeration** — recursive walk of `window.__timelines`, accumulating parent offsets:

```js
const walk = (node, parentOffset = 0) => {
  if (typeof node.getChildren === "function") {
    const offset = parentOffset + (node.startTime?.() ?? 0);
    for (const child of node.getChildren(true, true, true)) walk(child, offset);
    return;
  }
  const targets = (node.targets?.() ?? []).filter((t) => t instanceof Element);
  if (!targets.length) return;
  const props = Object.keys(node.vars ?? {}).filter((k) => ![
    "duration","ease","delay","repeat","yoyo","onStart","onUpdate","onComplete","stagger"
  ].includes(k));
  const start = parentOffset + (node.startTime?.() ?? 0);
  results.push({ selectorHint: …, targetCount: targets.length, props,
                 start, end: start + node.duration(), ease: … });
};
```

2. **Micro-tween filter** — tweens shorter than `MIN_DUR` (default **0.15s**) are dropped from the
   map as noise. bay's mode is 0.098s — *below hyperframes' noise floor*.
3. **Bbox sampling** — 6 samples per tween at bucket midpoints.
4. **Flags** — the per-tween verdicts:

```js
if (bboxes.every(b => b.w === 0 || b.h === 0))                       flags.push("degenerate");
if (anyOffscreen)                                                     flags.push("offscreen");
if (bboxes.every(b => b.opacity < 0.01 && b.visible))                 flags.push("invisible");
if (dur < 0.2 && props.some(p => ["y","x","opacity","scale"].includes(p)))
                                                                      flags.push("paced-fast");
if (dur > 2.0)                                                        flags.push("paced-slow");
```

   `offscreen` uses a **half-size tolerance** rather than a strict canvas test:
   `b.x < -b.w*0.5 || b.x + b.w > width + b.w*0.5` (etc.) — a partial bleed is fine, half-out is not.
5. **Collision detection** — for every pair of tweens whose *time* ranges overlap, find bbox samples
   within 50ms of each other and compute rect intersection; flag both when `overlap / aArea > 0.3`.
   Time-overlap first, so it is O(pairs) not O(frames × elements²).
6. **Density and dead zones** — active tween count in 0.5s buckets; any run of zero-activity buckets
   ≥ **1.0s** becomes a dead zone with the note *"No animation for Xs. Intentional hold or missing
   entrance?"* (and a distinct end-of-composition variant).
7. **Stagger detection and *consistency*** — group tweens with identical prop lists, durations within
   0.05s, and starts within `4 × duration`; groups of ≥3 get their inter-onset intervals measured:

```js
const avgInterval = intervals.reduce((a,b) => a+b, 0) / intervals.length;
const maxDrift    = Math.max(...intervals.map(iv => Math.abs(iv - avgInterval)));
const consistent  = maxDrift < avgInterval * 0.3;
```

   Output is human: *"5 elements stagger at 80ms intervals"* or *"5 elements stagger with uneven
   intervals (80ms, 210ms, 60ms, 340ms)"*.
8. **Element lifecycles** — per selector: `firstAppears`, `lastAnimates`, `tweenCount`, the union of
   props touched, `endsVisible`, `finalPosition`.
9. **Snapshots** — visible-element inventory at `[0, 0.25d, 0.5d, 0.75d, d−0.1]` with what was
   animating at each.
10. **An ASCII choreography chart** — 60 columns, one row per tween:

```
Timeline (12.0s, each char ≈ 0.20s):
  0s                                                    12s
  ┼───────────────────────────────────────────────────────┤
  ████                                                     #headline opacity+y
      ██████                                               #stat scale
                    ███                                    .card opacity
```

**What bay should take:** the **paced-fast flag at 0.2s** (bay's mode of 0.098s would flag 76
moves), the **dead-zone detector**, the **stagger-consistency ratio**, the **half-size offscreen
tolerance**, the **time-overlap-first collision test** (which is exactly EVIDENCE.md #9's uncaught
"Different day." occlusion), and above all the **ASCII timeline chart**, which makes a one-scene
61-second project visually obvious in a way no finding code does.

Also note the CLI's `sweep_static` rule, which is the correct shape for bay's `inert-scene`:

> If a 3s+ composition shows zero geometry change across every sample, `check` fails with
> `sweep_static`: **a frozen timeline makes every green verdict unreliable, so it refuses to pass.**

That is the pattern EVIDENCE.md #8 needs: when the structure degenerates (one scene, 61 seconds),
the checker should **refuse to certify**, not silently pass.

And the `*.motion.json` sidecar — assertions authored *before* the build, verified against the
seeked timeline:

```json
{
  "duration": 6,
  "assertions": [
    { "kind": "appearsBy",    "selector": "#headline", "bySec": 0.5 },
    { "kind": "before",       "a": "#headline", "b": "#cta" },
    { "kind": "staysInFrame", "selector": ".card" },
    { "kind": "keepsMoving",  "withinSelector": ".scene" }
  ]
}
```

| Assertion | Fails when |
|---|---|
| `appearsBy(selector, bySec)` | not visible (opacity ≥ 0.5) by `bySec` — `motion_appears_late` |
| `before(a, b)` | `a` does not first appear strictly before `b` — `motion_out_of_order` |
| `staysInFrame(selector)` | once visible, its box leaves the canvas — `motion_off_frame` |
| `keepsMoving(withinSelector?)` | a fully-static window exceeds `maxStaticSec` (default 2s) — `motion_frozen` |

> A selector that matches nothing is reported as `motion_selector_missing` rather than silently
> passing — a typo'd selector fails loudly. **Use this in the feedback loop instead of eyeballing
> the render: assert what the motion is supposed to do, and let `check` tell you when the seek
> diverges from intent.**

**This is a gameproof check, and it is the only one in the family that is.** The assertions are
authored *from the plan*, before the build, and describe *this specific video's* intent. There is no
global threshold to satisfy. A model that writes weak assertions produces a video that visibly
doesn't match its own storyboard — which the user reads.

---

## 7. What is web-specific and does not transfer

bay's primitive set: `text · rect · ellipse · image · video · audio`; animatable channels `opacity,
scale, x, y, rotation, scaleX, scaleY` (visual) and `volume` (audio); masks; effects; per-key
easing. Colour, blur, letter-spacing and mask geometry are **one-shot state changes, not channels**.

### 7.1 Does not transfer at all — do not plan around these

| Capability | Why not | Blueprints/rules that die |
|---|---|---|
| **Per-character / per-word text** | bay has no glyph or word sub-element. A text element is one box. | `hacker-flip-3d`, `discrete-text-sequence` (typing), `context-sensitive-cursor`, `waterfall-entry` (per-word), `gradient-text-sweep`, `depth-scatter-assemble` (glyphs), `asr-keyword-glow`. **Kills `typewriter-reveal` and most of `kinetic-type-beats`' word-level variants outright.** bay's own troubleshooting already lists per-character text as missing. |
| **Real 3D** (`perspective`, `rotateX/Y`, `translateZ`, `preserve-3d`) | bay has `rotation` (2D Z-axis) only. | `3d-camera-flight`, `orbit-3d-entry`, `split-tilt-cards`, `3d-page-scroll`, `3d-text-depth-layers`, `depth-scatter-assemble`. **Kills `comparison-split`'s signature (mirrored `rotateY` book-open tilt) and `camera-journey` sub-shape B.** |
| **SVG stroke draw** (`stroke-dasharray`/`dashoffset`, `getTotalLength`) | No stroke primitive, no path. | `svg-path-draw`, `svg-icon-enrichment`, and every check-mark / connector / ring / underline draw-on. **Kills `logo-assemble-lockup`'s entire "draws its own outline" family.** |
| **SVG path morph** | Already flagged special even in hyperframes. | The `zoom-out-workspace-reveal` blob morph, `panel-edit-live-sync`'s easing-handle bend. |
| **`filter: blur()` as a channel** | bay's blur is a one-shot state change, not a keyframable channel. | `motion-blur-streak`, `depth-of-field-blur`, every velocity-matched transition that ramps blur, `blur-through` / `focus-pull` / `blur crossfade` transitions, the whip-pan quick-pick. |
| **`clip-path` animation** | bay's masks are stencils, and `mask_set` geometry is one-shot. | The `techniques.md` clip-path reveal used by ~15 rule-mapping rows. bay *can* do a wipe by holding a mask still and moving the element under it (per its own SKILL.md) — a real but strictly weaker substitute. |
| **Colour/gradient tweens** | Colour is a state change. | `theme-crossfade-morph`, `press-release-spring`'s colour variation, `chart activation color flip`, `gradient-text-sweep`, all "invert bg + text colour on the beat" variants. Discrete colour *swaps* at keyframe boundaries remain available; continuous colour interpolation does not. |
| **`width`/`height` and reflow** | No layout engine — nothing pushes anything. | `anchored-layout-expand` (whose entire premise is in-flow reflow) and `reactive-displacement`'s in-flow half. A bay "expand" is a scale, with nothing displaced. |
| **WebGL / shader transitions** | 14 named shaders, `html2canvas`, TypeGPU, `html-in-canvas-patterns.md`. bay's effects are a fixed compositor set. | The entire shader-transition catalog and its selection tables. bay must map "energy → transition" onto whatever `transition_add` actually offers. |
| **DOM measurement / FLIP** | `getBoundingClientRect`, `document.fonts.ready`, `measureText`. | `camera-cursor-tracking`, and the "measure the target at setup, never hand-derive" discipline that every camera rule leans on. bay's coordinates are authored fractions — arguably *simpler*, but the rules' measured-offset math is moot. |
| **`letter-spacing` / variable-font axis tweens** | Not channels. | Letter-spacing collapse/tighten, variable-font `opsz`/`wght` animation. |
| **Cursor / UI reconstruction** | Not a capability gap — a *genre* gap. bay makes explainers and data pieces, not product-UI demos. | `cursor-ui-demo`, `panel-edit-live-sync`, `prompt-type-submit-generate`, `agent-progress-theater`, `device-surface-showcase`, `cursor-drag`, `multi-cursor-choreography`. **7 of 22 blueprints and ~10 of 48 rules are about driving a reconstructed app UI.** They are irrelevant to bay's brief, not merely unimplementable. |

### 7.2 Transfers only in weakened form

- **Virtual camera.** `viewport-change` / `multi-phase-camera` / `coordinate-target-zoom` assume one
  wrapper element transforming everything. bay has no group node — a camera means applying the same
  `scale`/`x`/`y` keyframes to every element in the scene, and the counter-translate math
  (`T = -offset × S`) must be computed per element at author time. Doable via `animate_many`, but
  it is authored arithmetic, not a wrapper. **Every camera-driven blueprint
  (`spatial-pan-stations`, `zoom-out-workspace-reveal`, `camera-journey`, `dataviz-countup`'s
  push-through) is gated on bay having a group/camera concept, or on accepting per-element camera
  math.**
- **Overflow/clipping.** Three blueprints carry an `Overflow (required for a clean check)` section
  and rely on `overflow: hidden` + `data-layout-allow-overflow`. bay's canvas clips, but there is no
  per-container clip and no allow-list attribute, so `check`'s `off-canvas` will fire on any
  deliberate traversal. bay needs an equivalent intent marker.
- **Ambient decoratives.** `house-style.md`'s "2-5 per scene" list is mostly achievable with
  `rect`/`ellipse`/`image` plus opacity and scale — radial glows become a pre-rendered PNG, ghost
  text becomes a large low-opacity `add_text`, hairline rules become thin rects (which *do*
  `scaleX` from 0, exactly as advertised). Grain/noise needs an image asset. This one transfers
  well.
- **Contrast checking.** Transfers *better* than hyperframes' version: bay owns the compositor and
  can render a text-suppressed pass directly instead of screenshotting a mutated DOM.
- **Audio.** Partially, and *not* in the direction I first assumed. bay has `sfx`, a bed and a LUFS
  target, but EVIDENCE.md §10 shows the bed is 13 stepped constant-gain slices with **zero volume
  keyframes**, ducked by boosting to `vol = 2.0` between narration, and the SFX are one asset per
  category stamped 11× at identical duration. That is the easing failure in another domain, and
  hyperframes' contribution to it is real but narrow — see §5.13.

### 7.3 Transfers unchanged

The scale table · the palettes · the visual-style token blocks (minus GSAP-specific ease *names*) ·
the typography guardrails and selection thinking · the lazy-defaults list · story spine · narration
pacing and number pronunciation · data-in-motion bans · beat direction's concept/mood/verb format ·
the motion-verb vocabulary · build/breathe/resolve · the direction rules (`.out` in, `.in` out) ·
speed→weight bands · the ≤500ms stagger cap · the exit ban · velocity-matched cuts (minus blur) ·
the blueprint format itself · the rule format itself · `design-adherence`'s closed-world audit ·
the `motion.json` sidecar · every algorithm in §6.

---

## 8. The 8 most transferable ideas, ranked by how much they'd have prevented the measured failures

Ranked by damage prevented against EVIDENCE.md, not by elegance.

> ⚠ **Superseded in scope by Part I §V.** The ranking below still holds, but Part I narrows what
> each idea carries: **formats and mechanisms transfer; hyperframes' taste content does not**, because
> it has never been rendered either. Idea 1 becomes "the blueprint template + ~6 shapes bay derives
> itself over 3 grammars" (not 22 imported shapes); idea 2 becomes "the closed-world adherence
> mechanism" (not the 8 styles or 13 presets); idea 8's scale table must be recomputed for
> 1080×1920 in-feed. Per-idea line budgets are in Part I §V — the total is ~650 lines of skill,
> a **replacement** for most of bay's 2,197, not an addition.

---

### 1. Blueprints — time-coded shot templates with `[slots]` and a signature move

**Prevents:** #8 (one 61-second scene), #9 (the same template repeated for all 8 beats), #2 (the
3-frame move), #1 (90% opacity), and #9's "scenes dump and freeze".

This is the highest-leverage transfer by a wide margin, because it converts every one of those from
a thing the agent must *remember not to do* into a thing it structurally *cannot* do. A blueprint's
`Scene 1 (0.0–~0.8s) … Scene 3 (~1.9–end)` cannot yield one 61-second scene. Its per-role variants
cannot yield the same composition eight times. Its `rule mapping` assigns moves per verb, so
"opacity everywhere" would require every mapped rule to be an opacity rule — and none of them are.

**Ported to bay** — `.claude/skills/bay/blueprints-index.md` + `blueprints/*.md`, 8–12 shapes, each
50–70 lines, in exactly the §2.2 template, restricted to bay's primitives:

- `stat-hero` — one number owns the frame, a proportional bar/ring lands with it, a caption follows.
- `kinetic-statement-beats` — 3–5 full-frame statements replacing each other, each a *different*
  transform axis. (bay-safe: whole-line elements, no per-glyph.)
- `chart-build` — axis rect wipes in, bars `scaleY` from `anchorY: 1` staggered, labels follow, one
  bar highlights.
- `compare-two` — two panels enter from opposite wings (translate + scale, not rotateY), one badge
  each. bay-safe rewrite of `comparison-split`.
- `list-accumulate` — items arrive ~1/sec into a vertical stack and stay lit; the stack holds.
- `titlecard-hold` — one restrained move then a still hold, with the `stillness note` carried over
  verbatim.
- `pan-stations` — pre-placed stations, camera-as-`animate_many` lateral pans. (Gated on the camera
  question in §7.2.)
- `image-reveal` — image lands with Ken Burns + perspective-substitute, caption anchored to an edge.

Each with `intent` / `roles served` (as trigger sentences) / `duration` / time-coded `shot structure`
with `[slots]` / `motion vocabulary` (**capped at 12 items**) / `rule mapping` → bay move ids /
`camera modifier`. Provenance is the honest problem: hyperframes mined 178 clips. bay has three bad
videos and two good external teardowns (`12-video-teardowns.md`). **Write 8 blueprints from those
teardowns and label the thin evidence** — `panel-edit-live-sync`'s `provenance` field with its
explicit concentration caveat is the model for how to ship a shape you're not fully sure of.

---

### 2. A design spec committed before placement, plus a closed-world adherence audit

**Prevents:** #4 (Menlo ×69), #6 (5 colours, monochrome), #5 (nothing is big), and half of #7
(one left column).

The picker/spec/adherence triad is what makes "commit to a style first" real: the commitment
produces a **file**, and the audit is **set membership against that file**, not a threshold. You
cannot game "every hex in the composition appears in the spec's palette" — the winning move is
*fewer* distinct values, all declared. Compare bay's round-1 checks, every one of which rewards
more distinct values.

**Ported to bay** — `frame.md` in the project directory, written before `add_text` is called once:

```yaml
---
name: <picked style>
colors: { bg: "#…", ink: "#…", accent: "#…", muted: "#…" }   # 3–5, no more
typography:
  display: { family: "…", weight: 900, minPx: 200 }
  body:    { family: "…", weight: 300, minPx: 44 }
  label:   { family: "…", weight: 400, minPx: 28 }
motion:
  entry: spring-out
  exit:  power2-in
  ambient: none
  durations: { entrance: 0.45, hold: 1.6, transition: 0.35 }
zones: [hero, support, caption]     # named y-bands the layout must use
---
## Do's and Don'ts
```

Then a `check` rule `spec-drift`, closed-world: **every `fill`/`color` in the project must appear in
`colors`; every `fontFamily` must appear in `typography`; every font size must be ≥ its role's
`minPx`; every channel easing must appear in `motion`.** Reported as a checklist, fixed before
render. This single lint would have failed wicks-v2 on four counts at once.

Seed it from a bay-flavoured `visual-styles.md` — port the 8 style token blocks with GSAP ease names
mapped to bay's 14 easings — and from the 9 palette files verbatim.

---

### 3. The animated-property distribution and the tempo floor

**Prevents:** #1 directly (opacity 107 / 119), #2 directly (76 moves at 0.098s), #3 (`hold` ×130).

EVIDENCE.md's own diagnosis is that the check measures the wrong axis. Hyperframes measures the
right ones and states them as authoring rules first, checks second:

- *"Don't enter everything from the same direction. You default to `y: 30, opacity: 0`. **Vary:**
  from left, from right, from scale, opacity-only, letter-spacing."*
- `paced-fast` flags any transform tween under **0.2s**; the animation map's noise floor is
  **0.15s** — bay's *mode* is 0.098s, below the threshold at which hyperframes stops calling
  something a move.
- *"Vary the motion axis, reuse the ease family."*
- *"no more than 2 independent tweens with the same ease in a scene"* and *"the slowest scene should
  be 3× slower than the fastest"* — both **within-scene** or **ratio** constraints, not global counts.

**Ported to bay** — replace `monotone-easing` / `monotone-duration` with three distribution checks:

- `opacity-dominant` — fires when opacity > **60%** of animated channels in a scene. (wicks-v2: 90%.)
- `pop-not-move` — fires when > **⅓** of transform moves are < **0.2s**. (wicks-v2: 76/150 at 0.098s.)
- `tempo-flat` — fires when `slowest transform move / fastest ≥ 0.2s move < 3×`.

All three are *ratios or shares*, so adding more elements cannot satisfy them. And all three are
authored into the skill as prose rules *before* they exist as checks, because a check the author
never read is a check they discover by failing.

---

### 4. `sweep_static` — the checker refuses to certify a degenerate structure

**Prevents:** #8, the report's own "most important structural finding" — the check suite silently
degenerates to nothing on a one-scene project.

Hyperframes' framing, verbatim: *"If a 3s+ composition shows zero geometry change across every
sample, `check` fails with `sweep_static`: **a frozen timeline makes every green verdict unreliable,
so it refuses to pass.**"* The principle generalises: **when the analysis's own preconditions fail,
report that, not a pass.**

**Ported to bay** — a `structure-degenerate` finding that fires whenever the per-scene checks cannot
meaningfully evaluate:

- 1 scene, or any scene > **20s**, or fewer than `ceil(duration / 12)` scenes;
- any scene where two frames sampled 0.5s apart mid-scene are geometrically identical (this is
  already in bay's SKILL.md as prose — *"Two snapshots 0.5s apart mid-scene must not be identical"*
  — but nothing enforces it).

And critically: when `structure-degenerate` fires, **every other per-scene finding is reported as
`inconclusive`, not `pass`.** A one-scene project should produce a red banner reading "the per-scene
checks did not run", never eight green ticks.

---

### 5. The `motion.json` sidecar — assert intent before building, verify against the render

**Prevents:** #9 (the empty card at t≈19s and 24s, the occluded "Different day.", the identical
frames 5s apart), #2, and the whole class of things that look fine in the timeline and wrong on
screen.

This is the only genuinely un-gameable check in the family, because the assertions come from **this
video's plan**, not from a global threshold. `appearsBy` / `before` / `staysInFrame` / `keepsMoving`
are four primitives that between them encode most of what a storyboard promises. And
`motion_selector_missing` means a typo fails loudly rather than passing silently.

**Ported to bay** — after the storyboard is approved, before any `add_text`, write
`<project>.motion.json`; `check` verifies it by sampling the timeline:

```json
{ "assertions": [
  { "kind": "appearsBy",    "element": "hero-stat", "bySec": 0.5 },
  { "kind": "before",       "a": "kicker", "b": "headline" },
  { "kind": "staysInFrame", "element": "card" },
  { "kind": "keepsMoving",  "scene": "scene-3", "maxStaticSec": 2.0 },
  { "kind": "noOverlap",    "a": "headline", "b": "card" },
  { "kind": "occupies",     "band": [0.75, 1.0], "minElements": 1 }
]}
```

The last two are bay-specific additions aimed at #9 (text collision) and #7 (nothing below y=0.73).
`noOverlap` needs bay to compute text bounding boxes, which the layout/`small-text` machinery
already implies it can.

---

### 6. The storyboard as a proposal — a `Why` column that traces to the message, and an SFX cue per beat

**Prevents:** #9 (identical template ×8 — a repeated template survives a listing and dies in a
proposal), #1 (the frame table is where "everything fades in" becomes visible), the "hook is
nothing" finding (#9, t=0.5s blank), and **#10's SFX half** (one asset per category stamped 11× at
identical duration).

`story-spine.md`'s three rules cost nothing and catch structural failure at the cheapest possible
point:

> Open by echoing the strategy line: **"This video tells [audience] that [message]."** … **Why** is
> the frame's job in the story, traced back to the message — **a frame whose why cannot be traced to
> the message is a frame to cut, not to decorate.**
>
> - Delete every evidence beat — the remaining beats must still state the value on their own.
> - Delete the value beats — if the video still seems to work, it was a feature tour, not a story.
>
> a frame change here costs 30 seconds; the same change after build costs minutes.

**Ported to bay** — a `STORYBOARD.md` (bay's format can be hyperframes' verbatim; it is
framework-neutral) plus a mandatory proposal turn before any tool call:

| Frame | Beat · duration | Blueprint | On screen | Why |
|---|---|---|---|---|

Adding a **Blueprint** column is the change that makes #1 and #2 land: eight rows all reading
`kinetic-statement-beats` is the failure, visible before a single element is placed. And the
hook rule — *"the first beat answers 'why should I care' in outcome language"* — is precisely what
a blank frame at t=0.5s fails.

Carry `beat-direction.md`'s per-beat fields into each frame's body, **including `SFX cues`**
(§5.13): a sound described by *character* at the moment its motion verb is written. Eleven beats
that each described their own sound cannot collapse into one whoosh asset placed eleven times at
0.54s — which is what §10 measured. Silence gets an entry too. This is the cheapest available fix
for the SFX half of #10, and it costs one extra line per frame in a file that already exists.

---

### 7. Registers, doctrine notes, and the intersection recommendation — how to name taste without a metric

**Prevents:** #3 (`hold` blessed as diversity), #4 (mono everywhere), and the meta-finding.

Three devices that all do the same job — make a *named point* in the parameter space the unit of
choice, instead of a *count*:

- **Named registers.** `sine-wave-loop` "low-amplitude register", `spring-pop-entrance` "Calm settle
  / Firm settle / Bouncy pop (RARE)", `springEase` ζ=1.0 / 0.80–0.85 / 0.60–0.70. A blueprint cites
  a register; the register carries its ranges. You cannot satisfy "low-amplitude register" by
  counting distinct values.
- **Doctrine notes at the point of use.** `sine-wave-loop` is a documented, mapped rule that opens
  *"Reach for this last … the agent's reflexive cheat … I'd rather have NO motion than BAD motion."*
  `cursor-ui-demo` maps to it with `CAUTION: motion-doctrine bans idle wobble; prefer a
  settle-and-hold`. `agent-progress-theater` earns an exception with a written justification (*"here
  they are DIEGETIC: the pulse performs 'the machine is working'"*). **The cheap move is present,
  named, marked cheap, and its one legitimate use is spelled out.** That is more robust than a ban,
  which the agent routes around, and more robust than a counter, which the agent maximises.
- **The intersection recommendation.** Typography lists 18 embedded families and 19 banned ones,
  then computes and states the 9-name intersection. **A positive shortlist beats a negative list.**

**Ported to bay** — every move in `motion.md` gets named registers with ranges and a "reach for this
last / this is the house default" ordering; `hold` gets an explicit doctrine note (*"per-key `hold`
exists so one property can arrive fast, hold, and leave slow — three segments, three curves. Using
it to stuff keyframes is keyframe-stuffing with extra steps; if the mid-segment is a hold, say so
with one key and one `hold`, never four"*); and `banned-defaults.md` gains a positive counterpart —
**the 6–10 fonts and 5 easings that are both available and not defaults**, computed once and stated.
Menlo goes on the banned list *with* the shortlist that replaces it.

---

### 8. The scale table and the "brand strict / composition free" contract

**Prevents:** #5 (max 96px on a 1080 canvas; 34px = 3.1% of frame width), #7 (one left column,
nothing below y=0.73), #6's flatness.

Two short documents, ~120 lines together, that encode nearly all of bay's layout failures:

- The web→video scale table (§5.1) plus the in-feed uplift (**body ≥32px, headlines ≥90px** — on
  1920; scaled to bay's 1080 width and the fact that a vertical reel is watched in-feed, the
  headline floor is **~200px**, which is what bay's own `layout.md` already asks for and did not
  get).
- *"Two focal points minimum · Fill the frame: hero text 60-80% of width · Anchor to edges;
  centered-and-floating is a web pattern · Split frames; zone-based layouts, not centered stacks ·
  Three layers minimum · Background is not empty."*
- The consumption contract: **strict on hex/family/weight-relationships/Don'ts, free on size,
  spacing, opacity, border weight, composition.** This is what prevents one spec from producing one
  template eight times.
- The squint test: **one display moment dominates at 3–6× its neighbour.**

**Ported to bay** — `layout.md` gains the scale table, a per-role `minPx` floor read from `frame.md`,
and three checks that are cheap and hard to game:

- `type-ratio` — largest type on frame / second-largest < **3×** → fire. (wicks-v2: ~1.1× for real
  content.)
- `dead-band` — any horizontal band ≥ **25%** of canvas height carrying no element, at any sampled
  time → fire. (wicks-v2: the bottom third-to-half of every frame.)
- `single-column` — > **60%** of elements share an x within ±0.02 → fire. (wicks-v2: 63 of 188 at
  x≈0.085.)

All three are ratios over the frame, so they cannot be satisfied by adding elements — which is
exactly the property bay's round-1 checks lacked.

---

### Where audio and voice sit in this ranking — and why they are not their own entry

EVIDENCE.md §10 and §11 are real failures of the same shape as the visual ones, but the prior art
does not contain a mixing doctrine to port. What it contains, and where it lands:

- **§10(a), the stepped bed.** Fixed by `extract-audio-data.py`'s per-frame RMS envelope driving
  volume keyframes on **one** bed element with asymmetric attack/release (§6.2). This is an
  algorithm transfer, not an architecture one — it sits inside idea 5's territory (assert
  `bedVolume` has ≥ N keyframes and never exceeds 1.0, and `check` verifies it).
- **§10(b), the stamped SFX.** Fixed by the per-beat `SFX cues` field (idea 6).
- **§10's real number — 160 move onsets in 61s.** Fixed by ideas 1 and 3, and it has to be fixed
  *first*: EVIDENCE.md is right that scoring a noisy video makes it louder noise.
- **§10(d), dynamic range as a goal.** No prior art. bay's `flat-mix` finding needs an LRA floor
  alongside the LUFS target; that is bay's own invention to make.
- **§11, the flat voice.** No prior art at all. Hyperframes would produce the same failure.

So: none of the five is a *ninth architectural idea*. Three are covered by ideas already ranked,
one is a script, and one is a genuine gap in the prior art that bay must answer alone.

---

## Closing observation

The failures in EVIDENCE.md are not failures of instruction-following. The agent followed every
rule it was given. They are failures of a system that asked the agent to **invent a shot** and then
graded the invention with counters.

Hyperframes never asks for an invention. It asks for a *route*, then a *brief*, then a *storyboard*,
then per frame a *blueprint id*, and only then for tool calls — and by that point the composition,
the pacing, the moves, and the palette have all already been chosen, in writing, by documents whose
taste was reverse-engineered from work that was already good. The checks that exist are almost all
either **closed-world set membership** (adherence), **assertions of this video's own stated intent**
(the motion sidecar), or **refusals to certify** (`sweep_static`). Not one of them is a diversity
count.

The order to port in, if it must be sequenced: **blueprints + storyboard first** (idea 1 and 6 are
one mechanism, and neither works alone), **`frame.md` + adherence second** (2), **the distribution
checks and `structure-degenerate` third** (3, 4), the rest as capacity allows.

---

## Appendix — files read

All 7 skills in full or in substantial part. Read end-to-end: `hyperframes/SKILL.md`,
`intent-interview.md`; `hyperframes-core/SKILL.md`, `storyboard-format.md`, `review-loop.md`,
`production-loop.md`; `hyperframes-animation/SKILL.md`, `rules-index.md`, `blueprints-index.md`,
`techniques.md`, **all 22 blueprints**, `rules/{spring-pop-entrance, waterfall-entry, nudge-curve,
multi-phase-camera, sine-wave-loop, kinetic-beat-slam}.md`, `adapters/gsap-easing-and-stagger.md`,
`transitions/overview.md`, `scripts/animation-map.mjs`; `hyperframes-creative/SKILL.md`, **all 16
references**, **all 9 palettes**, `frame-presets/code-editorial/FRAME.md`,
`scripts/contrast-report.mjs`, `scripts/extract-audio-data.py`; `hyperframes-keyframes/SKILL.md`;
`hyperframes-cli/SKILL.md`, `references/lint-validate-inspect.md`; `hyperframes-registry/SKILL.md`.
Line counts for every file in the family were taken with `wc -l` and are reported in §1.2.
