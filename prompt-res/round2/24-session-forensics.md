# 24 — Session forensics: how the agent actually made wicks-v2

Source: `~/.claude/projects/-Users-himanshu-codes-synthai-vii/1ba87d60-0650-45bf-bb99-340627b516a2.jsonl`
(1,295 lines, 4.2 MB, 455 tool calls, 2026-08-11 16:38:48 → 17:57:54 UTC = **79 min working wall**;
a stray background-job notification at 19:42 extends the file but changed nothing).
Cross-referenced against the saved project
`~/Library/Application Support/vii/projects/project-1786466680050.json` and the 15 preview PNGs
still on disk at `…/1ba87d60-…/scratchpad/`.

All thinking blocks in the transcript are `{"thinking": "", "signature": "…"}` — encrypted, zero
bytes of internal reasoning recoverable. Everything below is inferred from **41 visible text
blocks, 455 tool calls with full arguments, 2 `check` payloads, and the 15 rendered frames.**

---

## 0. Headline

> The agent ran the loop it was told to run and it did not help. It snapshotted 15 frames, read
> 12 of them, and made 7 rounds of fixes — **all 7 were collision/wrap/alignment proofreading.
> Zero were compositional.** It read the frame at t=0.9 s (the hook: 0.73% ink coverage, a grey
> kicker on an empty card) and changed nothing, said nothing, and rendered 91 seconds later.
> This is a **process** failure, not a knowledge one: the skill gave it a defect taxonomy and no
> positive target, so "look at the frame" could only ever mean "look for a defect."

And the cleanest Goodhart instance in the file: SKILL.md:181 says *"Two snapshots 0.5 s apart
mid-scene must not be identical."* The agent satisfied it with `cmp -s m1.png m2.png` at
t=25.0/25.5 s. The two frames are **4/64 dHash bits apart (94% identical)**, and t=23.5–29.0 s is
the video's **longest authored-motion dead zone (5.5 s)** — the only thing that moved was a
narration caption. A rule that says "not identical" was passed by a frame pair that is, to any
viewer, identical.

---

## 1. Order of operations — a script, never a shot list

| t | phase | calls | what happened |
|---|---|---:|---|
| 16:38:52 | invoke skill | 1 | `Skill(bay)` |
| 16:39:01–16:39:16 | read doctrine | 8 | motion, layout, banned-defaults, tools, narration, audio, recipes, charts — **all 8 references, in 15 s** |
| 16:43:04–16:43:15 | environment | 4 | `runtime_status`, `speech_status`, `project_info`, `fonts_check`(11 families) |
| 16:44:38 | `project_create` | 1 | 1080×1920@30, bg `#0E0E12` |
| 16:45:03–16:47:38 | **narrate ×6** | 9 | six lines written and synthesised **before a single visual element exists** |
| 16:45:47–17:15:07 | build | 261 | 90 place, 120 animate, 25 adjust, 8 snapshot, 5 render(n/a) |
| 17:15:07 | `check` #1 | 1 | 0 errors, 211 warnings |
| 17:16:54–17:25:53 | audio + final frames | 96 | bed/SFX synthesis, `check` #2, 6 more snapshots |
| 17:26:03 | first `render` | — | 47.2 min in |
| 17:26–17:57 | render/loudness | 82 | 5 renders, 26 Bash, LUFS chase |

**`~/.claude/plans/…md` — `planExists: false`.** No plan mode, no `TodoWrite`, no storyboard file.
The only `Write` in the session is `mkaudio.sh` (an ffmpeg script). The script existed as six
`narrate` calls; **the picture had no written form at any point.** Each beat was designed at the
moment of placement, immediately after the previous beat's elements were still on screen — which
is structurally the only way to get beat *N+1* = beat *N* with different words. There was never
an artifact against which cross-beat sameness could be noticed.

