> **Historical:** describes the Rust engine, deleted; recover what it cites with `git show rust-engine-final:dep/rust/<path>` (e.g. `crates/bay-mcp/src/tools.rs`).

# Round 3 — the critique: bay vs "best AI video editor in the world"

**Date:** 2026-08-15. **Inputs:** the code on the current branch, every internal doc through
round 2, and three commissioned research reports checked into this directory:
[`01-market-landscape.md`](01-market-landscape.md) (competitors, Aug 2026),
[`02-what-good-video-means.md`](02-what-good-video-means.md) (craft, quality rules, self-eval
research), [`03-capability-audit.md`](03-capability-audit.md) (code-level audit).

**The stated goal:** *give it a task, and it'll accomplish it — the best AI video editor in the
world.*

---

## 1. Verdict

bay is the best-engineered **agent-driven composition engine** in its cohort — and it is not yet
an AI video *editor* in the sense the goal means. Today, "give it a task" is true for one genre
family: made-from-scratch motion-graphic reels and narrowly scripted assembly jobs. Four things
stand between that and the goal:

1. **It cannot hear.** No speech-to-text. `bay-speech` speaks; it does not listen. This single
   absence excludes bay from the majority of real-world demand: transcript editing, filler and
   silence removal with judgment, captioning recorded speech, viral-clip finding, podcast and
   talking-head work. The podcast-cut demo needed a hand-written Python driver and still says so
   in its own README.
2. **It can barely see.** SigLIP over externally extracted stills is retrieval, not
   understanding. No temporal embeddings, OCR, faces, actions, no "find the moment where she
   laughs."
3. **Its editorial grammar is shallow.** One scene, one transition, no retime family at all, no
   group/camera transform, no track verbs, no compound clips. Whole genres (montage, tutorial,
   music video, multicam interview) are structurally out of reach regardless of agent quality.
4. **Its quality loop is half-built and partly fictional.** The pixel checks and critic loop are
   plan-stage; meanwhile the skill *claims* codes (`no-response`, `bottom-dead`, `frozen`) that
   `check.rs` does not implement. A gate that is documented but absent is worse than absent.

