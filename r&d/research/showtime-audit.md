# showtime vs bay audit

showtime is ahead on everything around the picture (free voice, music, QA gates, critic, one-sentence pipeline); bay is ahead on the editor, the motion engine and footage tools.

Audited 2026-10-06. showtime: `github.com/FavioVazquez/showtime` at commit `1c13d77` (0.4.0, MIT). bay: branch `feat/editor-parity` at `6292f8ce`.

## Caveats: what was read and what was not

- The showtime clone at `scratchpad/ref/showtime` was deleted mid-audit (around 21:12; `ref/` afterwards held only Drift, NullMotion, drift.tgz, audit-drift.md). The same commit, `1c13d77` (showtime 0.4.0), was read from GitHub to stdout; no files were created. showtime paths below are relative to that repo.
- Three sub-agents sent to read showtime's Python in depth returned nothing. showtime facts therefore come from its README, SKILL.md, the "Essentials" block of each reference, `qa.md`'s rule table, the benchmark README and SCOREBOARD. Its Python and JS source were not read beyond line counts and imports.
- bay's branch changed during the audit from `feat/resolve-host` to `feat/editor-parity` (`6292f8ce`). The bay findings are from the latter, which has about 75 tools, not 69.

## (a) Verdict

showtime is a director's method plus a local asset factory: one sentence becomes a stated-assumptions line, a one-sentence contract, a voice-first timed script, a first look, one render, a measured QA verdict, a blind critic round and a delivery card. Every stage is a command with a "done when". It is ahead of bay on:

- free local narration with word timings
- music (bay has none at all)
- a post-render QA gate with about 60 named rules
- readability and "phone" checks
- data to charts, site and app capture, stock search with licence gating and automatic credits
- an independent critic with a fix-or-waive ledger
- a benchmark that measures all of it

bay is ahead on being a real editor (timeline, undo, Changes card and Revert, policy sandbox), a native motion engine (`.brf`, no Chrome screenshots), `check_film` continuity measurement (showtime has no equivalent), paid generative image/video/speech, visual footage search, multicam and podcast tools, dubbing, subject mattes, grading, and encoded-file loudness mastering. bay's gap is not the engine. It is sound, verification after export, and the end-to-end procedure.

## (b) showtime's pipeline (SKILL.md § Pipeline)

0. **Start**: `job init <slug> --request "<verbatim>"` creates `showtime-out/<slug>-<ts>/` with `SHOWTIME.md` (ledger) and `job.json`. The opening line states mode, length, aspect and assumptions; it asks at most two questions, each with a recommended answer, and only if the request is ambiguous.
1. **Understand**: inspect the repo, URL, footage or brief. `brand capture` writes `brand.json`; evidence goes to `work/evidence/*.txt`. Artefact: the contract "This video tells ___ that ___".
2. **Plan**: `narration.md` (one `## scene` per scene), then `voice script --fit N` writes `vo.wav`, `timeline.json` (slots and word times), `vo.words.json`, `vo.srt`. `retime --from-voice` sets scene lengths from the voice. Music comes from `audio music pick` or `audio compose`, with `audio cuts` putting scene changes on phrases. All of it lands in `audio/mix.json`.
3. **First look**: `new <template>` writes `showtime.json` + `index.html`. `check` covers text, contrast, phone check and determinism. `look` makes one 1280 px composite that a disposable reviewer answers in text.
4. **Build**: `render` (headless Chrome, frame = pure function of time) writes `final.mp4`, `poster.jpg`, `credits.txt`. Fixes re-render only `--from/--to` and splice.
5. **Verify**: `qa` gives PASS/WARN/FAIL with LUFS and true peak in `qa.json`. `review-pack` feeds a fresh critic that writes `FINDINGS.md`. Later rounds are pairwise in both orders (`review-verdict`), capped at three, and every blocker or should-fix is fixed or waived (`review-respond`).
6. **Deliver**: `share.txt` (post copy, chapters, credits), `deliver exports` per platform, `receipt.md/json`, and a fixed-shape delivery card.

Opt-in studio mode adds local boards (concepts, style frames, music beds, storyboard, animatic) with hard stops. A crew of ten sub-agents works by `TASK.md`/`RESULT.md`.

## (c) Capability matrix

