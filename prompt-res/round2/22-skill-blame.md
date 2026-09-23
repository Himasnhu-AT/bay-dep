> **Historical:** describes the Rust engine, deleted; recover what it cites with `git show rust-engine-final:dep/rust/<path>` (e.g. `crates/bay-mcp/src/tools.rs`).

# 22 — Skill blame: what advice produced wicks-v2

Area: audit of `.claude/skills/bay/` (SKILL.md + 9 references, 2,197 lines / 17,885 words /
~108 KB ≈ 27k tokens).

**Headline: the agent read 8 of the 9 reference files in full and obeyed them. wicks-v2 is not a
skill-compliance failure — it is the skill executed correctly. Every measured defect traces to a
literal, a range endpoint, a conditional premise, or a named-bad-example inside these files.**

Producing session: `~/.claude/projects/-Users-himanshu-codes-synthai-vii/1ba87d60-….jsonl`.
Skill files it Read: `motion.md`, `layout.md`, `banned-defaults.md`, `tools.md`, `narration.md`,
`audio.md`, `recipes.md`, `charts.md`. Not read: `troubleshooting.md`.
So "too long to be followed" is falsified as the failure mode. It was followed.

---

## 0. The measurement basis

Re-measured from `project-1786466680050.json` (ticks = 120,000/s, not 1e6 — earlier readings
that divided by 1e6 were 8.33× short) and from six frames pulled out of the encoded MP4.

| Quantity | Measured |
|---|---|
| scenes | **1** (`scenes[]` length 1), 188 elements, 62.0 s |
| animated channels | 172: opacity **107**, x 19, y 17, scale 11, scaleY 10, scaleX 8 |
| elements animated on **opacity only** | **66** |
| elements with **no animation at all** | **69** — so 135/188 (72%) never move a pixel of geometry |
| animation segments | 435 total: 245 carry a value change, **190 are flat (44%)** |
| moving segments ≤ 0.15 s | **82 / 245**; the mode is **76 segments at exactly 0.100 s** (3 frames), all opacity |
| slowest / fastest move | 11.7 s / 0.10 s = **117×** |
| easing occurrences | `key:hold` **121**, `linear` 79, `key:linear` 62, `ease-out` 58, `power4-out` 12, `key:power-out` 10, `hold` 9 … `spring-out` **2**, `key:spring-out` 2 |
| fonts | Menlo ×69, Baskerville ×4 |
| font weights | 700 ×51, 400 ×22 |
| fontSize | 34 ×41, 26 ×11, 30 ×4, 38 ×4, 24 ×3, 62 ×2, 58 ×2, 22 ×2, then singletons; **max 96** |
| colours | all **7** layout.md palette tokens present, + 5 invented greys incl. `#4A4A58` |
| x placement | 0.08 ×38 + 0.0889 ×25 = **53% of 119 visual elements in one gutter**; 21% have their centre right of x=0.55 |
| y placement | **max y = 0.735 across all 188 elements**; zero elements below y=0.78 |
| rendered ink, bottom quarter of frame | **0.00%** at t = 9, 19, 29, 45 s; 1.16% at 56 s |
| rendered ink at t = 0.5 s | **0.08%**, entirely in the top quarter |
| media assets | 16, **all audio**. `add_image` calls: **0**. `add_video` calls: **0**. |
| tool-call counts | animate 94, add_audio 64, add_shape 46, add_text 35, animate_many 24, snapshot 15, **check 2**, mask_set 1, effect_add 0, transition_add 0, template_place 0, looks_list 0 |

---

## 1. Blame table — outcome → the line that caused it

### 1.1 Monospace everywhere (Menlo 69/73 text elements)

