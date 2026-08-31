# Tools

**Generated — do not hand-edit.** `python3 .claude/skills/bay/gen-tools.py` reads
the JSON emitted by bay-mcp's `dump_tools` example and rewrites this file. Regenerate it
whenever the tool surface changes; a hand-maintained argument list is wrong within a week.

Argument **names** only. The live schema your client already holds carries the types, the
descriptions and the defaults — read it there, per call. Nothing in this skill prints a
default value, because a printed default is the value that comes back.

The tool prefix is whatever name the server was registered under (`mcp__bay__…`,
`mcp__vii__…`). Every tool is written bare here for that reason.

102 tools.

| tool | required | also takes |
|---|---|---|
| **project_create** — Start a new, empty project | — | `background`, `brief`, `customKit`, `format`, `fps`, `fpsDenominator`, `height`, `kit`, `name`, `width` |
| **style_pick** — Choose the project's STYLE KIT: three typefaces (display, body, mono), a type ramp that maps each element role to a size, a six-colour palette, and at least four named framings | — | `brief`, `customKit`, `kit` |
| **project_info** — Canvas size, fps, timeline duration and element counts for the current project | — | — |
| **fonts_check** — Report which of the given font families are actually installed | `families` | — |
| **fonts_list** — Every typeface installed on this machine | — | `contains`, `weight` |
| **media_import** — Register a media file (image, video or audio) and probe its real duration and dimensions | — | `generationReceipt`, `id`, `mediaId`, `path` |
| **audio_probe** — Measure an imported sound: `lufs` (EBU R128 integrated loudness — the unit a mix is specified in), `peakDb`, `rmsDb`, and `accentSeconds` (where its transients are, for landing a cut on the music) | `mediaId` | — |
| **add_text** — Place a text element on the timeline | `start`, `duration`, `content`, `role` | `align`, `anchorX`, `anchorY`, `blendMode`, `cover`, `framing`, `id`, `layer`, `letterSpacing`, `lineHeight`, `opacity`, `plate`, `rotation`, `scale`, `scaleX`, `scaleY`, `shadow`, `stroke`, `tiltX`, `tiltY`, `tone`, `typeOn`, `x`, `y` |
| **add_shape** — Place a rectangle or ellipse: bars, rules, dots, panels, underlines, and the orbs and grounds a composed film is built out of | `start`, `duration`, `role` | `anchorX`, `anchorY`, `blendMode`, `cover`, `dash`, `framing`, `gap`, `gradientAngle`, `gradientFrom`, `gradientTo`, `id`, `layer`, `opacity`, `radius`, `rotation`, `scale`, `scaleX`, `scaleY`, `shape`, `strokeTone`, `strokeWidth`, `tiltX`, `tiltY`, `tone`, `x`, `y` |
| **add_image** — Place an imported image | `mediaId`, `start`, `duration` | `anchorX`, `anchorY`, `blendMode`, `cover`, `framing`, `id`, `layer`, `opacity`, `role`, `rotation`, `scale`, `scaleX`, `scaleY`, `tiltX`, `tiltY`, `x`, `y` |
| **add_video** — Place an imported video clip | `mediaId`, `start`, `duration` | `anchorX`, `anchorY`, `blendMode`, `cover`, `framing`, `id`, `layer`, `opacity`, `role`, `rotation`, `scale`, `scaleX`, `scaleY`, `speed`, `tiltX`, `tiltY`, `trimStart`, `x`, `y` |
| **add_audio** — Place an audio clip (music bed, sound effect) on the audio lane | `mediaId`, `start`, `duration` | `id`, `processDialogue`, `role`, `speed`, `trimStart`, `volume` |
| **group_create** — Parent several visual elements to one transform | `elementIds` | `anchorX`, `anchorY`, `blendMode`, `cover`, `framing`, `id`, `layer`, `opacity`, `rotation`, `scale`, `scaleX`, `scaleY`, `tiltX`, `tiltY`, `x`, `y` |
| **element_retime** — Change a video or audio clip's constant playback speed | `elementId` | `freezeAt`, `freezeDuration`, `speed` |
| **apply_move** — Put a NAMED MOVE from bay's vocabulary on an element | — | `at`, `direction`, `distance`, `elementId`, `move` |
| **animate** — Give an element motion | `elementId` | `at`, `direction`, `distance`, `easing`, `keys`, `move`, `property` |
| **animate_many** — Run ONE move across MANY elements, staggered — the verb for kinetic type, list reveals, and any group arrival | `elementIds` | `at`, `by`, `decay`, `direction`, `distance`, `duration`, `easing`, `from`, `move`, `property`, `stagger`, `to` |
| **element_delete** — Remove an element from the timeline by id | `elementId` | — |
| **element_move** — Slide a clip along the timeline | `elementId`, `start` | — |
| **element_trim** — Trim a clip's edges | `elementId` | `duration`, `start` |
| **element_split** — Cut a clip in two at a timeline position | `elementId`, `at` | `newId` |
| **element_source** — Slip: change WHICH part of a video or audio file a clip plays, keeping it exactly where it is on the timeline and exactly as long | `elementId`, `trimStart` | — |
| **element_duplicate** — Copy a clip, effects and animation included, placed right after it | `elementId` | `newId` |
| **element_rename** — Rename an element | `elementId`, `name` | — |
| **transform_set** — Reposition, scale, rotate or fade an element already on the timeline | `elementId` | `anchorX`, `anchorY`, `opacity`, `rotation`, `scale`, `scaleX`, `scaleY`, `tiltX`, `tiltY`, `x`, `y` |
| **text_update** — Change a title's words, or what it is for, in place — keeping its id, position and animation | `elementId` | `align`, `content`, `letterSpacing`, `lineHeight`, `role`, `tone` |
| **effect_add** — Add a picture effect to a clip | `elementId`, `type` | `effectId`, `look`, `lut`, `params` |
| **effect_set** — Retune an effect that is already on a clip, or switch it off without removing it | `elementId`, `effectId` | `enabled`, `params` |
| **effect_remove** — Take an effect off a clip | `elementId`, `effectId` | — |
| **blend_set** — Change how a clip composites over what is under it | `elementId`, `mode` | — |
| **audio_set** — Change an audio clip's level, mute it, or move its in-point — and duck it under the lines it plays behind | `elementId` | `attackMs`, `depthDb`, `duckUnder`, `holdMs`, `joinGapMs`, `muted`, `preRollMs`, `releaseMs`, `trimStart`, `volume` |
| **duck** — Duck a music bed under narration: four volume keyframes per line, on ONE clip | `bedId` | `attackMs`, `depthDb`, `holdMs`, `joinGapMs`, `preRollMs`, `releaseMs`, `underIds` |
| **formats_list** — What kinds of video bay knows, what each is built out of, and which checks each one relaxes and why | — | — |
| **audio_react** — Drive an element's scale from how loud the sound is, moment to moment — the orb that pulses with the voice | `elementId`, `mediaId` | `channel`, `depth`, `floorDb` |
| **room_tone** — Lay the room itself under the whole cut, lifted from a pause in the recording | `mediaId` | `crossfadeMs`, `levelDb`, `seconds` |
| **audio_smooth** — Crossfade every place two sounds meet, so a dialogue edit stops ticking at its joins | — | `elementIds`, `joinMs` |
| **fade_set** — Fade a clip up at its head and down at its tail | `elementId` | `fadeIn`, `fadeOut` |
| **transition_add** — Cross-dissolve between two clips on the same lane | `fromId`, `toId` | `duration` |
| **element_ripple_delete** — Remove a clip and close the hole it leaves: every later clip on the same lane moves back by its length | `elementId` | — |
| **marker_add** — Mark a moment on the timeline — a beat in the music, where a line lands, where the next cut goes | `at` | `id`, `label` |
| **crop_set** — Reframe a clip: cut away part of the source so what is left fills the frame | `elementId` | `bottom`, `left`, `right`, `top` |
| **mask_set** — Limit where a clip shows to a shape — a vignette, a spotlight on one part of the frame, half the screen for a split | `elementId` | `feather`, `height`, `inverted`, `shape`, `width`, `x`, `y` |
| **templates_list** — The element bundles bay can place in one call: lower thirds, kickers, end cards, and anything the user saved | — | — |
| **template_place** — Place a template on the timeline at a time, filling its text slots | `templateId` | `layer`, `start`, `text` |
| **sfx_search** — Find a sound | — | `query` |
| **sound_add** — Place a recorded sound from an installed pack on the audio lane | `sound`, `start` | `volume` |
| **sfx_list** — The sound effects bay synthesises: whooshes, risers, clicks, impacts | — | — |
| **sfx_add** — Synthesise a sound effect and place it on the audio lane in one call | `sfx`, `start` | `duration`, `level`, `tone`, `volume` |
| **looks_list** — The grades bay ships with: id, name, and what each one is for | — | — |
| **shots_detect** — Find the cuts in an imported clip and return the stretches between them | `mediaId` | `minSeconds`, `threshold` |
| **faces_detect** — Find the people in a clip: a face rectangle per person per sampled frame, and optionally their upper bodies | — | `endSeconds`, `mediaId`, `path`, `sampleSeconds`, `startSeconds`, `want` |
| **media_index** — Build and persist a semantic index for imported footage | `mediaId` | — |
| **media_search** — Find footage by meaning rather than filename | `query` | `limit`, `mediaId` |
| **auto_reframe** — Track the subject in a video clip and animate crop insets for a new aspect ratio | `elementId` | `sampleSeconds`, `smoothingSeconds`, `targetHeight`, `targetWidth` |
| **check** — Inspect the timeline for the mistakes that make a finished video look wrong: a large fill too close in colour to what it sits on to be seen, a card with nothing legible in it, an easing that overshoots a bar past its own number, an opening frame emptier than the rest of the video, two consecutive beats that carry nothing between them, elements off the canvas, type too small to read at thumbnail size, clips pointing at media nobody imported, black gaps in the picture | — | `duration` |
| **check_frames** — Render low-resolution, caption-suppressed samples and inspect the picture itself | — | `duration` |
| **scopes_read** — Measure one frame the way a colourist reads it: luma waveform, RGB parade, vectorscope and histogram, reduced to where the exposure sits, what is clipped and which way the colour leans | `at` | `scale`, `stride` |
| **timeline** — Dump the whole timeline: every layer, its elements, their timings, transforms, effects, and the animation on them | — | `animatable` |
| **snapshot** — Render ONE frame to a PNG so you can look at it | `at`, `path` | `scale` |
| **contact_sheet** — Render review frames into one labelled PNG | `path` | `columns`, `times` |
| **render** — Encode the timeline, picture and sound | `path` | `audioBitrateKbps`, `codec`, `duration`, `endSeconds`, `ignoreChecks`, `loudness`, `preset`, `quality`, `reason`, `startSeconds` |
| **job_status** — Follow work that runs in the background | — | `job` |
| **job_cancel** — Ask a running job to stop | `job` | — |
| **runtime_status** — What bay needs to work, and whether it is installed on this machine — ffmpeg for decode and export, Kokoro for narration | — | `job` |
| **runtime_install** — Install what bay is missing, from builds pinned and hash-verified in bay itself | `component` | — |
| **speech_status** — Whether Kokoro text-to-speech is available on this machine, and which voices it can speak | — | — |
| **vision_status** — Whether bay can find a picture from a description — the SigLIP encoder that scores an image against a phrase | — | — |
| **stock_status** — Which image archives bay can reach, which need a key, and how much has already been downloaded | — | — |
| **stock_search** — Search an open image archive and get results ordered by what is actually in the picture | `query` | `describe`, `kind`, `licence`, `limit`, `minWidth`, `provider` |
| **stock_fetch** — Download one stock_search result to this machine, with its licence and attribution recorded beside it | `asset` | `maxBytes` |
| **audio_beats** — Find the pulse of an audio file: tempo, where the grid starts, and every beat in seconds | — | `everyNthBeat`, `mediaId`, `path` |
| **silence_detect** — Find the dead air in a recording: the pause before an answer, the gap while someone thinks, the run-up at the head and the tail after the last word | — | `mediaId`, `minimumSeconds`, `padSeconds`, `path`, `thresholdDb` |
| **library_save** — Keep a file in your media library, under a name you choose, in a collection | `path` | `collection`, `name`, `stockId` |
| **library_list** — What is in the media library, with the credit lines anything CC-BY obliges you to show | — | `collection` |
| **library_collect** — Copy a whole collection into a folder — usually one beside the project file | `collection`, `into` | — |
| **stock_credits** — The attribution for everything downloaded, as text you can paste | — | — |
| **image_rank** — Score images already on disk against a phrase, best first | `query`, `paths` | — |
| **narrate** — Speak text with Kokoro, put the audio on the timeline, and place word-synced captions for it | `text` | `audioPath`, `captionAlign`, `captionStyle`, `captionX`, `captionY`, `captions`, `energy`, `langCode`, `peakDb`, `pitchSemitones`, `speakerColors`, `speakerLabels`, `speed`, `start`, `targetWordsPerSecond`, `voice`, `volume` |
| **subtitles_add** — Read an SRT or WebVTT file and place every cue on the timeline as a caption | `path` | `captionAlign`, `captionStyle`, `captionX`, `captionY`, `offset`, `speakerColors`, `speakerLabels` |
| **subtitles_export** — Write the timeline's captions out as an SRT or WebVTT file | `path` | `format` |
| **subtitles_to_video** — Turn a subtitle file straight into a video: create a project, place every cue as a caption, optionally narrate each cue with Kokoro, and render an MP4 | `path`, `output` | `background`, `brief`, `captionAlign`, `captionStyle`, `captionX`, `captionY`, `customKit`, `fps`, `height`, `kit`, `langCode`, `narrate`, `speakerColors`, `speakerLabels`, `speed`, `targetWordsPerSecond`, `voice`, `width` |
| **project_save** — Save the project | — | `path` |
| **project_list** — List the projects in the user's bay library — the same list the desktop app opens on | — | — |
| **project_load** — Replace the current project with one from the library (by id) or from a JSON file (by path) | — | `id`, `path` |
| **transcribe** — Hear an imported video or audio file locally with whisper.cpp and attach the word-timed transcript to the media asset | `mediaId` | — |
| **diarize** — Separate speakers in an existing transcript by clustering local acoustic features for each utterance | `mediaId` | `speakers` |
| **transcript_get** — Read the persisted transcript for an imported asset: language, utterances, speakers where Whisper supplied turns, and every word's start/end/confidence | `mediaId` | — |
| **transcript_search** — Find an exact word sequence in a transcript | `mediaId`, `query` | — |
| **cut_by_transcript** — Build a dialogue edit by placing selected transcript ranges consecutively as paired video and speech clips | `mediaId` | `layer`, `ranges`, `timelineStart`, `wordRanges` |
| **remove_silence_and_fillers** — Create a tightened transcript edit: remove configurable filler words, compress dead air, keep short conversational pauses untouched, and retain a bounded meaningful beat from long pauses | `mediaId` | `deadAirThresholdSeconds`, `fillerWords`, `keepMeaningfulPauses`, `layer`, `meaningfulPauseSeconds`, `meaningfulPauseThresholdSeconds`, `retainedPauseSeconds`, `sourceEnd`, `sourceStart`, `timelineStart` |
| **plan_create** — Create the inspectable editorial promise before building: named genre format, target runtime, beat intents, and asset slots | `brief`, `format`, `targetRuntimeSeconds`, `beats` | `approve` |
| **plan_get** — Read the project's plan artifact, critic obligations, tournament state, and the built-in format registry | — | — |
| **variant_create** — Clone the active project into the project library as one deliberate alternative | `label` | — |
| **variant_register_render** — Attach a real rendered file to a variant | `projectId`, `path` | — |
| **tournament_compare** — Record one forced pairwise preference between two engine-verified renders | `leftProjectId`, `rightProjectId`, `winnerProjectId`, `reason` | — |
| **critic_prepare** — Render an engine-seeded contact sheet and return only brief, sheet, and computed check/check_frames evidence for a fresh critic | `path` | — |
| **critic_submit** — Submit a fresh critic's three forced choices and nine binary taste judgments | `weakestPanel`, `mostAlikePair`, `thumbnailPanel`, `binaries`, `rationale` | — |
| **critic_refresh** — Re-render every open critic obligation at its original timestamp | — | — |
| **gen_image** — Generate a still through a local, fal, or Gemini adapter, then verify the actual pixels against the prompt with bay's provisioned SigLIP encoder | `prompt` | `consent`, `execute`, `height`, `model`, `previewId`, `provider`, `seed`, `width` |
| **gen_video** — Generate a short source clip through a local, fal, or Gemini adapter | `prompt` | `consent`, `execute`, `height`, `imageRef`, `model`, `previewId`, `provider`, `seconds`, `seed`, `width` |
| **gen_music** — Generate a music bed through a local or fal adapter | `brief` | `bpm`, `consent`, `execute`, `model`, `previewId`, `provider`, `seconds`, `seed` |
| **runtime_remove** — Remove one runtime component that bay installed and report the disk space actually freed | `component` | — |

Two facts the table cannot show:

- **`render`, `narrate`, `subtitles_to_video`, `shots_detect`, `media_index`,
  `auto_reframe`, and `diarize` answer with a job id.**
  Poll `job_status` with it until `finished` is true, then read `result`. `job_cancel`
  stops one. Everything else answers in a single call.
- **bay has no scene object.** No tool creates, splits or selects one; a project is one
  scene however long it runs. Structure is expressed in time — see
  [structure.md](structure.md) — not in a container.
