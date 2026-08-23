---
name: explainer-short
description: Build a diagram-explainer short with bay — a narrated portrait video where one dark canvas accumulates a drawn diagram for the whole runtime, a serif chapter lockup swaps as the argument advances, and a one-line takeaway pill paraphrases the voice. Use when someone wants an explainer video about a mechanism, a market concept, a system, or any idea best taught by drawing one case and annotating it — "explain X as a video", "make a chart explainer", "teach this visually". Requires the bay MCP server (see the bay skill).
---

# The diagram explainer

A named format, reverse-engineered from a 28-video corpus of narrated trading explainers
(study: `research/format-study/scarcitycircle-format.md`). Everything numeric below was
measured on that corpus, not chosen.

**What it is.** A portrait short, 90–150 s, narrated from the very first frame. One dark
canvas, **zero cuts**: a diagram drawn from primitives accumulates for the whole runtime and
is never torn down — later chapters annotate the same drawing the hook started. A serif
chapter lockup in the top band swaps its words as the argument advances. A one-line takeaway
pill near the bottom **paraphrases** the narration — never transcribes it. The visual grammar
is *drawing as proof*: every claim the voice makes is immediately staged on the diagram as a
concrete case with a 1–4 word label.

**When to reach for it.** A mechanism a stranger misunderstands: why prices move, how a
queue fails, what a cache actually does. Anything where the teaching move is "watch what
happens in this one concrete case" and the case can be drawn from bars, lines, zones and
labels.

**When not to.** Anything that needs photographs or footage as evidence (that is the archive
reel, `references/archive-reel.md` in the bay skill). Anything with no build — a listicle or
a ranking has no single accumulating picture, and this format without its one growing diagram
is a slideshow with a pill on it.

This skill drives bay's MCP tools. Read the bay skill first — its `SKILL.md`, then
`references/structure.md` and `references/craft.md`; the live tool schema is the authority on
every argument. The full call-by-call build is in [references/build.md](references/build.md).

---

## The recipe

```
speech_status                          voices; bail early if Kokoro is missing
project_create(portrait, kit)          one kit committed before anything is placed
marker_add × one per thought           a dozen to twenty; name the turn and the payoff
narrate × N (captions off)             one clip per thought; the script is the skeleton
add_shape / add_text                   the diagram: bars, wicks, levels, zones, labels
animate_many(stagger)                  the build phases; arrivals carry the liveness
text_update                            the lockup swap and the pill swap — same ids, all video
media_import → add_audio → duck        the bed, faded both ends, ducked under every line
sfx_add                                one sound per chapter swap and one under the turn
check → check_frames → snapshot        iterate until clean
render                                 poll job_status until finished
```

## The measured numbers

| | |
|---|---|
| **Canvas** | portrait at 30 — 1080×1920 |
| **Runtime** | 90–150 s. The corpus median is 132 s; nothing in it under 88 s works harder than the pieces near 110 s. Shorter passes everything longer passes |
| **Narration** | `targetWordsPerSecond` ≈ 2.5 (corpus: 2.16–3.02, median 2.51). Sentences 8–12 words. Voice enters at t = 0 |
| **Hook** | first sentence ≤ 18 words (median 13), lands by ~5 s, states the misconception or the question — never the answer |
| **Turn** | at 15–35 % of runtime where the piece has one (half the corpus does) |
| **Chapters** | 3–6 lockup swaps, one per 25–45 s |
| **Beats** | one marker per narrated thought, 12–20 for the runtime above |
| **Diagram events** | something visible arrives every **0.8–1.1 s** — see the frozen gate below; the corpus stamps every 2.5–4.5 s and freezes between, which bay rejects |
| **Pill swaps** | every 3–6 s, riding the narrated thought |
| **Type** | roles only, kit resolves size. Corpus scale for orientation: chapter lockup cap-height 2.7–4.0 % of frame height, kicker and labels 1.3–1.9 %, pill 1.4 % |
| **Palette** | the kit's. `editorial-data` is the measured match: near-black ground, warm ink, gold accent, blue second accent — the corpus runs `#000000` ground, gold/periwinkle accent, and TradingView green/red for the two case-outcomes |
| **Pill position** | the kit's `footer` framing (bottom-anchored, ~91 % of frame height in `editorial-data`) — exactly where the corpus holds it (91–93 %) |
| **Bed** | 8–17 LU below the voice in speech gaps; ducked, never silent in gaps |

