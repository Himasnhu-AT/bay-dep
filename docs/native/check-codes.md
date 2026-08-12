# `check` — every code, and what it was measured on

`check` is a pure pass over the project model (`bay-core/src/check.rs`). This is the register of
what it can say, what severity each code carries, and — for every code — **whether it fires on
the project the round-2 effort is about, and on that project's predecessors.**

That last column is the whole point of this document. The five perceptual checks shipped in
round 1 were never computed against the video they were written to catch, and all five passed
it. A code that has not been measured against real work is a hypothesis.

## The envelope

```
{ "status": "clean" | "findings" | "unevaluated",
  "findings": [ … ≤ 12 … ],          // worst first, one per code in rotation
  "rollup":   { "<code>": <count> }, // every code that fired, including what the cap left out
  "skipped":  [ { "code", "reason" } ],
  "stats":    { … },
  "errors", "warnings", "notes", "total" }
```

- **`status` is three-state.** `clean` means every check ran and none found anything.
  `unevaluated` means nothing was found *but a check could not run* — read `skipped` before
  treating it as a pass. There is no `ok` boolean any more: the report it replaced said
  `ok: true` on a project where 25 of its 27 codes could not fire by construction.
- **`findings` is capped at 12**, drawn one per code in rotation rather than truncated, so
  thirty of one code cannot hide one of another. The earlier report put its three true findings
  at position ~237 of 242.
- **`skipped` is the `spans()` lesson in one field.** A check that could not evaluate says so.
- **The rule set is capped too**: `MAX_GATING_CODES = 14` `Error` codes, asserted over the
  registry by a test that fails the build at 15. Adding one means deleting one. **It is now full
  at 14/14** — see the mix section below for the arithmetic that filled it.

## The gate

`render` calls `check` first and refuses while any `Error` stands. One escape:

```
render({ path, ignoreChecks: true, reason: "<at least 40 characters>" })
```

The reason is stamped into the job result **and** into the MP4's own `comment` metadata, where
it outlives the session that authorised it. There is no per-code suppression and there must
never be one — the first code anybody suppresses is the one that keeps firing.

## The codes

**Measured by `cargo test -p bay-core --test fixtures`, which always runs**, over the five
projects checked in under `rust/crates/bay-core/tests/fixtures/`. Columns:

| column | fixture | what it is |
|---|---|---|
| **wicks** | `wicks-v2.json` | `project-1786466680050`, the 62 s candlestick video this effort is about |
| **p-1** | `candlestick-wick-volatility.json` | `project-1786349139172`, its first predecessor, also condemned |
| **p-2** | `candlestick-wicks.json` | `project-1786342678843`, its second predecessor, also condemned |
| **R1** | `r1-locked.json` | the Palmier reply-screenshot demo — 3 elements, all from t = 0, none animated, one locked frame for 39.3 s |
| **R2** | `r2-accumulate.json` | the doodle explainer — 19 illustration and logo assets arriving on narration cues onto one blush ground and never leaving, 57.2 s |

R1 and R2 are hand-built from `prompt-res/12-video-teardowns.md` and
`prompt-res/round2/32-composition.md`; the other three are byte-for-byte copies of the real
projects. `skip` means the code could not evaluate and said so in `skipped` — **which is not a
zero.** The previous version of this table carried a sixth column, `small`, for two short starter
projects in one person's library; it is gone, because nothing in the repository can reproduce it.

