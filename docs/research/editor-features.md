# Video editor features: the landscape, and where bay stands

Researched 2026-09-23. The matrix covers ten desktop editors (three pro NLEs, seven
prosumer/creator tools) and seven AI-native tools, with a **bay** column added to every table. The
prioritised gap list comes first because it is the part to act on. The matrix and sources it rests on
follow it.

## How the bay column was established

Every bay cell was checked against something in the tree. None was inferred from a guessed name
(CLAUDE.md: "a feature absent under the name you guessed is not an absent feature").

- **Tool catalog:** `src/shared/tools/*.ts`, 36 tool files. For example `trim_item` carries `mode: slip | slide | roll`,
  `delete_items` carries `ripple`, and `add_captions` accepts `srt`.
- **Store actions:** `EditorActions` in `src/renderer/src/store/types.ts` (`trimEdit`, `rippleDelete`, `addMarker`, `patchTrack`, …).
- **Model:** `Item`, `Track`, `Marker` and `Transition` in `src/shared/project.ts`. `speed` is one constant per
  item; `effectiveSpeed` maps anything non-positive to 1×, so reverse is not possible. `Layout` is static, so there
  are no keyframes. `Marker` is a single frame, with no range.
- **UI:** the running app, driven with agent-browser (see `ui-audit.md`), `lib/useKeyboard.ts` for
  shortcuts (no J/K/L and no I/O marks), and `ExportDialog.tsx` for formats (MP4/H.264, MOV, WebM/VP9, WAV,
  MP3, PNG sequence; no HEVC, ProRes or AV1; the range is always the whole timeline).
- **Skills:** `src/shared/skills.ts`. Talking-head editing removes pauses and retakes from the transcript, but no
  tool detects filler words or silence on its own.

Legend: `Y` present, `P` partial (the cell says what is missing), `N` absent.

## Where bay is already ahead or level

Several features rare elsewhere are fully built in bay: **slip/slide/roll** (5/10 editors),
**beat detection with snap-to-beat** (2/10), **loudness mastering verified on the encoded file**, **word-lit
animated subtitles** (7/10), **auto-ducking** (4/10), **HTML and code-driven motion graphics** (2/10: only
Resolve 21 and Shotcut 25.10 have anything like `.brf`), and **chat/agent editing with a
reviewable diff and one-step revert** (1/10 among desktop editors: only Descript Underlord). The gaps below are
mostly the ordinary features every editor has, not the unusual ones.

## Prioritised gap list

Columns:
- **Prev** is how many of the 10 desktop editors have the feature (a lower bound; see the matrix).
- **Value** is what a person editing gains.
- **Agent fit** is how naturally the feature becomes a tool whose result an agent can check without seeing the
  picture. bay's design rewards features whose state is data (fields, frames, numbers) and penalises ones that
  only work by hand-eye (a bezier handle, a lasso).
- **Effort** is a rough size given bay's architecture: **S** is under a day, **M** is days, **L** is a week or more
  and touches the model, the compositor, export and the UI, and **XL** is a subsystem.

### Tier 1: common, valuable, and a good fit (do these first)

| # | Gap | Prev | Value | Agent fit | Effort | Notes |
|---|---|---|---|---|---|---|
| 1 | **Keyframes on opacity, position/scale, rotation and volume** | 7/10 (volume 10/10) | Very high: fades between levels, push-ins, animated PiP, volume rides under dialogue | High: `keyframes: { opacity: [{ frame, value, ease }] }` is data an agent writes more reliably than it drags | L | Additive optional field on `Item`. A single sampling function has to be shared by the compositor, `preview_frame` and export, the same way `itemAudioGainAt` is shared, and audio automation belongs in that function too. The UI can start as a keyframe toggle per inspector field plus diamonds on the clip; a graph editor can come later. This is the largest gap between bay and every mid-tier editor. |
| 2 | **Freeze frame** | 9/10 | High | High (`freeze_frame { itemId, atFrame, durationInFrames }`) | S–M | Main extracts the frame to a still asset with ffmpeg, and the store places it, split at the playhead. No model change. |
| 3 | **Caption export (SRT/VTT)** and a sidecar on export | 8/10 | High for anything published | High | S | The cues already exist as text items or subtitle word timings; this only needs a serializer and a checkbox in the export form. |
| 4 | **Track solo** | 8/10 | Medium–high when judging a mix | High | S | Optional `Track.solo`; `itemsAtFrame` and the audio graph honour it. Put the button beside mute and give it the same aligned column (see `ui-audit.md`). |
| 5 | **In/out range: JKL shuttle, I/O marks, export a range** | JKL 6/10; range export is standard in every NLE | High for speed of review | High (`export_timeline { fromFrame, toFrame }`; the agent already reasons in half-open ranges from `remove_range`) | S–M | The export form's "Range: Whole timeline" row is a fixed label today. |
| 6 | **Range markers** | 8/10 | Medium (chapters, review notes, beats-to-cut) | High | S | Optional `Marker.durationInFrames`. The `chapters` and `review` skills would use it directly. |
| 7 | **Silence and filler detection as tools** | silence 6/10, filler 4/10 | High for talking-head work | Very high: returns ranges that feed `remove_range` | S–M | `silencedetect` in main, plus filler tokens from the whisper `-ojf` output bay already produces. The talking-head skill currently asks the model to eyeball gaps. |
| 8 | **Scene / shot-boundary detection** | 6/10 | High for long footage | Very high: gives the agent cut points it cannot see | S–M | ffmpeg `scdet`, or a histogram delta computed in main, returned as frames per asset like `beats`. |
| 9 | **Chroma key** | 10/10 | High | Medium (a key colour and tolerance are numbers; judging spill needs `preview_frame`) | M | Add a pass to the existing WebGL2 grade context: same path for preview and export, identity resolves to `null` as the grade already does. |
| 10 | **Noise reduction / speech enhance** | 10/10 / 7/10 | High | High (`clean_audio` renders a derived asset) | M | Offline in main: `afftdn`/`arnndn`, or a local model, writing a new asset. The preview can't run it live through Web Audio, and a derived asset avoids needing to. |
| 11 | **Frame analysis for the agent: scopes as numbers** | scopes 5/10 | Medium for people, high for the agent | Very high: luma histogram, clipping %, average colour and skin-tone line as tool output let the agent verify a grade it cannot see | M | UI scopes can come second. The agent needs this more than any person: a grade is currently checked by looking at a JPEG. |

