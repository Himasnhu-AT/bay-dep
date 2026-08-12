# Video teardowns — two references vs. three of ours

Five videos analysed in parallel, each by a dedicated analyst working the same protocol:
ffprobe, contact sheets *actually looked at*, full-resolution frames read individually,
`volumedetect` + `loudnorm`, scene-change detection at three thresholds, ink-coverage sampling,
and consecutive-frame diffing to test whether anything moves mid-scene.

| | File | Role |
|---|---|---|
| R1 | `Downloads/1.mp4` | reference — "Palmier" AI-editor demo, reply-screenshot format |
| R2 | `Downloads/2.mp4` | reference — doodle explainer, "pioneers get the arrows" |
| O1 | `Desktop/candlestick-wick-volatility.mp4` | ours |
| O2 | `Desktop/local-first.mp4` | ours |
| O3 | `Desktop/candlestick-wicks.mp4` | ours (companion/alternate cut of O1) |

---

## The measurements, side by side

| | R1 | R2 | O1 | O2 | O3 |
|---|---|---|---|---|---|
| Canvas | 720×1280 | 716×1274 | 1080×1920 | 1080×1920 | 1080×1920 |
| fps / duration | 20 / 39.3 s | 30 / 57.2 s | 30 / 70.5 s | 30 / 30.1 s | 30 / 74.2 s |
| **Integrated loudness** | **−14.0 LUFS** | **−14.1 LUFS** | −16.5 | **−25.3** | **−27.5** |
| True peak | −0.0 dBTP | −1.2 dBTP | −1.5 | −2.5 | −4.6 |
| LRA | 6.7 LU | 2.3 LU | 3.4 | 3.1 | 3.5 |
| Music bed | yes | (narration-forward) | **none** | **none** | **none** |
| SFX | yes | — | **none** | **none** | **none** |
| Narration | none | yes | yes | yes | yes |
| Hard cuts (τ=0.3) | 0 | 0 | 0 | 0 | 0 |
| Change events (τ=0.06) | 0 | 18 (~3.1 s apart) | — | — | 0 (even at τ=0.02) |
| Content change cadence | every 1–3 s | every ~1.5–3 s | scene-start only | scene-start only | scene-start only |
| Ink coverage | dense (real UI) | 10–40% (composed) | 0.8–12.3%, median <5% | 4.0–6.9% | 1.5–6.3%, mean 2.9% |
| **Distinct motion behaviours** | n/a (screen capture + cuts) | pop/scale/fade on N assets | **1** | **1** | **2** |
| **Distinct durations** | — | — | **1** | **1** | **2** |
| Hook in first 3 s | claim + proof | proverb pull-quote | none — 0.78% ink | none — definition card | none — 0.87 s of silence, then a glossary |

---

## R1 — the reply-screenshot demo (`1.mp4`)

**What it is.** A recursive product demo: a screenshot of a flattering tweet is pinned at the
top, a screen recording of the editor "Palmier" plays in a window in the middle, and a fixed
caption sits at the bottom — "I guess it's crazy good then, whole thing edited in Palmier!" The
recording shows an AI agent inside the app building *the very video you are watching*, with
literal tool-call names on screen (`Create_folder`, `Add_texts`, `Set clip properties`).

**Frame architecture.** Locked for all 39 seconds. Three static zones — tweet card (~11% of
height), demo window (~24%), caption line — on pure black. **Roughly 70–75% of every frame never
changes.** That is why scene detection reports zero cuts at every threshold (peak score 0.049
across 785 frames): all the change happens inside one small window.

**Why it works.**
1. The reply frame is never dropped. It borrows a real conversation's credibility for the full
   39 s instead of using it as a two-second hook.
2. The content *is* the receipts — specific, unglamorous tool-call names read as authentic in a
   way marketing copy cannot.
3. It closes its own loop: the agent visibly assembles the beats you already watched.
4. Hard cuts inside the window every 1–3 s keep a text-and-UI-heavy video from dragging.
5. A loud, continuous mix (−14.0 LUFS, essentially at the ceiling) carries the energy while the
   picture is doing something visually static.

**What a naive agent would get wrong:** go fullscreen with the demo (killing the format), bolt
on TTS narration (there is none), and invent flashy keyframed motion where the authentic version
is deliberately plain screen capture plus straight cuts.

**Reproducible in bay today?** Mostly **yes**. Black ground, rounded-rect card, avatar on an
ellipse mask, single-style white text on black, one video clip held static, hard cuts, a music
bed plus synthesised SFX — all native. The mono→warm grade on the closing shot would be two
cross-dissolved clips instead of a ramp. The only genuine miss is live typing, which would have
to be faked as still-image swaps.

---

## R2 — the doodle explainer (`2.mp4`)

**What it is.** A business parable — "the pioneers get the arrows, the settlers get the land" —
argued through two case studies (search engines, then ride-share) and deliberately never
restated as the AI analogy it set up in its first 16 seconds. It trusts the viewer to close it.