| file:line | text | mechanism |
|---|---|---|
| `layout.md:68` | "Display face for headlines and body; **mono for every figure, label, ticker and formula**." | role assignment |
| `layout.md:69` | "Numbers are always mono. Kickers are mono, uppercase, letterspaced ~0.18em." | role assignment |
| `banned-defaults.md:70` | "**Numbers are always mono**, at every size, in every video." | role assignment, restated |
| `charts.md:67-68` | `START  +50%  −50%  ← caption, muted, mono, 40` / `100 150 75 ← value, coloured, mono, 68` | role assignment, restated |
| `motion.md:261` | "Mono, always — proportional digits jitter horizontally" | role assignment, restated |
| `layout.md:71` | "On macOS: `Helvetica Neue` + `Menlo` is a solid default pair." | **names the default** |
| `recipes.md:17` | `fonts_check { "families": ["Helvetica Neue", "Menlo"] }` | literal in first code block |
| `recipes.md:196`, `motion.md:257` | `"fontFamily": "Menlo", "fontSize": 200` | literal ×2 |
| `tools.md:66` | `{ "families": ["Helvetica Neue", "Menlo"] }` | literal |
| `banned-defaults.md:59`, `tools.md:73` | "Menlo, Monaco, Courier New, PT Mono, Andale Mono (mono)" | Menlo is first in both lists |

The skill assigns mono to: figures, labels, tickers, formulas, kickers, axis ticks, units, chart
captions, chart values, count-ups. On a finance explainer that is every role except the headline.
**Menlo 95% is the pairing rule executed correctly.** `Menlo` appears in 5 of 10 files and is the
only mono in every code example. Nothing anywhere caps a family's share.

Verified from the session: the agent's single `fonts_check` call passed
`["Baskerville","Menlo","Didot","Futura","Optima","Avenir Next","Helvetica Neue","Georgia",
"Palatino","PT Mono","Monaco"]` — the exact union of `banned-defaults.md:58-59` and
`tools.md:72-73`. It chose from the list it was given and used the list's first mono.

### 1.2 The 400/700 weights — the skill named the wrong answer and got it back

`banned-defaults.md:68`: *"**Weight contrast must be extreme.** 400 vs 700 is a web distinction;
video needs 300 vs 900."*

Project: `fontWeight` 700 ×51, 400 ×22. **Exactly the pair the line names as wrong.** Stating the
bad values supplies the tokens; the polarity is the part that does not survive.

Worse, the rule is **unsatisfiable with the fonts the same file recommends**. Measured from
`system_profiler SPFontsDataType` on this machine:

| family (from `banned-defaults.md:58-59`) | styles installed | 300? | 900? |
|---|---|---|---|
| Menlo | Regular, Bold (+italics) | no | no |
| Monaco | Regular | no | no |
| Courier New | Regular, Bold | no | no |
| PT Mono | Regular, Bold | no | no |
| Andale Mono | Regular | no | no |
| Baskerville | Regular, SemiBold, Bold | no | no |

**Every mono the skill recommends ships at most two weights**, and the skill also mandates mono
for most of the frame. Two rules in one file contradict each other. An unsatisfiable rule teaches
the agent to discount the section it sits in.

### 1.3 34 px type, 96 px ceiling

Every fontSize in the shipped video is an endpoint of a `layout.md` range — and, except one, the
**low** endpoint.

| shipped | count | source | position in source |
|---|---:|---|---|
| 34 | 41 | `layout.md:55` body **34**–54 | low end |
| 24 | 3 | `layout.md:57` label **24**–40 | low end |
| 62 | 2 | `layout.md:54` headline **62**–96 | low end |
| 38 | 4 | `recipes.md:297` `captionFontSize: 38`; `troubleshooting.md:53` "~38" | literal |
| 52 | 1 | `recipes.md:328` `captionFontSize: 52` | literal |
| **96** | 1 | **`recipes.md:20` `"fontSize": 96`** — the only fontSize literal in §1 "Minimum viable reel", the first code block in the most-copied file | literal |
| 180–300 (hero) | **0** | `layout.md:52` | never used |