| code | severity | wicks | p-1 | p-2 | R1 | R2 | notes |
|---|---|---|---|---|---|---|---|
| `zero-length` | error | 0 | 0 | 0 | 0 | 0 | structural |
| `before-zero` | error | 0 | 0 | 0 | 0 | 0 | structural |
| `missing-media` | error | 0 | 0 | **8** | 0 | 0 | p-2 references assets it never imported |
| `past-source-end` | error | 0 | skip | skip | 0 | 0 | skipped where nothing is probed |
| `missing-effect-asset` | error | 0 | 0 | 0 | 0 | 0 | structural |
| `transform-not-finite` | error | 0 | 0 | 0 | 0 | 0 | structural |
| `off-canvas` | error | 0 | 0 | 0 | 0 | 0 | structural |
| `nothing-visual` | error | 0 | 0 | 0 | 0 | 0 | structural |
| `empty-text` | error | 0 | 0 | 0 | 0 | 0 | structural |
| **`dead-plate`** | **error** | **1** | 0 | 0 | **0** | **0** | `panel`, 34.2 % of canvas at **1.10:1**. All four numbers met. No longer clearable by turning the plate down to 0.49, nor by jittering its colour a hex digit at a time. |
| **`empty-container`** | **error** | **2** | 0 | 0 | **0** | **0** | the same panel (7 marks over **1.8 %** of its own fill for 7.5 s) plus `sq`, 8.9 % of canvas holding one mark for 6.5 s — which used to be exempt for being drawn at under half opacity. All four numbers met. |
| **`value-overshoot`** | **error** | **1** | 0 | 0 | **0** | **0** | `m_a`, a bar eased to **110.0 %** of its own number. All four numbers met. |
| **`broken-continuity`** | **error** | **4** | 3 | 4 | skip | **0** | **repaired.** Was 2 / 1 / 3 / skip / **11** — 5.5× more on the reference than on the video it condemns. Now asks its question only of seams where the composition was *replaced*; see below. |
| **`speech-masked`** | **error** | skip | skip | skip | skip | skip | **never evaluated on anything — see below.** |
| `no-hook` | warning | 1 | 1 | 1 | 0 | **0** | was **1** on R2; the denominator was the video's median frame, which an accumulating video cannot match at its opening. Measured against the opening second instead — see below. |
| `small-text` | warning | 2 | 0 | 9 | 0 | 0 | |
| `unreadable-dwell` | warning | 0 | 1 | 0 | 0 | 0 | **ranks wicks-v2 best — see below** |
| `off-grid` | warning | 1 | 1 | 1 | 0 | 0 | fires on everything authored so far; deliberately not a gate |
| `animation-overruns` | warning | 0 | 0 | 0 | 0 | 0 | |
| `hidden-track-has-content` | warning | 0 | 0 | 0 | 0 | 0 | |
| `overlap` | warning | 0 | 0 | 3 | 0 | 0 | main lane only |
| `invisible` | warning | 0 | 0 | 0 | 0 | 0 | |
| `zero-scale` | warning | 0 | 0 | 0 | 0 | 0 | |
| `black-start` | warning | 0 | 0 | 0 | 0 | 0 | |
| `gap` | warning | 0 | 0 | 0 | 0 | 0 | |
| `monotone-easing` | warning | 0 | 0 | 0 | 0 | 0 | the whole-project form (`curves.len() == 1`) is **deleted**; only the sliding-window form remains |
| `monotone-duration` | warning | 0 | 0 | 0 | 0 | 0 | the earlier table said 1 on p-2; measured against the checked-in file it is 0. The whole-project ratio form is **deleted**; only the sliding-window and per-beat forms remain |
| `flat-mix` | warning | 6 | 0 | 10 | 0 | 0 | the fade clamp; it fired 0 before |
| **`bed-too-quiet`** | **warning** | skip | skip | skip | skip | skip | needs a measured asset; no fixture has both a bed and a voice |
| `no-bed` | warning | 0 | 1 | 0 | 0 | **1** | R2 is narration over silence, by design |
| `off-vocabulary-motion` | warning | 125 | 139 | 93 | **0** | **0** | every real project predates the move registry; both references are built from it |
| `off-token-value` | warning | 0 | 0 | 0 | 0 | 0 | only projects with a committed kit can fire it, and none of the five has one |
| `silent` | note | 0 | 0 | 0 | 0 | 0 | |
| `one-scene` | note | 0 | 0 | 0 | **1** | 0 | R1 declares no beats at all, which is the whole shape of it |

### Commitment 4, evaluated

Plan §1.4 commitment 4: a gating code ships only with four numbers — fires on wicks-v2, silent on
R1, silent on R2, and does not rank wicks-v2 above its own predecessors. Against the five
fixtures:

| | codes | |
|---|---|---|
| **meet all four** | `dead-plate`, `empty-container`, `value-overshoot`, `broken-continuity` | wicks-v2 1 / 2 / 1 / 4, and 0 on both references |
| **correctly silent** | the nine structural codes | none of the five projects has a NaN transform or a zero-length element; their silence is the right answer, and it is now measured rather than assumed |
| **unmeasured** | `speech-masked` | `skip` on all five |

Thirteen of the fourteen are honest. One is not — `speech-masked` — and it holds the last slot in
`MAX_GATING_CODES = 14`. The budget arithmetic is unchanged by this repair: no code was added or
removed, so the count is still 14.

### Four codes that decide the render, and why they are the four

