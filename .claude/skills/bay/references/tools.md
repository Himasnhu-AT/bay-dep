# Tools

**Generated — do not hand-edit.** `python3 .claude/skills/bay/gen-tools.py` reads
`rust/crates/bay-mcp/src/tools.rs` and rewrites this file. Regenerate it whenever the tool
surface changes; a hand-maintained copy of an argument list is wrong within a week.

Argument **names** only. The live schema your client already holds carries the types, the
descriptions and the defaults — read it there, per call. Nothing in this skill prints a
default value, because a printed default is the value that comes back.

The tool prefix is whatever name the server was registered under (`mcp__bay__…`,
`mcp__vii__…`). Every tool is written bare here for that reason.

70 tools.

| tool | required | also takes |
|---|---|---|
| **project_create** — Start a new, empty project | — | `name`, `width`, `height`, `fps`, `background` |
| **style_pick** — Choose the project's STYLE KIT: three typefaces (display, body, mono), a type ramp that maps each element role to a size, a six-colour palette, and at least four named framings.

Call it with a `brief` and nothing else to be offered three kits that suit it — seeded by the brief and today's date, and excluding the last five this machine committed | — | `brief` |
| **project_info** — Canvas size, fps, timeline duration and element counts for the current project | — | — |
| **fonts_check** — Report which of the given font families are actually installed | `families` | — |
| **media_import** — Register a media file (image, video or audio) and probe its real duration and dimensions | — | `path`, `id`, `mediaId` |
| **audio_probe** — Measure an imported sound: `lufs` (EBU R128 integrated loudness — the unit a mix is specified in), `peakDb`, `rmsDb`, and `accentSeconds` (where its transients are, for landing a cut on the music) | `mediaId` | — |
| **add_text** — Place a text element on the timeline.

There is no fontFamily, fontSize, fontWeight or color here, on purpose: say what the line is FOR with `role` and how loud it is with `tone`, and the project's committed style kit answers the rest | `start`, `duration`, `content`, `role` | `align`, `letterSpacing`, `lineHeight`, `id`, `cover`, `framing`, `layer`, `x`, `y`, `scale`, `scaleX`, `scaleY`, `anchorX`, `anchorY`, `rotation`, `opacity`, `blendMode` |
| **add_shape** — Place a solid rectangle or ellipse: bars, rules, dots, panels, underlines | `start`, `duration`, `role` | `shape`, `radius`, `id`, `cover`, `framing`, `layer`, `x`, `y`, `scale`, `scaleX`, `scaleY`, `anchorX`, `anchorY`, `rotation`, `opacity`, `blendMode` |
| **add_image** — Place an imported image | `mediaId`, `start`, `duration` | `id`, `cover`, `framing`, `layer`, `x`, `y`, `scale`, `scaleX`, `scaleY`, `anchorX`, `anchorY`, `rotation`, `opacity`, `blendMode` |
| **add_video** — Place an imported video clip | `mediaId`, `start`, `duration` | `trimStart`, `id`, `cover`, `framing`, `layer`, `x`, `y`, `scale`, `scaleX`, `scaleY`, `anchorX`, `anchorY`, `rotation`, `opacity`, `blendMode` |
| **add_audio** — Place an audio clip (music bed, sound effect) on the audio lane | `mediaId`, `start`, `duration` | `volume`, `trimStart`, `role`, `id` |
| **apply_move** — Put a NAMED MOVE from bay's vocabulary on an element | — | `elementId`, `move`, `at`, `direction`, `distance` |
| **animate** — Give an element motion | `elementId` | `move`, `direction`, `distance`, `property`, `keys`, `at`, `easing` |
| **animate_many** — Run ONE move across MANY elements, staggered — the verb for kinetic type, list reveals, and any group arrival | `elementIds` | `move`, `direction`, `distance`, `property`, `by`, `from`, `to`, `duration`, `at`, `stagger`, `decay`, `easing` |
| **element_delete** — Remove an element from the timeline by id | `elementId` | — |
| **element_move** — Slide a clip along the timeline | `elementId`, `start` | — |
| **element_trim** — Trim a clip's edges | `elementId` | `start`, `duration` |
| **element_split** — Cut a clip in two at a timeline position | `elementId`, `at` | `newId` |
| **element_source** — Slip: change WHICH part of a video or audio file a clip plays, keeping it exactly where it is on the timeline and exactly as long | `elementId`, `trimStart` | — |
| **element_duplicate** — Copy a clip, effects and animation included, placed right after it | `elementId` | `newId` |
| **element_rename** — Rename an element | `elementId`, `name` | — |
| **transform_set** — Reposition, scale, rotate or fade an element already on the timeline | `elementId` | `x`, `y`, `scale`, `scaleX`, `scaleY`, `rotation`, `opacity`, `anchorX`, `anchorY` |
| **text_update** — Change a title's words, or what it is for, in place — keeping its id, position and animation | `elementId` | `content`, `align`, `letterSpacing`, `lineHeight` |
| **effect_add** — Add a picture effect to a clip | `elementId`, `type` | `look`, `lut`, `params`, `effectId` |
| **effect_set** — Retune an effect that is already on a clip, or switch it off without removing it | `elementId`, `effectId` | `params`, `enabled` |
| **effect_remove** — Take an effect off a clip | `elementId`, `effectId` | — |
| **blend_set** — Change how a clip composites over what is under it | `elementId`, `mode` | — |
| **audio_set** — Change an audio clip's level, mute it, or move its in-point — and duck it under the lines it plays behind | `elementId` | `volume`, `muted`, `trimStart`, `duckUnder` |
| **duck** — Duck a music bed under narration: four volume keyframes per line, on ONE clip.