`layout.md:59` ("**Hero figures must be ≥200px on screen**") and `banned-defaults.md:90` ("A hero
number at body size … ≥200px on screen") are both **conditional on the role "hero figure"**. The
agent never designated one, so neither rule ever applied. There is no unconditional rule of the
form "the largest thing on screen must be ≥ N".

The lint agrees with the low end: `check.rs:114` `MIN_LEGIBLE_TEXT_FRACTION = 0.022` of canvas
height ⇒ on 1920 the floor is `fontSize ≈ 23.8`. **34 renders at 60 px = 3.15% and passes with
43% margin.** The skill's floor and the lint's floor were drafted to agree, and both are far below
"reads at thumbnail".

### 1.4 90% opacity animation

| file:line | text | mechanism |
|---|---|---|
| `motion.md:240` | "**Binary opacity.** Use `easing: "hold"` with keys `[{t:0,value:0},{t:cue,value:1}]` so the positional move carries the entrance." | **conditional premise** ("the positional move") applied unconditionally — 66 elements have opacity and nothing else |
| `recipes.md:166-171` | `animate_many { "property": "opacity", "from": 0, "to": 1, "duration": 0.01, … "easing": "hold" }` | copyable 0.01 s (1/3 frame) opacity step |
| `recipes.md:118-128` / `motion.md:209-213` | **FADE — opacity only.** "One per scene at most." | a per-scene cap on a one-scene project = one cap for 61 s. Shipped: 66. |
| `recipes.md:24-25, 64-69, 93-95, 112-116` | every entrance recipe (2a/2b/2c) pairs a positional channel with an opacity channel | opacity is in 4 of 4 entrance examples |
| `motion.md:365-372` | "What to check before you ship": counts **distinct elements arriving**, **arrival distribution**, **mid-scene frame change**, **distinct easings and durations** | **the round-1 metric list. It does not measure which property moves.** |

There is no statement anywhere in 2,197 lines that constrains the *distribution of animated
properties*, and no statement that an element whose only animated channel is opacity is a defect.

### 1.5 The 3-frame pop (76 moves at 0.100 s)

| file:line | text | mechanism |
|---|---|---|
| `recipes.md:169` | `"duration": 0.01` on the binary-opacity `animate_many` | the skill's only stated opacity move duration is **0.3 frames** |
| `motion.md:126-139` | the easing allocation table's "Typical duration" column: `hold` → **"n/a"**, `linear` → **"matches its move"** | the two easings the agent used most (linear 141, hold 130) are exactly the two rows with **no duration constraint** |
| `motion.md:86` | "The slowest move in a video should be about **3× the fastest**." | stated as a required **spread** with no ceiling and no floor on the fastest. Shipped ratio: **117×** — the rule was *over*-satisfied by making moves absurdly short |
| everywhere | — | **no minimum move duration exists in the skill.** Its shortest listed value is 0.2 s (`power-in`/`ease-in`), stated as "typical", not as a floor |

### 1.6 `hold` became the most-used easing (121 of 130 are per-key)

The per-key easing feature is explained **four times**, and the canonical example is duplicated
byte-for-byte in two files:

- `SKILL.md:140-143`
- `motion.md:147-173` — the 5-key example at lines 156-165
- `recipes.md:211-236` — **the same 5 keys, identical values**, at lines 219-227
- `tools.md:131-133`

Of the four per-key easings in that example, **two are `hold` on flat segments**. And both copies
then explicitly bless the no-op:

> `motion.md:171-172` — "the `hold` on a flat segment **states intent rather than changing the
> output**."
> `recipes.md:234-236` — "The `hold` keys on the flat segments are **stating intent rather than
> changing the output**."

Shipped: **190 of 435 segments are flat, and 121 keys carry an explicit `hold`.** The skill taught
the agent to write keyframes that render nothing and document intent. Under a round-1 metric that
counts *distinct easing values*, a no-op key is free diversity. **The skill wrote the exploit.**

Five further sanctioned `hold` sites: `recipes.md:170`, `motion.md:240`, `charts.md:89`,
`motion.md:138`, `tools.md:143`.

Contrast: `spring-out` — called "the house entrance" in **four** places (`SKILL.md:144`,
`motion.md:23`, `motion.md:126`, `tools.md:139`) and once more in `tools.rs:327`'s own schema
description — was used **4 times in 188 elements**. Repetition of a *name* does not produce use;
repetition of a *code literal* does.

### 1.7 One 61-second scene — the skill's unit of measurement does not exist in the API

**There is no scene tool.** `bay-mcp/src/tools.rs::definitions()` registers 55 tools; none
creates, names, splits or selects a scene. `studio.rs` writes only ever to
`project.active_scene()` (studio.rs:328, 477-502, 798, 1000, 1040, 1096), and studio.rs:1151
comments "A project with one empty scene — the starting point every reel is built up from."
**The MCP surface is single-scene by construction.**

`tools.md` is 360 lines documenting all 55 tools and contains the word "scene" **zero times**
(`grep -c scene references/tools.md` → 0).

Meanwhile "scene" is the unit of nearly every rule in the skill — 20 occurrences in motion.md, 14
in recipes.md, 6 in SKILL.md, 5 in banned-defaults.md, 4 in layout.md:

| file:line | rule, per scene |
|---|---|
| `motion.md:81-83` | "No two *independent* moves in a scene may share an easing" |
| `motion.md:90` | "Don't reuse one stagger. Each scene needs its own rhythm." |
| `motion.md:95` | "Don't put ambient motion on every scene." |
| `motion.md:100-108` | build 0–30% / breathe 30–70% / resolve 70–100% |
| `motion.md:212` | FADE: "One per scene at most" |
| `motion.md:279` | PUNCH: "never on more than one element per scene" |
| `motion.md:289` | JITTER: "One element per scene" |
| `motion.md:366-370` | the ship-check, all four questions "for each scene" |
| `banned-defaults.md:33-38` | "At least three layers per scene", "Two focal points minimum", "two to five [background elements] per scene" |
| `layout.md:83` | accent "one element per scene" |
| `SKILL.md:176-181` | the four banned defaults, all per scene |

**With one scene, every one of these became a per-video rule satisfied once, and every per-scene
check in `check.rs` (`inert-scene`, `front-loaded`, `no-accumulation`, `monotone-easing`,
`monotone-duration`) evaluated a single 62-second bucket.**

The skill never says how many scenes a video should have, how long one should be, or how to make
one. Its only quantitative statement about scene count is a *negative example*:
`motion.md:87` "three scenes at 10.5 / 10.0 / 9.6s is a defect" and `banned-defaults.md:96`
"Uniform scene lengths… Vary by 3×". `recipes.md:340-375` ("A seam between two scenes")
implements a scene boundary purely as element animation — which is the only thing the API can
express, and which means "scene" is a fiction the author holds in their head with no
representation any tool or check can see.

### 1.8 One left column, empty bottom

| file:line | text | shipped |
|---|---|---|
| `layout.md:27` | "**Left gutter 96px** → `x: 0.089`" | 96/1080 = 0.088889 exactly — **25 elements carry that float**, 38 more carry 0.08. 53% of 119 visual elements in one gutter. |
| `layout.md:28` | "Content width 804px → a text box of `scale: 0.744`" | `scale: 0.744` ×13 |
| `layout.md:15,69` | kicker "tracked 0.18em" | `letterSpacing: 0.18` ×7 |
| `recipes.md:22` | `"x": 0.089, "y": 0.40, "anchorX": 0, "anchorY": 0, "scale": 0.744` | all four literals shipped |
| `layout.md:13-22` | the ASCII canvas: **one** named slot (KICKER, top-left), a blank labelled "content lives here", and two keep-outs | the video is exactly this |
| `layout.md:29` | "**Bottom 420px** is the caption band; **right 180px** is the action rail. **Keep both clear.**" | max element y = **0.735**; zero elements below 0.78; bottom quarter of the rendered frame = **0.00% ink** in 5 of 6 samples |
| `layout.md:30-31` | "Leaving 900px of dead space at the bottom is a real defect — the last element should sit around y≈1400–1450" | lowest element = 0.735 × 1920 = **1411 px**. **Rule satisfied exactly.** |

`layout.md:30-31` is the round-1 fix for the empty-bottom problem, and it is a **point constraint
on one element**, not an area constraint on the frame. One intermittent 34 px caption line at
y=0.735 satisfies it while leaving everything below y≈0.69 empty for the whole runtime. This is
the cleanest single case of Goodhart in the file: the rule was written, obeyed to the pixel, and
the defect it was written to fix is still there.

`banned-defaults.md:85` forbids "Everything centred … anchor to edges, split the frame, zone the
layout" — it forbids the alternative and names no geometry; `layout.md` supplies exactly one edge
to anchor to. Nothing anywhere constrains horizontal variety, ink distribution, or how many
distinct x anchors a video needs.

### 1.9 The blank hook (0.08% ink at t=0.5 s)

| file:line | text |
|---|---|
| `banned-defaults.md:98-99` | "A hook that is not a hook. One of ours opened on 0.87s of silence followed by a glossary; **another opened at 0.78% ink.**" — names the failure, **states no threshold** |
| `layout.md:135-137` | "**a small kicker is ~0.1% of the frame and perfectly legible**, so 'blank' has to mean *no ink at all*, not 'little ink': **do not judge a frame by how much of it is covered**." |
| `motion.md:364` | "**Ink coverage is the wrong metric** — a good reference video is 60–90% empty frame." |

Round 1 added two lines that pre-emptively disarm the only measurement that would have caught the
blank hook, and then quoted 0.78% as an example of a bad opening without making it a limit. The
new video opens at **0.08%** — an order of magnitude below the number the skill cites as a defect,
and just below the 0.1% the skill certifies as "perfectly legible".

### 1.10 The palette is layout.md's table, verbatim

`layout.md:79-87` is a 7-row table of hex values. All 7 appear in the project:
`#0E0E12` (ground), `#EDECE6` ×48, `#A8A8B0` ×3, `#73737E` ×19, `#FF5B5B` ×15, `#8A93A3` ×7,
`#606070` ×2. Plus five invented dark greys — one of which is **`#4A4A58`, the value
`layout.md:97` labels "2.21:1 — still too low"**. The agent mined the contrast table for hex
codes and used the one marked as failing.

`layout.md:83` — accent "`#FF5B5B` — **scarce** — one element per scene, always the point". One
scene ⇒ 15 accent uses all "in one scene". Rule satisfied, meaning inverted.

Nothing requires the palette to be derived from the subject. A table of hex codes is the strongest
copy attractor a document can contain.

### 1.11 No image, no video, in 61 seconds

`add_image` calls: 0. `add_video` calls: 0. All 16 media assets are audio.

`banned-defaults.md:33-38` is the rule that was supposed to fix this. Its own list of background
treatments is:

> "Ghost type at 3–8% opacity bleeding off frame, a hairline rule, a colour panel, a dot lattice,
> **a shape at low opacity behind the content.** Two to five per scene."

Four of five options need no asset. The cheapest compliant option was taken: 46 `add_shape` calls,
zero images. `banned-defaults.md:38-39`'s escape hatch — "If the piece genuinely has no assets,
**say so and get some**" — requires the agent to first conclude the piece has *genuinely* no
assets, which it will never conclude while the shape option is offered on the line above.
`SKILL.md:178-180` restates the same rule with the same permission.

---

## 2. The skill as an artifact

### 2.1 Size is not the problem — the producing agent read almost all of it

| file | lines | code lines | code % | `never`/`don't`/`no` | `must`/`always`/`every` | soft (`prefer`,`should`,`usually`,`good default`) | numeric literals |
|---|---:|---:|---:|---:|---:|---:|---:|
| SKILL.md | 192 | 4 | 2% | 11 | 10 | 4 | 3 |
| recipes.md | 420 | **217** | **51%** | 4 | 6 | 1 | 5 |
| motion.md | 377 | 22 | 5% | 18 | 10 | 3 | 43 |
| tools.md | 361 | 16 | 4% | 5 | 12 | 7 | 3 |
| audio.md | 195 | 27 | 13% | 2 | 8 | 1 | 23 |
| narration.md | 149 | 6 | 4% | 3 | 3 | 5 | 2 |
| troubleshooting.md | 144 | 6 | 4% | 1 | 2 | 1 | 1 |
| layout.md | 138 | 17 | 12% | 3 | 9 | 5 | 22 |
| charts.md | 114 | 22 | 19% | 1 | 8 | 2 | 5 |
| banned-defaults.md | 107 | 0 | 0% | 7 | 12 | 4 | 4 |
| **total** | **2,197** | **337** | **15%** | 55 | 80 | 33 | 111 |

The transfer channel is **code, not prose**. `recipes.md` is 51% copyable code, has the *lowest*
prohibition density in the skill (4 negations in 420 lines), and supplied the shipped video's
gutter (0.089), box (0.744), ceiling fontSize (96), ground (`#0E0E12`), primary type colour
(`#EDECE6`), mono family (Menlo), the `hold`-on-flat-segment pattern, and the sub-frame opacity
duration (0.01). `banned-defaults.md` is 0% code, has the highest prohibition density, and its
most specific rule (`:68`, weights) came back inverted.

**Rule: a value that appears inside a fenced block is a default. A value that appears in prose is
a suggestion. A value that appears in prose as a bad example is a default.**

### 2.2 Which parts a model actually obeys

The only reliable predictor in the corpus is **ordered numbered lists**. There are four:

| checklist | file:line | followed? |
|---|---|---|
| the 10-step loop | `SKILL.md:74-95` | **yes, in order** — project_create → fonts_check → media_import → add_* → animate/animate_many → narrate → sfx+bed → check → snapshot → render all appear in the call log in that sequence |
| the three audio requirements | `audio.md:18-20` | **yes** — bed, 63 SFX, `preset: "social"`, −13.9 LUFS measured |
| the four ship questions | `motion.md:366-372` | **yes — and this is what got gamed** (distinct easings, distinct durations) |
| chart honesty | `charts.md:106-113` | n/a, no chart |

**There is no ordered checklist for composition, typography, colour, scene structure, or asset
sourcing.** Those live in prose and reference tables — and those are precisely the four axes that
failed. The correlation is exact: everything the skill numbered was executed; everything it
narrated was approximated.

### 2.3 Structural defects independent of content

1. **Duplication as endorsement.** The per-key easing feature appears 4× (SKILL.md:140-143,
   motion.md:147-173, recipes.md:211-236, tools.md:131-133) with the same example verbatim twice.
   The easing allocation appears 3× (SKILL.md:144-146, motion.md:120-144, tools.md:135-146). The
   "three layers per scene" rule appears 2× (SKILL.md:178-180, banned-defaults.md:33-38). Every
   duplicated *feature* got over-used; every duplicated *prohibition* did not get obeyed more.
2. **Per-scene rules against a scene-less API** (§1.7). ~15 rules are unenforceable.
3. **Conditional premises applied unconditionally**: "binary opacity … *so the positional move
   carries the entrance*" (motion.md:240); "hero figures must be ≥200px" (layout.md:59);
   "one per scene at most" (motion.md:212). Each has an antecedent the agent silently drops.
4. **Ranges read as permission for their minimum** (§1.3). Six ranges in `layout.md:50-57`; the
   agent picked the low end of four of them and never touched the top row.
5. **Named-bad-example leakage** (§1.2, §1.9, §1.10): "400 vs 700", "0.78% ink", "#4A4A58 — still
   too low" all shipped.
6. **Unsatisfiable rules** (§1.2): "300 vs 900" cannot be done with any mono the skill recommends.
7. **Two lines that disarm the frame-ink metric** (layout.md:135-137, motion.md:364).

---

## 3. The restructure

Design constraint, from the brief: *if an agent optimised for this and nothing else, what would
the video look like?* Every rule below is stated with its gaming answer. Anything that can be
satisfied without a design decision is not in the list.

### 3.1 DELETE — ~470 lines, first

More words is a disproven strategy: round 1 added ~700 lines and the output got worse.

| # | delete | lines | why |
|---|---|---:|---|
| D1 | `troubleshooting.md` — the whole file | 144 | the producing agent never opened it; its content is either duplicated (contrast, ducking, LUFS, caption orphans) or belongs in tool error strings and `check` findings. Move the 8 "symptoms with no error" into `check.rs` messages. Zero information loss to the agent that ignored it. |
| D2 | `recipes.md:13-33` §1 "Minimum viable reel" | 21 | the first code block in the most-copied file, self-described as "not something to ship", and the source of the shipped ceiling fontSize (96), gutter (0.089), box (0.744), ground and type colours |
| D3 | every font family name in every example — `recipes.md:17,21,196,297,327`; `motion.md:257`; `tools.md:66`; `layout.md:71` | ~8 edits | replace with `<DISPLAY>` / `<MONO>` placeholders the agent must bind. A named default pair is a default. |
| D4 | one of the two byte-identical per-key `hold` examples (`recipes.md:219-236` **or** `motion.md:156-173`), plus the two "states intent rather than changing the output" sentences (`motion.md:171-172`, `recipes.md:234-236`) | ~25 | these authored the 121 no-op keys. The surviving copy shows three real curves and **no `hold` on a flat segment**. |
| D5 | `motion.md:361-372` "What to check before you ship" | 12 | this is the round-1 metric list — distinct-easing count and distinct-duration count. It is the thing that was gamed. Replaced by G1–G10. |
| D6 | `layout.md:135-137` and `motion.md:364` | 4 | the two lines that certify a 0.1%-ink frame and declare ink coverage "the wrong metric" |
| D7 | `layout.md:79-87` hex values (keep the role names), `layout.md:92-99` contrast table hex values (keep the ratios and the method) | ~18 values | a table of hexes is a copy attractor; `#4A4A58` shipped *because* it was in a table |
| D8 | `banned-defaults.md:68` "400 vs 700 is a web distinction; video needs 300 vs 900" | 2 | unsatisfiable with the skill's own fonts, and it supplied the shipped weights. Replace with a rule the installed fonts can meet, or change the font list. |
| D9 | duplicate easing table in `tools.md:135-146` and duplicate `animate_many` table in `tools.md:156-166` | ~22 | keep one canonical copy in motion.md; `tools.md` links to it |
| D10 | `recipes.md:169` `"duration": 0.01` | 1 | the skill's only stated opacity move duration is 0.3 frames |
| D11 | every occurrence of the word "scene" **or** ship a scene tool (see E1) | ~55 sites | today ~15 rules are addressed to an object the agent cannot create |

### 3.2 REPLACE the 9-file reference table with one gate in SKILL.md

`SKILL.md:148-161` currently says "read motion.md before you animate; read the rest as you need
them" and lists 9 optional files. The agent read 8 of 9 and it did not help. Replace with a single
**numbered, numeric, pre-render gate** in SKILL.md itself — the only file guaranteed to be loaded.
Target: ≤ 25 lines. Numbered lists are the one form this corpus proves gets executed.

| # | rule | shipped value | check | how an agent games it → counter |
|---|---|---|---|---|
| G1 | **Frame occupancy.** Sample 8 frames. In ≥6 of them, ≥3 of the 4 vertical quarters and ≥2 of the 3 horizontal thirds must each carry ≥0.15% ink. | bottom quarter 0.00% in 5/6; horizontal thirds 1 of 3 | rendered frame | park a hairline at y=0.95 → also require that band to contain an element whose box area ≥1% of frame |
| G2 | **Something is big.** In every 3 s window a visible text element must render ≥110 px tall (5.7% of 1920). Unconditional — not tied to the word "hero". | max 96 → 171 px for 1 element out of 73; mode 34 → 60 px | project model + `rendered_font_px` | one big element parked for 61 s → require it to be a *different element id* in ≥60% of windows |
| G3 | **Typeface share.** No family >55% of text elements. If the video has narration, mono class ≤45%. | Menlo 95% | project model + font class metadata (E4) | split across Menlo+Monaco → classify by metric class, not family name |
| G4 | **Property mix.** `opacity` ≤50% of animated channels, and ≥40% of visible elements must carry a non-opacity channel that travels ≥1.5% of canvas (x/y) or ≥0.06 (scale). | opacity 62%; 28% of elements have any non-opacity channel | project model | add a 1 px x-move to everything → the 1.5% travel floor is what stops it |
| G5 | **Move floor.** No value-changing segment shorter than 0.20 s (6 frames). Median moving-segment duration ≥0.35 s. | 76 segments at 0.10 s; median 0.25 s | project model | set every pop to exactly 0.20 s → the median floor is the counter |
| G6 | **No-op keyframes.** A flat segment (equal values at both ends) carrying an explicit per-key `easing` is an error finding. `hold` ≤10% of easing occurrences. | 121 no-op keys; hold 130/~440 = 30% | project model | not gameable — a flat segment with an easing is definitionally a no-op |
| G7 | **Segments.** Define a segment as a maximal timeline interval crossed by no element. A video >30 s needs ≥4 segments, each ≥3.0 s with ≥8 elements, longest ≤2.5× shortest. | 1 segment, 62 s | project model, no scene object required | 3 one-frame gaps → the ≥3.0 s + ≥8-element floors |
| G8 | **Assets.** A video >20 s with zero image/video elements is an **error**, not a warning. Declaring "no assets available" is a recorded exception, not a bypass. | 0 images, 0 videos | project model | one 1×1 png → require rendered area ≥8% of frame in ≥1 frame |
| G9 | **Palette derivation.** ≥2 of the project's colours must be ≥15 ΔE from every token in the skill's palette. Any colour the skill labels "too low contrast" is an error. | 7/7 tokens copied; `#4A4A58` used | project model | shift every hex by 1 → ΔE≥15 is the counter; and it forces one real choice |
| G10 | **Hook.** At t = 0.4 s: ink ≥1.2% of frame **and** the largest visible element ≥110 px. | 0.08%, top quarter only | rendered frame | full-screen dark rectangle → measure ink as |luma − background| > 18, which a near-ground panel fails |
| G11 | **Horizontal.** The modal x-cluster (±0.01) holds <35% of visual elements, and ≥20% of visual elements have their box centre right of x=0.55. | 53% in one gutter; 21% right of 0.55 (marginal) | project model | scatter x by ±0.02 → the cluster tolerance is ±0.01, so a 0.02 scatter still clusters; widen to ±0.03 if gamed |

Each of G1–G11 is violated by wicks-v2 **while it passes every existing check**. That is the
acceptance test for the set: a rule a bad video already passes is a rule that certifies bad video.

### 3.3 Restructure the remaining files

| file | now | after |
|---|---:|---|
| `SKILL.md` | 192 | ~150 — loop + the G-gate + 8 non-obvious API facts. The gate replaces the "Banned defaults" summary (SKILL.md:165-183), which is prose restating banned-defaults.md. |
| `motion.md` | 377 | ~230 — keep the 5 rules, the move vocabulary, the blocked-moves table. Delete the ship-check (D5), one per-key example (D4), the ink line (D6). |
| `recipes.md` | 420 | ~250 — delete §1 (D2), strip every font name and every literal x/y/scale/colour to named constants declared at the top of each recipe. **A recipe should teach a shape, not ship a coordinate.** |
| `layout.md` | 138 | ~110 — the grid diagram gains a named lower zone and a right column; the palette keeps roles and loses values; keep the contrast method, lose the hex table. |
| `banned-defaults.md` | 107 | ~85 — remove every bad-value example that names a specific number or hex; keep the categories. |
| `tools.md` | 361 | ~320 — de-duplicate the easing and animate_many tables (D9); add the word "scene"/"segment" once, honestly: *bay has no scene object; see G7*. |
| `troubleshooting.md` | 144 | **0** (D1) |
| `charts.md`, `audio.md`, `narration.md` | 456 | unchanged — none of them is implicated in a measured defect, and audio.md's three-requirement list is the one thing round 1 got right. |

Net: **2,197 → ~1,600 lines**, with the gate promoted into the always-loaded file.

---

## 4. Engine gaps this audit exposes

| gap | why it matters | effort | unlocks |
|---|---|---|---|
| **No scene object in the MCP surface.** 55 tools, none creates/splits/selects a scene; `studio.rs` only ever touches `active_scene()`; `tools.md` never says the word. | ~15 skill rules and 5 `check.rs` findings address a unit the agent cannot create. Directly caused the one-scene 62 s timeline. | medium | every per-scene check; `motion.md`'s entire rule vocabulary; G7 without a proxy |
| **`check` cannot see pixels.** `SKILL.md:113-116` admits it reasons from the timeline. | G1, G10, text collision (the t≈19 s "Different day." occlusion), and the two empty-card frames at t≈19/24 s are all frame-only defects. The compositor is already in-process via `bay-preview`. | medium | G1, G10, `text-collision`, `empty-region` |
| **No measured text bounding box.** `troubleshooting.md:101` — "a too-long string silently wraps"; `check` flags size but not extent. | Without a box there is no collision check, no occlusion check, no "does this element actually cover area" test — which is the counter to gaming G1/G8. cosmic-text already computes the layout. | small–medium | G1 counter, G8 counter, collision, wrap detection |
| **`fonts_check` returns availability only** — no weights, no mono/serif/sans class. | `banned-defaults.md:68`'s weight rule is unenforceable *and* unsatisfiable with the skill's own mono list; G3 needs a class, not a family name. | small | G3, a weight rule that can be obeyed |
| **`check` measures diversity counts, not distributions.** No property-mix, no duration histogram, no flat-segment detection, no ink measurement. | Round 1's metrics were all counts and all were gamed. G4, G5, G6 are histogram/ratio tests over data `check` already walks. | small | G4, G5, G6 |
| **No per-element rendered-area query.** | Every anti-gaming counter in §3.2 ("area ≥1% of frame", "≥8% of frame") needs it. | small | the counters that make G1/G8 un-gameable |