`dead-plate`, `empty-container` and `value-overshoot` fire **on wicks-v2 and on nothing else** —
including the two predecessors that this effort agrees are also bad, and including both
references. `broken-continuity` fires 4 on wicks-v2, 3 and 4 on the two predecessors, and 0 on
both references. That is the separation a gating code has to show before it is allowed to block
an encode.

Each names a different failure of the same object: the panel is 34.2 % of the canvas, it cannot
be seen against the ground it sits on, and it is empty. The bar is a separate element and a
separate claim — its size *is* its number, and `back-out` draws 110 % of it for a quarter of a
second.

### The mix, and the budget arithmetic that shaped it

**One code left the registry and two joined it.** `gain-above-unity` was deleted; `speech-masked`
and `bed-too-quiet` replace it.

The gating budget is `MAX_GATING_CODES = 14` and thirteen `Error` codes already existed, so
**exactly one gating slot was free** — and `gain-above-unity` was a *warning*, so deleting it
freed none. Both new codes cannot be errors. The slot went to `speech-masked` for a reason the
plan states itself: a gating rule may be a difference between two measured states, and may not be
a one-sided threshold over the project JSON. `speech-masked` is the first shape; `bed-too-quiet`
is an absolute floor, which is the second, so it ships as a warning. **The budget is now full at
14/14.** The next gating code requires deleting one, which is the argument the number exists to
force.

*What that costs, stated:* the pair is meant to bracket the answer from both sides, and only one
side gates. An agent that deletes its bed clears `speech-masked` and collects a warning. If that
is ever observed, the fix is to spend a slot on `bed-too-quiet`, not to raise the budget.

