> **Historical:** describes the Rust engine, deleted; recover what it cites with `git show rust-engine-final:dep/rust/<path>` (e.g. `crates/bay-mcp/src/tools.rs`).

# 43 — Process prior art: `faceless-explainer` and `brag`

Mined for **process architecture** — the workflow, its artifacts, and what enforces the order — not
for aesthetic content. Everything below is quoted from source on this machine:

- `~/.claude/skills/faceless-explainer/` (SKILL.md, references/, scripts/, sub-agents/)
- `~/.claude/skills/hyperframes-core/references/` (the shared contracts the skill delegates to)
- `~/.claude/skills/brag/` (SKILL.md, references/, scripts/, assets/)
- bay: `rust/crates/bay-audio/src/{sfx.rs,library.rs,lib.rs}`, `bay-core/src/check.rs`,
  `bay-mcp/src/tools.rs`

---

## 0. The one-sentence finding

In both skills the plan is a **file that later steps mechanically read**, and the unit of work is a
**physically separate file with a separate author**. bay's failure — 188 elements in one 61-second
scene — is not possible in these systems, because there is no place to put a 189th element: a frame
worker's terminal action is writing `compositions/frames/<frame_id>.html`, and `frame_id` is derived
from the `src:` line of a `## Frame N` block that a human approved. Structure is enforced by the
filesystem and by scripts that `process.exit(1)`, not by prose asking for structure.

---

## 1. The two pipelines and their gates

### 1a. `faceless-explainer` — 8 steps, every one with an explicit **Gate:** line

The skill states its own enforcement posture up front:

> You are the orchestrator. Work in `videos/<project>/`. Run steps in order and pass each gate
> before continuing. User-gated steps are Step 0, Step 3, and Step 6. […] Do every step yourself
> except Step 5, where you dispatch one sub-agent per frame.

Workflow, verbatim from SKILL.md line 18:

> Step 0 setup → `hyperframes.json`; Step 1 brief → `capture/extracted/`; Step 2 design system →
> `frame.md`; Step 3 storyboard/script → `STORYBOARD.md` and `SCRIPT.md`; Step 3.1 audio →
> `audio_meta.json`; Step 4 visual design → enriched `STORYBOARD.md`; Step 5 frames →
> `compositions/frames/NN-*.html` and `index.html`; Step 6 final render → `renders/video.mp4`.

| Step | Artifact produced | Gate (verbatim) | What actually enforces it |
|---|---|---|---|
| 0 Setup | `hyperframes.json`, `BRIEF.md` | "`hyperframes.json` and `BRIEF.md` exist; the preference-backed answers were recorded […]; sign-in status was shown" | **File exists** + `npx hyperframes init` refuses a non-empty directory |
| 1 Brief | `capture/extracted/visible-text.txt`, `tokens.json` | "…exist; you can state the explainer's topic and audience in one clear sentence" | **File exists** (the second half is prose) |
| 2 Design system | `frame.md`, `.hyperframes/caption-skin.html` | "`build-frame.mjs` exited 0 — `frame.md` exists from a named preset" | **Script exit code.** `build-frame.mjs --preset <name>` "copies the preset's `FRAME.md` → `frame.md` and **remixes** it onto any brand tokens […] and self-validates (exits 1 on a broken mapping)" |
| 3 Storyboard | `STORYBOARD.md`, `SCRIPT.md` | "`STORYBOARD.md` exists, every frame has the required narrative fields, `SCRIPT.md` exists when narration is needed, and the user approved the frame-by-frame plan" | **File exists + human checkpoint gate.** Downstream, `frame-packets.mjs` throws `"STORYBOARD.md has no frame blocks"` and `"${frame.heading}: missing src"` |
| 3.1 Audio | `audio_meta.json` | "audio job has started, or the project is marked silent (`music: none` + no `SCRIPT.md`)" | **File exists**, and the silent marker is pinned by tests |
| 4 Visual design | enriched `STORYBOARD.md` (shot sequences) | "every frame has a time-coded shot sequence whose reveals are paced to the voiceover (no front-loading); each frame names its invented `focal` and/or `roles`; `## Video direction` exists" | **Prose + a checklist.** This is the weakest gate in the chain — see §8 |
| 5 Build frames | `compositions/frames/NN-*.html`, `index.html` | "every frame is marked `animated` […], `index.html` exists, and captions are built or explicitly skipped" | **Subagent contract + script.** `frame-packets.mjs` refuses oversize packets; `assemble-index.mjs` refuses to assemble over a pending BGM |
| 6 Finalize | `renders/video.mp4` | "`lint` and `check` passed and the snapshots were inspected before render; user approved at the review pause; `renders/video.mp4` exists" | **CLI exit codes** (`transitions verify`, `lint`, `check`) + human gate |

Two enforcement details worth stealing:

**Failure stops the line, and recovery is bounded.**

> If a command fails, surface stderr and stop — don't pile on recovery commands. Fix it yourself:
> the cheapest safe edit to `compositions/frames/NN-*.html`, then rerun the failed check.

**Known false positives are named so the agent doesn't burn the budget chasing them.** Step 6
carries an explicit "Known false-positive — do not chase it" paragraph about ~1–4px
`text_box_overflow` on caption words, ending: "Only act on a `text_box_overflow` when it names a
**frame** element (`#el-NN-*`), not a caption word." A check suite that cries wolf gets ignored
wholesale; naming the wolf keeps the rest credible.

**Ordering is enforced structurally, not by numbering.** Step 5 physically cannot run before Step 3,
because `frame-packets.mjs` reads `STORYBOARD.md` and throws without it; Step 6's
`transitions.mjs inject` reads both `STORYBOARD.md` and `index.html` and `die()`s with
`"index.html not found at ${indexPath} — run assemble-index.mjs first"`. The step numbers are
documentation; the *file dependency graph* is the enforcement.

### 1b. `brag` — 4 steps, one hard gate, three soft

```
Step 1 Inspect  → (answers to a 9-question rubric, written down)
Step 2 Plan     → <output-dir>/brag-plan.md
Step 3 Compose  → <output-dir>/composition-brief.md + composition/
Step 4 Deliver  → brag.mp4 + brag.jpg + share-copy.txt
```

Gates verbatim from `brag/SKILL.md`:

| Step | Gate |
|---|---|
| 1 | "You can answer all 9 questions in the brag planning rubric." |
| 2 | "`<output-dir>/brag-plan.md` exists with a full storyboard. Scene durations sum to 15–25 seconds." |
| 3 | "`npx hyperframes check` passes with zero errors inside `<output-dir>/composition/` (the single browser gate before render — see hyperframes-cli for what it audits)." |
| 4 | "`<output-dir>/brag.mp4` exists. A best-frame poster `<output-dir>/brag.jpg` is picked (not an arbitrary frame) and baked as frame 0 of `brag.mp4`. Share copy is written." |

**What actually stops step 3 from starting before step 2 is done — honest answer:** *only* the file
dependency. `composition-brief.md` is templated to embed values that exist nowhere else
(`## Storyboard` says "Use the storyboard in `brag-output/brag-plan.md` as the creative contract",
and the Visual Identity block wants "exact value from project" for background/text/accent). You
cannot fill the brief template without having done Step 1 and Step 2, and Step 3's own self-review
checklist opens with `[ ] <output-dir>/composition-brief.md exists.` There is no script that
verifies Step 2 happened. Compared with faceless-explainer, brag's ordering is **weakly enforced** —
it holds because each step's output is the literal input template of the next, not because anything
refuses.

**Where brag is *stronger* than faceless-explainer:** its one hard gate has real teeth, and the
skill deliberately removed the escape hatch.

> Fix all errors. `check` is brag's single pre-render gate — run it and fix everything it reports,
> including WCAG contrast failures (they gate as errors, not warnings). Each contrast finding
> carries a suggested compliant color, so apply it or adjust within the palette family and re-run
> `check` — most fixes need no screenshot. **There is no per-element contrast escape hatch for real
> text; the only bypass is `check --no-contrast`, which skips the entire WCAG pass
> (all-or-nothing), not a way to accept one borderline element.**

That last sentence is the single most transferable line in either skill. A check whose bypass is
all-or-nothing cannot be nibbled to death.

