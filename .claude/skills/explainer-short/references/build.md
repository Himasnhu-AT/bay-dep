# Building a diagram explainer, call by call

The walkthrough assumes the bay skill's ground rules: tools are called with whatever prefix
the server registered (`mcp__bay__…`), the live schema is the authority on arguments, and
`render`/`narrate` return job ids you poll with `job_status`. Nothing here prints a value to
copy — sizes, colours and durations come from the kit and the move registry.

## 0. Preconditions

```
speech_status          → voices; no Kokoro, no format — install via runtime_install
runtime_status         → ffmpeg present for the eventual render
project_info           → is a window already holding a project? ask before replacing it
```

## 1. Script first

Write the whole script before any element exists. It is the skeleton: every beat is one
narrated thought, and the diagram schedule hangs off the narration cues.

- Budget words at the target rate: at ~2.5 words/second, a 110 s piece is ~270 words.
- One sentence, 8–12 words, per thought. The hook sentence states the misconception.
- Read it end to end with the video off: it must be a complete explanation that never
  speaks a figure the screen will print.
- For each thought, write the pill line next to it (3–8 words, not a substring) and the
  diagram event it triggers. That three-column table *is* the edit.

## 2. Project and markers

```
project_create(width, height, fps, kit)     portrait, house rate; editorial-data unless the
                                            brief argues otherwise (its note names
                                            explainers and data essays as its purpose)
marker_add × one per thought                label them; label the turn "turn"
marker_add(label: "payoff")                 BEFORE any audio exists — the mix gate
                                            asks whether the loudest moment lands here
```

## 3. Narration

One `narrate` call per thought, `captions` off — this format's on-screen text is the
authored pill, and a second, word-synced lane under it would collide and double-voice the
frame. Pass `targetWordsPerSecond` and let bay pick the speed; check the returned end time
against the thought's beat and fix overruns by cutting a clause, not by speeding up.

The returned cue times are the spine: every diagram arrival, pill swap, and lockup swap
below is scheduled against them.

## 4. The standing text — three elements, alive all video

Create each **once**, then only `text_update` / `animate`. Their ids never change; that is
what makes every chapter seam a carry instead of a replacement (`broken-continuity`).

- **Chapter lockup** — `add_text(role: hook)` at the top band, centred, caps. At each
  chapter seam, `text_update` its content (and role, once it is no longer the hook). It
  names what the current chapter teaches, in 1–3 words.
- **Kicker** — `add_text(role: kicker)` under the lockup, when a chapter needs a framing
  line. `text_update` per chapter; delete it for chapters that don't need it — deleting a
  kicker is legal, it is not the carry element.
- **Underline rule** — `add_shape(role: chrome)` under the lockup, entering with
  `underscore` (its own doc note says: anchor at the left edge, start at the word's settle
  time plus a few frames). Re-run `underscore` at each lockup swap.
- **Pill** — `add_text(role: label, plate: on)` at the kit's `footer` framing. This is the
  bottom-liveness anchor (`bottom-dead` needs a substantial ink cluster low in ≥ half of
  all frames), so it exists from frame one to the last frame. `text_update` per thought.
  Never give any element role `caption` and never reuse a caption id — captions are
  tool-authored and the checks partition on that.

## 5. The diagram

Everything is `add_shape` primitives on the dark ground; the diagram accumulates and is
never cleared.

**A bar/candle is two rects**: a body and a thin wick, `group_create`d if you need to move
them as one. Tone carries the outcome semantics: `accent2` is documented in the kit as "the
opposition — a second series, the down bar, the contrast case", so the two contrasted
outcomes are `accent` vs `accent2`, with `dim` for history that is no longer the argument.

**Entrances.** Bars arrive with `unveil` (a rise into place — no scale channel, so no
false-value window) or, for horizontal levels and zones, `fill` (a draw from zero). Never
an entrance that approaches a bar's final size from above (`press` lands from larger):
a bar seen at more than its own value, even briefly, is `value-overshoot`, an error.
Anchor bars at their baseline (`anchorY`) so any later scale reads as growth from the
axis, not ballooning from the middle — this is also what `anchor-scale` measures a chart
by.

