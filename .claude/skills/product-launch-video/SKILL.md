---
name: product-launch-video
description: Plan and build a cinematic product launch film in bay — concept, aesthetic, storyboard, narration, motion, review, render. Use when someone wants a launch video, promo video, product trailer, teaser, feature announcement, brand reveal, demo film, hype video, or "a video for our product" — including when they describe the outcome ("make people feel how fast this is") rather than naming the form. Covers the creative production workflow; the `bay` skill covers the engine.
---

# Product launch video

A launch film makes someone *feel* a product before they can touch it. That is a different job
from explaining one, and it fails in a specific way: technically clean, thirty seconds long, and
completely forgettable.

This skill is the production workflow — what to decide, in what order, and what not to start
until the previous decision is made. **It does not teach the engine.** Load the `bay` skill for
that: tools, coordinates, the gate, the things that bite. The two are meant to be read together,
the way a director's plan and a camera manual are.

> The split is deliberate and it is the same one the original made. This workflow came from
> [memex-lab/product-launch-video-skill](https://github.com/memex-lab/product-launch-video-skill),
> which pairs a creative-production skill with a Remotion implementation skill. Here the
> implementation skill is `bay`. **Roughly a third of the original did not survive the port**, and
> not because bay is weaker — because bay already holds those decisions in code. The last section
> says exactly what was dropped and why; read it if you know the original, skip it if you don't.

## Three principles

**Intentionality over decoration.** Every element, every move, every light source answers *what
is this telling the viewer*. If the answer is "nothing, it looked nice", it is wrong. This is not
a taste position — it is the one that survives contact with a check, because bay's `dead-plate`
and `empty-container` are both this principle with a number attached.

**Sensory translation.** Translate the abstract into the physical. If the product is fast, the
cut is fast. If it is calm, things settle rather than snap. A film about privacy that opens with
a hard cut and a text slam is lying with its grammar while telling the truth with its words, and
the grammar is what people believe.

**Mastery of contrast.** Scale (macro detail against a wide), pace (frantic against a held
frame), light (a bright subject in a dark frame), sound (a beat after silence). A film at one
tempo throughout is asleep no matter how good each frame is. **Contrast is the single thing most
often missing from an agent-built film**, because an agent builds each beat well and builds them
all the same.

---

## Phase 0 — understand the product

Ask all of this at once. Drip-feeding questions across five turns is how a brief arrives
half-formed.

1. **Product** — what is it, what does it do, what does it replace?
2. **Audience** — who is watching? Developers, consumers, investors, an internal room?
3. **Core message** — the ONE thing they remember tomorrow.
4. **Tone** — what should they *feel*? Impressed, calm, excited, unnerved, ready.
5. **Duration** — 15 s teaser / 30 s spot / 45–60 s launch / 90 s+ deep dive.
6. **Assets** — logo, screenshots, screen recordings, photography, brand colours, fonts?
7. **Narration** — voiced or music-only? Language, and what the voice should sound like.
8. **Reference** — anything they admire. A link is worth ten adjectives.
9. **Where it gets posted** — a landing page, a feed, a keynote, a Shorts slot. This decides
   aspect, whether it must read muted, and how fast the first three seconds have to be.

If the conversation already answers some of these, extract them and confirm only the gaps.

**GATE.** Do not start Phase 1 without an answer — theirs or yours, stated — to all nine. If
assets were provided, list every one and say where each will be used. Not every asset has to
appear; none may be silently dropped.

---

## Phase 1 — the aesthetic

This is the most consequential creative decision and the one most often skipped.

**In bay the aesthetic is a kit**, not a set of hexes. `style_pick` takes the brief and offers
kits: display, body and mono faces, a six-role palette, a type ramp per role, and named framings.
Once committed at `project_create`, every `add_text` and `add_shape` resolves its family, size,
weight and colour from the `role` and `tone` you name. **You never type a hex or a point size.**

So Phase 1 is not "invent a palette". It is:

1. `style_pick` with a real brief — the product, the tone, the audience, in a sentence.
2. Read the offers and **choose against the product's personality**, not the prettiest card. The
   faces are the brand voice made visible: a transitional serif argues, a geometric sans
   demonstrates, a mono says this was built by engineers.
3. `fonts_check` before you commit. A kit naming a face this machine does not have will
   substitute silently and every frame will be wrong in a way that is hard to see and impossible
   to unsee. `fonts_list` says what is actually installed.
4. Say your choice out loud, with the reason, before you build.

If you are offering the user a direction rather than picking one, give **two or three**, each as:
name · mood in two sentences · which kit · the motion character (things settle / things snap /
things drift) · and the **signature element** — the one motif that makes this film this film and
not a template with a logo dropped in.

### The slop checklist

These are the tells of a generated video. They are not the original's list; that one was written
against HTML. This one is written against what bay actually produces when nobody is watching.

- **Everything centred.** `x: 0.5, y: 0.5` on every beat. Use the kit's `framings` — they exist
  because an agent left alone centres everything.
- **One move, everywhere.** Fifteen elements, all `lift`. The registry has 35 moves in 8 kinds;
  a film that uses three of them is a film with one idea about motion.
- **Opacity fades as entrances.** bay's registry forbids opacity as a *lead* channel for a
  reason. A thing that materialises did not arrive from anywhere.
- **The kit ignored.** Raw hexes, hand-set sizes, a headline at `role: "caption"` because it fit.
  If you are fighting the kit, you picked the wrong kit — change it, don't override it.
- **Purple gradient on near-black.** Now that bay has gradients this is reachable, and it is the
  single most recognisable cliché in the genre. The rest of the original's list ports intact:
  emoji as icons, flat evenly-lit scenes, identical card grids, text with no spatial relationship
  to anything.
- **A held frame with a caption crawling under it.** Passes a lint, reads as a screensaver.

**GATE.** Present the directions and get a choice. If the user says "just do it", pick, and state
which and why in one sentence before moving on.

---

## Phase 2 — the storyboard

**Write the whole storyboard before placing a single element.** Save it as `storyboard.json` next
to the project. It is the contract between the concept and the build, and it is what you re-read
in Phase 5 instead of trusting your memory of what you meant.

See [references/storyboard.md](references/storyboard.md) for the schema and a worked example.

### The arc

Even fifteen seconds has a dramatic structure.

| Act | Does | Share of a 30 s film |
|---|---|---|
| **Hook** | A problem, a tension, or one striking frame | 15 % |
| **Reveal** | The product. The hero moment | 15 % |
| **Showcase** | 2–4 capabilities, one beat each | 45 % |
| **Climax** | The most impressive single thing in the film | 15 % |
| **Close** | Name, line, call to action | 10 % |

15 s compresses to hook → reveal → close, no features. 60 s expands the showcase to 4–5 beats and
earns a vision or proof beat before the climax. 90 s adds real-world usage.

Four structures, pick by what the product actually is: **problem → solution** (a clear pain),
**vision → reality** (a new category), **montage → focus** (feature-rich, or a big update),
**teaser** (intrigue, glimpse, date).

### Beats are markers

`marker_add` every beat before any element exists. This is not bookkeeping: bay's `check` reads
the piece through its markers, and the mix is judged against the `payoff` marker you place now,
before there is any audio to judge. A film without markers is a film bay cannot review.

Beat lengths in this genre run **median ~6 s, shortest 3, longest 12**. Each beat is one idea,
fully assembled, then *removed* — and the removal is as designed as the arrival.

### Specificity is the whole point

"Elements animate in" is not a storyboard entry. It leaves enough room that the build will be
generic, and you will not be able to tell afterwards whether the build failed or the plan did.

> **Bad:** the title appears and cards come in.
>
> **Good:** headline `land`s on frame 1 at `role: "hook"`, `framing: "hero"`. At 0.9 s three
> capability cards `cascade` in from the left, 140 ms apart, while the headline `make-room`s
> upward to clear them. The rule under the headline `underscore`s after the last card settles.

The test: **two different builders working from your entry produce nearly the same timeline.** If
they wouldn't, it isn't specific enough yet.

### The storyboard review

- [ ] Every beat has a purpose. No beat exists to fill time.
- [ ] The arc has tension *and* release — not five beats at the same energy.
- [ ] Total duration is within a second of the target.
- [ ] The hero moment is named, and it is not the logo.
- [ ] The product, its interface, or an unmistakable artefact of it is on screen inside 3 s —
      unless this is deliberately a teaser.
- [ ] If it may play muted, every claim in the narration also exists on screen.
- [ ] Each beat names what it carries **into** the next one. That is `broken-continuity`, and in
      this format it is a real requirement rather than a genre mismatch.
- [ ] No two consecutive beats share a layout or a move set.
- [ ] Any beat with 3+ items names a choreography pattern, not "staggered fade".
- [ ] If narrated: the `voice` block is filled, every beat has narration text or an explicit
      `null`, and the word count fits the beat at ~2.5 words/second.

**GATE.** `storyboard.json` exists and passes the list above before Phase 3.

---

## Phase 3 — assets

Only if the storyboard needs them. Skip it outright if type and shapes carry the film — in this
genre they usually do, and the reference film this format was derived from was 2D composited
layers for all but four of its 118 seconds.

- **`stock_search` / `stock_fetch`** — the open archives, ranked by what is *in* the frame. Read
  `separation` before you trust the order, and **look at what it picked**. It proposes.
- **`gen_image` / `gen_video` / `gen_music`** — bay will generate, locally, and returns a preview
  with a cost before it does anything. Check the `configured` flag first: on a machine where the
  local model is not installed this returns `willGenerate: false` and you should plan without it
  rather than discover it at build time.
- **Brand fidelity is absolute.** Use the user's own logo, UI and product photography as
  references only. You may re-light, re-frame and re-stage them. You may not redraw them.
- **Interfaces get rebuilt, not screenshotted.** A panel made of shapes can scale from nothing,
  translate as a unit and mask down into a single node. A screen recording can be cropped and
  moved. This is the difference between a film about a product and a film with a product in it.

`media_import` everything before you build. `library_save` the keepers.

---

## Phase 4 — build

### 4.0 Narration first

If the film is voiced, **`narrate` before you place anything**, because the real audio duration
is the timing backbone and every beat after it moves when it changes.

Kokoro runs locally through `narrate` — `speech_status` lists the voices, `runtime_install`
fetches it if it is missing. Never tell the user to install it themselves.

- **Pick the voice from the storyboard's `voice` block**, not by ear on the first try. `af_*` and
  `am_*` are American, `bf_*`/`bm_*` British, and the other prefixes are other languages.
  `af_heart` and `bm_george` are the safe two for this genre; `am_puck` has energy and `bf_emma`
  has calm.
- **Narrate per beat, not the whole script in one call.** One long take gives you one duration
  and no ability to move a single beat.
- **Then conform the storyboard to the audio.** If a beat's narration came back at 4.4 s and the
  storyboard said 4.0, the storyboard is wrong. Update it and push every subsequent `startSec`.
- Captions come from the same synthesis as the audio, so they cannot drift. Take them.
- Write for the ear: short sentences, one clause, no parentheses. Read it aloud. Anything you
  stumble on, Kokoro will stumble on differently and worse.

### 4.1 Motion

**You name moves. You do not write curves.** `animate` takes a registry move, which carries its
own channels, key values, easing and duration. `animate_many` runs one move across a group,
staggered. Hand-written keyframes still work and are reported per channel as
`off-vocabulary-motion`, so the cost of leaving the vocabulary scales with how far you leave it.

This is where the original's easing tables and spring configs used to be. They are gone on
purpose — see the last section.

**The density standard.** The original asked for three simultaneous CSS properties per element.
That does not port: bay animates `opacity, scale, x, y, rotation, scaleX, scaleY` and `volume`,
and nothing else — blur, colour and letter-spacing are one-shot state, not channels. What ports
is the *intent*, restated in bay's own terms and, unlike the original, checkable:

Every beat has, at minimum:

1. **An entrance** — one `Entrance` move on the thing the beat is about.
2. **A response** — an element already on screen answers the arrival with a positional or scale
   move. `make-room` and `dim-back` are the two `Response` moves and `make-room` is the highest
   value move in the registry. Opacity does not count and neither does the arrival's own stagger
   group. This is `no-response`.
3. **An ambient** — something continuous under the held part of the frame: `drift`, `creep`,
   `push-in`, `pull-back`, `fill`. Without one the beat is a slide. This is `frozen`.

And across the film: **an accent on the landings** (`tap`, `thump`, `nudge`, `tilt`), **a
designed exit** (`duck`, `sweep-out`, `recede` — an exit is not a reversed entrance), and **a
seam pair** where two beats should feel welded (`whip-out`/`whip-in`, `z-out`/`z-in`).

**No two consecutive beats use the same move set.** If beat 3 cascaded cards from the left, beat
4 does not.

### 4.2 Layers

A beat with one layer is a slide. Build up the stack — bay's version of it, with what each is
actually made of:

| Layer | Made of | Motion |
|---|---|---|
| 1 Ground | full-frame shape, gradient fill from the kit's tones, or an image | `push-in` / `pull-back` |
| 2 Structure | thin rectangles as a rule grid, placed once | static |
| 3 Depth | ellipse + a one-shot `blur` effect = a glow orb; `blend_set: "screen"` | `drift`, slow `tap` |
| 4 Atmosphere | 12–30 small ellipses — more than that costs more than it gives | `wave` across the group |
| 5 Content | the actual type, panels, product | the beat's entrance |
| 6 Light | a thin bright blurred rect swept across | `sweep` |
| 7 Grain | a noise PNG, full frame, `blend_set: "overlay"`, at the opacity where you stop noticing it | static |

Not every beat needs all seven. **Fewer than three and it will look flat**, and that is not a
matter of taste — `check_frames`'s `bottom-dead` and `anchor-scale` are both measuring whether a
frame has more than its content layer.

**Composition:** anchor to the kit's `framings` rather than to centre. Build at least one leading
line per beat — a rule, a gradient direction, a panel edge — that points at the focal element.
The brightest, highest-contrast thing in the frame should be the thing you want looked at; if it
isn't, the frame is arguing with itself.

**Light is a tool, not a finish.** A radial gradient behind the product is a spotlight. Glow
intensity should crescendo into the climax. A beat about privacy uses contained light; a beat
about power uses a hard directional beam.

**Type is a physical object.** Never a bare fade. Match the motion to the word — a line about
speed enters fast, a line about calm settles.

### 4.3 Choreography

Three or more items on screen at once is a choreography problem, not a stagger problem. The ten
patterns, which of them bay can build, and how — [references/choreography.md](references/choreography.md).

### 4.4 Seams

Transitions are where an amateur film gives itself away.

- **Motivated.** The seam is a consequence of the outgoing beat's energy, not a chosen effect.
- **Momentum transfers.** If a card left rightward, the next thing enters from the right. If
  something shrank away, the next thing grows in. That is what `whip-out`/`whip-in` and
  `z-out`/`z-in` are for — velocity-matched pairs, not two independent animations.
- **Something survives the seam.** Keep the *id* across it and `animate` it there. A rebuilt beat
  loses its id and reads as the next card in a carousel. This is `broken-continuity`.
- **Vary them.** The same transition eight times is one transition seen eight times.
- **Never transition over something being read.**

Fast (0.2–0.3 s) is montage. Medium (0.3–0.5 s) is standard. Slow (0.5–0.8 s) is cinematic —
and a 2-second beat cannot afford a slow one.

---

## Phase 5 — the review

**The `bay` skill's numbered gate applies here unchanged and in full.** This format is the genre
those checks were written against, so nothing is suspended and nothing is a false positive. Run
it. Do not restate it here and do not substitute this list for it.

On top of it, for this genre specifically:

- [ ] **Pause anywhere. Is it a poster?** Export a frame from every beat with `contact_sheet` and
      **actually Read the PNG.** Every defect worth catching is invisible to a lint and obvious
      in a frame. This is the step that gets skipped and it is the one that finds the bugs.
- [ ] **The first three seconds stop a scroll.** Not "are competent". `no-hook` measures the
      opening against the film's own median, so a film that is quiet throughout passes it while
      still opening on nothing.
- [ ] **It has rhythm.** Fast, slow, fast, hold. Say the tempo of each beat out loud in order; if
      you can't hear a shape, there isn't one.
- [ ] **Breathe before the climax.** A moment of stillness is what makes the biggest moment big.
- [ ] **No held frame over 2 seconds** without an ambient move under it.
- [ ] **Readable at phone size**, not just in a full-size preview. Shrink the contact sheet and
      look again.
- [ ] **Nothing exists only to satisfy a check.** This is the failure mode of building against a
      gate, and it has happened here: a black strip added to clear `bottom-dead`, a slab sized to
      clear `anchor-scale`. Both passed. Both looked like placeholders. If an element's only
      justification is a check code, delete it and solve the beat properly.

---

## Phase 6 — render and deliver

`render` runs `check` first and refuses on an error. `ignoreChecks` with a `reason` exists and
writes your reason into the file's metadata — a written claim, not a suppression, and it silences
*everything* rather than the one code you meant.

Before the full render, snapshot one frame per beat and look at them. A layout bug found in a
still costs a minute; the same bug found in a finished render costs the render.

Then tell the user: where the file is and how big, its duration and resolution, what to change to
re-cut it — the kit for colour and type, the markers for timing, the beat's elements for content
— and **what you would fix with another pass**. That last one is the difference between delivering
a film and handing over a file.

---

## What did not port, and why

If you know the original, this is the diff. If you don't, you can stop reading here.

| The original | Here | Why |
|---|---|---|
| Easing table, spring configs, stagger millisecond ranges | Deleted | The registry holds them. It exists because an audit found 90 % of hand-authored channels were opacity and 76 moves lasted three frames — a document with free parameters gets read as defaults and typed back in wrongly. Naming a move is the fix. |
| "3 simultaneous motion properties (opacity + transform + filter)" | "Entrance + response + ambient per beat" | bay has no animatable filter, and a stronger invariant of its own: opacity may ride, never lead. The restatement is also checkable, which the original wasn't. |
| Remotion project structure, `useCurrentFrame`, `<Sequence>` | Gone | There is no code. The timeline is the artefact. |
| Colour palette invention | `style_pick` | The kit resolves size, weight, family and colour from a role. Inventing a palette means overriding one. |
| Gemini TTS, `GEMINI_API_KEY`, network | Kokoro via `narrate` | Local, no key, nothing leaves the machine. |
| "Render a still and inspect it" | Same, promoted to a gate | It was advice. Here it is step 11 of a numbered gate, because it is the step that actually finds things. |
| Frosted glass, `backdropFilter`, CSS grain | Blend modes + a noise image | bay has 17 blend modes and five effects (brightness, contrast, saturation, blur, lut). Glass is not one of them. |
| Phases 0–2 and 5: brief, aesthetic, storyboard, review | Kept nearly intact | This is the part that was never about Remotion. It is the reason the original is worth porting. |