**A second brag mechanism with teeth:** the numeric gate. "Scene durations sum to 15–25 seconds.
Count them." plus a per-tone scene-count table (`deadpan` 3-4, `chaotic` 6-8) and a reading-time
floor:

> Short label or 1-3 word line: about 0.8s settled. Headline or full sentence: about 0.3s per word,
> minimum ~1.2s. The hook line gets the most.
> […] **Too much text for the scene length.** A 4s scene lands maybe 2-3 short reads at the floor,
> not 6. If a scene carries more text than its duration allows, cut copy or split the scene — do not
> speed it up.

This is a *distribution* constraint stated as arithmetic, not a diversity count — exactly what bay's
`monotone-duration` fails to be.

---

## 2. The storyboard artifact, verbatim

This is the answer to "what forces a decision before any rendering happens."

### 2a. The base format — `hyperframes-core/references/storyboard-format.md`

Frontmatter (global direction), verbatim table:

| Key | Meaning | Example |
|---|---|---|
| `format` | Canvas size | `1920x1080` |
| `duration` | The brief's rough length expectation (advisory, not a hard limit) | `22s` |
| `message` | One-line thesis | `Ship a launch video in an afternoon` |
| `arc` | Narrative arc | `Hook → Problem → Solution → Proof → CTA` |
| `audience` | Who it's for | `indie devs on X` |
| `mode` | Interaction mode (see `brief-contract.md`; default collaborative) | `autonomous` |

Per-frame section — "One `## Frame N — Title` heading per frame (`Frame` / `Beat` / `Scene` accepted
at H2/H3). Metadata as `- key: value` bullets; everything below them until the next heading is the
free-form **narrative**."

| Key | Meaning |
|---|---|
| `status` | `outline` → `built` → `animated` (defaults `outline`) |
| `src` | project-relative path to the frame's HTML sub-composition (the tile poster renders from it) |
| `duration` | e.g. `4s` |
| `transition_in` | `crossfade` / `cut` / `wipe` … (alias `transition`) |
| `scene` | one-line contact-sheet caption (aliases `description` / `summary` / `caption`) |
| `voiceover` | the frame's narration _guide_ (aliases `vo` / `voice_over` / `narration`) |
| `poster` | seconds to seek for the tile poster (past the intro animation) |
| _any other key_ | kept verbatim under the frame's `extra` — a workflow carries its own per-frame data (effects, assets, …) here |

Parsed manifest (the machine contract):

```
StoryboardManifest {
  globals: { format?, message?, arc?, audience?, extra: {…} }
  frames: Array<{
    index, number?, title?,
    status,                       // "outline" | "built" | "animated"
    src?, duration? / durationSeconds?, transitionIn?,
    scene?, voiceover?, poster?,
    narrative,                    // markdown below the metadata
    extra: {…}                    // unknown keys, preserved
  }>
  warnings: Array<{ message, line?, frameIndex? }>
}
```

Canonical example, verbatim:

```markdown
---
format: 1920x1080
message: "Ship a launch video in an afternoon"
arc: Hook → Problem → Solution → Proof → CTA
audience: indie devs on X
---

## Frame 1 — Hook

- scene: Big type punches in on the beat
- duration: 3s
- poster: 2s
- transition_in: cut
- status: animated
- voiceover: "Ship a launch video in an afternoon."
- src: compositions/frames/01-hook.html

Open cold on the promise. This is the thesis — everything after pays it off.

## Frame 2 — The problem

- scene: A 20-minute timer spins on a stack of rejected takes
- duration: 4s
- transition_in: crossfade
- status: built
- voiceover: "The old way? Prompt, wait twenty minutes, get something that misses."
- src: compositions/frames/02-problem.html

The old way: prompt, wait, get something that misses. Establish the pain we remove.
```

**The parser is deliberately lenient** (`scripts/lib/storyboard.mjs`): "never throws, accepts
freeform narrative, recognizes Frame/Beat/Scene headings at H2/H3, preserves unknown keys verbatim
under `extra` (keys lowercased)." Unknown status values degrade with a warning:

```js
function applyStatus(frame, value, headingLine, warnings) {
  const normalized = value.toLowerCase();
  if (isFrameStatus(normalized)) { frame.status = normalized; return; }
  frame.extra.status = value;
  warnings.push({ message: `Frame ${frame.index}: unknown status "${value}"; defaulting to "${DEFAULT_FRAME_STATUS}".`, … });
}
```

Leniency in the *parser* is paired with strictness in the *consumers*: `frame-packets.mjs` throws on
a frame with no `src`, `transitions.mjs` `die()`s on a missing index or a missing composition root.
The plan file is a permissive human artifact; the scripts that read it are unforgiving.

### 2b. The Step-3 narrative frame template — `references/story-design.md`

What Step 3 must decide *before* any HTML exists:

```md
## Frame N — Short name

- scene: one clear visual idea
- voiceover: "spoken guide text, or empty"
- duration: rough estimate in seconds
- transition_in: crossfade
- status: outline
- src: compositions/frames/NN-short-name.html
- type: feature_showcase
- persuasion: Progressive disclosure
- beat: comprehension
- blueprint: messaging-multi-phase — candidate shape from the role→blueprint menu; omit when none fits

narrativeRole: What this frame does in the viewer's understanding.
keyMessage: The one idea the viewer should remember.
```

`type` is a closed enum: `hook | pain_point | product_intro | feature_showcase | benefit_highlight |
social_proof | branding | cta`. `persuasion` must be **a named technique from a catalog** — the doc
is explicit that a vague answer is a failure: "When no catalog technique fits, name a new one inline
and explain its mechanism […]. Never write generic 'explain the idea.'" `beat` must come from a
four-phase emotional vocabulary and "Avoid generic 'positive' / 'interested.'"

Structure is a single forced choice at the top:

> Pick **one** structure (or explicitly name a compound). Do not splice phases from different
> structures — each is a complete path through understanding.
> `concept-explainer` | `how-to-process` | `listicle` | `story-explainer`

And the core rule that forbids the default behaviour:

> An article is an information dump. A video is a guided act of understanding.
> Do not follow paragraph order. […] **The single most common failure is paraphrasing the article in
> order — do not do that.**

### 2c. The Step-4 enrichment — the time-coded shot sequence

This is the part bay has no analogue for at all. Verbatim example from
`references/visual-design.md`:

```
## Frame 3 — How interest compounds
- scene: a snowball rolls downhill, gaining a labeled ring each turn   ← refine only if it could read sharper
- voiceover: "…"            ← story's; leave it
- transition_in: crossfade  ← story's; leave it
- type: feature_showcase    ← story's
- persuasion: Concretization + progressive disclosure
- beat: comprehension
- blueprint: dataviz-countup (Adapt)   ← you add: the id you instantiated (or "compose")
- focal: the snowball                  ← you add: the INVENTED hero element of this beat
- roles: snowball = foreground subject · hill = background gradient (dim ~40%) · ring labels = supporting   ← you add: role per invented element
- sfx: whoosh-soft, tick               ← you add: the sound the beat wants (fetched + mounted at root; never yours to embed)

Adapt: keep the count-up-ring signature; the trend chart becomes the snowball's labeled rings climbing.
Scene 1 (0.0–1.2s): solid hill gradient (dim ~40%); the snowball seats upper-left, a circular progress ring + bold center number anchor it — Centered template, ~50% of frame. Slow push-in runs underneath.
Scene 2 (1.2–3.4s): as the VO names each turn, the snowball rolls down and gains one labeled ring per turn (layer-reveal); a small total ticks up beside it (the count-up reveals on its spoken cue, not at t=0). Asymmetric 60/40, 3 depth layers.
Scene 3 (3.4–5.0s): land the final ring emphasis dead-center, accent glow blooms behind it and holds; the total reads clean and STILL — no continuing push, no breathing (a held beat beats bad motion). The stillness reads against the prior motion.
```

The window count is derived, not fixed:

> **The window count = the number of spoken cues the line calls for** — a two-beat line is two
> windows, a five-item enumeration is five or six. There is **no fixed count and no mandatory
> "middle" act**; the only sin is dumping everything up front.

And the shot sequence is written to *forbid* bay's exact failure:

> The failure that reads as PowerPoint is **front-loading**: the agent rushes the whole canvas on
> screen in the first ~25%, and then it just sits. A time-coded shot sequence written **against the
> VO** makes that impossible: each window states what is on screen and what is moving, and
> **nothing appears before the voiceover reaches it.**

There is also a video-level invariants block written **once**, so per-frame entries are deltas:

> **`## Video direction` — write the invariants ONCE** […] palette system · motion grammar + reveal
> model · rhythm / held-frame allocation · negative list — what never appears […] **plus both motion
> failure modes** — slideshow (front-load then freeze) and screensaver (everything floating
> independently). […] Do **not** repeat these per frame — restating video-level rules in every frame
> is exactly the bloat this layer prevents.

### 2d. `brag`'s plan artifact — `brag-plan.md`

Lighter, but with two things faceless-explainer lacks: a **committed tone** and **per-scene audio
intent**. Verbatim skeleton (abridged to its load-bearing rows):

```markdown
# Brag Plan: [App Name]
## What is this app?
## The angle
## Hook (first 2-3 seconds)
## Key moments (the middle)
## Outro / punchline
## User flow worth showing
## Tone
- Preset: [default / polished / yc-parody / chaotic / deadpan / cinematic / app-store]
- Creative direction: [freeform phrase, inferred or user-provided]
- Interpretation: [one sentence on how this affects pacing, writing, visual energy, and restraint]
## Format: [landscape / vertical / square] — [width]x[height]
## Duration: [target seconds]
## Visual identity (from the project)
- Background: [exact color value]
- Accent: [exact color value]
- Text: [exact color value]
- Display font: [name]
- Body font: [name]
- Strongest visual element: [what from the site to reference]
## Audio direction
- Role / Music / Music treatment / Music cue guidance / Audio-reactive treatment /
  SFX posture / Audio-coupled moments / Restraint rule
## Storyboard

### Scene 1 — [name] — [duration]s
[What's on screen. What text appears. What product material must be referenced.]
Sequential/interaction: [yes — describe what appears one by one or what interaction is simulated …; or none]
Audio intent: [what the sound should do emotionally]
Audio-coupled idea: [typed text, beat-aligned reveal, counter ticks, card-by-card sequence, simulated tap/swipe/type — or none]
Music: [mood, or "none" only if disabled / missing / intentionally silent]
Transition mood: [clean / hard / dramatic / soft / chaotic] → Scene 2
```