Meanwhile the market moved: the "give it a task" category is validated and funded (Descript
Underlord v2, Mosaic, Eddie v3, Captions/Mirage, Adobe's Firefly Assistant), and bay's
architectural identity — local-first + MCP-native — is **no longer unique**: Kerf, AVE, Kinocut,
mcpCut, FableCut all shipped in 2025–26. None has a production engine. The research estimate is
**~12 months** before Adobe/Blackmagic bolt agent surfaces onto real engines. The window is open
and it is now.

## 2. What bay gets right — do not trade these away

- **Choice deletion over check accumulation.** Kits, roles, tones, the 33-move registry, and the
  Skalse-grounded three-rule-shape discipline are, as far as the research could find, *ahead of
  every shipping competitor* on the Goodhart problem. Mosaic says "taste is the frontier";
  bay has an actual mechanism.
- **The honesty culture.** Provenance, `skipped` reporting, fixtures measured against real
  failures, refusal-with-named-reason, the `ignoreChecks` written-claim escape. Round 2's
  admission that round 1 made the output worse is rarer and more valuable than any feature.
- **Local-first economics.** The loudest complaint themes across every cloud competitor —
  credit-burn on failed generations, opaque billing, CapCut-style ToS rights grabs, mandatory
  cloud upload of NDA'd footage — are all things bay is structurally immune to. Free infinite
  local iteration is not just pricing; it is *how taste gets applied*, and it is what makes a
  Best-of-N selection loop affordable when competitors meter every attempt.
- **A real engine behind the tools.** The MCP cohort competitors are ffmpeg wrappers; the cloud
  JSON-to-MP4 APIs have no local privacy story. A wgpu compositor with kits, moves, word-synced
  captions, ducking, and gated loudness-normalized export is the thing none of them have.

## 3. The shortcomings, in order of strategic damage

### 3.1 The understanding gap (blocks the goal outright)

Every top-10 "must have" from the market research that bay lacks reduces to perception:

| Missing | What it blocks |
|---|---|
| STT with word timestamps | transcript-first editing (Descript's moat), filler/silence removal with *pause intelligence*, captions on recorded speech, quote finding, dubbing prep |
| Diarization + face/subject tracking | speaker-aware cuts, multicam, auto-reframe 16:9→9:16 (every repurposer has it) |
| Temporal/semantic video indexing | "find the moment where X", highlight detection, B-roll matched to what is being said, stock-mismatch detection |
| Generative adapters (opt-in) | B-roll and fills the archives cannot supply; competitors ship Veo/Sora in-app |

Note the shape: bay's own round-2 unowned gap #21 ("nothing verifies the video is about the
brief") is *also* a perception gap. The relevance problem and the footage problem have the same
root — bay cannot compare content against intent in either direction.

### 3.2 The editorial grammar gap (blocks genres)

From the audit, in rough order of unlock-per-effort: retime (speed/ramp/reverse/freeze — an
entire grammar of emphasis, absent), group/camera transform (a push over 12 elements is 36
calls; no bay video has ever had a camera move), transitions beyond cross-dissolve (needs
animatable masks/params), track and edit-point verbs (insert/overwrite/roll/range), compound
clips and multi-sequence (long-form structurally impossible), multicam.

### 3.3 The legibility and voice gap (blocks perceived quality)

- **Text stroke/shadow/plate** — still missing, still the #1 caption-legibility rule, still the
  most-watched text in every video. Small engine job, outsized quality effect.
- **Per-word caption animation** — the modern caption format across every social tool.
- **The Kokoro single register** — round 2's own words: "36 seconds in a single unvarying
  register is its own retention failure," and the flat-F0 signature is literally on the external
  slop-detector list. This is the largest *admitted, unowned* gap in the plan
  (`44-expressive-tts.md` scopes it; nobody owns it).
- Grain/vignette/glow, gradients, paths/strokes — known since round 1, still open, and the
  round-1 caveat stands: reference videos did not need most of them. Sequence behind the above.

### 3.4 The trust-loop gap (blocks adoption)

The market research is unambiguous: the products winning trust show a **plan before cutting**
(Underlord's Project Brief), deliver **alternatives** (Eddie's 6 rough cuts), and keep an
**attributed, revertible history** (Kerf). bay has the reversible history and the refusal gate —
but no plan artifact (the gap its own capability map named: "there is no object between the
prompt and 45 tool calls"), no timeline diff for a human to approve, and no variant story. And
the critic loop (round-2 §3.4) plus `contact_sheet` remain unshipped, so the agent still cannot
cheaply *look at its own work*. External research adds two mechanisms worth adopting verbatim:
**pairwise tournament over N variants** (never absolute VLM scores) and **Forced Optimization**
(a revision ships only if it beats the incumbent) — and one warning: never let the VLM be the
sole gate, which bay's tiering already gets right.

### 3.5 The truth gap (cheap to fix, corrosive to leave)

- Skill claims unimplemented check codes; `references/tools.md` drops schema fragments its
  generator fails to merge; tool counts read 24/26/55/65 against a real 70; one running build
  served 51 of 55 tools and the miss was misdiagnosed as a taste failure. The repo already knows
  the rule — *stop hand-writing counts* — it has not finished applying it to itself.
- Built-in templates carry literal colors/sizes/positions, bypassing the kit — a second visual
  system inside the mechanism that exists to prevent second visual systems.
- `render` truncating a 155s timeline to 61s passed `check` clean; the words-per-second constant
  the skill teaches (2.5) disagrees with the engine's measured 3.30; the legacy `vii` directory
  still captures new projects. All three are shaped like "the system lies to its operator."

### 3.6 The platform gap (bounds the market)

macOS-proven only (Windows built, never exercised; Linux refused), single window/document/scene,
fixed unauthenticated loopback port (any local process can read/write arbitrary files through
it), ~2 GB of runtimes with no disk reporting or removal, absolute media paths by default,
SigLIP on CPU because Candle's Metal kernels are missing. None of these blocks the mission this
quarter; the auth token and the Windows exercise are the two that will embarrass first.

## 4. What "good video" means for the roadmap

Full detail in [`02-what-good-video-means.md`](02-what-good-video-means.md). The three findings
that should steer bay specifically:

1. **Variance is the discriminator.** Shot-duration σ ≥ 40% of mean, no three consecutive
   same-duration shots, an energy contour that *changes* over the runtime. Flat is the slop
   signature — in pacing, in loudness, in F0, in structure. bay's continuity/argmax rule shapes
   already point this way; the external work confirms the direction and adds the audio/voice
   axes. (Any new distributional gate must still clear the round-2 bar: two-sided, measured on
   fixtures, silent on references.)
2. **The hard numbers are broadcast standards, and bay already meets more of them than any
   competitor cohort tool** — −14 LUFS, dwell floors, ducking depth. Missing and cheap:
   true-peak ≤ −1.0 dBTP as a gate, speech-vs-bed ≥ 10 LU (AES-backed, bay's +6 LU is shy of
   it), caption CPS ceiling, 9:16 safe-area keep-outs as kit framings.
3. **Genre playbooks are the product surface.** The archive-reel reference file — a *named
   format* with every number and its failure modes — is exactly the right shape. The playbook
   table gives bay ten more formats to encode the same way. "Best AI video editor" at task level
   means: name the format, load its numbers, verify its gates.

## 5. What to fix — the ordered list

Ordering rule, inherited from round 2: consequence → representability → measurement → doctrine.
P0 restores truth, P1 buys perception (the strategic unlock), P2 buys craft ceiling, P3 widens
the market. Sizes use the repo's S/M/L/XL convention.

### P0 — truth and the half-built loop (days–weeks)

| # | Item | Size | Why first |
|---|---|---|---|
| 1 | **Finish round 2 as planned** — Phase 0–2 fixtures/envelope/free checks, then Phase 3 pixels + `contact_sheet` + critic loop | M–L | Already designed, already measured; everything below is graded by this ruler |
| 2 | **Kill the drift**: generate `tools.md` completely (fix the fragment merge), generate the tool count everywhere, delete unshipped check codes from the skill, fix the 2.5→3.3 w/s constant | S | Agents design from these documents; every drifted line is a defect factory |
| 3 | **`render` refuses/warns on timeline truncation**; `check` takes a `duration` | S | Already specced in todo.pending; a video ending mid-sentence passed clean |
| 4 | **Templates resolve from the kit**, not literals | S | Closes the internal contradiction in the style architecture |
| 5 | **`vii`→`bay` path migration made real** | S–M | Data-loss shaped |

### P1 — teach bay to hear and see (the strategic bet, weeks–months)

| # | Item | Size | What it unlocks |
|---|---|---|---|
| 6 | **STT sidecar with word timestamps** (whisper.cpp, Metal, ~150 MB quantized — a `bay-provision` manifest entry, same pattern as Kokoro/vision) + a first-class transcript object on imported media | L | The single highest-leverage item in this document. Transcript search, `cut_by_words`, filler/silence removal *with pause intelligence* (the #1 taste complaint against every auto-cutter is destroyed comedic timing), captions on real speech via the existing caption pipeline, quote-driven clip finding |
| 7 | **Plan artifact + approval loop**: a storyboard object between prompt and tool calls; a human-readable timeline diff; beats/roles/format declared before authoring (which also arms the payoff-marker and continuity gates properly) | M | The trust pattern every winning competitor converged on; also the round-1 capability map's named gap |
| 8 | **N-variant + pairwise selection** on top of the critic loop: render 2–3 variants differing in hook/pacing/music, tournament, Forced Optimization | M | bay's structural advantage — variants are free locally, metered everywhere else |
| 9 | **Voice**: per-clip prosody control now (rate/pause authoring across clips); an expressive-TTS decision from `44-expressive-tts.md` next; abstract the TTS provider either way (the Sora-2 shutdown is the lesson: cloud models churn violently — adapters, never dependencies) | M–L | The largest admitted-unowned quality gap; flat voice is a slop signature |
| 10 | **Semantic media index**: shot-sampled SigLIP embeddings persisted per project (shots already come from `shots_detect`; the "useful unit is a shot" risk note already says this), text-searchable | M | "The shot of the whiteboard"; B-roll-vs-narration mismatch detection; the first dent in unowned gap #21 (relevance) |

### P2 — craft ceiling (months, mostly known and ranked already)

11. **Text stroke/shadow/plate** (S) and **per-word caption animation** (M) — legibility first.
12. **Retime family**: constant speed, ramp, freeze (M) — an absent grammar, cheap relative to
    what it opens (montage, tutorial zoom-holds, punchline freezes).
13. **Group/parent transform** (M) — one camera move instead of 36 calls.
14. **Animatable masks + effect params** (M) → the transition family (wipe/push/dip) falls out.
15. **Paths/strokes/gradients** (M–L) — charts, connectors, self-draw; long-known, sequenced
    behind the above per the round-1 teardown finding (references didn't need them).
16. **Dialogue audio chain**: EQ + compressor + true-peak limiter presets on the speech role
    (M) — plus the ≥10 LU speech/bed gate and −1.0 dBTP as check codes.

### P3 — widen the market (quarters)

17. **Auto-reframe with subject tracking** (face detection + crop keyframes; the crop engine
    exists) — every repurposer's table stake, and the export story for "one timeline, every
    aspect."
18. **Diarization + multicam grammar** (waveform sync, active-speaker switching, J/L cut verbs
    — the craft research says ≥30% of speaker changes should be split edits).
19. **Opt-in generative adapters** behind explicit consent, provider-abstracted, for B-roll and
    fills the archives cannot supply.
20. **Platform hardening**: Windows actually exercised, an auth token on 7333, disk
    reporting/`runtime_remove`, multi-document routing.

### Deliberate non-goals

- **Do not chase generation quality.** Editing real footage well is the anti-slop position; the
  generative studios are complements (and churn risks), not the competition.
- **Do not add cloud dependence or credits.** The complaint corpus is a map of what not to build.
- **Do not grow the gate.** The 14-code budget holds; new codes buy their way in with the
  four-measurement proof, or they do not ship.
- **Do not write more doctrine prose.** Round 2 proved the transfer channel: schemas and
  registries transfer, prose numbers get copied as defaults. New craft knowledge lands as named
  formats, kit framings, moves, and check codes — not paragraphs.

## 6. The strategy in one paragraph

Keep the beachhead (bay is already the best agent-driven motion-graphics instrument anyone has
shipped) and buy perception with the next quarter: STT first, then the plan/variant/critic trust
loop, then the semantic index. That sequence converts bay from "executes a detailed plan" to
"derives the plan from footage and a goal" — which is the actual meaning of *give it a task* —
while the local-first, credit-free, real-engine position stays unoccupied. The window the market
research gives that position is about twelve months. The differentiators to protect while
spending it: the trust loop as product, taste as mechanism (kits/moves/gates, now extended to
formats), and iteration that costs nothing.