**How it is built.** One continuous blush canvas (`#FCF3F5`, pointedly not white). Hand-drawn
stick figures and flat object icons, with **real, unmodified corporate logos pasted straight in**
— AltaVista, Lycos, Excite, Google, Uber, Sidecar, OpenAI, Meta, Anthropic. The crayon world
around a photoreal logo is both the joke and the credibility.

**The motion engine is one idea:** *elements arrive one at a time, on the narrated word, and
they stay.* AltaVista → Lycos → Excite appear in sequence and remain on screen from ~0:16 to
~0:33 while the argument builds around them. It reads like watching someone fill a whiteboard.

**Zero hard cuts in 57 seconds.** Act breaks are staged *diegetically* — a stick figure walks to
a chalkboard and writes "Search engines," later "Rideshare." The biggest change in the video is
still just an element popping onto a continuous canvas.

**Typography.** Phrase-level captions, 2–5 words, cap-height ~3.1% of frame height — *quieter*
than typical burn-ins. Flat near-black on blush, **no stroke, no shadow, no plate**. Caption
position moves per composition rather than living in a fixed box. A second marker face carries
editorial asides ("ouch", "not even a thank you?!?!?") rotated 15–20° onto the logos.

**Reproducible in bay today?** **Yes, essentially completely** — given the illustration assets
as PNGs. Nothing in it needs a gradient, an animated mask, a keyframable effect, a path, or 3D.
Its captions are *exactly* the primitive bay already has. The two honest ceilings are the
hand-drawn linework (which is an asset-sourcing problem, not a rendering one) and the comedic
vocal delivery, which TTS flattens.

---

## O1 — `candlestick-wick-volatility.mp4` (ours)

70.5 s, seven chapters, a genuinely good argument: definition → the range is blind → the wick →
`W² = R² − 2R|r| + r²` → citation → "Measure the shadow."

- **One animation behaviour in 70 seconds.** Opacity fade, ~0.3–0.5 s. Frame pairs 0.5 s apart
  at t=6.0 and t=40.0 are **pixel-identical** — nothing moves mid-scene, ever.
- **Ink coverage 0.78%–12.3%, median under 5%.** At **t=36.0 s** the frame shows drawn axes with
  **no bar rendered at all** (0.97% ink) — that reads as a load failure, not minimalism, and is
  worth investigating as a possible engine bug rather than a design choice.
- **The numbers that are the story render at 35–45 px.** 736.53, 716.58, R=20 — against a
  ≥200 px hero floor. The one moment the scale is right is the formula card (~110–130 px), which
  is also the best frame in the video.
- **No hook.** t=1 s is 0.78% ink: a grey kicker and one expository line, in the window that
  decides most of the distribution.
- **Audio:** narration only. No bed, no SFX, −16.5 LUFS, and 2.1 s of silence over a static card
  at the end — the video runs out rather than ending.
- **Gets right:** contrast is clean throughout; red is used scarcely and consistently; chapter
  durations follow the narration; no bouncy easing anywhere.

## O2 — `local-first.mp4` (ours)

30 s, three scenes: THE PROBLEM / THE SHIFT / THE PAYOFF. Pure kinetic typography — no image,
video, shape or icon in the entire runtime.

- **Headline and subhead are fully in place by t≈0.8 s, then frozen for the remaining ~9 s of
  each ~10 s scene.** Frame diffs during holds: 0.000–0.003% of pixels changing.
- **One behaviour, one duration.** A ~0.4 s opacity fade, used identically for the headline
  block (×3) and every caption fragment (15+).
- **Ink 4.0–6.9% across twelve frames spanning the whole timeline.** One text column, one focal
  point, no background layer anywhere.
- **−25.3 LUFS** — about 11 LU under delivery. It will sound near-silent beside normalised feed
  content. No bed, no SFX, true silence in 12+ gaps.
- **Pacing is uniform**: 10.5 / 10.0 / 9.6 s. The doctrine asks for the slowest scene to be ≥3×
  the fastest.
- **Caption line breaks ignore semantics** — "The terms change / And" strands *And* on its own
  line; "computer You're / renting access" splits mid-clause.
- **No product name, logo or CTA anywhere.** It closes on the orphaned fragment "the cloud."
- **Gets right:** measured contrast 19.3:1 and 10.7:1; headline type correctly scaled at
  ~150–175 px; a deliberate 0.3–0.4 s offset before the first entrance; a real three-act
  colour-coded structure.

## O3 — `candlestick-wicks.mp4` (ours)

74.2 s, same series as O1. `R = H − L` → `W = R − |r|` → `E[W²] ∝ σ²` → citation → "Four
numbers. One subtraction."

- **Zero scene changes even at threshold 0.02** — one unbroken take for 74 seconds.
- **Two behaviours, two durations.** Opacity crossfade everywhere, plus **one** genuinely good
  self-drawing line chart at 0:29–30.5 — correct progressive disclosure, used exactly once.
- **Ink 1.5–6.3%, mean 2.9%**, content confined to the left third; the right ~65% and bottom
  ~25% are dead space in every sampled frame.