The `Visual identity` block is the anti-default mechanism: it demands **exact color values pulled
from the project**, and Step 1 tells you where to get them ("look for custom properties like
`:root { --primary: … }`"; failing that, "scan for the most-used colors"). The style is *sourced*,
never defaulted.

---

## 3. The frame-worker subagent pattern

### 3a. What is delegated

One frame. Not one file-with-several-frames, not a range.

> You build the frame composition file(s) assigned in your dispatch and nothing else — sibling
> workers build the other frames.
> **OUTPUT** — `compositions/frames/<frame_id>.html` for each assigned packet: exactly one bare
> `<template>…</template>` fragment. […] Writing your assigned file(s) (past the self-check below) is
> your **terminal action** — you do not edit `STORYBOARD.md`, mint audio, assemble the index, run the
> CLI, or report back. The orchestrator picks up the file and marks the frame's `status`.

### 3b. What context it gets — a *bounded, inlined* packet

`frame-packets.mjs` is a 27-line wrapper over
`hyperframes-core/scripts/lib/frame-packets-core.mjs`. The packet is assembled here:

```js
const packet = `# Frame packet: ${id}\n\n## Project inputs\n\n- Project: ${resolve(projectDir)}\n${designTruthLine(projectDir)}\n- RULES_DIR: ${join(animationDir, "rules")}\n\n## Assigned storyboard block\n\n${frame.block}\n${resourceSections(frame.block, { animationDir, ruleIds })}${extraSections ? extraSections(frame.block) : ""}`;
const bytes = Buffer.byteLength(packet);
if (bytes > maxPacketBytes) {
  throw new Error(`${id}: frame packet is ${bytes} bytes (limit ${maxPacketBytes})`);
}
```

Default `maxPacketBytes = 48_000`. The cited motion rules are found **mechanically**, not by asking
the agent to list them:

```js
export function citedRules(block, ruleIds) {
  const explicit = (field(block, "rules") ?? "").split(/[,\s]+/).map(r => r.trim()).filter(Boolean);
  const mentioned = ruleIds.filter((id) =>
    new RegExp(`(?<![\\w-])${escapeRegExp(id)}(?![\\w-])`, "i").test(block),
  );
  return [...new Set([...explicit, ...mentioned])].filter((id) => ruleIds.includes(id));
}
```

`ruleIds` is `readdirSync(rulesDir)` — the set of valid motion names **is the set of files on
disk**. A hallucinated motion name simply inlines nothing, and the worker contract then says: "for
each **named motion** in a Scene, reproduce the mechanics of its inlined rule recipe — **never
name-guess**." The role payload is assembled from two files verbatim so nothing is maintained twice:

```js
const role = `${core}\n\n---\n\n${delta}\n`;   // frame-worker-core.md + sub-agents/frame-worker.md
```

### 3c. What the worker is explicitly *forbidden* to decide

Verbatim heading "## You do NOT decide":

> - **What is SAID** — narration is locked in `SCRIPT.md` / the `voiceover` line. You only show; you
>   never write or restate narration text.
> - **Duration** — fixed from real voice timing. Build your shot to land within it; don't stretch or
>   trim it.
> - **Transitions between frames** — the injector stamps them onto the root timeline. You author the
>   shot itself (the VO-paced reveal sequence) but **never an exit**.
> - **Audio** (narration / BGM / SFX) — assembled at the root by the orchestrator. **No `<audio>`
>   element in your composition.**
> - **Design tokens** — palette / fonts / components come from `frame.md`. Don't invent them, and
>   **never lift a word, label, or wordmark out of `frame.md` as your copy** — it is a style spec, not
>   content.
> - **Which motions / assets exist** — named upstream in your block […]. Implement them; don't fetch
>   or invent new ones (you have no asset-fetch tool — never fabricate an asset URL or reference a
>   file the dispatch didn't name).
> - **The shared `STORYBOARD.md`** — your packet carries your block; never open or write the file
>   itself. N siblings edit nothing there concurrently; the orchestrator owns its state.

Note what this list *is*: every axis on which bay's agent drifted (font, size, colour, x-position,
duration, easing) has been removed from the frame author's decision space and moved upstream into an
artifact a human approved.

### 3d. Why the authors isolated it

Three stated reasons, all mechanical rather than stylistic:

1. **Concurrency safety.** "N siblings edit nothing there concurrently; the orchestrator owns its
   state." Namespacing is mandated: "Prefix authored ids and globally reusable class names with
   `<frame_id>-` so sibling frames assembled from parallel workers cannot collide."
2. **Context bounding.** "Workers read only their packet and `frame.md`; they never open
   `STORYBOARD.md` or the skill documents (the packet inlines what was selected upstream)." The
   packet even overrides the skill catalog: "This role + your packet also **supersede the skill
   catalog's own imperatives**."
3. **Honest self-check scoping.** The worker is told *why* it cannot verify its own work:

   > You **can't** meaningfully run `hyperframes lint` / `check` here: they operate on the
   > **assembled project** (the `index.html` graph / bundle), and your frame isn't wired in yet — so
   > they report on _other_ files, not yours (**a false green**). The **orchestrator** runs them after
   > assembly (the correct unit), and **re-dispatches you with the finding** if your frame fails.

   And the retry contract closes the loop: "if your context carries `lint` / `check` feedback from a
   prior pass, read it first and re-author so none of those findings recur; **treat each as a hard
   constraint**."

### 3e. Does it port to bay? Honest assessment: **partly, and the mismatch is real.**

The mismatch: a hyperframes frame is an **independent HTML file with its own paused GSAP timeline**,
composited later by an assembler that owns tracks, overlap, and audio. A bay scene is a **time range
on one shared mutable timeline**, reached through stateful MCP calls (`add_text`, `animate`,
`transform_set`) against a single loaded project. Three consequences:

- **No isolation boundary exists.** Two bay subagents calling `add_text` hit the same `Studio` and
  the same project JSON. There is no per-frame file to write, so "write your file and stop" has no
  bay equivalent today. Concurrent workers would race on element ids and layer indices.
- **No natural retry unit.** hyperframes can re-dispatch one worker with a finding because that
  worker's output is one file it can rewrite wholesale ("rewrite to iterate; last write wins"). A bay
  scene cannot be rewritten wholesale without `element_delete`-ing everything in its range, which
  the skill's own guidance discourages ("a rebuilt element loses its animation and its id").
- **The packet's value survives the mismatch; the parallelism does not.** The part that would have
  prevented bay's failure is not "run N agents", it is "**each unit of work receives only its own
  approved block, plus the inlined recipes for the moves it named, and cannot see or touch the
  rest**." That is portable to a *sequential* loop: build scene N from packet N, then scene N+1.

**The minimum bay port that preserves the value:** make the scene the unit and give it a
transaction. `scene_begin(scene_id) -> handle`, all element adds require `scene: <id>`, and
`scene_commit(scene_id)` runs the per-scene checks and refuses on error. Whether the body of that
loop runs in a subagent is then an optimisation, not the mechanism. If you *do* want subagents,
they need per-scene isolation in the engine first (a scene-scoped mutation API that rejects writes
outside its range) — otherwise you get bay's current failure mode with N times the concurrency.

---

## 4. Music cues and SFX analysis

### 4a. `analyze_music_cues.py` — what is computed

Four normalized features, per analysis frame (`HOP_LENGTH = 512`, `FRAME_LENGTH = 2048`, default
`sr=44100`), all from `librosa`:

| Feature | Source |
|---|---|
| `onset_strength` | `librosa.onset.onset_strength(y, sr, hop_length)` → normalized |
| `local_onset_contrast` | onset minus the median of a ±0.5s window around the frame, clamped at 0 → normalized |
| `rms` | `librosa.feature.rms(y, frame_length, hop_length)[0]` → normalized |
| `bass_energy` | mean STFT magnitude in **30–180 Hz** (`n_fft=4096`) → normalized |

Normalization is robust, not max-based:

```python
high = np.percentile(values, 98)
…
return np.clip(values / high, 0.0, 1.0)
```

The composite score:

```python
intensity = 0.45 * onset + 0.25 * contrast + 0.20 * rms + 0.10 * bass
```

Beat grid from `librosa.beat.beat_track(y, sr, onset_envelope=onset_env, hop_length, units="frames")`;
cue candidates are **every beat** (`kind: "strong_beat"`) plus **every detected onset**
(`librosa.onset.onset_detect(backtrack=False)`, `kind: "onset_peak"`). Then:

```python
def _dedupe_cues(cues, min_gap=0.18):
    sorted_by_strength = sorted(cues, key=lambda item: item["intensity"], reverse=True)
    accepted = []
    for cue in sorted_by_strength:
        if all(abs(cue["time"] - existing["time"]) >= min_gap for existing in accepted):
            accepted.append(cue)
    return sorted(accepted, key=lambda item: item["time"])

strong_cues = [c for c in _dedupe_cues(cue_candidates) if c["intensity"] >= 0.45]
strongest   = sorted(strong_cues, key=lambda c: c["intensity"], reverse=True)[:64]
strong_cues = sorted(strongest, key=lambda c: c["time"])
```

Greedy strongest-first dedupe at 180 ms, floor 0.45, cap 64.

### 4b. The cue schema, verbatim

From `assets/music/cues/happy-beats-business-moves-vol-1-by-ende-dot-app.music-cues.json`
(311 beats, 64 strong cues):

```json
{
  "schemaVersion": 1,
  "source": {
    "filename": "happy-beats-business-moves-vol-1-by-ende-dot-app.mp3",
    "trackStem": "happy-beats-business-moves-vol-1-by-ende-dot-app"
  },
  "duration": 163.96,
  "tempo": 120.19,
  "analysis": {
    "sampleRate": 44100,
    "hopLength": 512,
    "windowStart": 0.0,
    "windowDuration": 25.0,
    "windowEnd": 25.0
  },
  "scoring": {
    "intensityFormula": "0.45*onset_strength + 0.25*local_onset_contrast + 0.20*rms + 0.10*bass_energy",
    "features": ["onset_strength", "local_onset_contrast", "rms", "bass_energy"],
    "normalization": "Per-track robust normalization to 0-1 using the 98th percentile, then clamped.",
    "strongCueMinimumIntensity": 0.45,
    "strongCueMaxCount": 64
  },
  "beats": [
    {
      "time": 3.0186,
      "intensity": 0.8565,
      "features": { "onsetStrength": 1.0, "localOnsetContrast": 1.0, "rms": 0.6465, "bassEnergy": 0.2721 }
    },
    {
      "time": 3.5178,
      "intensity": 0.8158,
      "features": { "onsetStrength": 1.0, "localOnsetContrast": 1.0, "rms": 0.4754, "bassEnergy": 0.2076 }
    }
  ],
  "strongCues": [
    {
      "time": 16.0218,
      "intensity": 0.9988,
      "features": { "onsetStrength": 1.0, "localOnsetContrast": 0.995, "rms": 1.0, "bassEnergy": 1.0 },
      "kind": "strong_beat"
    },
    {
      "time": 17.0202,
      "intensity": 1.0,
      "features": { "onsetStrength": 1.0, "localOnsetContrast": 1.0, "rms": 1.0, "bassEnergy": 1.0 },
      "kind": "strong_beat"
    }
  ]
}
```

The `.md` sibling is the agent-facing view — the whole file, verbatim:

```markdown
# Music Cues: happy-beats-business-moves-vol-1-by-ende-dot-app

- Track: `happy-beats-business-moves-vol-1-by-ende-dot-app.mp3`
- Duration: 163.96s
- Estimated tempo: 120.19 BPM
- Planning window: 0.00-25.00s

## Useful Beat Grid

3.02, 3.52, 4.02, 4.53, 5.03, 5.53, 6.03, 6.52, 7.02, 7.52, 8.02, 8.52, 9.02, 9.52, 10.02, …

## Strong Cues In Window

- 17.02s (1.00, strong_beat)
- 17.52s (1.00, strong_beat)
- 18.52s (1.00, strong_beat)
- 20.02s (1.00, strong_beat)
- 23.02s (1.00, strong_beat)
…

## Reveal Candidates

- 17.02s (1.00, strong_beat)
- 17.52s (1.00, strong_beat)
- 18.52s (1.00, strong_beat)
- 20.02s (1.00, strong_beat)
- 23.02s (1.00, strong_beat)

## Use Policy

Use these as optional timing hints. Major reveals may move toward a nearby strong cue within about
0.15s; smaller entrances may align to nearby beats within about 0.10s. Ignore cues when they harm
story, readability, or pacing.
```

Note the **planning window**: `--window-duration` defaults to 25.0s, so the Markdown pre-filters a
163-second track down to the 25 seconds a brag video will actually use, and ranks a top-10 within
it. The agent is handed a shortlist, not a dataset.

### 4c. How composition consumes it

Two tiers, with explicit tolerances and a hard cap on how much of the edit music may own:

> - **`strongCues`** — high-intensity beats (drops, swells, accents). Use for **major moments**:
>   scene transitions, hero reveals, match payoff, logo landing. Lock 1–3 per video.
> - **`beats`** — the full beat grid. Use to **snap small sequential events** into the music's pulse:
>   cards arriving one by one, stats popping in, sequenced SFX hits.
>
> **Major moments (strong cues):** […] 3. Shift the reveal's start time to land within ±0.15s of the
> cue. 4. Mark it: `// beat-locked: 5.80s`
> **Sequential events (beats):** […] 3. Use consecutive beats from that point for each subsequent
> item — snap each within ±0.10s of a beat timestamp. 4. Mark it: `// beat-grid: stat 1 at 12.65s,
> stat 2 at 13.17s, stat 3 at 13.70s`

And the readability override, which is the interesting part — the music is explicitly subordinate:

> **Readable text vs the beat grid:** if the sequential items are text the viewer reads (stat labels,
> list rows, callouts) and the beats are close (under ~0.6s apart at fast tempos), do not reveal a new
> line on every beat — it outruns reading (this rushed the bicycles spec rows). Snap to every other
> beat, or reveal them quickly and hold the full set on screen afterward. Non-text accents (glows,
> dots, ticks) may still hit every beat.

The consumption is then checked by Step 3's self-review checklist:

> - [ ] At least 1 major tween is beat-locked to a strong cue […] within ±0.15s, marked
>   `// beat-locked` (or natural timing was chosen for readability).
> - [ ] Sequential events (cards, stats, list items) snap to consecutive `beats[]` timestamps
>   (±0.10s), marked `// beat-grid` (or natural timing was chosen for readability).

The `// beat-locked:` comment is a **cheap machine-greppable trace of an intentional decision** — a
pattern bay could copy directly (see §10).

### 4d. SFX analysis — schema and computation

`assets/sfx/sfx-analysis.json`, 228 files, top-level shape:

```json
{
  "schemaVersion": 1,
  "sourceRoot": "skills/brag/assets/sfx",
  "fileCount": 228,
  "analysis": { "sampleRate": 44100, "nFft": 2048, "hopLength": 256, "highFrequencyRangeHz": [4000, 16000] },
  "guidance": {
    "prefer": "Low/medium high-frequency risk SFX for smooth professional videos.",
    "avoid": "Repeated, loud, or sustained high-risk bright SFX unless the tone is intentionally chaotic.",
    "timing": "Clicks and interaction sounds usually start with the gesture; reveal sounds usually land with the visual payoff."
  },
  "recommendations": [ … ],
  "recommendationsByUse": { … },
  "files": [ … ]
}
```

One real per-file record, verbatim:

```json
{
  "path": "impact/impactSoft_medium_001.ogg",
  "family": "impact",
  "filename": "impactSoft_medium_001.ogg",
  "duration": 0.183,
  "loudness": { "rms": 0.1795, "peak": 0.8987, "crestFactor": 5.006 },
  "transient": {
    "onsetPeak": 0.091, "sharpness": 8.436, "activeDuration": 0.07,
    "activeRatio": 0.3801, "envelopeFlatness": 0.0922, "continuousRatio": 0.2812
  },
  "spectral": {
    "centroidP50Hz": 81.0, "centroidP90Hz": 144.2, "rolloffP90Hz": 150.7,
    "energyRatioLow": 0.7699, "energyRatioMid": 0.0461, "energyRatioHigh": 0.0028,
    "highActiveDuration": 0.0, "brightBurden": 0.0001, "decayTo10Percent": 0.07
  },
  "labels": {
    "brightness": "warm",
    "highFrequencyRisk": "low",
    "envelopeShape": "transient",
    "tags": ["impact"],
    "suggestedUses": ["hard transition", "major reveal"]
  }
}
```

The signal that carries the taste is `brightBurden` — the Markdown explains it: "high-frequency
energy weighted by level and duration. This separates sustained glassy ringing from short clicks."
`highFrequencyRisk` is the derived label an agent actually reads, and the family summary quantifies
the whole library:

```
- `casino/`: 51 files; HF risk low/medium/high = 0/10/41; avg high-frequency energy 0.59
- `impact/`: 109 files; HF risk low/medium/high = 5/104/0; avg high-frequency energy 0.08
- `interface/`: 20 files; HF risk low/medium/high = 5/14/1; avg high-frequency energy 0.25
- `ui/`: 48 files; HF risk low/medium/high = 2/14/32; avg high-frequency energy 0.57
```

`recommendationsByUse` inverts it into a picker the agent can use without reading 228 records:

```
- major reveal: `impact/impactSoft_medium_001.ogg` (low), `impact/impactSoft_medium_004.ogg` (low), …
- button press: `interface/click_003.ogg` (low), `interface/click_002.ogg` (low), …
- card reveal: `casino/card-slide-1.ogg` (medium), `casino/card-place-1.ogg` (high), …
```

Crucially the risk label survives into the recommendation, so the agent sees "the best card sound we
have is `medium` risk and the next four are `high`" and can decide not to repeat it eleven times.
bay's video used 11 whooshes and 11 ticks with no such signal.

### 4e. What bay would need to do the same

bay's audio situation is genuinely different, and better in one direction:

- **`bay-audio/src/sfx.rs`** is *synthesis*, 14 effects (`whoosh`, `whoosh-reverse`, `riser`,
  `sub-drop`, `impact`, `click`, `tick`, `pop`, `chime`, `error`, `beep`, `glitch`, `swell`), each
  with `id`, `name`, `description`, `default_seconds`, rendered deterministically at 48 kHz by
  `Sfx::render(SfxParams { seconds, tone, level })`. The header states the reason: "**A whoosh has to
  be as long as the transition it accompanies.**" So bay does not need spectral analysis to know a
  sound's duration or brightness — it *sets* them (`tone: f32` is literally the brightness knob
  `sfx-analysis` had to measure).