You give the three numbers that are a mix decision — depth, attack, release | `bedId` | `underIds` |
| **fade_set** — Fade a clip up at its head and down at its tail | `elementId` | `fadeIn`, `fadeOut` |
| **transition_add** — Cross-dissolve between two clips on the same lane | `fromId`, `toId` | `duration` |
| **element_ripple_delete** — Remove a clip and close the hole it leaves: every later clip on the same lane moves back by its length | `elementId` | — |
| **marker_add** — Mark a moment on the timeline — a beat in the music, where a line lands, where the next cut goes | `at` | `label`, `id` |
| **crop_set** — Reframe a clip: cut away part of the source so what is left fills the frame | `elementId` | `left`, `top`, `right`, `bottom` |
| **mask_set** — Limit where a clip shows to a shape — a vignette, a spotlight on one part of the frame, half the screen for a split | `elementId` | `shape`, `x`, `y`, `width`, `height`, `feather`, `inverted` |
| **templates_list** — The element bundles bay can place in one call: lower thirds, kickers, end cards, and anything the user saved | — | — |
| **template_place** — Place a template on the timeline at a time, filling its text slots | `templateId` | `start`, `text`, `layer` |
| **sfx_search** — Find a sound | — | `query` |
| **sound_add** — Place a recorded sound from an installed pack on the audio lane | `sound`, `start` | `volume` |
| **sfx_list** — The sound effects bay synthesises: whooshes, risers, clicks, impacts | — | — |
| **sfx_add** — Synthesise a sound effect and place it on the audio lane in one call | `sfx`, `start` | `duration`, `tone`, `level`, `volume` |
| **looks_list** — The grades bay ships with: id, name, and what each one is for | — | — |
| **shots_detect** — Find the cuts in an imported clip and return the stretches between them | `mediaId` | `threshold`, `minSeconds` |
| **check** — Inspect the timeline for the mistakes that make a finished video look wrong: a large fill too close in colour to what it sits on to be seen, a card with nothing legible in it, an easing that overshoots a bar past its own number, an opening frame emptier than the rest of the video, two consecutive beats that carry nothing between them, elements off the canvas, type too small to read at thumbnail size, clips pointing at media nobody imported, black gaps in the picture.