Where a number appears in a call, take it from the live schema or the kit — the table above
is what the *finished frame* should measure, not a list of arguments to copy.

## The beat template

Fractions of a target runtime T. Each beat is one `narrate` clip, one pill `text_update`,
and one or two diagram events.

1. **HOOK, 0–6 %.** Frame one already carries: the chapter lockup (role `hook`, then
   `text_update` it to `headline` duty for chapter two — same id forever), the first seed
   bars of the diagram, and the pill with its first line. The first sentence names the
   misconception. First diagram arrival inside the first second — `no-hook` and `black-start`
   are both measured against the opening.
2. **SETUP, 6–35 %.** One to two chapters. The voice explains the mechanism in general
   terms; the diagram builds the concrete case under it — bars printing in staggered batches,
   a level drawing on with `fill`, the first labels. Each new term spoken gets its on-screen
   instance labeled within a beat of being said.
3. **TURN, ~15–35 %** (when the piece has one — a contrarian format wants one). The shortest
   beat. Voice drops to a handful of words ("that spike was not demand"). Stage it unlike its
   neighbours: the accent tone appears where it has not been, the biggest zone panel lands
   (this is also the `anchor-scale` moment — see below), one sfx transient above the bed.
4. **CONSEQUENCE, 35–85 %.** The remaining chapters play the case forward — in this corpus,
   always as **two contrasted outcomes** (it holds / it fails; hit / miss; cached / evicted).
   The two outcomes get the two chart tones (green/red in the corpus; the kit's accents in
   yours). Any number the viewer must compare goes on screen as a `data` element; the voice
   then says what it *means*, not what it *is*.
5. **LANDING, 85–100 %.** Restate one rule in one sentence; the pill compresses it to
   3–5 words; one terminal element that appeared nowhere earlier (role `lockup`). The last
   diagram motion completes just before the end — do not end on a long-static frame. Close
   with a question or a specific named next action; the corpus's soft-follow CTA is the
   weakest thing in it, do not copy that.

## Say-vs-show — the discipline, per beat

This relationship is the format. Apply it as a checklist to every beat:

- **The voice carries causation and generality.** "When price returns here, those resting
  orders defend the level." It never reads the screen: no spoken figure that is printed, no
  "as you can see".
- **The screen carries one concrete case.** Not an illustration of the sentence — an
  *instance* of it, staged so the sentence is visibly true of it.
- **The pill compresses.** One line, 3–8 words, strictly fewer words than the sentence it
  rides, never a substring of it. Voice: "either the level holds and price continues higher,
  or it fails and the move unwinds" → pill: "hold — or unwind". It is an authored `label`
  with a plate, not a caption — never author anything with role `caption` (see the gates).
- **Labels are 1–4 word noun phrases, caps,** accent tone, placed touching the thing they
  name, arriving the moment the term is first spoken.
- **A spoken number is a shown number.** If the voice must say "three times", three of the
  thing are on screen, and the count is checkable at a glance.
- The moment of the key claim: the newest element must be the most visually active thing on
  screen. If the eye would land anywhere else, `dim-back` the rest.

## How each rule maps to the gate it protects

bay refuses to render on errors from `check` and `check_frames`. The template satisfies them
by construction; this table is why each rule exists, so you do not "optimize" one away.