- **Chart craft is decorating, not teaching.** The `R = H − L` bars appear fully formed — no
  growth from a fixed origin, no reference track behind them. `$0.04` — the one correctly
  hero-scaled element at ~192 px — **fades in as a static string instead of counting up.**
- **Headlines 60–85 px against a ≥110 px floor** — 40–50% undersized everywhere except `$0.04`.
- **−27.5 LUFS**, 13.5 LU under target, no bed, no SFX, and the video opens with 0.87 s of
  silence followed by a jargon glossary.
- **Gets right:** a real two-accent palette held consistently across all seven scenes; contrast
  8.97–18.53:1; no overshoot anywhere; captions correctly sequenced to the narration; and real
  duration variance (≈4 s to ≈16 s).

---

## The synthesis — six findings that change the plan

### 1. The references are reproducible in bay *today*

Both analysts, working independently, reached the same conclusion: neither reference needs a
gradient, an animated mask, a keyframable effect parameter, a stroked path, or a 3D transform.
R2 is reproducible essentially completely; R1 is reproducible except for live typing.

**This demotes most of the engine work.** The capability map ranked paths, animatable blur and
3D highly on general principle. Against the actual videos we want to make, they are not the
binding constraint. The binding constraints are doctrine, assets, and audio.

### 2. Zero hard cuts in all five videos — but only two of them are alive

Every video here reports zero scene changes at τ=0.3. The references achieve continuity
*without* cuts, deliberately: R1 by never breaking a fixed frame, R2 by staging act breaks
diegetically on a continuous canvas. Ours have no cuts because **nothing ever changes.**

So "no hard cuts" is not the defect. The defect is precise: **our scenes animate once and then
are pixel-identical for seconds at a time.** Confirmed by frame diffing in all three.

### 3. Ink coverage is the wrong metric — element arrival is the right one

R2 is also mostly empty: 60–90% of its frame is bare. A naive ink-coverage check would flag the
good reference alongside our bad ones.

What separates them is that R2's emptiness is **composed and accumulating** — a new element
lands every ~3 s and *stays*, so the frame fills over the scene's life, on a tinted ground, in a
deliberate cluster. Ours is empty *and* static *and* never accumulates, on flat near-black.

**Consequence for the perceptual check (§11 Phase B):** do not measure ink. Measure
**(a) how many distinct elements arrive during a scene, (b) how they are distributed across the
scene's duration, and (c) whether anything changes at all after the first second.** A scene
whose last element arrives in the first 20% of its duration is the failure, at any ink level.

### 4. Loudness is a solved problem we are not using

Both references sit at exactly −14 LUFS. Two of our three are 11–13.5 LU under. bay **has**
one-pass `loudnorm` to −14 with `social` / `youtube` / `master` export presets
(`bay-preview:1466`) — the agent simply is not reaching for them, and there is no music bed or
SFX under any of the three despite a synthesised SFX library being one tool call away.

This is the cheapest fix in the entire corpus: three tool calls per video, and it closes the
single largest measured gap between our output and the references.

### 5. The skill prescribes the monotony

`skills/bay/references/recipes.md:32`, on the rise-and-fade entrance: **"Every text reveal in a
good reel is this."** It is the only entrance pattern documented. Our three videos have exactly
one motion behaviour between them because the skill says to use exactly one.

Failure mode #2 is not the model defaulting. It is the model **obeying**.

### 6. We ship text on black; the references ship *stuff*

R1 is ~24% of its frame given to real screen recording; R2 is built from dozens of imported
illustration assets and real logos. Our three are 100% text and vector primitives on flat
near-black.

Neither reference's richness comes from a rendering feature we lack. It comes from **having
assets to place**. That is a pipeline gap — image generation/sourcing, a logo library, a
screen-capture path — and it sits alongside the doctrine as the real work.

---

## What this implies for the plan

Re-ranking [`11-action-plan.md`](11-action-plan.md) against the evidence:

| Rank | Item | Why it moved |
|---|---|---|
| **1** | **Doctrine + move vocabulary in the skill**, and delete "every text reveal is this" | Confirmed root cause of a 1-behaviour motion vocabulary across 175 s of output |
| **2** | **Audio defaults: bed + SFX + `-14 LUFS` export preset** | Largest measured gap; the capability already exists and is unused |
| **3** | **Perceptual check** — element-arrival distribution, post-first-second change, loudness, hook presence | Would have caught every defect in all three of our videos |
| **4** | **An asset pipeline** — generated/sourced illustration, logos, screen capture | What the references are actually made of. *Newly promoted; was not in the original plan* |
| **5** | Stagger verb + per-segment easing + spring curve | Still right, but now clearly behind the above |
| 6+ | Paths, animatable blur, gradients, 3D, camera | Real gaps, but **not** what stands between us and these two references |

One engineering item to run down separately: **O1 at t=36.0 s renders axes with no bar
(0.97% ink)**. That may be an authoring error, or it may be a real compositor bug. It should be
reproduced from the project file before it is assumed to be the former.