**Build phases.** Print bars in batches with `animate_many(stagger)`. The stagger is the
liveness budget: spacing arrivals ~0.8–1.1 s apart keeps every 1.2 s comparison window
alive (`frozen` fires when the ink arrangement is > 97 % identical across the window and
fewer than two of the five biggest clusters moved ≥ 3 % of frame height). Two consequences:

- Early, when the diagram is sparse, one bar is a big fraction of the ink — small arrivals
  clear the gate easily.
- Late, when it is dense, a small label is under the 3 % ink change — batch late arrivals,
  or ride a whole-group `shunt` (the chart making room is also the corpus's own pan-as-it-
  prints behaviour), or land a zone panel. Do **not** try to clear it with `drift`,
  `creep`, opacity, or a pulse — the gate is built to ignore exactly those.

**Annotations.** Labels are `add_text(role: label)` in caps, 1–4 words, placed touching
their referent, entering with `press` or `swell` on the cue where the term is first
spoken. Levels are thin rects drawn with `fill`; a violation/danger mark uses the accent
against expectation. Keep every label above the footer band — the pill owns that band, and
two texts sharing shaped ink bounds is `text-collision`, an error.

**Response.** Each arrival is answered by an incumbent within a few frames: `nudge`,
`make-room`, or `dim-back` on something already standing — a different element each time,
never the arriving group itself (`no-response`). These moves are compositional; they are
an order of magnitude too small to clear `frozen`, so never count them toward liveness.

**The turn's panel.** At the turn, land the piece's biggest single filled shape — the zone
box the argument turns on, roughly a third of the frame wide and a quarter tall, at fully
legible opacity (composited contrast at least 4.5:1 against the ground; a translucent wash
over near-black fails the ink test). This is the `anchor-scale` moment: some single
cluster must reach √(area/canvas) ≥ 0.26 at least once in the piece, and bars and letters
never merge that large. Role `data` if it encodes a level, `surface` if it is a card.

## 6. Audio

```
media_import(bed) → add_audio(role: bed) → fade_set both ends
duck(bedId, underIds: every narration clip)     against narrate's returned cues
sfx_add × one per chapter swap                  same length as the lockup move, starting
                                                slightly before it
sfx_add × one under the turn                    the single transient above the bed
```

The gap bed level and the separation are positional, not a number to chase: narration
windows louder than gaps, bed audible in gaps, loudest moment on the payoff marker. The
corpus measures 8–17 LU of separation; the mix gate's floor is looser — passing the gate
is the requirement, matching the corpus is the taste.

## 7. Verify, then render

```
check                    beats, mix, continuity, roles — fix errors, read the warnings
check_frames             frozen / anchor-scale / bottom-dead / text-collision on real pixels
snapshot × key moments   frame one, the turn, one dense late frame, the landing — LOOK
contact_sheet            the whole piece at a glance; is the diagram legible this small?
render → job_status      never ignoreChecks; a gate finding is a defect in the build plan
```

The characteristic findings and their causes, from building against this template:

| finding | almost always means |
|---|---|
| `frozen` late in the piece | annotation-phase arrivals too small or too sparse — batch them or add the seam `shunt` |
| `bottom-dead` | the pill was created late, or a chapter deleted it — it lives from frame one |
| `anchor-scale` | the turn panel is translucent or was split into stroke-only rects — one filled shape |
| `text-collision` | a diagram label wandered into the footer band, or the kicker overlaps a tall lockup |
| `broken-continuity` | a "fresh start" chapter — something was deleted and re-added instead of `text_update`d |
| `value-overshoot` | a bar entered with a from-above scale move |
| `no-response` on a beat | an arrival played to a static room — answer it with an incumbent move |