- **`bay-audio/src/library.rs`** is the recorded half: `installed(root) -> Vec<Sound>` and
  `search(root, query)`, with `Sound { id, name, pack, path, tags }`. There is **no** duration,
  loudness, brightness, or suggested-use metadata — a `sfx_search("click")` returns filenames ranked
  by id length, nothing more. This is exactly the gap `sfx-analysis.json` fills.
- **`bay-audio/src/lib.rs`** already has `decode_pcm(path, sample_rate) -> Option<AudioPcm>` and
  `waveform_peaks(path, buckets)`.

Three concrete additions, in order of value:

1. **Placement anchors on the synthesised catalogue (cheap, high value).** The descriptions already
   encode the timing rule in prose — "Put the END of it on the frame the cut lands", "end it exactly
   where the thing appears" — and an agent that reads prose does not reliably subtract. Add
   `anchor: Anchor` to `Sfx` (`Anchor::Tail` for `whoosh-reverse` and `riser`, `Anchor::Onset` for
   `impact`/`click`/`pop`, `Anchor::Lead` for `swell`) and make `sfx_add` take `atEvent: f64` (the
   *visual* time) rather than a start time, computing `start = atEvent − seconds` for `Tail`. This
   turns bay's best existing asset — synthesis at arbitrary length — into something an agent cannot
   misplace.
2. **A cue tool over imported audio.** `music_cues(mediaId, windowStart, windowDuration)` returning
   the brag schema (`tempo`, `beats[] {time, intensity}`, `strongCues[] {time, intensity, kind}`).
   bay already has PCM via `decode_pcm`; onset strength (spectral flux), RMS, and a 30–180 Hz band
   energy are all straightforward over an STFT, and tempo can come from autocorrelating the onset
   envelope. Copy the constants exactly — `0.45/0.25/0.20/0.10`, 98th-percentile normalization,
   0.18s dedupe, 0.45 floor — so the numbers mean the same thing they do in a corpus that works.
   Also copy the **window**: return the top ~10 cues inside the video's actual duration, not 311
   beats.
3. **A static analysis pass over the installed recorded packs.** Same schema as `sfx-analysis.json`,
   computed once at `runtime_install sfx` time and cached beside the pack:
   `duration`, `rms`/`peak`/`crestFactor`, `centroidP50Hz`, `energyRatioHigh`, `brightBurden`,
   `highFrequencyRisk`. Then `sfx_search` returns risk-labelled results and bay can refuse — or at
   least warn — when the same `high` risk file is placed more than ~3 times in one video.

---

## 5. The transition registry and the cut catalog

### 5a. The registry — `scripts/lib/transitions.json`

Five entries, whole vocabulary. Its header states the design:

> Vendored transition registry […] the curated Tier-B subset (transform/opacity/filter on the two
> frame clip wrappers `#el-<id>`, no overlay DOM, no per-frame cooperation). Each type carries its
> GSAP template; the transitions.mjs injector stamps it onto `window.__timelines["main"]`.
> Token placeholders the injector substitutes: `__OLD__` (`#el-<from>`), `__NEW__` (`#el-<to>`),
> `__T__` (overlap-start s), `__DUR__` (this boundary's duration), `__DX__`/`__DXIN__` (horizontal
> travel + incoming offset), `__DY__`/`__DYIN__` (vertical).

Two records verbatim:

```json
{
  "name": "blur-crossfade",
  "energy": "calm",
  "default_duration_s": 0.6,
  "directions": [],
  "source": "css-dissolve.md",
  "note": "Default when the two frames' #root backgrounds differ a lot — the blur masks the background-color clash a plain crossfade would expose.",
  "gsap_template": [
    "tl.to(__OLD__, { filter: \"blur(10px)\", scale: 1.03, opacity: 0, duration: __DUR__, ease: \"power2.inOut\" }, __T__);",
    "tl.fromTo(__NEW__, { filter: \"blur(10px)\", scale: 0.97, opacity: 0 }, { filter: \"blur(0px)\", scale: 1, opacity: 1, duration: __DUR__, ease: \"power2.inOut\" }, __T__);"
  ]
},
{
  "name": "push-slide",
  "energy": "medium",
  "default_duration_s": 0.5,
  "directions": ["LEFT", "RIGHT", "UP", "DOWN"],
  "default_direction": "LEFT",
  "source": "css-push.md",
  "note": "Directional. The injector picks __DX__/__DY__ from the direction and emits the horizontal OR vertical pair (not both).",
  "gsap_template_horizontal": [ … ],
  "gsap_template_vertical":  [ … ]
}
```

Trailer:

```json
"default_high_energy": "zoom-through",
"default_calm": "blur-crossfade",
"max_duration_s": 2.0
```

### 5b. How a transition is selected

Selection is **authored upstream, resolved mechanically downstream**. `transitions.mjs` header:

> `transition_in` (written by story-design on the INCOMING frame) names a registry type directly:
> crossfade | blur-crossfade | push-slide | zoom-through | squeeze, optionally `"<type> <DIR>"` /
> `"<type> <N>s"` (e.g. `"push-slide LEFT"`, `"crossfade 0.4s"`). `cut` / `none` / empty ⇒ hard cut
> (no overlap, no stamp).

Unknown names degrade to a documented default rather than failing or inventing:

```js
function resolveRecord(spec, byName, reg, warn) {
  let rec = byName.get(spec.type);
  if (!rec) {
    rec = byName.get(reg.default_calm);
    warn(`transition_in "${spec.type}" not in registry — using ${reg.default_calm}`);
  }
  return rec;
}
function resolveDur(spec, rec, reg) {
  let dur = spec.dur ?? rec.default_duration_s ?? 0.5;
  return Math.min(dur, reg.max_duration_s ?? 2.0);
}
```

And the loader refuses an empty registry outright:

```js
if (!Array.isArray(data.transitions) || data.transitions.length === 0) {
  throw new Error(`transition registry ${registryPath} has no transitions[]`);
}
```

### 5c. Is there a mechanism preventing the same transition every time? **No.**

I looked for one specifically. What exists is **prose in story-design.md**:

> Use only registry transition names in `transition_in`:
> `cut | crossfade | blur-crossfade | push-slide LEFT | push-slide RIGHT | push-slide UP |
> push-slide DOWN | zoom-through | squeeze`
> **Pick 2-3 transition types for the whole video and repeat them.** Frame 1 uses `cut` as a
> placeholder (there is no previous frame). Match the seam to the narrative: ordered steps → a
> consistent `push-slide`; a soft layer reveal or atmosphere shift → `crossfade` / `blur-crossfade`;
> zooming into a detail or pulling back → `zoom-through`; a clean topic switch or new list item →
> `cut`.

…and a **checklist item** ("Transitions use only registry names and repeat 2-3 types; frame 1 is
`cut`"). Nothing counts them. `transitions.mjs verify` checks only structural correctness:

```js
if (!txBlock.includes(`"#el-${from.id}"`) || !txBlock.includes(`"#el-${to.id}"`))
  fail.push(`boundary ${from.id}→${to.id}: injected block does not reference both ids`);
const overlapAmt = r3(from.start + from.duration - to.start);
if (overlapAmt <= 0) fail.push(`boundary ${from.id}→${to.id}: no overlap (${overlapAmt}s)`);
if (from.track === to.track) fail.push(`boundary ${from.id}→${to.id}: both on track ${from.track}`);
```

Same for layout variety — visual-design.md says "Use **≥3 different framings per video** so it
doesn't read as one repeated template; never the same framing twice in a row" — prose, uncounted.

**The interesting inference for bay:** in a system this disciplined, the authors deliberately did
*not* add a variety counter. What they added instead is (a) a **small closed vocabulary** — 5
transitions, not 50 — so any choice is a real choice, (b) **defaults tied to a semantic property**
(`energy: calm|medium|high|any`, `default_calm`, `default_high_energy`) rather than to
"whatever's first", and (c) the requirement that the choice be **written into the plan and
reviewed** before anything renders. Variety comes from a human looking at a table of 8 rows, not
from a lint counting distinct values. That is precisely the lesson of bay's `monotone-easing`
passing on 19 distinct easings.

### 5d. The cut catalog — a *different* vocabulary, deliberately non-overlapping

`references/cut-catalog.md` opens by fencing itself off from the registry:

> They are **not** the between-frame transition: story owns that via `transition_in`, which the
> harness's injector stamps from a **separate registry vocabulary** (`crossfade` / `blur-crossfade` /
> `push-slide` / `zoom-through` / `squeeze`) — the catalog names here (**cut-the-curve /
> inverse-zoom / waterfall**) are **not** valid `transition_in` values.

Four techniques (Zoom-Through, Inverse Zoom-Through, Cut the Curve, Waterfall Cut), unified by one
principle — "**cut at peak velocity, match direction and speed on both sides.**" — and specified to
the number. Blur is a table, not a taste call:

| Subject | Peak blur | Why |
|---|---|---|
| Text-scale (headline, line, word group) | **10px** | At 20px text smears into illegibility — the eye loses the word it was tracking and the cut reads as a glitch, not speed. |
| Full-frame surface (terminal window, card, screenshot) | **18–20px** | Big surfaces have edges and texture that survive heavy blur; lighter blur on a full-frame move reads as a rendering hiccup instead of motion. |

Velocity matching is stated as arithmetic:

> The cleanest match: exit `power4.in` and entry `power4.out` with the SAME distance and duration —
> mathematically the two halves of one `power4.inOut` composite, so the entering element picks up at
> exactly the 50% point of the notional path at identical velocity (e.g. 230px / 0.3s ≈ 3,070 px/s at
> the cut on both sides).

And it closes with a 9-row **Anti-Patterns** table (Don't / Why / Instead) — the "why" column is what
makes it teachable rather than arbitrary.

---

## 6. Self-check mechanisms, and the consequence of failure

Ranked by how much consequence a failure actually carries.

| Mechanism | Where | Consequence of failure |
|---|---|---|
| `build-frame.mjs` self-validation | Step 2 | **exit 1** — Step 2's gate is literally "exited 0". No `frame.md`, no downstream step. |
| Frame-packet byte limit | Step 5 | **throws**, and *atomically*: `mkdirSync(outDir)` runs only after every packet passes, so an overflow leaves no partial output. |
| `assemble-index.mjs` pending-BGM refusal | Step 5 | **non-zero exit and no `index.html` written** unless `--allow-pending-bgm` is passed. |
| `transitions.mjs verify` | Step 6 | **exit 1** with an enumerated failure list. |
| `npx hyperframes lint` / `check` | Step 6 / brag Step 3-4 | **blocks render.** brag: "zero errors" is the gate; WCAG contrast findings "gate as errors, not warnings", and the only bypass is all-or-nothing. |
| Worker retry-with-finding | Step 5→6 loop | The orchestrator "**re-dispatches you with the finding**", and the worker must "treat each as a hard constraint". A finding becomes a *rebuild*, not a note. |
| Frame-comments lifecycle | Review loop | "a workflow finding this file at a checkpoint treats it as the revision feedback — **revise exactly the frames named, delete the file, re-present**. […] it never lingers across rounds." Feedback that isn't acted on stays on disk and re-triggers. |
| `status: outline → built → animated` | Whole pipeline | A status is only advanced by the orchestrator *after* the artifact lands; the user's board "fills in blue by itself". Progress is observable, not asserted. |
| The worker's 13-item self-check | Step 5 | **No enforcement** — explicitly acknowledged: "you do NOT run the CLI". Its consequence is deferred to the orchestrator's post-assembly `lint`/`check`. |
| Step-4 "Before you finish — checklist" | Step 4 | **None.** Prose only. This is the same class of thing bay currently has. |
| Snapshot / contact sheet | Step 6 | **Weak, and deliberately so:** "Glance at it; if nothing is obviously broken, move on — don't linger here." |

Two observations bay should take seriously:

1. **The strong checks are the ones that produce no artifact on failure.** Refusing to write
   `index.html`, refusing to write any packet, exiting 1 before `frame.md` exists. The agent cannot
   proceed because the *input to the next step does not exist*. This is stronger than any severity
   level, because it does not depend on the agent respecting severity.
2. **bay's `check` currently has zero consequence.** `tools.rs:708` registers `check` with a
   description that pleads — "RUN THIS BEFORE render — it catches in milliseconds what otherwise only
   shows up in the finished file" — and `render` (`tools.rs:739`, dispatch at `tools.rs:1082`) never
   consults it. `check.rs` computes a real `Severity::{Error,Warning,Note}` and a `Report::is_clean()`
   that nothing gates on. brag's line is the fix: *this is the single pre-render gate.*

---

## 7. What the tests tell you

Five `.test.mjs` files, ~430 lines total. They are unusually revealing because each one names the
production incident that motivated it.

**`audio.test.mjs`** — 8 tests, two themes.

- *Duplication drift.* The first test asserts the file is **byte-identical** to a sibling skill's
  copy: "The header of this adapter declares it 'intentionally identical across the reusing skills' —
  pin that contract so a fix landing in one copy can't silently miss the other (**the fully-silent
  marker bug did exactly that**)."
