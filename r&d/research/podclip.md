# podclip — what it is, and what bay should take from it

Studied 2026-09-28 from a shallow clone of `github.com/treydoe1/podclip-public-release` at
`bfb3371` (2026-07-21), in `/tmp/podclip-audit-35292-1790562070`. Paths below are relative to that
repo unless they start with `src/` (bay). I ran podclip's own decision test
(`node --test tests/cut-decisions.test.js`: 4/4 pass) and drove its `decideEdits` function
directly on synthetic curves (script in the session scratchpad; results quoted below). I did **not**
install it into Premiere, so everything about the Premiere side (razor, clone, CEP) is read, not
run: **unverified**.

## 1. What it is

**One line:** a macOS-only Adobe Premiere Pro CEP panel that builds a *rough multicam speaker cut*
for a podcast. Each speaker has their own mic on their own audio lane, and each camera angle is
tagged with the speakers it shows. Podclip measures each mic's loudness over time with ffmpeg,
decides who is talking, and razors the angle tracks and switches clips on/off so the right angle
shows. It works on a duplicate of the sequence.

It does **one** thing. From the README's "Current scope" and a read of all 5 source files:

| Feature asked about | podclip? |
|---|---|
| Multi-speaker camera switching | **Yes** — the whole product, from per-mic levels, no transcript |
| Speaker detection / diarization | **No diarization.** "Who is talking" means "whose mic is loudest by ≥6 dB". There is no model, and a single shared mic cannot be split |
| VAD | Only a per-mic RMS threshold with attack/release (§3). No real VAD |
| Silence removal | No. Silence *holds the current shot* |
| Subtitles, transcript | No ("does not currently provide transcript-aware edits") |
| Chapters, social clips, thumbnails | No |
| Audio cleanup (noise, levelling) | No. Audio is only measured, never processed |
| Angle sync | No. Angles must already be synced on the timeline |
| Preview before writing, presets | No (README says so) |

**Licence: MIT.** `LICENSE`:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software
> … to deal in the Software without restriction, including without limitation the rights to use,
> copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software …
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.

The bundled ffmpeg 8.1.2 is LGPL-2.1+, built "without GPL, nonfree, or external libraries"
(`THIRD_PARTY_NOTICES.md`), the same policy as bay's own build. `PROVENANCE.md` says the code was
written from a plain-English description with a coding agent, and that no third-party plugin was
inspected or copied.

**Verdict for bay:** bay **may copy code** as long as the MIT notice ("Copyright (c) 2026 Podclip
contributors" plus the permission text) goes with the copied portion, e.g. in a header comment and
a third-party notices entry. I still **recommend reimplementing rather than copying**. The part
worth having is about 250 lines of ES5 (`client/panel.js:396-640`), and it has the defects in §4.
bay's idiom (TypeScript, frames rather than seconds, `@shared` pure functions, tests proven against
the bug they guard) would rewrite every line anyway. If any line does survive verbatim, add the
notice. Ideas, thresholds and the tag-set routing rule are fair game either way.

**Stack:** plain browser JavaScript in a CEP panel (`client/`), ExtendScript for Premiere
(`host/host.jsx`, using the QE DOM's `razor`), Node's `child_process` inside CEP to spawn ffmpeg.
No dependencies, no build step. Signed `.pkg` installer through Adobe's UPIA (`scripts/`,
`installer/`). CI: `.github/workflows/checks.yml` runs `scripts/check.sh` on `macos-latest`.

**Maturity (GitHub API, 2026-09-28):** created 2026-07-16, **13 stars, 5 forks, 0 open issues, 7
commits in total**. The last commit is 2026-07-22 (installer fixes), so it has been quiet for over
two months. The README says "beta". JS 60 KB, and the repo is 51 MB because it commits ffmpeg
binaries and the source tarball. It is a small, single-author, one-feature tool, not a platform.
Its value to bay is one well-specified algorithm and a clear list of failure behaviours.

