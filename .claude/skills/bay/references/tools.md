# Tools

**Generated — do not hand-edit.** `python3 .claude/skills/bay/gen-tools.py` reads
`rust/crates/bay-mcp/src/tools.rs` and rewrites this file. Regenerate it whenever the tool
surface changes; a hand-maintained copy of an argument list is wrong within a week.

Argument **names** only. The live schema your client already holds carries the types, the
descriptions and the defaults — read it there, per call. Nothing in this skill prints a
default value, because a printed default is the value that comes back.

The tool prefix is whatever name the server was registered under (`mcp__bay__…`,
`mcp__vii__…`). Every tool is written bare here for that reason.

55 tools.

| tool | required | also takes |
|---|---|---|
| **project_create** — Start a new, empty project | — | `name`, `width`, `height`, `fps`, `background` |
| **project_info** — Canvas size, fps, timeline duration and element counts for the current project | — | — |
| **fonts_check** — Report which of the given font families are actually installed | `families` | — |
| **media_import** — Register a media file (image, video or audio) and probe its real duration and dimensions | `path` | `id` |
| **add_text** — Place a text element on the timeline | `start`, `duration`, `content` | `fontSize`, `color`, `fontFamily`, `fontWeight`, `align`, `letterSpacing`, `lineHeight`, `id`, `layer`, `x`, `y`, `scale`, `scaleX`, `scaleY`, `anchorX`, `anchorY`, `rotation`, `opacity`, `blendMode` |
| **add_shape** — Place a solid rectangle or ellipse: bars, rules, dots, panels, underlines | `start`, `duration` | `shape`, `radius`, `color`, `id`, `layer`, `x`, `y`, `scale`, `scaleX`, `scaleY`, `anchorX`, `anchorY`, `rotation`, `opacity`, `blendMode` |
| **add_image** — Place an imported image | `mediaId`, `start`, `duration` | `id`, `layer`, `x`, `y`, `scale`, `scaleX`, `scaleY`, `anchorX`, `anchorY`, `rotation`, `opacity`, `blendMode` |
| **add_video** — Place an imported video clip | `mediaId`, `start`, `duration` | `trimStart`, `id`, `layer`, `x`, `y`, `scale`, `scaleX`, `scaleY`, `anchorX`, `anchorY`, `rotation`, `opacity`, `blendMode` |
| **add_audio** — Place an audio clip (music bed, sound effect) on the audio lane | `mediaId`, `start`, `duration` | `volume`, `trimStart`, `id` |
| **animate** — Attach a keyframe animation to one property of one element | `elementId`, `property`, `keys` | `easing` |
| **animate_many** — Run ONE move across MANY elements, staggered — the verb for kinetic type, list reveals, and any group arrival | `elementIds`, `property`, `from`, `to` | `duration`, `at`, `stagger`, `decay`, `easing` |
| **element_delete** — Remove an element from the timeline by id | `elementId` | — |
| **element_move** — Slide a clip along the timeline | `elementId`, `start` | — |
| **element_trim** — Trim a clip's edges | `elementId` | `start`, `duration` |
| **element_split** — Cut a clip in two at a timeline position | `elementId`, `at` | `newId` |
| **element_source** — Slip: change WHICH part of a video or audio file a clip plays, keeping it exactly where it is on the timeline and exactly as long | `elementId`, `trimStart` | — |
| **element_duplicate** — Copy a clip, effects and animation included, placed right after it | `elementId` | `newId` |
| **element_rename** — Rename an element | `elementId`, `name` | — |
| **transform_set** — Reposition, scale, rotate or fade an element already on the timeline | `elementId` | `x`, `y`, `scale`, `scaleX`, `scaleY`, `rotation`, `opacity`, `anchorX`, `anchorY` |
| **text_update** — Change a title's words or its typography in place, keeping its id, position and animation | `elementId` | `content`, `fontSize`, `color`, `fontFamily`, `fontWeight`, `align`, `letterSpacing`, `lineHeight` |
| **effect_add** — Add a picture effect to a clip | `elementId`, `type` | `look`, `lut`, `params`, `effectId` |
| **effect_set** — Retune an effect that is already on a clip, or switch it off without removing it | `elementId`, `effectId` | `params`, `enabled` |
| **effect_remove** — Take an effect off a clip | `elementId`, `effectId` | — |
| **blend_set** — Change how a clip composites over what is under it | `elementId`, `mode` | — |
| **audio_set** — Change an audio clip's level, mute it, or move its in-point | `elementId` | `volume`, `muted`, `trimStart` |
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
| **check** — Inspect the timeline for the mistakes that make a finished video look wrong: elements off the canvas, type too small to read at thumbnail size, clips pointing at media nobody imported, clips trimmed past the end of their own file, black gaps in the picture, overlapping clips on one lane, animation that runs past its clip, a silent export | — | — |
| **timeline** — Dump the whole timeline: every layer, its elements, their timings, transforms and which properties are animated | — | — |
| **snapshot** — Render ONE frame to a PNG so you can look at it | `at`, `path` | `scale` |
| **render** — Encode the timeline, picture and sound | `path` | `duration`, `startSeconds`, `preset`, `codec`, `quality`, `loudness`, `audioBitrateKbps` |
| **job_status** — Follow work that runs in the background | — | `job` |
| **job_cancel** — Ask a running job to stop | `job` | — |
| **runtime_status** — What bay needs to work, and whether it is installed on this machine — ffmpeg for decode and export, Kokoro for narration | — | `job` |
| **runtime_install** — Install what bay is missing, from builds pinned and hash-verified in bay itself | `component` | — |
| **speech_status** — Whether Kokoro text-to-speech is available on this machine, and which voices it can speak | — | — |
| **narrate** — Speak text with Kokoro, put the audio on the timeline, and place word-synced captions for it | `text` | `start`, `voice`, `speed`, `langCode`, `volume`, `peakDb`, `audioPath`, `captions`, `captionFontSize`, `captionColor`, `captionFontFamily`, `captionFontWeight`, `captionY`, `captionLayer`, `captionFade`, `maxWords`, `minCaptionSeconds`, `maxCaptionSeconds`, `gapSeconds` |
| **subtitles_add** — Read an SRT or WebVTT file and place every cue on the timeline as a caption | `path` | `offset`, `captionFontSize`, `captionColor`, `captionFontFamily`, `captionFontWeight`, `captionY`, `captionLayer`, `captionFade`, `maxWords`, `minCaptionSeconds`, `maxCaptionSeconds`, `gapSeconds` |
| **subtitles_export** — Write the timeline's captions out as an SRT or WebVTT file | `path` | `format` |
| **subtitles_to_video** — Turn a subtitle file straight into a video: create a project, place every cue as a caption, optionally narrate each cue with Kokoro, and render an MP4 | `path`, `output` | `width`, `height`, `fps`, `background`, `narrate`, `voice`, `speed`, `langCode`, `captionFontSize`, `captionColor`, `captionFontFamily`, `captionFontWeight`, `captionY`, `captionLayer`, `captionFade`, `maxWords`, `minCaptionSeconds`, `maxCaptionSeconds`, `gapSeconds` |
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