- *Marker semantics.* Four tests pin the "fully silent" contract (`music: none` + no `SCRIPT.md`),
  including that a stale `audio_meta.json` from a previous non-silent run is **removed**, and that
  `music: none` **with** narration keeps TTS. Then: "`sfx: none` is an absence marker, not a cue named
  none" — with the comment "Used to reach the engine as `{ sfx: ["none"] }` — a cue that cannot
  resolve" — and six more spellings (`None`, `n/a`, `NA`, `skip`, `-`, `—`).
- *Distinguishing "not ready" from "silent by design".* `bgm_pending` must survive translation:
  "The flag used to be dropped in the neutral → PL translation, making 'not ready yet'
  indistinguishable from 'silent by design'."

**`assemble-index.test.mjs`** — 3 tests, all on that same distinction:

> `assemble REFUSES while bgm_pending and no bed on disk` […]
> `assert.notEqual(r.status, 0, "should not assemble a silent film over a pending bed");`
> `// Refusing means producing nothing, not a half-built index.`
> `assert.equal(existsSync(join(dir, "index.html")), false);`

**`frame-packets.test.mjs`** — 3 tests: (1) packets inline the blueprint body and every Scene-cited
rule recipe, and a `blueprint: compose` frame inlines neither; (2) `_role.md` is core + delta
verbatim; (3) "packet validation is atomic and leaves no partial output on overflow" —
`assert.equal(existsSync(outDir), false)`.

**`transitions.test.mjs`** — 1 test, for a very specific bug: "inject extends a documented frame root
that omits `data-duration`" — asserting both the root **and** the frame's internal clip get extended
to `2.5`. (The production comment in `transitions.mjs` is franker: the id-matching regex "is matched
from anywhere in the tag's attribute list — never assume it is the first attribute (the index
assembler emits `data-hf-id` before `id`, so an id-first regex finds nothing and inject crashes on
the empty clip map).")

**`captions.test.mjs`** — parameterised across every shipped caption skin × two canvas colors,
asserting the word-state CSS rules (`.caption-word.is-active`, `.is-spoken`) survive skinning
**exactly once** each.

### What this implies about the real failure modes

The tests are almost entirely about **state and plumbing, not taste**:

1. **Silent failure is the enemy.** Four of the five files test that something either happens
   visibly or refuses loudly. Nothing tests "does it look good."
2. **Ambiguous absence is a real bug class.** `none` as a value vs `none` as a marker; `bgm: null`
   because silent vs `bgm: null` because pending. Both shipped wrong videos. bay has the same shape
   of hazard everywhere it accepts a string field with a "skip" spelling.
3. **Half-built output is worse than no output.** Both refusal tests assert *nothing was written*.
4. **Duplicated logic drifts, so pin it with a byte-equality test.** Cheap, and it caught a real bug.
5. **The parser is lenient and the consumers are strict** — and only the consumers are tested for
   strictness.

The corollary for bay: the tests you'd write from this prior art are not "does the video have 19
easings", they are "does `render` refuse when `check` reports an Error", "does `add_text` refuse a
scene id that isn't in the plan", "does a project with one scene fail the structural gate".

---

## 8. Ranked process mechanisms, with the concrete bay port

Ranked by how much each would have prevented **bay's measured failures** (EVIDENCE.md §1–§9).

---

### 1. The plan file as a *machine-read* artifact that partitions the timeline

*Prevents:* finding #8 (one 61-second scene, every per-scene check arithmetically incapable of
firing), #7 (one repeated template), and most of #2 (188 elements with no structure).

*Prior art:* `STORYBOARD.md` split by `splitFrames()` on `/^## Frame\s+([^\n]+)$/gm`; `frameId()`
derives the worker's output path from the `src:` field and **throws** without it; every downstream
script (`frame-packets`, `assemble-index`, `transitions`) reads the same file.

*bay port — a tool that refuses + a required argument:*

- New tool `plan_commit(plan)` where `plan` is `{ message, arc, audience, format, scenes: [{ id,
  title, seconds, type, beat, transition_in, voiceover?, note }] }`. It writes the plan into the
  project JSON and returns `{ planId, sceneIds[] }`. It **rejects** a plan with `scenes.len() < 3`,
  with any scene longer than ~12s, or whose durations don't sum to within 10% of the stated target.
- `add_text` / `add_shape` / `add_image` / `add_video` / `add_audio` gain a **required** `scene:
  String` argument. The handler resolves it against the committed plan and returns
  `is_error: true` — "no scene `<id>`; commit a plan first, or use one of: …" — when it doesn't
  match. Element start times are then *relative to the scene*, and out-of-range placement is an
  error, not a silent write.
- Consequence: bay physically cannot produce a one-scene 61-second project again, and every existing
  per-scene check in `check.rs` starts firing.

This is the single highest-value port. Everything else is a multiplier on it.

---

### 2. `check` becomes the render gate, with an all-or-nothing bypass

*Prevents:* the meta-finding — "the lint passed, because every check was a diversity count it
satisfied" is half the story; the other half is that passing was *optional*.

*Prior art:* brag Step 3's gate — "`npx hyperframes check` passes with zero errors […] the single
browser gate before render" — plus the no-nibbling clause: "There is no per-element contrast escape
hatch for real text; the only bypass is `check --no-contrast`, which skips the entire WCAG pass
(all-or-nothing), not a way to accept one borderline element."

*bay port — a check with teeth:*

- `render` calls `bay_core::check::check(&project)` first. Any `Severity::Error` ⇒ `is_error: true`,
  the finding list as the message, **no job spawned**. `Warning`s are returned in the job result but
  do not block.
- One escape: `render({ ignoreChecks: true })` skips the **entire** pass and stamps
  `"rendered with checks bypassed"` into the job result. No per-code suppression, ever.
- Also: promote the findings that actually correlate with the bad video (`small-text`,
  `nothing-visual`, `front-loaded`) from `Warning` to `Error` once #1 makes them able to fire.

---

### 3. Style adopted from a named preset, and never expressible inline

*Prevents:* #4 (Menlo ×69, no weight variation), #5 (max 96px, 34px mode), #6 (5 colours, one used
48 times), #7 (63 elements at x≈0.085).

*Prior art:* `build-frame.mjs --preset <name>` produces `frame.md` deterministically and exits 1 on a
broken mapping; the worker contract then forbids invention — "**Design tokens** — palette / fonts /
components come from `frame.md`. Don't invent them" — and `font_family_without_font_face` makes an
unshipped font a lint error. bay's `looks_list` is the nearest existing thing.