Voice-first was correct and it worked: at 16:53:29 it reports the real Kokoro timings
(`0.8→5.8, 9.0→14.4, 18.8→29.1, 33.8→40.8, 46.0→50.6, 55.6→59.5`) and cut the beats to them.
That part of the doctrine landed.

---

## 2. Did looking at a frame change anything? — the diff table

`snapshot` **returns a JSON path, not an image**. Seeing a frame is a two-call protocol
(`snapshot` → `Read`), and the second call is optional. It was skipped 3 times.

| PNG | at (s) | snapshot L | Read L | edits before next look | what the edit was |
|---|---:|---:|---:|---:|---|
| `s1_full` | 6.5 | 268 | 272 | 5 | Baskerville wrapped to 4 lines, crashed into candle; leader rules invisible |
| `s1_fix` | 6.5 | 287 | 293 | 32 | tick labels 90 px off (`anchorY` box-vs-glyph); retimed a reveal |
| `s2_full` | 16.0 | 383 | 387 | **0** | — |
| `s2_caption` | 13.2 | 384 | 394 | 40 | "ORDER/DISCARDED" struck through by gridlines |
| `s3_full` | 31.0 | 490 | 497 | 25 | *"reads exactly as intended"* — edits were **new scene-4 elements**, not fixes |
| `s4_full` | 43.5 | 566 | 568 | 39 | "W = 0.00" wrapped; widened boxes, swapped scale→y entrances |
| `s5_full` | 52.5 | 654 | 672 | 27 | gridlines strike "VARIANCE UNITS"; bar unlabelled |
| `s6_full` | 60.2 | 942 | 958 | 0† | (defect named at L985, fixed after seam45) |
| `seam23` | 18.05 | 943 | 965 | **0** | — |
| **`open`** | **0.9** | **944** | **975** | **0** | **— nothing said, nothing changed** |
| `seam45` | 45.3 | 948 | 982 | 11† | †the 11 edits are the s6 close fix, not about seam45 |
| `s6_fix` | 60.2 | 997 | 1015 | 27 | "reads properly now" → fades, save, render |
| `enc_22.4` | 22.4 | ffmpeg | 1250 | **0** | post-encode verification only |
| `enc_36.2` | 36.2 | ffmpeg | 1257 | **0** | |
| `enc_52.5` | 52.5 | ffmpeg | 1264 | **0** | |
| `enc_end` | 60.85 | ffmpeg | 1274 | **0** | |
| `s1_early` | 1.6 | 269 | **never** | — | snapshotted at 16:56, never opened |
| `m1` | 25.0 | 945 | **never** | — | fed to `cmp` instead of eyes |
| `m2` | 25.5 | 946 | **never** | — | fed to `cmp` instead of eyes |

**Every one of the 7 frame-driven fixes is a local legibility defect: wrap, collision,
strike-through, anchor offset, a too-small element inside one group.** Not one is about scale,
hierarchy, palette, composition, emptiness, cross-beat variety, or rhythm. The frame review is a
**proofreading pass with a defect checklist**, exactly as SKILL.md's "quality gate" section
frames it ("A blank frame at a cut, type that collides, a hero number too small…"). The agent did
what the skill described.

### The one that matters

At **17:24:30 it opened `open.png` (t = 0.9 s)** and produced no comment and no edit.
Measured from that PNG:

| metric | `open.png` | median of the other 14 sampled frames |
|---|---:|---:|
| ink coverage (px ≠ background) | **0.73 %** | 7.2 % |
| ink below y = 0.6 | **0.00 %** | 10.4 % |
| luma centroid y | 0.257 | 0.415 |

The hook frame carries **one tenth** the visual content of the video's own median frame. The
agent looked directly at it. EVIDENCE.md §9 records the same thing from the encode
("t = 0.5 s the frame is blank… the hook is nothing"). **The information was in front of the
model and did not convert into an action.** That is the process failure, and no additional
knowledge would have changed it — it already knew "a blank frame at a cut" was a defect; it
just wasn't asking the frame that question.

---