Returns "status": clean, findings, or unevaluated — and read "skipped" before treating anything as a pass, because a check that could not run says so there rather than staying quiet | — | — |
| **timeline** — Dump the whole timeline: every layer, its elements, their timings, transforms and which properties are animated | — | — |
| **snapshot** — Render ONE frame to a PNG so you can look at it | `at`, `path` | `scale` |
| **render** — Encode the timeline, picture and sound | `path` | `duration`, `startSeconds`, `preset`, `codec`, `quality`, `loudness`, `audioBitrateKbps`, `ignoreChecks`, `reason` |
| **job_status** — Follow work that runs in the background | — | `job` |
| **job_cancel** — Ask a running job to stop | `job` | — |
| **runtime_status** — What bay needs to work, and whether it is installed on this machine — ffmpeg for decode and export, Kokoro for narration | — | `job` |
| **runtime_install** — Install what bay is missing, from builds pinned and hash-verified in bay itself | `component` | — |
| **speech_status** — Whether Kokoro text-to-speech is available on this machine, and which voices it can speak | — | — |
| **vision_status** — Whether bay can find a picture from a description — the SigLIP encoder that scores an image against a phrase | — | — |
| **stock_status** — Which image archives bay can reach, which need a key, and how much has already been downloaded | — | — |
| **stock_search** — Search an open image archive and get results ordered by what is actually in the picture.

This sends your query to a third party — it is the only tool in bay that does | `query` | `describe`, `kind`, `provider`, `limit`, `minWidth`, `licence` |
| **stock_fetch** — Download one stock_search result to this machine, with its licence and attribution recorded beside it | `asset` | `maxBytes` |
| **audio_beats** — Find the pulse of an audio file: tempo, where the grid starts, and every beat in seconds | — | `mediaId`, `path`, `everyNthBeat` |
| **silence_detect** — Find the dead air in a recording: the pause before an answer, the gap while someone thinks, the run-up at the head and the tail after the last word | — | `mediaId`, `path`, `minimumSeconds`, `thresholdDb`, `padSeconds` |
| **library_save** — Keep a file in your media library, under a name you choose, in a collection | `path` | `collection`, `name`, `stockId` |
| **library_list** — What is in the media library, with the credit lines anything CC-BY obliges you to show | — | `collection` |
| **library_collect** — Copy a whole collection into a folder — usually one beside the project file | `collection`, `into` | — |
| **stock_credits** — The attribution for everything downloaded, as text you can paste | — | — |
| **image_rank** — Score images already on disk against a phrase, best first | `query`, `paths` | — |
| **narrate** — Speak text with Kokoro, put the audio on the timeline, and place word-synced captions for it | `text` | `start`, `voice`, `targetWordsPerSecond`, `speed`, `langCode`, `volume`, `peakDb`, `audioPath`, `captions`, `captionStyle`, `captionX`, `captionY`, `captionAlign` |
| **subtitles_add** — Read an SRT or WebVTT file and place every cue on the timeline as a caption | `path` | `offset`, `captionStyle`, `captionX`, `captionY`, `captionAlign` |
| **subtitles_export** — Write the timeline's captions out as an SRT or WebVTT file | `path` | `format` |
| **subtitles_to_video** — Turn a subtitle file straight into a video: create a project, place every cue as a caption, optionally narrate each cue with Kokoro, and render an MP4 | `path`, `output` | `width`, `height`, `fps`, `background`, `narrate`, `voice`, `targetWordsPerSecond`, `speed`, `langCode`, `captionStyle`, `captionX`, `captionY`, `captionAlign` |
| **project_save** — Save the project | — | `path` |
| **project_list** — List the projects in the user's bay library — the same list the desktop app opens on | — | — |
| **project_load** — Replace the current project with one from the library (by id) or from a JSON file (by path) | — | `id`, `path` |

Two facts the table cannot show:

- **`render`, `narrate`, `subtitles_to_video` and `shots_detect` answer with a job id.**
  Poll `job_status` with it until `finished` is true, then read `result`. `job_cancel`
  stops one. Everything else answers in a single call.
- **bay has no scene object.** No tool creates, splits or selects one; a project is one
  scene however long it runs. Structure is expressed in time — see
  [structure.md](structure.md) — not in a container.