**Network use: none.** Nothing in the source opens a socket. ffmpeg runs on local files.

## 2. Architecture

```
Premiere sequence ──host.jsx getSequenceInfo()──▶ tracks, clips, media paths, in/out (seconds)
        │
        ▼
analyzer.js  per speaker lane: ffmpeg astats → 50 ms RMS dB curve, stitched in sequence time
        │
        ▼
panel.js decideEdits(curves, settings)  → events [{sample, cam}] → per-angle segments {start,end,enabled}
        │
        ▼
host.jsx  duplicate sequence → open it → per angle track: razor every boundary, clip.disabled = !enabled
```

- **Lanes, not names.** Speaker *n* is audio lane A*n*, and angle *m* is video lane V*m*
  (`panel.js:702-719`). Missing lanes stop the run before anything is duplicated.
- **Output = razored, stacked angle tracks with clips toggled on/off**, not a multicam clip
  (`host.jsx:225-295`). The track above wins where two are enabled, but only one is enabled per
  segment by construction.
- **Safety:** it refuses to write when analysis finds only one camera state (`panel.js:763-764`),
  it duplicates first (`767-796`), and it checks the duplicate is the active sequence before
  writing (`host.jsx:236-238`).

## 3. How the speaker cut works, exactly

### 3.1 Level measurement (`client/analyzer.js`)