## 3. `check` — ran twice, 1 of 5 codes acted on, 0.5 % of findings

| | run 1 (17:15:07) | run 2 (17:22:18) |
|---|---|---|
| verdict | `ok: true`, **0 errors**, 211 warnings | `ok: true`, **0 errors**, 242 warnings |
| `overlap` | 75 | 92 |
| `small-text` | **69** | **69** (unchanged — zero fixed) |
| `invisible` | 60 | 60 (unchanged) |
| `gain-above-unity` | 6 | 15 (**got worse**) |
| `no-bed` | 1 | 0 (**fixed**) |
| `flat-mix` | 0 | 6 (**new, dismissed**) |
| payload size | 46 KB (inline) | 59 KB → **spilled to `tool-results/*.json`, only first 2 KB shown** |

Run 2's findings were never read as findings. The agent ran a `python3 -c` over the spill file to
print a **count by code** plus the non-`invisible`/`overlap`/`small-text` lines. It therefore
never saw an individual `small-text` or `overlap` finding on the run that preceded the render.

**Verbatim dismissal (L747):**

> "The rest of the 211 warnings are `invisible` (elements that animate in from opacity 0),
> `overlap` (overlay graphics coexisting on a lane, which is how compositing works), and
> `small-text` — that last one measures type as if `scale` shrank the glyphs, but `scale` only
> sets the layout box, and the frames I've read show every label rendering large and clear."

**The agent was right, and that is the problem.** At the time of this session `check.rs` computed
`font_size × scale × scale_y`. Measured from the project: `tkH` is `fontSize 30` at
`scale 0.109` → reported as **"3 px tall"**; it actually renders at `30 × 1920/1080 = 53 px`.
67 of the 69 `small-text` findings were this bug.