**Why `gain-above-unity` went.** It fired on **22 elements** of wicks-v2 (16 of them harmless —
six were bay's own `narrate` output at its own default), it measured a dimensionless multiplier,
and it was satisfiable by scaling every gain down by a constant, which changes no relative level,
is inaudible, and is undone by `loudnorm` on the way out. It certified the bad mix and pointed
away from the real defect. Reconstructed sample-accurately, `vol: 2.0` was never near the
limiter: the bed peaks at −12.5 dBFS in the summed mix, the narration at −0.6, and the mix at
−0.60 dBFS with **zero samples over full scale**. `bed.wav` peaks at −23.8 dBFS and integrates to
−35.3 LUFS; `2.0` was a rational response to a very quiet asset and still about 9 LU short.

**What replaced it is measured, not typed.** `media_import` now runs `ebur128` + `volumedetect`
and stores `{lufs, peakDb, rmsDb, accentSeconds}` on the asset (`audio_probe` does the same for a
file imported earlier). `check` builds a mix envelope from those measurements and the project's
own gain envelope, normalises it the way `loudnorm` does (`I = −14 LUFS`), and reports:

| stat | wicks-v2 |
|---|---|
| `stats.mix.narrationLufs` | −15.0 |
| `stats.mix.gapLufs` | −19.9 |
| `stats.mix.separationLu` | **4.9** (floor is 6.0) |
| `stats.mix.gapBedLufs` | −19.9 (floor is −26.0) |
| `stats.mix.peakAtSeconds` | 18.0 |
| `stats.mix.payoffAtSeconds` | *none — the project has no markers at all* |

**Those numbers are not in the project file, and `speech-masked` therefore never runs.** The
table above is what the mix envelope reports once the assets have been probed. `wicks-v2.json`
as it is checked in — and as it sits in the library — carries **no `loudness` on any of its
sixteen assets**, so `stats.mix.unmeasured` lists all sixteen, both mix codes land in `skipped`,
and the code fires zero times. The same is true of both predecessors. R1 has a measured bed and
no narration; R2 has measured narration and no bed. **`speech-masked` has never been evaluated
against a single real project**, which is the whole failure mode this document exists to make
visible, in the one row that was written as though it had been.

Its earlier wicks-v2 column read `1†`, with the caveat that two of the six narration WAVs on disk
had been truncated to about a third of their length by a later `narrate` run and now measure 7 LU
louder: against the files as they stand the project separates by **11.2 LU** and the code is
silent, and with those two restored to what their four untruncated siblings measure (−25.8 LUFS)
it separates by **4.9 LU** and fires. That is a measurement of some WAVs in a folder, made by
hand; it is not a measurement of the project, and the project is what `check` reads.

**Deliberately not measured: loudness range.** R1 measures 6.7 LU, wicks-v2 3.5, and **R2 — the
reference we most admire — 2.3**. A ≥6 LU floor condemns R2 by 2.6×. Dynamic range is the trap
the previous round fell into with integrated loudness, and it is not repeated here.

**The argmax ships as a stat, not as a code.** "The loudest 400 ms falls within 1.5 s of a
`payoff` marker" is in `stats.mix.peakAtPayoff`, and it is `null` when there is no marker. No
project in the corpus has a single marker, so a code for it would fire on every project that has
never heard of the convention — which is round 1's mistake — and there is no gating slot for it
anyway. Promote it once the skill teaches the convention and a slot is freed.

**`flat-mix` was clamped, not replaced.** It fired **0 times** on wicks-v2 and now fires **6**,
on the same clips and the same 4.3 dB separation. The window used to end the moment either level
reached zero anywhere in the overlap — which a fade does by definition — so adding a 0.3 s
`fadeIn` took it from six findings to zero with nothing about the mix changed. All 13 bed clips
in wicks-v2 carry exactly that fade. The window now excludes both clips' fades instead of ending
at them; a *keyframed* zero inside the window is still total separation and still ends the
comparison. A check a bad video silences with a cosmetic edit certifies the mix.

### Two codes that are deliberately **not** gates

- **`off-grid`** fires on all three real projects (89 of 300 authored start/duration values on
  wicks-v2; 115 of 182 on p-1). Nothing in the tool surface snaps a time to a frame, so gating on
  it would mean every existing project needing the override on its first render — which is how an
  override becomes habitual, and a habitual override is worth less than the rule it bypasses. The
  fix is upstream, in a tool that rounds. It is 0 on both references only because they were
  authored by hand onto the frame grid, which is what the upstream fix would make automatic.
- **`unreadable-dwell`** fires **0 times on wicks-v2** and once on a predecessor. The plan
  predicted 33 fires; every one of those 33 is a `narrate` caption, and
  captions are excluded here because bay times its own cues (`bay_speech::MIN_CUE_SECONDS`) and
  a check that fires on the tool's house style is the kind that teaches an agent to stop
  reading. Scoped to authored text it *ranks wicks-v2 best on its own axis*, which is exactly the
  inversion this round exists to avoid — so it ships as a warning and is not allowed to gate.

### Cost

The whole pass samples the composited frame at 10 Hz, and now the mix envelope at 10 Hz too. On
the 188-element, 62-second project with 69 audio clips: **6.4 ms in release**, 50 ms in a debug
build. The plan's budget is 50 ms in release, and the reason it has one is that the previous
`check` was called twice in 455 tool calls — a rule nobody runs takes every other rule with it.
The envelope is built once per pass and read twice, by the findings and by `stats`.

### What the references say, now that they exist

The R1 and R2 columns are the whole reason this table changed, and three of the things they say
are worth more than the numbers.

**1. `broken-continuity` condemned R2 eleven times out of thirteen seams, and does not now.**
The rule asked that consecutive beats share an element that *moved* — never by opacity,
deliberately. R2's entire idiom is that assets arrive on the narrated word and then hold still
while the argument accumulates around them, so eleven of its thirteen seams carried nothing that
moves. The two that passed were the two act breaks the teardown singles out, where a stick figure
walks to a chalkboard. The rule worked exactly as designed; **the premise was wrong.**

*Accumulation is continuity.* An element present in both beats that never left is stronger
evidence of one continuous composition than one that wiggled. The rule now asks its question only
of seams where the composition was **replaced**: at least `REPLACED_SHARE = 25 %` of the earlier
beat's rendered area is gone at the next one. Measured across the fixtures, R1 and R2 depart
**0 %** at every seam they have; the three condemned videos depart 23–92 %; a carousel departs
100 % by construction. On a replaced seam the question is unchanged — something has to survive it
and have changed — with two qualifiers the first version was missing, because without them one
`add_shape` and one `animate` bought the whole rule:

- the survivor must occupy at least `CARRIED_AREA = 1 %` of the canvas, so a token in a corner is
  not what holds a video together; and
- **drift never counts.** A channel of two keys spanning more than 90 % of the runtime is ambient
  liveness — it is never *at* a seam, only ever passing through one.

**2. R1's clean column on that code was two exemptions, not a pass — and one of them is gone.**
First, R1 has no narration and no markers, so its beats fall back to eight-second windows and the
rule declines to run. That one stands: a seam a clock invented is not a seam. Give it the three
markers `one-scene` asks for and it evaluates — and it used to still find nothing, because
`carried` returned true for any `Element::Video` on the grounds that its frames advance where the
project model cannot see them, and R1's centre is a screen recording. Swapping that one clip for
a still and changing nothing else condemned the identical locked frame at every seam. **The rule
was measuring the element *kind* of the thing holding a composition together.** The
`Element::Video` exemption is deleted; R1 with markers now reports 0 whether its centre is a clip
or a still, and for the same reason R2 does — neither ever takes anything away
(`r1_and_r2_are_silent_on_broken_continuity_for_the_same_reason`).

The positive control matters as much: cut every R2 asset except the ground and the stick figure to
two seconds, so each beat replaces the last instead of joining it, and eight of the thirteen seams
are condemned — and **neither act break is among them**
(`r2_is_silent_because_nothing_leaves_it_not_because_nothing_moves`).

**3. `no-hook` fired on R2, and does not now.** Its docstring said the relative form exists
because the absolute forms all fire on the reference explainer; measured against the reference
explainer, the relative form fired too. R2 opens on a proverb pull-quote carrying 2.83 % of the
canvas against a median frame of 15.32 % — 18 % of its own weight, where the rule wanted 60 % —
because a video whose frame *fills over its runtime* has a median denser than any opening it could
have. **Density was never what separated the references from the four condemned videos. Waiting
was:** all four are literally blank at 0.40 s and stay blank until 0.8 s, 1.3 s and 2.0 s, while
both references are already showing what they open with. So the denominator is what the frame
reaches inside its own first second (`HOOK_SETTLED = 1.0`), and the instant slides to the first
sample inside that second which reads at all — otherwise an ordinary one-second fade composites
below 4.5:1 at 0.40 s, puts down exactly zero ink, and every normal entrance is a blank opening.
The number is still sensitive to the glyph-ink model (`GLYPH_INK = 0.12`), and R2's marker-face
lettering is considerably heavier than that.

**4. The whole-project forms of `monotone-easing` and `monotone-duration` are deleted.** They were
a distinct-value cardinality (`curves.len() == 1`) and a one-sided global ratio
(`longest / shortest < MIN_MOVE_RATIO`) over the project JSON — the two shapes plan §1.4 rejects
on sight, and the two round 1 shipped and had answered with 130 `hold` keys on flat segments and
one 11.7 s move among 76 of 0.098 s. They also fire on a project whose forty assets share one
motion idea *by design*, which plan §1.3 explicitly protects. The sliding-window forms — the
two-sided shape the plan keeps — remain, and are silent on both references.

Also worth stating plainly: **neither reference commits a `StyleKit`**, so `off-token-value`
cannot fire on either, and neither can be used to measure it. Both are reconstructions of videos
made elsewhere, and a kit invented for them would be a measurement of the invented kit.

### How R1 and R2 were built

Both are hand-built bay projects, not exports of anything. Every value in them comes from a
measurement in the teardowns rather than from what a check would like:

- **R1** — 720 × 1280 at 20 fps, 39.3 s, background `#000000`. Three visual elements, all
  starting at t = 0 and none animated: the reply screenshot (`hook`, 9.9 % of the canvas), the
  Palmier screen recording (25.4 % of the canvas — so **74.6 % of every frame never changes**,
  against the teardown's "roughly 70–75 %"), and the reply line at the bottom. One music bed at
  −14.0 LUFS, which is what the teardown measured and the largest single gap between the
  references and our own work. Two imported picture assets and one audio asset.
- **R2** — 1080 × 1920 at 30 fps, 57.2 s, one blush `#FCF3F5` ground for the whole runtime.
  Fourteen narration lines, nineteen illustration and logo assets arriving on those cues and
  never leaving, twenty-three phrase-level captions carrying `source: tool` and `caption-<n>`
  ids because `narrate` wrote them. Zero cuts. **One motion idea shared by every asset**:
  `swell` out of the move registry, keyed exactly as `apply_move` writes it, which is why
  `off-vocabulary-motion` reports 0 on a project with 60 elements. The two act breaks are the
  stick figure walking, keyed as `sweep`. Largest type is the 58 px proverb; captions are 46 px,
  which is the ramp's own caption step.

Run the measurement:

```sh
cargo test -p bay-core --test fixtures
```

### The exploratory run over a private library

`corpus.rs` still exists and is still env-gated, for finding something the five fixtures do not
contain. It is not the measurement — with the variable unset it prints "skipped" and passes,
which is how five unmeasured gating codes shipped:

```sh
BAY_CHECK_CORPUS="$HOME/Library/Application Support/vii/projects" \
  cargo test -p bay-core --test corpus -- --nocapture
```