| showtime capability | bay | Evidence |
|---|---|---|
| End-to-end "one sentence to video" procedure with assumptions line and done-when per stage | Partial | `launch-film` skill (`src/shared/skills.ts:381`) and five `format-*.md` guides exist. Nothing covers from-nothing narrated video with voice, music and QA; grep for `assum`/`one-sentence` in `prompt.ts` and `skills.ts` finds nothing. |
| Local free TTS (Kokoro/Piper/Supertonic) with word timings | Lacks | `generate_speech` is cloud only: OpenAI, Gemini, ElevenLabs (`src/shared/speech.ts:100-147`). grep `kokoro\|piper\|say -v` is empty. |
| Narration script to per-line clips, fitted to N s, scenes retimed from voice | Partial | `estimate_speech` and `generate_speech` exist per call. No batch script, no slot timeline, no retime-from-voice; only the `dub` skill does slot fitting. |
| Pronunciation lexicon | Lacks | grep `lexicon\|pronunci\|phoneme` is empty. |
| Music: 297-track catalog, 18-style composer, fit to length | Lacks | Every guide assumes the user supplies the track; `retention-talking-head.ts:35` says so for effects. No tool makes or fetches music. |
| Beat grid, cuts on beats | Has | `detect_beats`, `editing.md:163`. |
| Sound effects | Has (smaller) | `score_sfx`: five materials in one room, against showtime's 56 types plus a 1,334-sound library. |
| Mix: ducking, levels by role, mix report | Partial | Duck, faders and `level_voices` exist. No report of voice-over-music dB. |
| Loudness mastering on the encoded file | Has | `main/export/master.ts`, `deliveredLoudness` on export. |
| Post-render QA (black/frozen, silent gap, clipping, true peak, voice masked, level jump, abrupt end, first frame, flash risk, caption rules, platform limits, missing credits) | Partial | Export `findings` cover missing audio, length over 2 % off, unreadable file and incomplete frames (`docs/review.md` §3). No detectors; `blackdetect`/`freezedetect` are not in `REQUIRED_FILTERS` (`script/build-ffmpeg.sh:67`). |
| Pre-render text check (phone point size, reading time, safe zone, contrast, overflow) | Lacks | Safe areas are prose in `review.md` and viewer guides. grep `wcag\|contrast ratio` is empty. |
| Continuity / "film or slides" measurement | **bay ahead** | `check_film`; showtime has only rhythm and frozen rules. |
| Contact-sheet look | Has | `frame_grid` (with spoken words under each cell), `preview_frame`. |
| Independent critic, pairwise, fix-or-waive | Lacks | The `review` skill is self-review. The in-app agent has no sub-agent tool (`--tools` list, CLAUDE.md). |
| Notes on the finished video | Has | `add_comment`, `read_feedback`, `resolve_feedback`. |
| Charts from CSV/JSON with numbers bound to data | Lacks | Charts are hand-written `.brf` code. No data asset kind, no import. |
| Motion components and themes (20 components, 23 transitions, 6 themes) | Partial | 7 templates (`templates.ts`), 6 styles, a `.brf` kit in the guide, 5 timeline transition kinds. |
| Website capture, scripted app recording with auto-zoom, brand kit | Lacks | grep `brand.?kit`, `desktopCapturer`, `site capture` finds nothing relevant. The launch-film skill redraws UI from user-supplied recordings. |
| PDF import | Lacks | Not found. |
| Stock/archive search (Openverse, Commons, NASA), licence gate, `credits.txt` | Lacks | grep `openverse\|wikimedia\|cc0\|credits.txt` is empty. `import_url` exists with no licence concept. |
| Generative image/video | **bay ahead** | `generate_image`, `generate_video`, 15 prompt kits. showtime refuses cloud APIs. |
| Icons, emoji as images, fonts by name | Partial | Fonts are assets. No icon or emoji fetch. |
| Still cutout | Partial | `put_behind_subject` (person matte); no general still cutout. |
| Transcript-driven cuts | Has | `transcribe`, `remove_range`, `remove_silences`, `apply_script`. Automatic filler-word removal is not a named feature. |
| Face-tracked 9:16 reframe, stabilise | Lacks | No reframe tool. `deshake` is in the ffmpeg build but no tool calls it. |
| Denoise, speakers, multicam, dub, visual search, highlights | Has / ahead | `audio_effects`, `switch_speakers`, `sync_angles`, `plan_dub`, `search_footage`, `find_highlights`. |
| Word-by-word captions | Has | `add_subtitles` (5 designs), `add_captions`. |
| Platform exports | Partial | `export-presets.ts`: YouTube, vertical, square, 4:5, podcast, master. No per-platform length/size check; no GIF/WebP loops. |
| Poster, share copy, delivery card, receipt | Lacks | grep `share.txt\|receipt\|delivery card` is empty. |
| Look history, "don't repeat the last video" | Lacks | Not found. |
| Style from a reference video | Has | `style-from-reference` skill, `write_style`. showtime adds `reference diff` and a copy check. |
| Studio boards, animatic | Partial | Three concepts in chat (`FILM_CONCEPTS`), `propose_edit`. No option board. |
| Honesty rules (sourced claims only, check the user's own claim) | Partial | The launch-film skill forbids invented features; there is no claims ledger. |
| Manim, single-file HTML video, PR/release videos, GitHub Action | Lacks | Outside bay's product shape; not recommended. |
| End-to-end benchmark | Lacks | `test/app` has 72 probes; no one-sentence task benchmark found. |

## (d) Ranked gaps and build specs

### 1. Director skill `make-video` (quick mode) — size S

- Behaviour: one sentence in. The agent prints one assumptions line (length, aspect, voice, music, review level), asks at most two questions with recommended answers, then runs contract, script, voice, build, look, QA and delivery card without stopping, except before paid generation.
- Where: a new skill in `skills.ts`, a guide `docs/pipeline.md`, a route in `prompt.ts`.
- Port closely: `references/story.md` §1-§6, `pacing.md` (all numeric), `modes.md` §1 and §5.
- Must not break: "Ask before editing"; paid tools stay `validateOnly` first.
- Verify: an agent-panel run on three prompts; assert the opening line and card shape by regex, as showtime's `delivery-card` eval does.

### 2. Music — size L, owner decision

- Behaviour: "with music" works with no file supplied; the bed is exactly the film's length with a beat map and an end hit.
- Where: a new tool `score_music` beside `score_sfx` (renderer synth or main) producing an audio asset plus beats, and a guide ported from `music.md`.
- Options: (i) a procedural composer — learn from `lib/st/audio/compose.py` (1,382 lines, numpy; it appears to use a SoundFont, unconfirmed); (ii) a bundled CC0 set; (iii) a CC-BY catalog downloaded from creators' sites, which is a new network exception.
- Verify: rendered length exact, `detect_beats` recovers the declared grid, mastered level measured through real ffmpeg.

### 3. Narration script tool `narrate_script` — size M

- Behaviour: lines keyed by scene in; one job per line (cached per unchanged line); returns slots and word times and places a voice track; `fitSeconds` rejects with "cut about N words".
- Where: `src/shared/tools/`, `main/generate/`, `@shared/speech`. Word times come from the existing whisper `-ojf` path. Pair it with a store action that retimes scenes or `.brf` durations from the slots.
- Learn from: `lib/st/voice/script.py` (608 lines) and `voice.md`'s word budgets.
- Verify: stub server; slots sum to the placed length; edit one line and exactly one job is paid.

### 4. Local free voice — size M, owner decision

Kokoro-82M (Apache-2.0, ONNX) could run in the existing onnxruntime utility process, but it needs espeak-ng (GPL-3.0) for phonemes, which matters for a signed LGPL-clean bundle. The zero-dependency alternative is macOS system speech, at lower quality. Without this, "one sentence" always needs a paid key.

### 5. Post-export QA tool `check_export` — size M

- Behaviour: read the delivered file and return PASS/WARN/FAIL per rule with timestamp and fix: black segment, frozen stretch, silent gap, clipping, true peak, loudness off target, first frame black, sound cut off at the end, level jump at cuts, voice under 8 dB over the music, flash risk, caption length and speed, platform length and size.
- Where: `src/main/export/` extending `findings`. Add `blackdetect`, `freezedetect`, `astats` to `REQUIRED_FILTERS`, or compute picture rules from frames the exporter already holds.
- Port closely: the rule table and thresholds in `references/qa.md` § Tools and `runtime/thresholds.json`; `lib/st/qa/hearing.py` (843 lines, no third-party imports), `rhythm.py`, `motion.py`.
- Verify: one defect fixture per rule, as showtime's `tests/fixtures/defects/*` (14 named defects), each paired with a clean file that passes.

### 6. Readability check — size M

- Behaviour: before export, flag text below a phone minimum (5 pt at 16:9, 10 at 1:1, 11 at 4:5, 15 at 9:16), held less than `0.3 s + max(chars/17, words/3)`, under platform UI zones, or under 4.5:1 contrast.
- Where: a new leg in `check_film` or a `check_text` tool reading resolved `.brf` scenes and text items; contrast from rendered pixels.
- Verify: mutants per rule; contrast sampled mid-transition.

### 7. Critic round — size M-L, owner decision on cost

- Behaviour: after export, a fresh session sees only a pack (frame grids, text crops, hearing measurements, the script) and returns blockers, should-fixes and "would I post this"; each finding is fixed or waived before "done".
- Where: main spawns a second read-only agent with `frame_grid`/`preview_frame` only; findings land as timeline comments so `read_feedback`/`resolve_feedback` are the ledger.
- Cheap first step (S): put showtime's eight self-review questions and the type-detail pass into `docs/review.md`.
- Learn from: `references/review.md`, `crew/critic.md`, `qa/pairwise.py`.

### 8. Data to chart — size M

- Behaviour: import a CSV/JSON as a data asset; `.brf` modules read it; a chart helper renders bar, hbar, line and race with direct labels and the title computed from the data; a `must_show` export finding checks the numbers.
- Where: asset `kind: 'data'`, `brf-code.ts` imports, a guide section.
- Must not break: the worker lockdown (data passed in, never fetched).
- Verify: every on-screen number equals a cell of the source.

### 9. Delivery card, share copy, credits — size S

- Behaviour: the final message has a fixed shape: files, length, loudness, QA verdict, what was actually looked at, assumptions, cost, three next options. It includes post copy and a credits block for anything needing attribution.
- Where: skill text plus a `licence`/`credit` field on assets.
- Verify: regex on the last message.

### 10. Component and theme kit for `.brf` — size M

Add count-up, typewriter, code block with diff, cursor and keycaps, device/browser frame, steps, kinetic type, Ken Burns and end card as importable helpers, plus 4-6 token themes. Where: `bay` module exports in `brf-code.ts`, `src/shared/styles/`. Verify: each compiled and run on every frame by `brf-code.test.ts`, each passing the readability check.

### 11. Product capture and brand kit — size L, owner decision

Capture a URL or local build into screenshots, copy, colours and fonts; record a scripted click-through with auto-zoom. It conflicts with `offline.ts` for remote URLs. A localhost/static-folder-only version, or brand extraction from user-supplied screenshots, needs no new exception.

### 12. Stock/archive search with licence gate — size M, owner decision

Hosts would be Openverse, Wikimedia Commons, NASA. Free licences by default, CC BY only with a credit written, NC/ND never.

### 13. Benchmark — size M, dev-only

Ten one-sentence tasks, automatic metrics from item 5, blind pairwise judges that must prove they opened every frame (random number stamped on each image), and a behaviour scoreboard. Learn from `benchmarks/README.md`, `scoring/judge.py`, `plugin-eval/`.

### Lower priority

Look history, face-tracked reframe, filler-word removal, option boards, pronunciation lexicon.

## (e) Owner decisions forced

| Decision | Why |
|---|---|
| A music source | Procedural needs no network. A catalog means new hosts (creators' sites or a mirror) and CC-BY credit duties; Scott Buckley tracks trigger YouTube Content ID without the credit line. |
| A local TTS model | Kokoro weights are Apache-2.0, but espeak-ng is GPL-3.0. New model download host. Otherwise voice stays paid-only. |
| Stock search | Three new network hosts; licence policy. |
| Site capture | Loads remote pages, against the editor-session block. |
| Critic agent | Roughly doubles token cost per video. showtime's own numbers: median 65.3k tokens per run with the skill against 34.7k without. |
| ffmpeg filters | Adding detectors changes the pinned build's configure line. |
| Any ported asset | showtime's code is MIT (attribution needed). Its bundled sounds, fonts and music each carry their own licence and are not covered by the repo's MIT. |

Reference scores from showtime: the behaviour scoreboard is 35/42 (83 %) with showtime against 25/42 (60 %) without, over 14 cases and 3 runs each, costing $36. In the author's blind vote, 0.3.0 was preferred to plain Claude Code on 7 of 8 tasks; he calls these anecdotes himself.

## (f) Could not determine

- showtime source internals: whether the composer is pure DSP or SoundFont-based, the face-tracker and cutout models, the ASR model beyond "Parakeet" in the docs, the map tile source, exact install sizes beyond "0.6-0.8 GB core", and the full list of `showtime check` finding codes.
- The crew dispatch contract in detail (`agents/*.md` not read), and the MCP "all" tool list beyond the ten core tools.
- Benchmark round 4 per-task numbers; they live on the project site, not in the repo.
- Whether bay's ffmpeg build already contains `blackdetect`/`freezedetect`; they are only absent from the required list.
- Whether `.brf` scenes expose enough text geometry for the readability check without rendering.
- Whether bay's tool count and skills are the same on `feat/resolve-host` as on the branch the audit ended on.
