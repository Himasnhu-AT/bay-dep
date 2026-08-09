# bay tool reference

24 tools. Every one returns JSON; a failure comes back as a tool error with a message naming
the offending value, so read it and correct the call rather than guessing.

**Three of them do not answer directly.** `render`, `narrate` and `subtitles_to_video` take
seconds to minutes, so they return a **job id** immediately and you poll `job_status` with it
until `finished` is true — then read `result`, which is exactly what the tool would have
returned in-band. `runtime_install` has always worked this way; these now match it.

```jsonc
narrate  { "text": "…" }        -> { "job": 7, "status": "started" }
job_status { "job": 7 }          -> { "finished": false, "fraction": 0.4, "message": "…" }
job_status { "job": 7 }          -> { "finished": true, "result": { "endSeconds": 4.2, … } }
```

Everything else, including `media_import`, still answers in one call.

---

## Project

### `project_create`
Start an empty project. **Call this first** — it clears the timeline.

| arg | default | notes |
|---|---|---|
| `name` | `"Untitled"` | |
| `width` / `height` | 1080 / 1920 | vertical reel. Landscape is 1920×1080. |
| `fps` | 30 | |
| `background` | `"#000000"` | `#rrggbb`; every frame sits on this |

### `project_info`
Canvas, fps, timeline duration, element counts, layer count.

### `project_save`
`{ "path"?: "…json" }` → `{ id, name, path }`

**Call this when the project is worth keeping.** With no `path` it saves into the user's project
library — the list the desktop app opens on — so they can pick the project up in the GUI. Pass a
`path` only to drop a copy somewhere specific.

### `project_list`
`{}` → `{ root, projects: [{ id, name, path, canvas, fps, durationSeconds, elements }] }`

What is already in the user's library, newest first.

### `project_load`
`{ "id": "…" }` from `project_list`, or `{ "path": "…json" }` for a loose file. Give exactly one.

---

## Media

### `media_import`
`{ "path": "…", "id"?: "…" }` → `{ mediaId, durationSeconds, width, height, hasAudio, hasVideo }`

Probes the file, so you get its **real** duration rather than a guess. A probe failure is
reported in `probeError` rather than silently defaulting.

### `fonts_check`
`{ "families": ["Helvetica Neue", "Menlo"] }` → `{ available: [...], missing: [...] }`

**Call before using any family.** cosmic-text silently substitutes a fallback for an unknown
family — the frame looks almost right and no automated check notices. `add_text` refuses an
uninstalled family for this reason.

macOS usually has: Helvetica Neue, Avenir Next, Futura, Optima, Baskerville, Georgia, Impact,
Arial Black (display); Menlo, Monaco, Courier New, PT Mono, Andale Mono (mono).
It usually does **not** have: SF Mono, IBM Plex Mono, Hanken Grotesk, JetBrains Mono.

---

## Placing elements

All visual tools share this block:

| arg | default | meaning |
|---|---|---|
| `layer` | 0 | stacking order; 0 is bottom, higher draws on top, gaps auto-created |
| `x`, `y` | 0.5 | position of the element's **anchor**, as a fraction of the canvas |
| `scale` | 1.0 | size as a fraction of the canvas; 1.0 spans the frame |
| `scaleX`, `scaleY` | 1.0 | per-axis multipliers on top of `scale` |
| `anchorX`, `anchorY` | 0.5 | which point of the element sits at `(x, y)`; 0 = left/top, 1 = right/bottom |
| `rotation` | 0 | degrees clockwise, **about the element's centre** (not its anchor) |
| `opacity` | 1.0 | |
| `blendMode` | `normal` | 17 modes: multiply, screen, overlay, difference, color-dodge, … |

### `add_text`
Plus: `content` (use `\n` for line breaks), `fontSize`, `color`, `fontFamily`, `fontWeight`,
`align` (left/center/right), `letterSpacing` (em), `lineHeight`, `id`.

`fontSize` is quoted **against a 1080-tall canvas** and scaled automatically. On a 1920-tall
canvas the multiplier is 1.778 — so `fontSize: 180` renders at 320px.

### `add_shape`
Plus: `shape` (`rect`|`ellipse`), `radius` (fraction of the shorter side; 0.5 = a pill),
`color`, `id`.

### `add_image` / `add_video`
Plus: `mediaId`, `start`, `duration`, (`trimStart` for video), `id`. Sources are fitted inside
their scale box without distortion.

### `add_audio`
`{ mediaId, start, duration, volume?, id? }`. Mixed into the exported MP4.