### Tier 2: common, but larger or less central

| # | Gap | Prev | Value | Agent fit | Effort | Notes |
|---|---|---|---|---|---|---|
| 12 | Speed ramps and reverse | 6/10, 7/10 | Medium–high | High once keyframes exist (a speed curve is a keyframed field) | L | Reverse needs a decoded-frame path. `<video>` seeks backwards badly, so a reversed proxy rendered by main is the practical route. |
| 13 | Nested / compound clips | 8/10 | High on long projects | Medium: adds a level of indirection every tool has to address | L | Model change: a timeline as an asset. Every item walker and export path is affected. |
| 14 | Shape masks (rect/ellipse/feather) + point tracking | 6/10 | Medium–high | Medium: shapes are numbers, but tracking needs vision | L | The crop fields are the start of this. An ellipse with feather covers most blur-a-face and vignette-a-subject uses. |
| 15 | Stabilisation | 7/10 | Medium | High (derived asset, like #10) | M | `deshake` in main. vid.stab (`vidstabdetect`/`vidstabtransform`) is GPL and is not in bay's LGPL ffmpeg (`vendor/ffmpeg/README.md`); the LGPL `deshake` filter is, as are `afftdn`, `arnndn` (model not shipped), `silencedetect`, `scdet` and `chromakey`, so #7, #8 and #10 need no new binaries. |
| 16 | Export codecs: HEVC, ProRes 422/4444 (alpha), AV1; a render queue | 7/10, 6/10, 3/10, 6/10 | Medium (ProRes and alpha matter for handoff) | High | S–M each | Mostly ffmpeg arguments, plus a check of the PNG-sequence alpha path. |
| 17 | FCPXML / OTIO export | 4/10 | High for this user specifically: the notes say Resolve can't be scripted from here, and an FCPXML import into Resolve is how an agent-built cut reaches a grading suite | High | M | `read_script` already linearises the timeline. An interchange writer is the same walk. |
| 18 | Curves UI (grade curves exist in the model, reachable only through `edit_item`) | 6/10 | Medium | n/a (the agent already has them) | M | A small curve editor in the Grade section. The model is in place. |
| 19 | EQ / compressor per clip | 9/10 | Medium | High (bands are numbers) | M | Needs one gain/EQ function shared by preview (BiquadFilter) and export (ffmpeg `equalizer`), as with the gain curve, or the two paths will diverge. |
| 20 | Proxies for 4K/HEVC sources | 6/10 | Medium–high on real footage | Low (invisible to the agent) | M–L | A transcode in main into the version-and-sweep cache, like posters. |
| 21 | Customisable shortcuts; command palette | 7/10, 2/10 | Medium | Low | M | The composer's `/` menu is already half a command palette. |

### Tier 3: rare, large, or against bay's principles

| # | Gap | Prev | Why it is here |
|---|---|---|---|
| 22 | Natural-language media search | 4/10 (all three pro NLEs, on-device) | Very high agent fit ("find the shot of the umbrella"), but it needs a local vision/text embedding model. Earlier work found SigLIP-on-Candle feasible (see memory: *Vision + stock search*). **XL.** |
| 23 | Auto reframe with subject tracking | 5/10 | `set_canvas` already refits cover/contain. Following a subject needs detection. **L.** |
| 24 | Multicam, magnetic timeline | 5/10, 8/10 | Magnetic is a design stance rather than a feature; bay's explicit tracks and `remove_range` sync story is the opposite choice, taken on purpose. Multicam is **L**. |
| 25 | TTS, voice clone, dubbing, music/clip generation, generative extend | 1–6/10 | Every one needs a model or a network. The product rule is that nothing reaches the network except whisper downloads the user asked for, so each one is a product decision before it is an engineering task. |
| 26 | Cloud projects, review, multi-user | 4–6/10 | Local-only by design. A review link would need a server. |
| 27 | Eye contact, face retouch | 1–2/10 | Rare, model-heavy, and ethically loaded. |

### What the AI-native tools suggest for bay specifically

1. **Publish the property scope the agent can change.** Kapwing does this [KAP-RN]. bay's tool catalog is that
   list already, and generating a user-facing "what the agent can do" page from it would show users where bay
   is ahead.
2. **Script-to-timeline is going mainstream** (Resolve IntelliScript, Premiere 26.5 Paper Edit). bay has
   `read_script`/`apply_script` and the rough-cut skill but no UI that shows a transcript as an editable document.
   A transcript view that runs through `apply_script` would be the most visible feature to borrow.
3. **Semantic search is the primitive that B-roll placement depends on** (#22). Without it, an agent picking
   B-roll is picking by filename.

---

## The matrix

### Reading the matrix

- **The versions have moved past the brief.** DaVinci Resolve **21** shipped 2026-06-02 [R21-NS],
  Premiere dropped "Pro" and is at **26.5** (September 2026) [PR265], and Final Cut Pro is at
  **12.3** (July 2026) [FCP-NEW]. The tables use the current versions and note where a feature
  arrived in Resolve 20 or FCP 11.
- **Cell legend:**
  - `Y`: verified this session from a cited source.
  - `Y*`: long-standing, widely documented, and not re-fetched this session. Very likely right, but not individually checked.
  - `P`: partial.
  - `$`: paid tier only (for example Resolve Studio, CapCut Pro).
  - `N`: absent as far as the sources show.
  - `?`: unverified. Treat it as unknown, not as no.
- **Prevalence** counts `Y`, `Y*`, `P` and `$` over the 10 editors in the table. `?` does not count, so every prevalence figure is a lower bound.
- **Column keys:**
  - `Res` = DaVinci Resolve 20/21
  - `PrP` = Premiere 25/26
  - `FCP` = Final Cut Pro 11/12
  - `CapC` = CapCut desktop
  - `Desc` = Descript
  - `Cam` = Camtasia 2026
  - `iMov` = iMovie for Mac
  - `Clip` = Clipchamp
  - `Shot` = Shotcut 25.x
  - `Kden` = Kdenlive 25/26
- **CapCut sources were partly unreachable.** capcut.com returned HTTP 451 to the fetcher, so the CapCut column rests on search-result extracts [CC-S1][CC-S2] and third-party reviews. Treat CapCut `Y` cells with more caution than the others.

---

### 1. Editing and trim tools

| Feature | Res | PrP | FCP | CapC | Desc | Cam | iMov | Clip | Shot | Kden | Prev | **bay** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Razor / split at playhead | Y* | Y* | Y* | Y* | Y* | Y* | Y* | Y* | Y* | Y* | 10/10 | Y (`split_at`, S) |
| Ripple trim / ripple delete | Y* | Y* | Y* (magnetic) | Y* (main track) | Y* (text deletes ripple) | Y* | Y* | Y* | Y [SH-F] | Y* | 10/10 | Y (`delete_items ripple`, Shift+Del, `remove_range`) |
| Roll edit | Y* | Y* | Y* | N? | ? | N? | N | N | Y* | Y* | 5/10 | Y (`trim_item mode:roll`, Alt-drag) |
| Slip | Y* | Y* | Y* | ? | ? | N? | N | N | Y* | Y* | 5/10 | Y (`trim_item mode:slip`) |
| Slide | Y* | Y* | Y* | ? | ? | N? | N | N | ? | Y* | 4/10 | Y (`trim_item mode:slide`) |
| 3-point / 4-point edits | Y* | Y* | Y* | N? | N | N | N | N | Y (3-pt) [SH-F] | Y* | 5/10 | N |
| Insert / overwrite from source viewer | Y* | Y* | Y* | P | N | N | P | N | Y* | Y* | 7/10 | N (no source viewer) |
| Lift / extract | Y* | Y* | Y* | P | P | P | N | P | Y* | Y* | 8/10 | Y (Delete / `remove_range`) |
| Paper edit (assemble from transcript selections) | Y (IntelliScript) [R20-G] | Y (26.5 Paper Edit) [PR265] | N | ? | Y* | P (Audiate) [CAM-N] | N | N | N | N | 4/10 | P (agent: `transcribe` + `read_script`/`apply_script`) |

Pattern: roll, slip and slide and 3/4-point edits are what separate the pro NLEs, Shotcut and Kdenlive from the creator tools. The creator tools replace them with a magnetic main track and trimming by text.

### 2. Timeline

| Feature | Res | PrP | FCP | CapC | Desc | Cam | iMov | Clip | Shot | Kden | Prev | **bay** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Multi-track video + audio | Y* | Y* | P (trackless + lanes/roles) [FCP-SPEC] | Y [CC-S1] | Y (multitrack) [DESC] | Y [CAM-F] | P (1 main + overlay) | Y* | Y [SH-F] | Y* | 10/10 | Y |
| Magnetic / auto-ripple main track | P (cut page) | N | Y [APL-NR] | Y* | Y* | Y* (magnetic tracks) | Y* | Y* | P (ripple mode) | N | 8/10 | N |
| Snapping | Y* | Y* | Y* | Y* | Y* | Y* | Y* | Y* | Y* | Y* | 10/10 | Y (edges, playhead, markers, beats) |
| Markers (with ranges) | Y* | Y* | Y* | Y* | Y* | Y* | N | N | Y* | Y (ranges, 25.12) [KD-WN] | 8/10 | P (point markers only) |
| Nested / compound clips | Y* | Y* (nested seq) | Y* (compound) | Y* | P (compositions) | Y* (groups) | N | P (group) | N | Y* (sequences) | 8/10 | N |
| Track lock / mute / solo | Y* | Y* | P (no lock; role solo) | P | P | Y* | N | P | Y* | Y (additive solo 26.08) [KD-WN] | 8/10 | P (lock, mute, hide; no solo) |
| Linked A/V | Y* | Y* | Y* | Y* | Y* | Y* | Y* | Y* | P | Y* | 10/10 | Y (one item carries both; J/L cuts) |
| Multicam | Y + AI SmartSwitch [R20-NS] | Y* | Y (64 angles) [FCP-SPEC] | ? | P (multicam layouts) | N | N | N | N | Y* | 5/10 | N |
| OTIO / XML interchange | Y* | Y* | Y* (FCPXML) | N | N | N | N | N | N | Y (OTIO, 25.04) [KD-WN] | 4/10 | N |

### 3. Audio

| Feature | Res | PrP | FCP | CapC | Desc | Cam | iMov | Clip | Shot | Kden | Prev | **bay** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Waveforms on timeline | Y* | Y* | Y* | Y* | Y* | Y* | Y* | Y* | Y [SH-F] | Y [KD-WN] | 10/10 | Y |
| Keyframed volume | Y* | Y* | Y* | Y* | P | Y* | Y* | P | Y* | Y* | 10/10 | N (level + fades only) |
| Fades (handles) | Y* | Y* | Y* | Y* | Y* | Y* | Y* | Y* | Y* | Y* | 10/10 | Y (frames, inspector + Effects presets) |
| Mixer / busses | Y (Fairlight) | Y* (submixes) | P (roles, no busses) | N | N | N | N | N | Y (mixer) [SH-F] | Y (mixer) [KD-WN] | 5/10 | N |
| Noise reduction | Y* | Y [PR-AI] | Y* | Y* | Y (Studio Sound) [DESC] | Y [CAM-F] | Y [IM-A] | Y [CLIP] | Y [SH-F] | Y* | 10/10 | N |
| AI voice isolation / speech enhance | $ (Voice Isolation, Studio) | Y (Enhance Speech) [PR-AI] | Y [APL-NR] | ? | Y [DESC] | Y [CAM-F] | P | Y (noise remover) [CLIP] | N | N | 7/10 | N |
| Loudness normalisation | Y* | Y* (auto-match) | P | ? | Y* | Y (levelling/normalise) [CAM-F] | P (boost) [IM-A] | ? | Y (loudness scope + filter) [SH-F] | Y* | 7/10 | Y (export mastering, measured on the encoded file) |
| Auto ducking | Y* + AI Audio Assistant [R20-NS] | Y [PR-AI] | N? | ? | Y* | N? | Y* | N? | N | N | 4/10 | Y (`duck`, keyed on a track) |
| EQ / compression | Y* | Y* | Y* | P | P | P | Y (EQ presets) [IM-A] | N | Y [SH-F] | Y* | 9/10 | N |
| Beat detection | ? | N? (Remix retimes music instead) [PR-AI] | Y (12.0) [FCP12] | Y* (auto beat marks) | N | N | N | N | N | N | 2/10 | Y (`detect_beats`, snap-to-beat) |
| Music retiming / remix | Y* (AI Music Remixer) | Y (Remix) [PR-AI] | N | ? | N | N | N | N | N | N | 2/10 | N |
| Automatic mix (level, de-ess, fades) | Y (AI Audio Assistant) [R20-NS] | P | N | N | P (Studio Sound) | P | N | N | N | N | 4/10 | N |

### 4. Colour

| Feature | Res | PrP | FCP | CapC | Desc | Cam | iMov | Clip | Shot | Kden | Prev | **bay** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Colour wheels | Y* | Y* (Lumetri) | Y* | P | N | N | N | N | Y (3-way) [SH-F] | Y* | 6/10 | Y (lift/gamma/gain; inspector = master only) |
| Curves | Y* | Y* | Y [FCP-SPEC] | Y* | N | N | N | N | Y* | Y* | 6/10 | P (agent `edit_item.grade` only; no UI) |
| LUTs | Y* | Y* | Y* | Y* | ? | Y* | N | P (filters) | Y [SH-F] | Y* | 8/10 | Y (.cube assets) |
| Scopes | Y* | Y* | Y* | ? | N | N | N | N | Y [SH-F] | Y* | 5/10 | N |
| HDR | Y* | Y (ACEScct, auto SDR/HDR) [PR252] | Y* | ? | N | N | P | N | N | P (10-bit, 25.12) [KD-WN] | 5/10 | N |
| Colour match | Y* (Shot Match) | Y* (Lumetri match) | Y (AI Match Color, 12.3) [FCP-NEW] | ? | N | N | N | N | N | N | 3/10 | N |
| Auto colour | Y* | Y (Auto Color) [PR-AI] | Y (Enhance Light & Color) [APL-NR] | Y* | N | N | Y* | Y* (enhancer) [CLIP] | N | N | 6/10 | N |
| Node-based grading | Y (incl. new Photo page) [R21-NS] | N | N | N | N | N | N | N | N | N | 1/10 | N |

### 5. Effects, transitions, compositing

| Feature | Res | PrP | FCP | CapC | Desc | Cam | iMov | Clip | Shot | Kden | Prev | **bay** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Library size | very large (Fusion + OFX) | large; +90 Film Impact (26.0) [PVC-26] | 300+ effects/transitions/generators [FCP-SPEC] | large + template store | small | 150 transitions [CAM-F] | small | medium | 25+ audio filters, many video [SH-F] | large (MLT/frei0r) | n/a | 7 transitions, 8 adjustments, 16 blend modes, grade, 7 templates, `.brf`/HTML |
| Blend modes | Y* | Y* | Y* | Y* | ? | ? | N | ? | Y* | Y* | 6/10 | Y (16) |
| Chroma key | Y* | Y* | Y* (Keyer) | Y [CC-S1] | Y (AI green screen) [DESC] | Y* | Y [IM-GS] | Y [CLIP] | Y [SH-F] | Y* | 10/10 | N |
| AI background removal (no green screen) | Y* ($ Magic Mask) | Y (Object Mask) [PR26] | Y (Magnetic Mask) [APL-NR] | Y (Auto Cutout) [CC-S1] | Y [DESC] | Y* | N | P (images only) [CLIP] | N | Y (SAM2 plugin) [KD-SEG] | 8/10 | N |
| Node / multi-layer compositing | Y (Fusion) | P (AE via Dynamic Link) | P (Motion) | N | N | N | N | N | N | N | 3/10 | P (tracks + blend + HTML/`.brf`) |
| Lottie / HTML graphics | Y (Resolve 21) [R21-WN] | N? | N | N | N | N | N | N | Y (Lottie/Rive; HTML in 25.10) [SH-F][SH-2510] | ? | 2/10 | Y (HTML compositions, `.brf` JSX modules) |

### 6. Titles and captions

| Feature | Res | PrP | FCP | CapC | Desc | Cam | iMov | Clip | Shot | Kden | Prev | **bay** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Title templates | Y* | Y* (MOGRT) | Y* | Y* | Y [DESC] | Y* | Y* | Y* | Y* | Y (revamped titler) [KD-WN] | 10/10 | Y (Templates panel, `add_template`) |
| Auto captions / transcription | Y (Studio for adv. engine) [R-TX] | Y (18+ langs) [PR-AI] | Y (FCP 11; 12.3 Generate Captions) [APL-NR][FCP-NEW] | Y [CC-S1] | Y [DESC] | Y [CAM-F] | N | Y (80+ langs) [CLIP] | Y (whisper.cpp) [SH-2510] | Y (Whisper/VOSK) [KD-STT] | 9/10 | Y (local whisper.cpp) |
| Animated (word-highlight) captions | Y (AI Animated Subtitles, R20) [R20-G] | P | P (12.3, "customise for social") [FCP-NEW] | Y* | Y* | Y (dynamic captions) [CAM-F] | N | Y* | P (typewriter burn-in) [SH-2510] | N | 7/10 | Y (`add_subtitles`, 5 designs) |
| Caption translation | ? | Y (27 langs) [PR252] | N | Y* | Y [DESC] | Y (7 langs) [CAM-F] | N | ? | N | P (Whisper translate) [KD-STT] | 5/10 | N |
| SRT import / export | Y* | Y* | Y* | P ($ export?) | Y* | Y* | N | ? | Y* | Y* | 8/10 | P (import via `add_captions srt`; no export) |

### 7. Speed and retiming

| Feature | Res | PrP | FCP | CapC | Desc | Cam | iMov | Clip | Shot | Kden | Prev | **bay** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Constant speed | Y* | Y* | Y* | Y [CC-S1] | Y* | Y* | Y [IM-S] | Y* | Y* | Y* | 10/10 | Y (0.1-8x) |
| Speed ramps / curves | Y* | Y* (time remap) | Y* | Y (speed curves) [CC-S1] | N? | N? | N | N | Y (speed ramping) [SH-F] | P | 6/10 | N |
| Reverse | Y* | Y* | Y* | Y* | ? | ? | Y* | N? | Y [SH-F] | Y* | 7/10 | N (speed must be > 0) |
| Freeze frame | Y* | Y* | Y* | Y* | Y* | Y* | Y* | ? | Y [SH-F] | Y* | 9/10 | N |
| Optical flow / AI frame interpolation | Y* ($ Speed Warp) | Y* | Y (Smooth Slo-Mo) [APL-NR] | Y* | N | N | N | N | ? | ? | 4/10 | N |

### 8. Keyframing

| Feature | Res | PrP | FCP | CapC | Desc | Cam | iMov | Clip | Shot | Kden | Prev | **bay** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Keyframe almost any property | Y (dedicated keyframe editor R20) [R20-NS] | Y* | Y [FCP-SPEC] | Y [CC-S1] | P | P (animations/behaviours) | N | N | Y (easing) [SH-F] | Y* | 7/10 | N (static layout; motion only inside `.brf`/HTML) |
| Easing / bezier graph | Y (curve view; loop/pingpong ease R21) [R21-NS] | Y* | P | P (presets) | N | P | N | N | Y (easing functions) [SH-F] | Y* | 6/10 | N (only inside `.brf`: `interpolate`, `spring`, `Easing`) |

### 9. Masks and tracking

| Feature | Res | PrP | FCP | CapC | Desc | Cam | iMov | Clip | Shot | Kden | Prev | **bay** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Shape masks | Y* (Power Windows) | Y (redesigned, 20x faster tracking) [PVC-26] | Y* | Y* | N | P | N | N | Y [SH-F] | Y* | 6/10 | N (crop only) |
| Point / planar tracking | Y* (both, Fusion/Color) | P (mask tracking; planar in AE) | P (object tracker, point) | Y (motion tracking) [CC-S1] | N | N | N | N | P (tracker for stabilisation) [SH-F] | P | 6/10 | N |
| AI object mask / rotoscoping | $ (Magic Mask v2) [R20-NS] | Y (Object Mask 26.0; Sharp/Smooth 26.5) [PR26][PR265] | Y (Magnetic Mask 11; Auto Mask 12.3) [APL-NR][FCP-NEW] | Y (Auto Cutout) | Y (green screen) | ? | N | N | N | Y (SAM2) [KD-SEG] | 6/10 | N |
| Face / beauty AI | Y (R21 face enhancement) [R21-WN] | N | N | Y (retouch) [CC-S1] | N | N | N | N | N | N | 2/10 | N |

### 10. Stabilisation

| Feature | Res | PrP | FCP | CapC | Desc | Cam | iMov | Clip | Shot | Kden | Prev | **bay** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Stabilisation | Y* | Y* (Warp Stabilizer) | Y* | Y [CC-S1] | N | N | Y (+ rolling shutter) [IM-S] | N? | Y [SH-F] | Y* | 7/10 | N |

### 11. Proxies and performance

| Feature | Res | PrP | FCP | CapC | Desc | Cam | iMov | Clip | Shot | Kden | Prev | **bay** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Proxy editing | Y* | Y* | Y [APL-NR] | Y* | N (cloud) | N | N | N | Y [SH-F] | Y* | 6/10 | N |
| Render cache / previews | Y* (Smart Cache) | Y* (render previews) | Y* | ? | N | N | Y* | N | N | Y* (preview render) | 5/10 | P (poster/waveform cache; no render cache) |
| Background render | Y* | P (via Media Encoder) | Y* | ? | N | N | Y* | N | N | P | 5/10 | N |
| GPU accel (decode/effects) | Y* | Y (Blackwell 4:2:2 decode 26.5) [PR265] | Y (Metal) [FCP-SPEC] | Y* | ? | Y* | Y* | ? | Y [SH-F] | P | 8/10 | Y (WebGL2 grade, canvas compositor, HW decode via Chromium) |
| 10-bit / float pipeline | Y* | Y* | Y* | ? | ? | ? | N | N | ? | Y (25.12) [KD-WN] | 4/10 | N (8-bit canvas) |

### 12. Export

| Feature | Res | PrP | FCP | CapC | Desc | Cam | iMov | Clip | Shot | Kden | Prev | **bay** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Social-platform presets / direct publish | Y* | Y* | Y* (+ Smart Conform) [APL-NR] | Y* | Y* | Y* | Y* | Y* | P | P | 10/10 | P (9:16, 1:1, 16:9, 4K canvas presets; no publish) |
| ProRes | Y* (Mac; Win $?) | Y* | Y [FCP-SPEC] | ? | N | N | Y* | N | Y (FFmpeg) | Y (FFmpeg) | 6/10 | N (MOV container, codec not ProRes) |
| H.265 / HEVC | Y* | Y* | Y* | Y* | ? | ? | Y* | N? | Y | Y | 7/10 | N |
| AV1 | Y* (HW) | ? | N? | ? | N | N | N | N | Y (FFmpeg) | Y (FFmpeg) | 3/10 | N |
| Alpha channel output | Y* | Y* | Y* (ProRes 4444) | ? | N | N | N | N | Y* | Y* | 5/10 | P (PNG sequence) |
| Batch / render queue | Y* | Y* (Media Encoder) | P (Compressor) [APL-NR] | N | N | P | N | N | Y [SH-F] | Y* | 6/10 | N (one export at a time) |
| Audio-only export | Y* | Y* | Y* | Y* | Y* | Y* | Y* | P | Y* | Y* | 10/10 | Y (WAV, MP3) |
| Up to 4K | Y* | Y* | Y* | Y* | Y (4K) [DESC] | Y (4K60 rec) [CAM-F] | Y* | Y* ($ for 4K) | Y* | Y* | 10/10 | Y |

### 13. Templates, collaboration, shortcuts

| Feature | Res | PrP | FCP | CapC | Desc | Cam | iMov | Clip | Shot | Kden | Prev | **bay** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Whole-project templates | P (Fusion titles) | P (MOGRT) | P (themes, 12.3 Creator content) [FCP-NEW] | Y* (huge store) | Y (AI-directed templates) [DESC] | Y [CAM-F] | Y* (trailers) | Y* | N | N | 8/10 | P (agent skills: talking-head, short-form, rough-cut ...) |
| Cloud projects | Y (Blackmagic Cloud) [R21-WN] | Y* (Team Projects / Productions) | N | Y* | Y* | Y (Camtasia Online) [CAM-N] | N | Y* (OneDrive) | N | N | 6/10 | N (local-only by design) |
| Review / comments | Y* | Y (Frame.io V4 panel) [PVC-26] | N | ? | Y [DESC] | Y (Screencast) [CAM-F] | N | ? | N | N | 4/10 | N |
| Real-time multi-user | Y (Blackmagic Cloud collaboration) [R21-WN] | P | N | ? | Y [DESC] | Y [CAM-F] | N | N | N | N | 4/10 | N |
| Customisable shortcuts | Y* | Y* | Y* (Command Editor) | P | P | Y* | N | N | Y [SH-F] | Y* | 7/10 | N |
| JKL shuttle | Y* | Y* | Y* | ? | ? | ? | Y* | ? | Y* | Y* | 6/10 | N (Space, arrows, Home/End) |
| Command palette / action search | ? | N | N | N | Y* | N | N | N | Y (quick action search) [SH-F] | Y* (Ctrl+Shift+Space? unverified) | 2/10 | P (composer `/` skills, `@` pins) |

---

### 14. AI features: pro and creator editors

| Feature | Res | PrP | FCP | CapC | Desc | Cam | iMov | Clip | Shot | Kden | Prev | **bay** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Text-based editing | Y [R-TX] | Y [PR-AI] | N (transcript search only) [FCP12] | Y* | Y [DESC] | Y (free via Audiate, 2026) [CAM-N] | N | N | N | N | 5/10 | P (agent-driven; no transcript editor UI) |
| Filler-word removal | N [R-TX] | Y [PR-AI] | N | Y* | Y [DESC] | Y [CAM-N] | N | N | N | N | 4/10 | P (talking-head skill: pauses/retakes; no filler detector) |
| Silence removal | P (on assembly) [R-TX] | Y* (pauses in TBE) | N | Y* | Y* | Y [CAM-N] | N | Y (>3s) [CLIP] | N | N | 6/10 | P (skill + `remove_range`; no detector) |
| Eye-contact correction | N | N | N | ? | Y [DESC] | N | N | N | N | N | 1/10 | N |
| Auto reframe | $ (Smart Reframe) | Y [PR-AI] | Y (Smart Conform) [APL-NR] | Y [CC-S1] | Y* (layouts) | N | N | N | N | N | 5/10 | P (`set_canvas` refits cover/contain; no subject tracking) |
| Scene / edit detection | Y* | Y [PR-AI] | Y (Edit Detection 12.3) [FCP-NEW] | Y* | Y* | N | N | N | N | Y* | 6/10 | N |
| Natural-language media search | Y (IntelliSearch R21) [R21-WN] | Y (Media Intelligence) [PR252] | Y (Visual + Transcript Search 12.0) [FCP12] | Y (Smart Search) [CC-S1] | ? | N | N | N | N | N | 4/10 | N |
| Generative extend | N | Y (Firefly; 360p-4K in 26.5) [PR252][PR265] | N | ? | N | N | N | N | N | N | 1/10 | N |
| Generate clips / SFX in timeline | N | Y (Generative Media tool 26.5) [PR265] | N | Y (Seedance video gen) [CC-S2] | Y (video gen) [DESC] | P (avatars) [CAM-F] | N | N | N | N | 4/10 | N |
| B-roll suggestion | N | P (search only) | P (search only) | ? | Y (Underlord) [UL] | N | N | N | N | N | 3/10 | N |
| TTS | Y (Speech Generator R21) [R21-NS] | ? | N | Y [CC-S1] | Y [DESC] | Y (ElevenLabs voices) [CAM-N] | N | Y (400 voices) [CLIP] | Y (25.10) [SH-2510] | N | 6/10 | N |
| Voice clone / convert | Y (Voice Convert R20; 10s voice R21) [R20-G][R21-NS] | N | N | ? | Y (+ Regenerate lip-matched) [DESC] | ? | N | N | N | N | 2/10 | N |
| Dubbing / translation | N? | P (captions only) | N | ? | Y (30+ langs) [DESC] | Y (7 langs) [CAM-F] | N | N | N | N | 3/10 | N |
| Music generation | N | P (SFX generation) [PR265] | N | ? | ? | N | N | N | N | N | 1/10 | N |
| Highlight / clip extraction | N | N | N | Y* | Y (Create Clips) [DESC] | N | N | P (Auto Compose) [CLIP] | N | N | 3/10 | P (short-form skill) |
| AI agent / chat editing | N | N? | N | ? | Y (Underlord, agentic) [UL] | N | N | N | N | N | 1/10 | Y (in-app agent + MCP, Changes card/Revert) |
| Script-to-timeline assembly | Y (IntelliScript) [R20-G] | Y (Paper Edit) [PR265] | N | ? | Y [UL] | N | N | N | N | N | 3/10 | P (rough-cut skill, `apply_script`) |
| Auto multicam switching | Y (SmartSwitch) [R20-NS] | N | N | N | Y* (Automatic multicam) | N | N | N | N | N | 2/10 | N |

### 15. AI-native tools

Columns:
- `UL` = Descript Underlord
- `Rwy` = Runway (Aleph 2.0)
- `Opus` = OpusClip
- `Kap` = Kapwing (Kai)
- `VEED` = VEED
- `Cap` = Captions, now Mirage
- `FfVE` = Adobe Firefly video editor (web, beta)

| Feature | UL | Rwy | Opus | Kap | VEED | Cap | FfVE | Prev |
|---|---|---|---|---|---|---|---|---|
| Chat / agent editing of a timeline | Y [UL] | P (prompt edits a clip) [RWY] | N | Y (Kai sidebar) [KAP-A][KAP-RN] | ? | Y (chat-based editor) [CAP] | P (prompt edits) [FF-CG] | 5/7 |
| Text-based editing | Y [DESC] | N | P | Y* | Y* | Y* | Y (transcript nav) [FF] | 5/7 |
| Filler / silence removal | Y [UL] | N | Y* | Y (Smart Cut) [KAP-A] | Y* | Y* | ? | 5/7 |
| Eye contact | Y [UL] | N | N | ? | Y [VEED-EC] | Y (per-shot) [CAP] | N | 3/7 |
| Auto reframe with speaker tracking | Y* | N | Y [OPUS] | Y* | Y* | Y* | ? | 5/7 |
| Highlight extraction / virality score | Y (Create Clips) | N | Y (ClipAnything + score) [OPUS] | Y* | Y* | Y* | N | 5/7 |
| AI B-roll | Y [UL] | N | Y (stock or generated) [OPUS] | Y* | Y* | Y* | Y (generate from frame) [FF] | 6/7 |
| Dubbing with lip-sync | Y (30+) [DESC] | N | ? | Y* | Y (29 langs, lipsync) [VEED-DUB] | Y (30+) [CAP] | ? | 4/7 |
| Voice clone / TTS | Y [DESC] | ? | N | Y* | Y* | Y* | ? | 4/7 |
| Generative in-shot edit (restyle, replace object, new angle) | N | Y (Aleph: one frame propagated, 10 cuts, 30s 1080p) [RWY] | N | P | ? | ? | Y (Firefly + partner models) [PVC-26] | 3/7 |
| Soundtrack / SFX generation | ? | ? | N | Y (routing to music models) [KAP-RN] | ? | Y (music) [CAP] | Y [FF] | 3/7 |
| Multi-track timeline underneath | Y | N | P | Y | Y | Y | Y [FF-TL] | 6/7 |

---

### 16. Notable agent-first and AI-native patterns

1. **The agent is a co-editor inside the timeline, not a separate generator.** Underlord is described as "agentic" and acts on your behalf across cleanup, enhancement and repurposing [UL][DESC-S6]. Descript added a model picker that includes Claude Sonnet 4.5 [UL-2026]. Kapwing's Kai edits "across entire projects" from a sidebar chat, "while you stay in control of every edit" [KAP-A]. Its May 2026 notes list which properties Kai can touch (brightness, blur, filters, layers, audio fades, background removal) and say it now takes 10+ attached media per chat [KAP-RN]. Captions/Mirage offers editing "completely through text prompts" [CAP]. The pattern is chat plus a visible, undoable timeline, and the tools publish the scope of properties the agent can change.
2. **The transcript is the edit surface, and script-to-timeline is going mainstream.** Descript and Camtasia/Audiate edit video by editing text, and Camtasia made this free in 2026 [CAM-N]. Pro NLEs have now adopted "assemble from the script": Resolve's IntelliScript matches takes to a script [R20-G], and Premiere 26.5 added Paper Edit [PR265]. Most tools stop at filler-word and silence removal, and Resolve still has no filler detection [R-TX].
3. **Semantic search of the footage is now standard in the pro NLEs.** Premiere has Media Intelligence (local, natural language) [PR252], FCP 12 has Visual + Transcript Search [FCP12], and Resolve 21 has IntelliSearch [R21-WN]. All three index on-device. For an agent this is the "find the shot" primitive that B-roll placement depends on.
4. **One-click AI masks have replaced rotoscoping everywhere, open source included.** Premiere has Object Mask [PR26], FCP has Magnetic Mask and Auto Mask [APL-NR][FCP-NEW], Resolve has Magic Mask v2 [R20-NS], and Kdenlive has a SAM2 plugin [KD-SEG]. Kdenlive's plugin shows the capability can ship locally with open weights.
5. **Generation is placed on the timeline, not in a separate app.** Premiere's Generative Extend and 26.5's Generative Media tool generate video and SFX in the sequence and attach Content Credentials [PR252][PR265]. Firefly's web editor generates new scenes "from any frame" [FF]. Runway Aleph applies an edit made to one frame across the whole shot and preserves what was not asked to change [RWY]. Provenance and "edit one frame, propagate" are the emerging contracts.
6. **Code and markup graphics formats are entering the NLE.** Resolve 21 imports Lottie (`.json`/`.lottie`) and HTML graphics [R21-WN]. Shotcut 25.10 renders image/video from HTML and supports Lottie/Rive through Glaxnimate [SH-2510][SH-F]. This is directly relevant to bay's `.brf` and HTML compositions: two mainstream editors now treat web and vector animation formats as first-class media.

---

## Sources

- [R20-G] Blackmagic, DaVinci Resolve 20 New Features Guide (PDF): https://documents.blackmagicdesign.com/SupportNotes/DaVinci_Resolve_20_New_Features_Guide.pdf
- [R20-NS] Newsshooter, Resolve 20 announced / final: https://www.newsshooter.com/2025/04/04/blackmagic-design-davinci-resolve-20-announced-with-100-new-features-including-ai-enhancements/ · https://www.newsshooter.com/2025/05/27/davinci-resolve-20-final-release/
- [R21-WN] Blackmagic, What's New (Resolve 21): https://www.blackmagicdesign.com/products/davinciresolve/whatsnew
- [R21-NS] Newsshooter, Resolve 21 final (2026-06-02): https://www.newsshooter.com/2026/06/02/davinci-resolve-21-final-release/ · PetaPixel: https://petapixel.com/2026/06/03/davinci-resolve-21-officially-released-with-new-photo-editing-ai-tools-and-much-more/ · Guide PDF: https://documents.blackmagicdesign.com/SupportNotes/DaVinci_Resolve_21_New_Features_Guide.pdf
- [R-TX] Resolve text-based editing / silence / no filler detection: https://blitzcutai.com/blog/davinci-resolve-text-based-editing · https://dvresolve.com/tutorial/text-based-editing-using-transcription/
- [PR252] Premiere 25.2 (Generative Extend, Media Intelligence, Caption Translation, ACEScct): https://www.cined.com/adobe-premiere-pro-and-after-effects-25-2-introduced-ai-generative-extend-media-intelligence-and-more/ · https://www.newscaststudio.com/2025/04/03/adobe-brings-generative-extend-media-intelligence-to-premiere-pro/
- [PR26] Premiere 26 rebrand + Object Mask: https://petapixel.com/2026/01/20/rebranded-adobe-premiere-26-arrives-with-one-click-object-tracking/
- [PVC-26] ProVideo Coalition, Adobe 2026 video updates (Sundance): https://www.provideocoalition.com/new-ai-and-masking-tools-in-premiere-plus-major-upgrade-to-after-e%EF%AC%80ects/
- [PR265] Adobe Community, What's New in Premiere 26.5 (Sept 2026): https://community.adobe.com/announcements-727/what-s-new-in-adobe-premiere-26-5-september-2026-1641187
- [PR-AI] Adobe, Premiere AI video editing: https://www.adobe.com/products/premiere/ai-video-editing.html
- [APL-NR] Apple Newsroom, FCP 11: https://www.apple.com/newsroom/2024/11/final-cut-pro-11-begins-a-new-chapter-for-video-editing-on-mac/
- [FCP12] ProVideo Coalition, What's new in FCP 12: https://www.provideocoalition.com/whats-new-in-final-cut-pro-12-and-more/ · Newsshooter: https://www.newsshooter.com/2026/01/28/final-cut-pro-12-0/
- [FCP-NEW] Apple Support, What's new in FCP (12.3): https://support.apple.com/guide/final-cut-pro/whats-new-ver19637ebab/mac
- [FCP-SPEC] Apple, FCP tech specs: https://www.apple.com/my/final-cut-pro/specs/
- [CC-S1] CapCut desktop review, 2026 (third party): https://bigvu.tv/blog/capcut-online-desktop-editor-review/ · https://www.nemovideo.com/blog/capcut-review-2026
- [CC-S2] CapCut desktop page (search extract only, HTTP 451 to the fetcher): https://www.capcut.com/tools/desktop-video-editor
- [DESC] Descript video editing features: https://www.descript.com/video-editing
- [DESC-S6] Descript Season 6: https://www.descript.com/blog/article/descript-season-6-meet-underlord
- [UL] Descript Underlord: https://www.descript.com/underlord · https://help.descript.com/getting-started/underlord-beta-your-ai-co-editor-in-descript
- [UL-2026] Underlord 2026 update (model picker): https://www.letscompareai.com/post/descript-underlord-update-faster-ai-video-editing-for-creators-in-2026
- [CAM-F] TechSmith, Camtasia features: https://www.techsmith.com/camtasia/features/
- [CAM-N] TechSmith, What's New in Camtasia 2026: https://www.techsmith.com/learn/webinars/whats-new-in-camtasia-2026/ · https://www.techsmith.com/camtasia/features/ai-text-based-editing/
- [IM-GS] Apple Support, iMovie green screen: https://support.apple.com/guide/imovie/create-a-green-screen-effect-mov82da1338a/mac
- [IM-A] Apple Support, iMovie correct/enhance audio: https://support.apple.com/guide/imovie/correct-and-enhance-audio-mov86277afbd/mac
- [IM-S] iMovie stabilisation/speed (third party): https://www.howtogeek.com/imovie-is-still-perfect-for-your-personal-video-editing-needs/
- [CLIP] Clipchamp AI features: https://clipchamp.com/en/ai-video-editing-clipchamp/
- [SH-F] Shotcut features: https://www.shotcut.org/features/
- [SH-2510] Shotcut 25.10 release: https://www.shotcut.org/blog/new-release-25.10.31/ · https://ubuntuhandbook.org/index.php/2025/11/shotcut-25-10-image-video-html/
- [KD-WN] Kdenlive manual, What's New (25.04 to 26.08): https://docs.kdenlive.org/en/more_information/whats_new.html
- [KD-SEG] Kdenlive 25.04 (SAM2 object segmentation): https://kdenlive.org/news/releases/25.04.0/
- [KD-STT] Kdenlive Speech to Text: https://docs.kdenlive.org/en/effects_and_filters/speech_to_text.html
- [RWY] Runway Aleph 2.0: https://runway.com/product/aleph-2
- [OPUS] OpusClip overview (third party): https://www.eesel.ai/blog/opusclip · https://www.opus.pro/home-a-b
- [KAP-A] Kapwing AI video assistant: https://www.kapwing.com/ai/video-assistant · https://www.kapwing.com/kai
- [KAP-RN] Kapwing release notes, May 2026: https://www.kapwing.com/help/kapwing-release-notes-may-2026/
- [VEED-EC] VEED Eye Contact: https://www.veed.io/tools/eye-tracking-software/eye-contact-ai
- [VEED-DUB] VEED AI Dubbing: https://www.veed.io/tools/voice-dubber/ai-dubbing
- [CAP] Captions/Mirage: https://captions.ai/overview · https://mirage.app/captions · https://mirage.app/captions/correct-your-eye-contact
- [FF] Adobe Firefly video editor: https://helpx.adobe.com/firefly/web/firefly-video-editor/about-firefly-video-editor/about-firefly-video-editor.html
- [FF-TL] Firefly create a timeline: https://helpx.adobe.com/firefly/web/firefly-video-editor/set-up-your-project/create-a-timeline-in-a-project.html
- [FF-CG] Firefly prompt-based edits: https://www.contentgrip.com/adobe-firefly-video-editor-update/

Not fetched: Adobe's own "What's new in Premiere" help page returned 403, so Premiere 26.x details come from Adobe Community posts and trade press.