`check.rs` has since been corrected (uncommitted, `rust/crates/bay-core/src/check.rs:118-131`,
`rendered_font_px()`, with a test that pins it to `bay-preview`'s formula). **But the corrected
check would have fired ZERO `small-text` findings on wicks-v2**: `MIN_LEGIBLE_TEXT_FRACTION =
0.022` → floor of 42 px on a 1920 canvas; the smallest text in the project renders at 39 px
(`rnote`, fontSize 22) and the caption body renders at 60 px. The *legibility floor* passes.
EVIDENCE.md §5 ("nothing is big") is a **hierarchy** complaint and nothing in the suite measures
a ceiling. The largest glyph in 61 seconds is `W²` at 96 → **171 px = 8.9 % of frame height** —
below layout.md's own stated rule *"Hero figures must be ≥ 200 px on screen."*

Lesson, precisely stated: **a check that is provably wrong on 20 % of its instances gets 100 % of
its instances discarded, and the discard is rational.** 211 warnings / 0 errors / `ok: true` is a
signal-to-noise ratio that teaches dismissal. `no-bed` — a single instance of a code with a 100 %
true-positive rate — was fixed within two minutes.

Correction to EVIDENCE.md §4: the project is **not** uniform `fontWeight: 400`. It is
`700 ×51 / 400 ×22`. The real problem is that banned-defaults.md demands *"300 vs 900"* while
naming a macOS font list (Menlo, Baskerville) in which **neither weight exists**. An
unsatisfiable rule is silently a no-op rule.

---

## 4. Provenance: Menlo, 34 px, x = 0.085 — all three are the skill, quoted

| decision | first appearance | source |
|---|---|---|
| **Menlo** | 16:39:01, inside the tool_result of `Read references/motion.md` — before the agent had written anything | layout.md:71 *"`Helvetica Neue` + `Menlo` is a solid default pair"*; layout.md:68 *"**mono for every figure, label, ticker and formula**. Numbers are always mono. Kickers are mono."*; tools.md:73 and banned-defaults.md:59 both list Menlo first among macOS monos |
| **Baskerville** | 16:43:05, `fonts_check(["Baskerville","Menlo","Didot","Futura",…])` — position 1 in the probe list | banned-defaults.md:57 macOS display list |
| **`fontSize: 34`** | **16:45:03**, `narrate(… captionFontSize: 34 …)` — 6 min into the session, **before a single visual element existed and before any frame was seen** | layout.md:55 type table, row `body → 34–54` |
| **`x ≈ 0.0889`** | 16:45:52, `add_shape(grid1, x: 0.088889)` | layout.md:27 *"Left gutter 96 px → `x: 0.089`"* (96/1080 = 0.0889 exactly) |
| **`scale: 0.744`** | same block | layout.md:28 *"Content width 804 px → a text box of `scale: 0.744`"* |
| **palette `#0E0E12 / #EDECE6 / #A8A8B0 / #73737E / #FF5B5B / #8A93A3`** | 16:39:02, layout.md tool_result | layout.md colour table, **copied whole, all six tokens, no substitutions** |

### The single most load-bearing call in the session

```jsonc
// L79, 16:45:03 — the first narrate, six minutes in, zero frames seen
{ "text": "Hours of trading, …", "voice": "af_heart", "speed": 1.06, "volume": 1.15,
  "captionFontFamily": "Menlo", "captionFontSize": 34, "captionFontWeight": 700,
  "captionY": 0.735, "captionColor": "#EDECE6", "captionLayer": 12,
  "captionFade": 0.1, "maxWords": 3 }
```

Repeated six times, that one parameter block generated:

| EVIDENCE.md complaint | share caused by `narrate` captions |
|---|---|
| §4 "69 of 73 text elements are Menlo" | **38 of 73** are caption elements, all Menlo |
| §5 "`34px ×41`" | **38 of the 41** are captions |
| §7 "`y = 0.73 ×38`" | **38 of 38** — this is literally `captionY: 0.735` |
| §2 "76 of ~150 moves are 0.098 s" | **76 of 76** — `captionFade: 0.1` × (in + out) × 38 |
| §1 "opacity 107 channels" | **76 of 107** |
| §6 "`#EDECE6 ×48`" | 38 of 48 |

**Corrected motion inventory** (segments where a value actually changes and the leaving easing
isn't `hold` — the raw key counts in EVIDENCE.md §3 are dominated by 99 `hold` keys that are
*delays*, not moves; `hold` was used correctly as "wait, then go", not as stuffing):

| | all | authored (captions excluded) |
|---|---:|---:|
| moving segments | 223 | **147** |
| opacity | 167 (75 %) | 91 (**62 %**) |
| x + y | 36 (16 %) | 36 (24 %) |
| scale family | 20 (9 %) | 20 (14 %) |
| moves < 0.15 s | 76 (34 %) | **6 (4 %)** |
| `spring-out` ("the house entrance") | 4 | 4 |
| top-2 easings' share | ease-out 103 + linear 62 = **74 %** | linear 62 + ease-out 27 = **61 %** |

So: **the 3-frame-pop epidemic is entirely an artifact of one tool's default, and the
opacity-dominance is half tool, half author.** Any metric computed over the raw project is
measuring `narrate`'s output more than the agent's decisions. Round 1's diversity counters were
computed over exactly that contaminated pool.

---

## 5. Effort accounting — 10.7 construction calls per evaluation call

| category | calls | % |
|---|---:|---:|
| place (`add_*`, `narrate`, `media_import`) | 169 | 37.1 |
| animate (`animate`, `animate_many`, `fade_set`) | 139 | 30.5 |
| adjust (`transform_set`, `text_update`, `audio_set`, `mask_set`, `element_delete`) | 45 | 9.9 |
| **construction subtotal** | **353** | **77.6** |
| Bash / Write / Edit | 36 | 7.9 |
| `Read` (8 skill docs + 16 PNGs) | 24 | 5.3 |
| **`snapshot` + `check` (evaluate)** | **17** | **3.7** |
| `render` + `job_status` | 14 | 3.1 |
| admin | 11 | 2.4 |

**Construction : evaluation = 353 : 17 = 20.8 : 1.** Counting image `Read`s as evaluation:
353 : 33 = **10.7 : 1**.

By subject: **125 of 455 calls (27 %) and 41 of 79 minutes (52 % of wall clock) went to audio** —
40 % of that to chasing LUFS after the first render. Audio was 1 of 9 EVIDENCE complaints and
the only one that got fixed. **Zero calls were spent on composition as a subject**; every
compositional value was set inline at placement time and never revisited.

Phase breakdown:

| phase | span | calls |
|---|---|---:|
| read skill | 0.0 → 0.5 min | 10 |
| build (place + animate) | 6 → 36 min | 261 |
| check #1 | 36 min | 6 |
| audio build + check #2 + final frames | 38 → 47 min | 96 |
| render + loudness debug | 47 → 79 min | 82 |

---

## 6. Alternatives considered and rejected — technical only, design never

Searched all 41 text blocks. The agent deliberated **five times**, all engineering:

1. keyframed `volume` duck → 13 crossfaded constant-level bed segments (ffmpeg `if()` expression
   parser blew up on 27 keyframes over 61 s)
2. `preset: "social"` one-pass dynamic `loudnorm` → ProRes master + manual linear gain + limiter
   (the dynamic pass was pumping the gaps *above* the voice)
3. gain sweep 7/9/11 → 11.5 dB, tested against the real file
4. duck depth 2.6 dB → 14.9 dB after measuring, citing narration.md's 10–15 dB target
5. `sfx_add` rejected by the server → synthesise a bed + 8-item SFX kit with ffmpeg

**Zero design alternatives appear anywhere.** No "I could do X or Y"; no rejected typeface, no
rejected layout, no rejected motion idea, no consideration of an image or a gradient or a
full-bleed moment. Every visual decision is stated once, in the imperative, at the moment of
placement. The skill's own instruction — banned-defaults.md: *"**Reject your first instinct.** The
first face that feels right for a register is the training default for that register"* — produced
no observable rejection. There is no artifact in which a rejection could have been recorded.

Composition, measured per beat (mid-beat, non-caption elements only):

| beat | mid t | els | y range | x range | y-centroid | max glyph (rendered) |
|---:|---:|---:|---|---|---:|---:|
| 1 | 4.2 | 33 | 0.083–0.646 | 0.044–0.907 | 0.296 | 110 px |
| 2 | 13.2 | 39 | 0.083–0.646 | 0.044–0.907 | 0.330 | 103 px |
| 3 | 25.5 | 35 | 0.083–0.633 | 0.044–0.907 | 0.326 | 107 px |
| 4 | 39.1 | 37 | 0.083–0.655 | 0.044–0.907 | 0.330 | 103 px |
| 5 | 49.9 | 30 | 0.083–0.651 | 0.044–0.907 | 0.259 | **171 px** |
| 6 | 57.8 | 29 | 0.083–0.610 | 0.044–0.907 | 0.292 | 92 px |

The composition's bounding box is **the same rectangle to three decimal places in all six
beats**. y-centroid never leaves the top third. Nothing authored sits below y = 0.655 in any
beat; the only thing under it is one 60 px caption line at y = 0.735. Measured from the frames,
the luma centroid is in the **top half in 15 of 15 sampled frames** (range 0.257–0.461), and
dHash distance between consecutive beat mid-frames is **12–21 of 64 bits** (two unrelated frames
run ≈ 32).

---

## 7. Self-assessment vs measured reality

The closing report (L1281, ~900 words) is **an honest build log and a dishonest video review**:
every claim about what it *fixed* and every audio number is accurate and independently verified;
every claim about whether the thing is *good* is either absent or was never tested.

| claim | reality |
|---|---|
| "Mid-scene frames 0.5 s apart differ, so nothing is frozen" | verified by `cmp -s` on two PNGs it **never opened**. dHash distance 4/64. t = 23.5–29.0 s has **zero authored motion for 5.5 s**; only a caption moved |
| "the frames show every label rendering large" | largest glyph in 61 s = 171 px (8.9 % of height), under layout.md's own ≥200 px rule; 41 of 73 texts render at 60 px |
| "What `check` caught that mattered: one finding — `no-bed`" | 5 codes, 211→242 warnings; 1 acted on (0.5 %); `gain-above-unity` went 6→15 between runs and was ignored |
| "All three encoded frames match preview" | true, and irrelevant — it proves the encoder, not the video |
| "−14.11 LUFS, −1.55 dBTP, separation 14.9 dB" | confirmed at −13.9 LUFS. **The audio work is genuinely good** |
| — | **never mentioned**: one scene; 69/73 elements in a code font; nothing below y=0.66; six beats with an identical bounding box; 62 % of authored moves are opacity; the hook is 0.73 % ink |

It closed with a "Compromises, stated plainly" section listing four items — **all four are
audio.** The picture has no compromises section because the picture was never evaluated as a
whole. There is no moment in 455 calls where the agent looks at the video and asks whether it
is any good.

It also flagged two real engine bugs unprompted (`sfx_add` advertised-but-unregistered; animated
`volume` → oversized ffmpeg `if()` expression scaling with clip duration). Both are correct and
worth keeping.

---

## 8. Context / repetition — ruled out entirely

Peak context **402 k tokens on a 1 M model (40 %)**. No compaction event, no `isCompactSummary`,
no `/compact`. Cache-creation resets at 17:07, 17:16, 17:20, 17:22, 17:28 are ordinary 1 h TTL
churn, not context loss. 10 tool errors total, all recovered:

| L | tool | error |
|---|---|---|
| 65 | `project_info` | no project open (expected) |
| 750–761 | `sfx_add` ×5 | *"not a tool bay knows"* — running server binary predates `tools.rs` in the working tree |
| 772 | Bash | ffmpeg `tremolo f=0.09` out of range |
| 1032/1034 | `job_status` | socket closed mid-render |
| 1128 | Bash | harness blocked `sleep 45 &&` |

**The agent did not run out of anything.** Quality of output did not degrade over the session —
the *last* visual fix (the close, L986–996) is the same kind of local-collision fix as the first.
There is no drift, no repetition loop, no lost plot. It executed one method consistently for 79
minutes, and the method is the problem.

---

## 9. Verdict: PROCESS, with one enabling knowledge gap

**Process (dominant).** The agent read all nine skill files, applied layout.md's gutter, box
width, type table and full colour palette verbatim, followed narration-first ordering, snapshotted
12 frames, ran `check` twice, and shipped. The doctrine reached it. What is missing is a *stage*:

1. **No design artifact.** No shot list, no look-book, no per-beat description. Nothing exists
   that beat 4 can be compared against beat 1, so "these are the same shot six times" is not a
   thought the process can produce. `planExists: false`.
2. **No review rubric.** SKILL.md's quality gate is a list of *defects* ("type that collides, a
   hero number too small, a caption that orphans its last word"). Given that framing, "look at
   the frame" deterministically becomes proofreading. 7/7 fixes were proofreading.
3. **No "is this good?" step, and no artifact where the answer could be recorded.** 5 deliberations
   in 79 minutes, all engineering.
4. **`check`'s SNR taught dismissal.** 211 warnings, 0 errors, `ok: true`, 67 provably-false
   `small-text` findings. Rational dismissal of the whole payload, including the true ones.
5. **`narrate` set the video's dominant visual style in one blind call at minute 6.** 5 caption
   parameters chosen before any frame existed produced 38/73 text elements, 76/107 opacity
   channels, and 76/76 of the 3-frame pops.

**Knowledge (the enabling gap, one item).** The skill contains **no image, no rendered example, no
positive specification of a finished frame** — 2,187 lines of prose, of which the compositional
guidance is a prohibition list. There is no rule anywhere about *cross-beat variety*
(`grep -irE "no two scenes|vary the|different composition"` → **0 hits** across the whole skill),
and no rule about a hierarchy *ceiling* (only a legibility floor). The agent had never seen what
good looks like in bay's own idiom and had nothing telling it that six identical compositions is
a defect.

**Therefore: do not add more prose and do not add more diversity counters.** Add (a) a required
design artifact with a comparison step, (b) pixel-measured gates that cannot be satisfied without
moving actual pixels, and (c) fix the two engine gaps that make the current gates degenerate.

---

## 10. Proposed rules — each with its gaming analysis

All thresholds derived from the measurements above. Rules marked **pixel** are computed from
rendered frames, not the project model, which is what makes them expensive to game.

| # | rule | measured on wicks-v2 | how an agent would game it | why it can't |
|---|---|---|---|---|
| R1 | **pixel** Ink coverage of the frame at `t = 0.5 s` and `t = 1.0 s` must be ≥ 60 % of the video's median frame ink coverage | 0.73 % vs median 7.2 % → **ratio 0.10, fails 6×** | dump a big low-contrast rectangle at t=0 | ink = pixels differing from the modal background by ≥ 12 luma; a low-contrast card scores near zero. To pass you must put contrast on screen in the first half-second |
| R2 | **pixel** Ink mass below y = 0.60 must be ≥ 15 % of total ink in ≥ 50 % of sampled frames | 0 % in beats 1–2, ≤ 18 % ever | add a caption line at y = 0.9 | it's *area*-weighted; one 60 px text line is < 1 % of ink. Filling the bottom 40 % takes real artwork |
| R3 | **pixel** dHash distance between consecutive beat mid-frames ≥ 26/64 | 12, 12, 15, 21, 18 — **all 5 pairs fail** | shuffle a decoy element between beats | dHash is an 8×8 luma-gradient signature; moving a small element changes ~2 bits. 26 bits requires the frame's gross structure to change |
| R4 | **pixel** Luma centroid y across beat mid-frames must span ≥ 0.25, and at least one beat must have centroid > 0.55 | span 0.204, max 0.461 — **fails both** | drop one big block low in one beat | that *is* the design decision. It cannot be faked without composing a bottom-weighted frame |
| R5 | Largest rendered glyph in each beat ≥ 200 px on a 1920 canvas (`fontSize ≥ 113`); at least one beat ≥ 400 px | max 171 px, only in beat 5; 5 of 6 beats ≤ 110 px | set one off-screen text to 400 px | pair with `off-canvas` + require the element be ≥ 8 % of frame ink in ≥ 0.4 s of rendered frames |
| R6 | Over **moving segments only** (value changes AND leaving easing ≠ `hold`), opacity ≤ 45 % of segments **and** the sum of positional travel per beat ≥ 0.35 canvas-widths | opacity 62 % authored / 75 % all; beats 1,2,6 have < 0.15 travel | animate `x` by 0.001 on 40 elements | measure **travel distance**, not channel count. 0.001 contributes 0.001 |
| R7 | Over moving segments only, 25th percentile duration ≥ 0.25 s and median ≥ 0.35 s | p25 = 0.10 s (all captions) | — | duration is duration. **Also: change `narrate`'s `captionFade` default from 0.1 to 0.28 and exclude tool-generated caption fades from the pool**, or this rule just fights `narrate` |
| R8 | ≥ 3 distinct `fontFamily` values, and no single family on > 55 % of text elements **weighted by rendered ink area** | 2 families; Menlo 94 % by count | add a 12 px third-family label | ink-area weighting makes a tiny label worth ~0 |
| R9 | `check` must emit **errors, not warnings**, for R1–R7, and must report ≤ 12 findings by default (`--all` for the rest), deduped by code with a count | 211 warnings / 0 errors / `ok:true` | — | this is the SNR fix; without it every other rule is discardable |
| R10 | Replace SKILL.md:181's *"two snapshots 0.5 s apart must not be identical"* with **"between the 30 % and 90 % points of every beat, dHash distance across a 0.5 s gap ≥ 8/64, computed with captions hidden"** | current test passed at 4/64 with captions counted | — | hiding captions removes the free-pass; 8/64 needs the artwork itself to move |
| R11 | **Process**: require a written beat sheet (one line per beat naming *composition*, *the biggest thing on screen*, *where the eye goes*, *what moves*) **before the first `add_*` call**, and a mandatory re-read of it after the last beat is placed, with an explicit answer to "which two beats look most alike, and what did you change?" | none existed | write a beat sheet that says the same thing six times | R3/R4 are the enforcement; the beat sheet is what makes the failure *nameable* |
| R12 | **Process**: the frame-review prompt must ask three questions in order — (1) what is the biggest thing here and is it big enough? (2) where is the bottom third? (3) does this look like the previous beat? — before "what is broken?" | never asked | — | if R1–R4 are errors, answering wrongly costs a render |

---

## 11. Engine gaps this session proves

| gap | evidence | effort | unlocks |
|---|---|---|---|
| **No scene tool over MCP.** `bay-core` has `Command::AddScene` (`command.rs:191,1365`); `bay-mcp/tools.rs` registers 33 tool arms and none creates a scene. `grep -n scene crates/bay-mcp/src/tools.rs` → 0 hits | project has `scenes: [1]`, 188 elements, 61 s. **Five per-scene checks (`inert-scene`, `front-loaded`, `no-accumulation`, `monotone-easing`, `monotone-duration`) are arithmetically incapable of firing** | small — one tool arm | every per-scene check starts working; beats become addressable objects; R3/R4/R6/R10 have a unit to iterate over |
| **`snapshot` returns a path, not an image.** Looking is a 2-call protocol and the second call is optional | 3 of 15 snapshots never `Read`; the anti-freeze test was delegated to `cmp` | small — return the image content block, or add `snapshot_grid` returning a labelled contact sheet of N times in one call | makes "look at 6 beats side by side" a single call, which is the only cheap way to notice cross-beat sameness |
| **No pixel-measuring surface.** Every gate in `check.rs` reasons from the timeline; SKILL.md:113 admits *"it cannot tell you a frame rendered empty"* | R1–R4 above are all uncomputable today | medium — a `frame_stats` tool: sample N frames, return per-frame ink coverage, ink-by-row-band, luma centroid, dHash, dominant colours | turns every ungameable rule in §10 from prose into a gate |
| **`narrate` caption defaults are a design decision with no design review.** 5 parameters, chosen blind at minute 6, produced 38/73 text elements and 76/76 of the 3-frame pops | §4 table | small — raise `captionFade` default to ~0.28, and have `narrate` **refuse** caption styling until at least one `snapshot` has been taken in the session | removes the single biggest contaminant from every project-model metric |
| **`sfx_add`/`sfx_list`/`sound_add` advertised but unregistered in the running binary** | 5 hard errors at 17:16:57–17:17:06; agent hand-built a bed and 8-item SFX kit with ffmpeg, costing ~28 min | small — rebuild/ship; add a startup assertion that the advertised registry equals the dispatch table | recovers ~35 % of session wall clock for picture work |
| **Animated `volume` compiles to a nested ffmpeg `if()`, one branch per sampled segment; 27 keyframes over 61 s broke the parser** | L1058, render job 11 died mid-encode | medium | ducking by keyframe instead of 13 hand-crossfaded segments |
| **`check`'s `small-text` was `font_size × scale × scale_y`** (fixed since, `check.rs:118-131`) — but the corrected version fires **0** findings on wicks-v2, because 0.022 is a legibility *floor* and the complaint is a hierarchy *ceiling* | 69 findings, 67 false, 0 fixed; corrected floor = 42 px, smallest real text = 39 px | small | R5 is the missing half |