| rule in this skill | gate | mechanism |
|---|---|---|
| an arrival every 0.8–1.1 s, sized ≥ 3 % of the ink on screen | `frozen` (error) | the gate compares ink masks 1.2 s apart; a pair freezes when the arrangement is > 97 % identical and fewer than two of the five biggest clusters moved ≥ 3 % of frame height. Drift and micro-nudges do **not** clear it; arrivals do. As the diagram densifies, one small label is < 3 % of the ink — batch arrivals, or move the whole diagram group (`shunt`) on the seam |
| the turn's zone panel is one filled shape ≥ ~30 % × 24 % of frame, at fully legible opacity | `anchor-scale` (error) | some single high-contrast cluster must reach √(area/canvas) ≥ 0.26 at least once. Bars and letters never merge that big; one big filled panel does. A translucent fill over a dark ground fails the ink contrast test — keep the panel's composited contrast ≥ 4.5:1 |
| the pill is an authored plated `label` at the `footer` framing, present throughout; the diagram's baseline furniture sits low | `bottom-dead` (error) | half of all sampled frames need a ≥ 1.5 %-area ink cluster with centroid below 72 % of frame height. Tool captions are suppressed during checks, so a narration caption cannot carry this — the authored pill can, which is one more reason the pill is authored |
| four fixed text lanes: lockup band (top ~3–13 %), kicker under it, labels inside the diagram, pill at footer | `text-collision` (error) | shaped text bounds may not overlap another text's ink. Fixed non-overlapping bands make collision impossible; the one risk left is a diagram label drifting into the pill — keep labels above the footer band |
| lockup and pill swap via `text_update`, diagram only ever accumulates | `broken-continuity` (error) | a seam where the composition was replaced needs a surviving, visibly-changed element id. Same-id swaps and an accumulating diagram mean no seam is ever a replacement |
| every entrance is a registry move; bars arrive by `unveil` or a draw, never by a scale move that approaches from above | `off-vocabulary-motion` (warning), `value-overshoot` (error) | hand keyframes are reported per channel; a bar that eases in from 110 % of its own height displays a false value. Approaching from zero or from below is monotone and safe |
| each arrival is answered by an incumbent (`nudge`, `make-room`, `dim-back`) — a different one each time | `no-response` (warning) | a new arrival that leaves every incumbent unchanged is a slide stack. Note these moves are for *composition*, they are too small to clear `frozen` |
| one bed under everything, faded both ends, `duck`ed under every line; payoff marker placed before any audio | `no-bed`, `flat-mix` (warnings), the mix gate | narration windows must beat the gaps, the bed must stay audible in gaps, the loudest moment must land on the payoff marker |
| hook text + seed bars + pill all present at t = 0 | `no-hook`, `black-start` (warnings) | the opening second is measured against the piece; an empty black open — which the corpus loves — fails it. This is a deliberate departure from the source format |

## What makes it fail

Measured failure modes — the corpus's own, and the ones the gates exist to catch:

1. **Subtitle-itis.** The pill drifts into transcribing the voice. The moment pill text is a
   substring of the sentence, cut words until it is a claim of its own.
2. **Reading the screen aloud.** The voice says a number that is printed. Give the number to
   the screen and the meaning to the voice, or delete one of them.
3. **The stamp-and-freeze.** The corpus stamps an annotation, then holds a dead frame for
   2–5 s while the voice talks (40–84 % of corpus runtime is frozen). bay rejects this
   outright. Liveness comes from **arrival cadence** — do not fake it with drift, opacity
   shimmer, or a pulsing element; the gate is specifically built to ignore those.
4. **The carousel.** Clearing the diagram to start chapter two. The whole point of the format
   is that chapter four's annotation lands on chapter one's drawing. Never delete-and-re-add;
   `text_update`, `transform_set`, and accumulation only.
5. **Wordy screens.** A label over four words, a second sentence in the pill, a paragraph
   anywhere. The register mismatch is instant — the type is serif and calm, the screen budget
   is a few words per beat.
6. **Accent inflation.** The accent on every label is decoration; the accent on the one thing
   the current sentence is about is a pointer. One accent element per beat.
7. **Runtime bloat.** The corpus stretches one idea to 170 s with restatement. Nothing
   rewards length; land the mechanism, contrast the two outcomes, get out. 90–120 s is the
   sweet spot for one clean mechanism.
8. **A cold open with a bare chart.** The hook lockup, seed bars, and pill must all exist at
   frame one. The corpus opens near-black and takes 3 s to say anything visual; that is a
   retention tax and a `no-hook` finding, and this format drops it.