*bay port — a required argument that is a role, not a value:*

- `style_adopt(preset)` writes a style block into the project: `{ display, body, mono }` families
  with weights, a type ramp (`hero`, `title`, `kicker`, `body`, `caption` → px at this canvas size),
  a palette (`bg`, `ink`, `dim`, `accent`, `accent2`), and a layout grid (named framings with x/y
  anchors). Refuses if any named family fails `fonts_check`.
- `add_text` **drops** `fontFamily` / `fontSize` / `color` as free values and takes `role: "hero" |
  "title" | "kicker" | "body" | "caption"` and `tone: "ink" | "dim" | "accent"`. Raw values are an
  error naming the role to use instead. Same for `x`/`y`: `anchor: "hero-left" | "third-right" | …`
  from the adopted grid, with raw fractions allowed only via an explicit `xy` escape that `check`
  flags.
- Consequence: the default *is* the preset, so "the style emerged from defaults" becomes harmless —
  the defaults are now a designed system rather than Menlo/34px/0.085. And "copy-pasted 180 times"
  copies a designed token, not an accident.

---

### 4. Distribution checks replace diversity counts

*Prevents:* #1 (107 of 119 animated channels are opacity), #2 (76 of ~150 moves are 3 frames), #3
(`hold` ×130 while `spring-out` ×4).

*Prior art:* brag's reading-time floor is the model — an arithmetic constraint on a *distribution*,
not a count of distinct values: "Short label or 1-3 word line: about 0.8s settled. Headline or full
sentence: about 0.3s per word, minimum ~1.2s." Plus: "A 4s scene lands maybe 2-3 short reads at the
floor, not 6. If a scene carries more text than its duration allows, cut copy or split the scene —
do not speed it up." And the cut catalog's blur table — one number per subject class, with the
failure explained.

*bay port — new finding codes in `check.rs`, all `Error` once #1 lands:*

- `opacity-only`: if `opacity` channels > 60% of all animated channels in a scene → error. (bay's
  video: 90%.)
- `pop-not-move`: if > 25% of transform moves have `duration < 0.15s` → error, naming the mode of
  the histogram. (bay's video: mode = 0.098s at 51% of moves.)
- `unreadable-hold`: per text element, `settled_seconds < max(0.8, 0.3 × word_count)` → error.
  This is the direct port of brag's floor and would have caught the frames that dump and freeze.
- `type-ramp-flat`: if `max(fontSize) / median(fontSize) < 3.0` in a scene → error. (bay's video:
  96/34 = 2.8 across the *whole video*, and 1.0 within most scenes.) This is visual-design.md's
  hierarchy rule — "combine ≥ 2 of size (3:1) / weight (800 vs 400) / contrast / position / motion"
  — made arithmetic.
- `dead-region`: sample the union of element bounding boxes per scene; if a horizontal band ≥ 25% of
  frame height contains nothing in the whole scene → warning naming the band. (bay's video: nothing
  below y=0.73.)

Each of these is a *shape* constraint. An agent can only satisfy them by changing what it makes.

---

### 5. The bounded packet — one unit of work sees only its own approved block

*Prevents:* the drift that turns beat 1's decisions into beat 8's copy-paste; and "it never
committed to a style before it started placing."

*Prior art:* `frame-packets-core.mjs` — the packet is `project inputs + the frame's exact block +
the blueprint body + every cited rule recipe, inlined`, hard-capped at 48 KB, built atomically, plus
`_role.md` = core + delta verbatim. Rule ids are validated against `readdirSync(rulesDir)`, so a
hallucinated motion name inlines nothing.

*bay port — sequential, not parallel (see §3e):* generate `scene-packets/<scene-id>.md` from the
committed plan, each containing the scene's plan block, the adopted style tokens it may use, and the
recipe text for each named motion — where the valid motion set is bay's actual keyframe vocabulary,
checked against a registry. Build scene N from packet N only. Do **not** ship parallel subagents
until `scene_begin`/`scene_commit` gives the engine a real isolation boundary; without it, N agents
on one shared `Studio` reproduce bay's failure faster.

---

### 6. Snapshot observation must be *consumed*, not just taken

*Prevents:* "It took snapshots and, as far as we can tell, never changed anything because of what it
saw."

*Prior art:* two mechanisms. (a) The worker **retry contract** — the orchestrator "re-dispatches you
with the finding" and the worker must "re-author so none of those findings recur; treat each as a
hard constraint". (b) The **frame-comments lifecycle** — "revise exactly the frames named, delete the
file, re-present. Writers create it only on submit; it never lingers across rounds." Feedback that
isn't consumed stays on disk.

*bay port — a returned token:*

- `snapshot` returns `{ path, observationToken }` where the token encodes `(scene_id, time,
  content_hash_of_scene)`.
- `render` requires `observations: [token, …]` covering **every** scene, and rejects any token whose
  `content_hash` no longer matches the current scene — i.e. a snapshot taken and then edited *past*
  is fine (that's the point), but a snapshot never taken, or taken of a scene you then rebuilt and
  never re-checked, blocks the render. Message: "scene `pain` changed after its last snapshot —
  re-snapshot before rendering."
- This makes looking mandatory and makes *acting* the cheap path: the only way to clear a stale
  token is to snapshot again, which puts the frame back in front of the model.

---

### 7. A small closed vocabulary with semantic defaults, instead of a variety counter

*Prevents:* #3 (`hold` becoming the house easing because the counter blessed it) and, more broadly,
the metric-gaming meta-finding.

*Prior art:* five transitions, each tagged `energy: any|calm|medium|high`, with `default_calm` and
`default_high_energy` named in the registry, `max_duration_s: 2.0` clamped in code, unknown names
degrading to the calm default **with a warning**. Variety comes from a reviewed plan, not from a
lint. Same for motion: `motion-language.md` is a **named palette** — "You name motion by **role /
move name**, never by raw GSAP curve, ms, or stagger formula — the worker maps the curve" — with an
explicit banned list: "`back.out` / `bounce.out` / `elastic.out` as the default entrance […] Fix with
rule 1 (`power3` long-tail)."

*bay port — a required argument drawn from a registry:*

- `animate` takes `move: "<named-move>"` from a bay move registry (`per-word-reveal`, `count-up`,
  `push-in`, `layer-reveal`, `scale-swap`, `held-still`, …), each of which expands to a real keyframe
  recipe with its own easing and duration. Raw `easing`/`duration` remain available but become the
  escape hatch, and `check` flags a project where > 30% of channels use raw values.
- Delete `hold` as an easing an agent can name, or make it reachable only from inside a move recipe
  that legitimately needs it. The evidence is unambiguous: exposing a keyframe-stuffing primitive to
  a diversity-scored agent produced 130 uses of it.
- Keep the **motion doctrine as prose next to the registry**, because it explains the why:
  "I'd rather have NO motion than BAD motion. A held, still frame is better than a frame kept 'alive'
  by breathing or a drifting camera."

---

### 8. Music cues and SFX placement anchors

*Prevents:* nothing in the measured list directly — but it removes the guessing that produced 69
scattered audio elements with no relationship to the picture, and it is the most **directly
portable** item in either skill.

*bay port:* §4e above, in order — (1) `anchor` on `Sfx` + `sfx_add(atEvent:)`, (2) `music_cues`
returning the brag schema over `decode_pcm` output with the same constants, (3) a cached analysis
pass over installed recorded packs. Copy the consumption discipline verbatim too: **1–3 strong-cue
locks per video, ±0.15s for majors, ±0.10s for beat-grid items, and readability outranks the beat.**
Have `animate` accept `beatLock: <seconds>` and record it in the project so `check` can report
"3 beat-locked reveals" — brag's `// beat-locked:` comment, made structural.

---

### Ports I would *not* make

- **Parallel per-scene subagents**, until the engine has scene-scoped isolation. See §3e.
- **A transition/easing/framing variety counter.** Neither skill has one, and bay already proved what
  happens when you add one.
- **A heavier snapshot review step.** faceless-explainer deliberately keeps it light — "Glance at it;
  if nothing is obviously broken, move on — don't linger here." The fix for "never changed anything
  because of what it saw" is the token in #6, not more looking.