- `SAMPLE_MS = 50`, so 20 values a second (`:25`).
- Per clip on a speaker's lane, ffmpeg is run with `-ss inPoint -t duration -i media -vn -af
  aresample=48000,[pan=mono|c0=cN,]asetnsamples=n=2400:p=0,astats=metadata=1:reset=1,
  ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-` (`:210-232`). This produces an RMS dB
  per 50 ms window, with `-inf` mapped to −120 (`:277-295`).
- **Channel mapping:** speaker *s* reads channel *s−1* of its own lane's media (`panel.js:738`).
  If that channel does not exist, or its peak is ≤ −100 dB, it re-reads channel 0
  (`analyzer.js:249-264`). So one poly-WAV from a recorder placed on every lane works, and so does
  ordinary mono or dual-mono.
- The clips are stitched into one sequence-time array. Gaps stay at −120, and the last write to a
  bin wins (`:302-330`). Clip speed is ignored: it reads `duration` seconds of source from the in
  point (read, not tested).

### 3.2 Decision (`client/panel.js:396-640`)

Defaults are from `client/index.html:29-101`. The constants in `panel.js:490-494` are hard-coded.

| Parameter | Default | Meaning |
|---|---|---|
| `dbThreshold` (per mic overridable) | **−50 dB** RMS, slider −70…−10 | mic is "hot" above it |
| `ignoreShort` (attack) | **0.35 s** | must be hot this long, continuously, to latch active |
| release | **0.45 s** fixed | stays active through breaths and gaps this long |
| `delayCuts` | **0.10 s** | a new camera must stay the candidate this long |
| min shot | **0.75 s** fixed | no cut sooner than this after the last cut, and shots shorter than this are removed afterwards |
| `leadIn` | **0.12 s** | the cut is placed this much *before* the decision (show the speaker slightly before they speak) |
| dominance | **6 dB** fixed | if the loudest active mic beats the next by ≥6 dB, the others count as bleed |
| `wideFreq` | medium (off/low/medium/high) | whether overlap may go to a group or wide angle (see §4: only `off` differs) |

Per 50 ms sample `t`:

1. **Latch** each mic: above threshold → `attack++`, release counter reset to 9 samples, latch
   on once `attack ≥ 7`. Below → `attack = 0`, release counts down, latch off at zero (`:514-538`).
2. **Bleed rejection:** `dominantSet` keeps only the loudest mic if it is ≥6 dB over the second
   (`:461-487`).
3. **Pick an angle** (`pickCamera`, `:423-442`): an angle whose tag set equals the active set;
   otherwise the **smallest** angle whose tags include all of it (a two-shot beats a wide); else
   the loudest speaker's single-speaker angle; else hold. With nobody active, it holds. With
   `wideFreq = off` and two or more active, it holds (`:543-557`).
4. **Debounce:** the proposed angle becomes a candidate and must survive `delayCuts`, and at least
   `minShot` must have passed since the last cut. The cut is written at `t − leadIn`
   (`:565-579`).
5. **Smooth:** repeatedly delete any interior event whose shot is shorter than `minShot`
   (`smoothEvents`, `:623-639`).
6. Events become one enabled/disabled segment list per angle, covering the whole duration
   (`:592-617`).

So the effective latency from a speaker starting to the cut is ~0.35 s attack + 0.1 s delay −
0.12 s lead-in ≈ **0.33 s after onset**, never sooner than 0.75 s after the previous cut.

### 3.3 Writing (`host/host.jsx:225-295`)

For each angle track: QE `razor` at every segment boundary. A boundary outside any clip throws,
and the error is swallowed (`:262-268`). Then each clip whose **midpoint** falls inside a segment
gets `clip.disabled = !seg.enabled` (`:273-285`). Timecode is built by hand as HH:MM:SS:FF
(`:297-309`), so a drop-frame sequence would razor at the wrong frames. That is my reading and is
untested.

## 4. Defects found (measured where marked)

1. **`wideFreq` low/medium/high behave identically. Measured.** `allowMulti` is computed
   (`panel.js:541`) and passed to `pickCamera`, which never reads its second parameter. On a
   10-second, two-speaker curve with an overlap, `low`, `medium` and `high` gave byte-identical
   segments. Only `off` differed. The UI offers four choices and implements two. This is the
   "correct-looking construct nothing can reach" shape in bay's CLAUDE.md.
2. **Redundant leading cut. Measured.** When the first event is not at sample 0, a hold event for
   the *same* camera is prepended (`:588-590`). The output then has `[0, 0.3]` and `[0.3, 3]` on
   the same angle, which is a razor that changes nothing. `smoothEvents` can also leave two
   consecutive events on one camera after a splice, because it never merges them (read).
3. **An absolute threshold.** −50 dB RMS is a fixed level, so a quiet guest's mic and a loud
   host's mic need hand-tuned per-mic thresholds. The panel prints max, average and %-above per
   mic so the user can tune (`:744-747`). A level relative to each mic's own speech distribution
   would remove the tuning. See §6.1.
4. **One-mic podcasts are out of scope.** With a single mixed track, every speaker is "the same
   mic", and the result is one camera state, which it then refuses to write.
5. **No sync.** Angles and mics are assumed already aligned on the timeline.

None of these threaten the core idea: per-mic energy with hysteresis, and routing by tag sets.
That idea is sound and small.

## 5. Mapping to bay

**bay today (from the tree, not memory).** Tools (`src/shared/tools/`, 59 tool files besides
`index/fields/spec`): add_captions, add_comment, add_marker, add_subtitles, add_template,
add_track, add_transition, apply_dub, apply_script, browse_assets, delete_items, detach_audio,
detect_beats, detect_cuts, edit_asset, edit_item, estimate_speech, export_timeline,
fill_prompt_kit, find_highlights, frame_grid, generate_image, generate_speech, generate_video,
import_media, import_url, index_footage, inspect_item, list_projects, mark_highlights,
open_project, place_asset, plan_dub, preview_frame, propose_edit, read_brf, read_composition,
read_feedback, read_project, read_script, read_style, remove_marker, remove_range,
remove_transition, resolve_feedback, search_footage, search_styles, set_canvas, set_playhead,
split_at, track_dub, track_export, track_generation, transcribe, trim_item, undo, write_brf,
write_composition, write_style. Skills (`src/shared/skills.ts`): talking-head, captions,
short-form, lower-third, motion-graphics, opening-title, rough-cut, transitions, end-card,
chapters, highlights, dub, style-from-reference, review, launch-film. Styles
(`src/shared/styles/`): kinetic-typography, luxury-minimal, news-lower-thirds,
product-launch-film, retention-talking-head, ugc-ad.

Facts about bay that shape the designs:

- **`Item.disabled` already exists and has podclip's exact meaning.** It means "stays on the
  timeline, neither draws nor sounds" in preview, `preview_frame` and export alike, because all
  three read through `playableTimeline` (`src/shared/project.ts:537-542, 951-975`). The store can
  toggle it (`src/renderer/src/store/slices/editing.ts:140-146`), but **no agent tool sets it.**
- bay's ffmpeg build already requires `afftdn`, `arnndn` and `silencedetect`
  (`script/build-ffmpeg.sh:67`, pinned by `src/main/ffmpeg/capabilities.test.ts:201`), and **no
  code uses any of them** (`git grep`). The binaries needed for silence removal and denoise are
  already shipped.
- `src/main/media/waveform.ts` already decodes mono s16le at 8 kHz for peaks. A 50 ms RMS curve
  is the same decode with a different reduction, so no `astats` parsing is needed.
- `docs/research/editor-features.md` already lists silence and filler detection (#7) and noise
  reduction (#10) as tier-1 gaps. Scene detection (#8) has since shipped as `detect_cuts`.
- `src/main/vision/` is **SigLIP image/text embeddings only** (`index_footage`/`search_footage`,
  one frame per 2 s, `@shared/visual-search.ts:124`). There is **no face detector** anywhere in
  the tree.
- Placing a video puts its sound on A1 as a linked clip by default (CLAUDE.md, "A placed video's
  sound…"), and Overwrite clears the same span of A1. Three camera angles each carry scratch audio,
  so a multicam setup has to keep that scratch audio off the mic lanes. A podcast import flow has
  to handle this (read, not tested).

### 5.1 Feature by feature

Effort: S ≤ 2 days, M ≤ 1–2 weeks, L > 2 weeks. All are offline unless marked.

| Feature | bay has it? | (a) agent tool | (b) one-click UI | Deps | Effort | Risk |
|---|---|---|---|---|---|---|
| **Speaker auto-switch (multicam by mic)** | **No** | `switch_speakers` (write, dryRunnable), see §6.1 | Edit page › Timeline menu **"Auto-switch speakers…"**: a sheet with the tag grid pre-filled from track names, a coloured lane strip previewing the switch, and Apply as one undo step | none new: ffmpeg decode + a pure `@shared` decision function | **M** | Mic bleed and unbalanced gain (mitigated by relative thresholds). Angles must be synced first |
| **Angle / mic sync** | No | `sync_angles`: cross-correlate the 8 kHz envelopes of each angle's scratch audio against a reference mic (search ±N s, guess N=10), then move the items | "Sync by audio" in the same sheet, run before switching | none | **M** | False peaks on repetitive audio (music beds). Report the correlation peak ratio and refuse below a floor |
| **Set `disabled` from the agent** | UI only | add `disabled` to `edit_item` (or `enable_items`) | exists (toggle) | none | **S** | none; prerequisite for the above |
| **Silence removal** | No (the talking-head skill has the model eyeball gaps) | `find_silences` (read: spans from the RMS curve and/or `silencedetect`, plus word gaps from the `-ojf` transcript) + `remove_silences` (write, dryRunnable: one `edit()` removing spans last-first via the `remove_range` mapping, with padding) | **"Remove silences"** button with threshold / min-gap / padding sliders. The spans to be removed are shaded on the timeline before Apply | none (`silencedetect` already built) | **S–M** | Cutting breaths that carry meaning (padding default ~0.1 s, guess). Locked tracks drift, which `remove_range` already names |
| Filler removal ("um", "uh") | No | `find_fillers` from whisper tokens; feeds the same removal | checkbox in the same sheet | none | S | whisper often *omits* fillers from text. Measure recall before promising it |
| **Subtitles** | **Yes**: `add_subtitles` (5 designs), `add_captions`, `captions` skill | speaker-coloured subtitles once speaker segments exist (the colour per speaker from `switch_speakers` output) | exists | none | S (add-on) | none |
| **Clip extraction** | **Mostly**: `find_highlights` + `mark_highlights`, `highlights` / `short-form` skills | `make_clips`: take marked highlights → one new timeline per pick (bay supports several `timelines`), reframed 9:16, subtitled | **"Make 3 clips"**: runs the highlights skill, then shows 3 cards to accept/reject and export | none; reframing that follows a face needs §5.2 | **M** | Reframe without a face detector is a centre crop, which is wrong for off-centre framing |
| **Audio cleanup: noise** | No | `clean_audio`: render a derived asset with `afftdn` (or `arnndn` + a shipped RNNoise model) and swap it in as a linked source | **"Clean up voice"** on an audio clip | `arnndn` needs a model file: shipping one is fine, fetching one is a new network exception. `afftdn` needs nothing | **M** | Over-denoise artefacts. Preview can't run it live, hence a derived asset |
| **Audio cleanup: levelling** | Partial: export loudness mastering (`main/export/master.ts`, off by default), track faders, ducking | `level_voices`: per speaker clip, measure integrated loudness (`ebur128`) and set `item.volume` so every speaker lands at one target. It is a gain, so no new render | **"Balance speakers"** in the Audio page | none | **S** | Doesn't fix intra-clip dynamics. A compressor would be a derived render (`acompressor` is not in the required list yet) |
| **Chapters / timestamps** | **Partial**: `chapters` skill (transcribe → `add_marker`) | `export_chapters`: markers → YouTube "00:00 Title" text + mp4 chapter metadata on export | "Copy chapters" in Deliver | none | **S** | YouTube requires the first chapter at 00:00 and ≥3 chapters of ≥10 s. Validate in the tool |
| **Thumbnails** | Partial: `preview_frame`, `generate_image`, prompt kit `thumbnail-background` | `make_thumbnail`: pick candidate frames (sharp, eyes-open needs faces; without faces, highest SigLIP score for "person talking, expressive" is a guess) → a `.brf`/composition title over the still → export PNG | "Thumbnail" tab in Deliver | a face detector would help, but it is not required | **M** | Taste. Without faces, frame picks are weak |

### 5.2 One-mic podcasts: the part podclip cannot do

Podclip's premise is one mic per speaker. For one mixed track, "who is talking" needs a real
**diarization** or an **active-speaker** signal:

- **whisper.cpp stereo diarize (`-di`)** labels segments by which stereo channel is louder. That is
  podclip's trick again, and only for two-channel recordings. **Unverified** against bay's
  vendored whisper build.
- **tinydiarize (`-tdrz`)** emits speaker-*turn* tokens (no identity) and needs a dedicated
  `small.en-tdrz` model. English only. **Unverified.** Turns plus a "which of 2 speakers"
  clustering step would still be needed.
- **Speaker embeddings on onnxruntime-node** (already a bay dependency for SigLIP, in a utility
  process): VAD, then a per-segment embedding model, then clustering. Most robust, but it is a
  **new model download**, so a new entry under CLAUDE.md's network exceptions in the same shape
  as whisper/SigLIP (pinned repo, commit, size, SHA-256, only on explicit Download). **L.**
- **Face-based active speaker** (lip motion per detected face) also gives *where to crop* for
  9:16. That needs a face detector, which bay lacks. The cheapest local one on macOS is Apple's
  Vision framework (`VNDetectFaceRectanglesRequest`) through a small signed helper binary: no
  download, runs on the ANE. **Guess:** unmeasured here, and a new Mach-O must pass
  `script/release-signed`'s content checks. **L** for active speaker, **M** for faces alone.

Recommendation: ship the per-mic path first (§6.1). It is deterministic and has no model, and
podcasts recorded for video almost always have one mic per person. Treat single-mic diarization
as a separate, later project.

## 6. Designs

### 6.1 `switch_speakers`, bay's version of podclip

- **Pure core** `@shared/speaker-switch.ts`: `(curves: Float32Array[] at 20 Hz, angles:
  {trackId, shows: speakerIndex[]}[], opts) → Cut[]` in *timeline frames*. Keep podclip's
  latch/bleed/tag-set/debounce/min-shot rules (MIT, credited). Fix §4.1–4.2 by construction: no
  dead option, and events merged when consecutive events share a camera.
- **Relative thresholds** instead of −50 dB. Per mic, take the level distribution over the whole
  recording and threshold at the midpoint between its noise floor (p10) and speech level (p90).
  Keep a per-mic override. **Guess:** unmeasured, so prove it on a real two-mic podcast against
  hand-tuned podclip settings before switching the default.
- **Levels in main** (`media/levels.ts`, beside `waveform.ts`): the same 8 kHz s16le decode,
  reduced to RMS per 50 ms, cached by `cacheKey`. It maps item → source span with the item's
  speed, which podclip ignores.
- **Apply** in one `edit()`: `split_at` every angle track at each cut, then set `disabled` on the
  off segments. This is non-destructive (re-enable any clip), undoable, and shows up in the
  Changes card. Refuse, as podclip does, when the result is a single state. Say which mic never
  crossed its threshold and what its p90 was, so the message is a recovery instruction.
- **Tool args** name tracks by id (from `read_project`): `speakers: [{trackId, name}]`,
  `angles: [{trackId, shows: [name…]}]`, optional `wide: boolean`, `leadInFrames`,
  `minShotFrames`, `thresholdsDb`. The result lists the cuts per angle and a per-speaker
  screen-time share, which the agent can check against intent ("the guest is on screen 12%: check
  their mic").
- **Tests** (proven against the bug): a bleed specimen where the quiet mic is 5 dB under (must
  switch) beside one 7 dB under (must not); an overlap routed to the exact group angle beside one
  with no group angle (falls back to the loudest single); speed-changed clips.

### 6.2 Smart mode: detect the footage, then shape the palette

Goal: on import (or on "What is this?" in the Media page), classify the project's footage and
rearrange the tool palette, the agent's suggested actions and the page layout. Every signal
below is computable locally today, or with one small addition marked **new**.

**Signals** (per asset, then aggregated over the pool):

| Signal | Source in bay | Cost |
|---|---|---|
| Aspect, resolution, fps, duration | `probe.ts` → `Asset.width/height/durationUs` | free (import) |
| Audio channels | `Asset.channels` (`project.ts:56-59`) | free |
| Speech ratio = speech seconds / duration | `transcribe` cues (whisper, local) | seconds per minute of audio. Sample 3×60 s windows for speed |
| Distinct concurrent audio sources | count of audio assets whose durations are within 2% of one another and of a video (multi-mic recording) | free |
| Energy-overlap between mics | **new** `media/levels.ts` (§6.1): % of time ≥2 mics hot | a decode per file |
| Cut rate = cuts/min | `detect_cuts` (`scdet`, local) | ~real-time/10, guess |
| Music vs speech | `detect_beats` confidence + low speech ratio | a decode |
| Screen-recording look | SigLIP (`search_footage` text query "a computer screen, user interface, code editor") similarity on the sampled frames; plus fps often 30/60 exact and resolution matching common displays (2880×1800, 1920×1080 with no audio or with a mic-only track) | index cost, already optional |
| Face count | **none today.** SigLIP prompts "two people talking at a table, podcast studio" vs "one person talking to camera" are a stand-in. A real count needs Vision (§5.2) | — |

**Classes and thresholds.** All thresholds are **guesses** until measured on a labelled set of
~30 projects:

| Kind | Rule (first match wins) | Palette / layout change |
|---|---|---|
| **Podcast, multi-mic multicam** | ≥2 audio sources of ~equal length to ≥2 video assets of the same length (±2%), speech ratio > 0.6, mic overlap < 15% | Surface **Auto-switch speakers**, **Sync by audio**, **Balance speakers**, **Remove silences**, **Make 3 clips**, **Chapters**. Audio page mixer shows one strip per speaker named from track names. Suggested agent prompts: "Build the speaker cut" |
| **Podcast / interview, one mic** | 1 audio source, speech ratio > 0.6, SigLIP "two people" > "one person" | Same, minus Auto-switch. Offer it greyed with "needs one mic per speaker, or diarization (not yet)". This is a truthful affordance |
| **Talking head** | 1 video with its own audio, speech ratio > 0.6, cut rate < 1/min, duration > 60 s | **Remove silences / fillers**, **Add subtitles** (retention-talking-head style), `talking-head` skill, punch-in keyframes, **Make 3 clips** |
| **Screen recording** | SigLIP UI score top, speech ratio 0.2–0.9, cut rate ≈ 0, often no camera audio | Zoom-to-region keyframes, cursor-area crop, **Remove silences**, chapters, captions (clean style); hide grade-heavy tools |
| **B-roll pile** | ≥5 video assets, median duration < 30 s, speech ratio < 0.15 | `index_footage` prompt ("index these so I can search them"), `search_footage`, `detect_cuts`, beat-cut with music; Media page first; hide transcript tab |
| **Music video / montage** | a music asset (speech ratio < 0.1 **and** beat confidence high) + several video assets; or a supplied edit with cut rate > 15/min | `detect_beats`, snapping to beats on, transitions, grade and look tools forward; subtitles hidden |
| **Unknown** | nothing matches | today's default layout. Never guess loudly |

**How it changes the UI** without breaking bay's rules:

- The kind is a **suggestion stored on the project** (`project.kind?`, an additive optional field
  that needs no format bump), with a small chip in the top bar: "Looks like: podcast, 2 mics ·
  change". The user can always override it, and the override wins.
- It selects **which quick actions show** (a row above the timeline, the `aboveTimeline` slot in
  `editor/workspace/pageContent.tsx`) and **which skills are suggested** in the agent dock. It
  does not move or unmount the one `Preview`/`Timeline` (CLAUDE.md: rendered once, portalled).
- The agent gets the kind and its evidence in the system prompt's project summary ("classified as
  podcast-multicam because: 2 mic files of 58:12, 3 video files of 58:12, speech 0.81"), so it
  can say why it suggests something, and it can be wrong out loud.
- Detection runs in the background after import, cheapest signals first. A decision can be
  made from probe data alone for multicam podcasts and B-roll piles. Transcription and cuts only
  run when the cheap signals are ambiguous, and never download a model unless the user has
  already allowed it ("Download models when needed").

## 7. What to take, in order

1. **`disabled` in `edit_item`**: S. Unblocks everything below.
2. **`remove_silences` / `find_silences`**, with a button: S–M. Highest value per effort. Filters
   already shipped. Applies to talking heads, podcasts and screen recordings alike.
3. **`switch_speakers` + "Auto-switch speakers…"** (with `media/levels.ts`): M. Take podclip's
   decision rules (MIT, credit), fix the two measured defects, and use relative thresholds.
4. **`level_voices`** (gain-only speaker balance): S.
5. **`sync_angles`**: M. Needed before 3 for footage that isn't pre-synced, which is most real
   recordings.
6. **Smart mode**, probe-only classes first (multicam podcast, B-roll pile): M. Speech- and
   SigLIP-based classes after a labelled evaluation.
7. `clean_audio` (afftdn derived asset): M. `export_chapters`: S. Thumbnails, face detection and
   diarization: L, later, each with its own network or signing decision.