---

## Motion

### `animate`
```jsonc
{ "elementId": "bar", "property": "scaleX", "easing": "power-out",
  "keys": [{ "t": 0, "value": 0 }, { "t": 0.8, "value": 0.6 }] }
```

- Properties: `opacity`, `scale`, `x`, `y`, `rotation`, `scaleX`, `scaleY`.
- **`t` is seconds after the ELEMENT starts**, not timeline seconds.
- Replaces any existing animation on that property — re-animating is idempotent.
- Needs at least two keyframes.
- Easings: `linear`, `ease-in`, `ease-out`, `ease-in-out`, `power-out`, `expo-out`,
  `back-out`, `hold`.
  `power-out` is the workhorse for entrances; `ease-in-out` for anything transforming in
  place; `hold` for a hard cut.

### `element_delete`
`{ "elementId": "…" }`.

---

## Reading your work back

### `timeline`
Every layer, its elements, their timings, transforms, and which properties are animated. Use
this between edits instead of tracking state yourself.

---

## Speech and subtitles

### `speech_status`
Is Kokoro available here, and which voices can it speak? Reports what to do if not — it never
throws.

### `narrate`
Speak text, place the audio, and lay word-synced captions.

| arg | default | notes |
|---|---|---|
| `text` | — | punctuation drives phrasing; there is no SSML |
| `start` | 0 | timeline seconds |
| `voice` | `af_heart` | see `speech_status` |
| `speed` | 1.0 | 1.0–1.15 suits a reel |
| `langCode` | `a` | a/b English, e/f/h/i/j/p/z others |
| `volume` | 1.0 | with `peakDb` on, 1.0 is already full-strength |
| `peakDb` | −2.0 | normalize each utterance to this dBFS peak; `null` for raw |
| `captions` | true | place captions as well as audio |
| plus caption styling | | `captionFontSize`, `captionColor`, `captionFontFamily`, `captionY`, `captionLayer`, `captionFade`, `maxWords`, `minCaptionSeconds`, `maxCaptionSeconds`, `gapSeconds` |

Returns a **job id** — poll `job_status` until `finished`, then read `result.endSeconds` and
**check it fits** before committing. Audio and captions come from one synthesis, so they cannot
drift apart.

### `subtitles_add`
`{ path: "…srt|vtt", offset?: 0 }` plus caption styling. Places every cue as a caption.

### `subtitles_export`
`{ path, format: "srt"|"vtt" }`. Writes the timeline's captions back out.

### `subtitles_to_video`
An `.srt` in, a playable `.mp4` out — one call. Creates the project, places every cue,
optionally narrates each cue at its own time, and renders.

```jsonc
{ "path": "script.srt", "output": "out.mp4", "narrate": true, "voice": "af_heart" }
```

Returns a **job id** — poll `job_status` until `finished`. `result.overruns` lists cues whose
spoken audio ran past the next cue's start. Speech does not have to fit the window a subtitle
author chose, so this is surfaced rather than silently truncated.

---

## Output

### `snapshot`
`{ at, path, scale? }` → renders ONE frame to a PNG. `scale: 0.5` is fast and still legible
for review. **Paths are resolved by the server process — use absolute paths.**

### `render`
`{ path, duration? }` → encodes the whole timeline, picture and sound. `duration` overrides
the timeline's own length — useful when elements extend past the intended end for crossfades.

Returns a **job id**. Poll `job_status` with it: `fraction` moves per encoded frame, and
`result` carries `bytes` and `encodeSeconds` once `finished` is true. Requires ffmpeg.

### `job_status`
`{ job? }` → one job, or every job when the id is omitted. The fields that matter:

| field | meaning |
|---|---|
| `finished` | the only thing worth branching on |
| `result` | what the tool returns, present once finished |
| `error` | why it failed, if it did |
| `fraction` | 0–1, or null when the size is not known yet |
| `message` | one line for a human: "encoding frame 240 of 900" |

### `job_cancel`
`{ job }` → asks a job to stop. Best-effort, and the granularity differs by tool:

| tool | stops at |
|---|---|
| `render` | the next frame; no partial file is left behind |
| `subtitles_to_video` | the next cue |
| `narrate` | only if it has not started — one synthesis is a single uninterruptible call |

`cancelling: false` means it could not be cancelled, usually because it had already finished.
A job that finishes *despite* a cancel reports `finished` with its `result` and
`cancelled: false` — the work happened, so saying otherwise would be a lie.
