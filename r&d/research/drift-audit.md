# Drift vs bay — feature audit

Roots: bay = `/Users/himanshu/codes/synthai/vii`, Drift = `/private/tmp/claude-501/-Users-himanshu-codes-synthai-vii/9eba4df8-4cfd-4f9f-aa4f-965ab54329d4/scratchpad/ref/Drift`. Nothing was edited or launched; every claim is from reading source, not from running either app.

**Licence:** Drift is GPL-3.0. Nothing below is copied from its code, shaders, presets or assets; Drift citations are identifiers and file paths only. Every spec must be built from the behaviour described, not from Drift's source.

## (a) Verdict

bay is not behind Drift on cutting. It is ahead on trim tools (slip/slide/roll, source-viewer insert/overwrite, J/L cuts, range ripple that keeps sync), colour (wheels, curves, LUTs, grain, halation — Drift has no wheels, curves, LUTs or scopes), loudness mastering, review comments, the agent's diff/revert, and export honesty. The distance is almost entirely in what you can do to a clip after it is cut:

- **No effect stack.** bay has 8 CSS-style adjustments plus the grade; Drift ships 64 video effects, 30 audio effects and 23 one-click templates.
- **No shape masks, no speed ramps or reverse, no adjustment layers, no stabilisation, no chroma key.**
- **Thin titling.** One fill, one outline, one shadow, one plate, and no text or clip animation presets.
- **Missing safety and scale features.** No autosave or crash recovery, no proxies, no bins, no voiceover recording.

Roughly: bay is a strong cutter and grader with a weak effects, titles and audio-processing layer. Drift is the reverse, plus a lot of novelty features bay should skip.

## (b) Feature matrix

Status is bay's. "Proof" is the bay file:line for has, or the search that came back empty for lacks (searches were case-insensitive over `src/**/*.ts{,x}`, tests excluded). Paths are relative to bay's root; `store/types.ts` means `src/renderer/src/store/types.ts`, `project.ts` means `src/shared/project.ts`, `editor/…` means `src/renderer/src/editor/…`.

### Timeline editing

| Feature (Drift) | bay | Proof |
|---|---|---|
| Blade tool, split at playhead, split all tracks | Has | `src/shared/commands/timeline.ts:24`, `clip.ts` (`clip.split`, `clip.splitAll`) |
| Trim start/end to playhead (Q/W), ripple | Has | `clip.trimStartRipple` etc.; `store/types.ts` `trimToPlayhead` |
| Ripple delete, close gap | Has (stronger) | `store/types.ts:386` `rippleDelete`, `:469` `closeGapAt` |
| Slip / slide / roll | Has; not found in Drift's toolbar or menus | `store/types.ts:373` `trimEdit` |
| Snapping to edges, playhead, markers, beats | Has | `store/types.ts:246`; `lib/snap.ts` |
| Multi-select, nudge, copy/cut/paste, duplicate | Has | `store/slices/editing.ts`; `edit.*` commands |
| Paste attributes | Has | `store/types.ts:447` |
| Copy/paste/save effect stacks | Lacks | no effect stack exists (see Effects) |
| Linked A/V, separate/unlink audio | Has | `store/types.ts:407` `detachAudio`; `@shared/links` |
| Markers, coloured and labelled | Has | `store/types.ts:575` |
| In/Out work area, loop | Has | `store/types.ts:243` |
| Freeze frame | Has | `store/types.ts:489` |
| Track mute / hide / solo / height | Has, plus lock | `editor/TrackHeader.tsx:109-120` |
| Reorder tracks by dragging | Lacks | `moveTrack\|reorderTrack` → only `addTrack(kind, index)` |
| Typed tracks (text, subtitle, graphic) | N/A | bay has `video \| audio` only (`project.ts:30`); deliberate |
| Merge adjacent cuts of one source (heal a through-edit) | Lacks | `joinClips\|merge clips\|heal` → no editor hit |
| Compound clips / nested timelines (make, open, flatten) | Lacks | `compound\|nested\|precomp` → only Resolve-connector files. Model already has `timelines[]` (`project.ts:799`) but no UI switches the active one |
| Transform layer (move/scale/fade several tracks as one) | Lacks | no group or parent field on `Item` |
| Adjustment layer (effects over everything below, for a span) | Lacks | `adjustment ?(layer\|clip\|track)` → 0 files |
| Multicam: angle viewer, punch cuts live | Partial | `sync_angles`, `switch_speakers`, `applyAngleSwitch` (`types.ts:457`) exist; no viewer UI |
| "Allow overlap" / "ripple on trim" mode toggles | Lacks, by design | placement never overlaps (`placementTrack`) |
| Timeline overview / minimap | Lacks | `minimap\|overview` → 0 files |
| Customisable timeline toolbar | Lacks | — |

### Viewer

| Feature | bay | Proof |
|---|---|---|
| Transform handles on the picture | Has | `editor/viewer/TransformOverlay.tsx` |
| Crop on the picture | Has | `view.cropMode` (`commands/view.ts:24`) |
| Safe areas, thirds grid | Has | `commands/view.ts:14-15` |
| Custom guide sets (lines, margins, aspect frames, saved) | Lacks | only the two fixed overlays |
| Fullscreen preview, viewer zoom | Has | `view.fullscreenPreview`; `workspace/ViewerRegion.tsx` |
| Preview resolution Full/Half/Quarter/Auto | Lacks | no resolution control in `ViewerControls.tsx` or `Transport.tsx` |
| Proxy media (create/remove, 360–1080p, export uses originals) | Lacks | `proxies\|createProxy\|proxyPath` → only agent MCP-proxy files |
| VFR → constant-frame-rate conversion | Lacks | `vfr\|constant frame rate` → one unrelated file |
| JKL shuttle, frame step, jump to edit/marker | Has | `lib/shuttle.ts`; `playback.*` |
| Scopes | Neither has them | — |
| Blurred or transparent canvas background | Partial | solid colour and transparent (`project.ts:843`); no blur fill |

### Effects

Drift's 64 video effects by category:

- **Colour:** Brightness, Contrast, Gamma, Hue, Saturation, Temperature
- **Impact:** Beat Shake, Motion Trail, Spin Blur, Strobe, Sharpen, Zoom Punch
- **Dreamy:** Bling, Bloom/Glow, Bokeh Dream, Edge Glow/Neon, Gaussian Blur, Halation, Lens Flare, Light Leak, Lightning Sky, Star Filter, Bloom, Blur, Vignette, Time Echo
- **Glitch:** Block Glitch, Digital Glitch, Infinite Zoom, Kaleidoscope, RGB Split, Ripple/Water, Scanline Glitch, Shockwave, Pixelate, Ripple, Wave Warp
- **Keying:** Chroma Key
- **Retro:** Cinematic, Film Burn, Grayscale, Sepia, VHS, Super 8, VHS/CRT
- **Depth:** Depth Fog, Behind Subject, Depth of Field, 3D Relight, Depth View
- **Artistic:** Duotone, Comic, Oil Paint, Pencil Sketch
- **Face:** Alien Head, Big Eyes, Fat/Slim, Fisheye, Face Swap, Swirl, Wide Mouth, 3D Face Mesh, Face Props, Retouch

Drift's 23 effect templates (one-click stacks): Anime Punch, Beat Drop, Bling Drop, Glitch Cut, Blur Behind, Bubble World, Neon Cutout, Sunset Leak, Cinematic Open, Dream Fade, Comic Pop, Manga Intro, Echo Drop, Ghost Walk, Shadow Legion, Flash Storm, Storm Drop, Kaleido Chaos, RGB Rave, Neon Night, Retro Tape, Slowmo Drop, Snap Transition.

| Feature | bay | Proof |
|---|---|---|
| Per-clip ordered effect stack with typed parameters, bypass, reorder | Lacks | `Item` has `adjustments`, `grade`, `blendMode`, `masks` only (`project.ts:462-560`) |
| Colour basics | Has (better) | `Adjustments` `project.ts:372`; `Grade` `src/shared/grade.ts:86` |
| Halation, vignette, grain | Has | `grade.ts:86-103` |
| Blur | Partial | `adjustments.blur` only; no directional, spin or bokeh |
| Sharpen, glow/bloom, light leak, lens flare | Lacks | no such fields |
| Glitch, RGB split, VHS, pixelate, kaleidoscope, wave | Lacks | — |
| Chroma key | Lacks | `chroma ?key\|green ?screen\|colorkey\|keyer` → 0 files |
| Duotone, comic, sketch, oil | Lacks | — |
| Time echo / motion trail (needs earlier frames) | Lacks | — |
| Subject cut-out, text behind subject | Has | `store/types.ts:418`; `@shared/matte` |
| Click-to-segment any object | Lacks | subject mask is Apple Vision person only (`src/shared/matte.ts:79`) |
| Depth estimation effects (DoF, fog, relight) | Lacks | — |
| Face effects, retouch | Lacks | — |
| Effect templates, save a stack as a preset | Lacks | `editor/effectPresets.ts:117-123` is 7 adjustment looks |
| Blend modes | Has (16 vs Drift's 7) | `project.ts:395` |
| Flip H/V, rotate 90° | Lacks | `flipH\|flip horizontal` → no model or inspector hit |

### Transitions

Drift bundles 28:

- **Basic:** Crossfade, Dip to Black, Dip to White, Push Left, Wipe ×4, Zoom In
- **Cinematic:** Cross-Zoom Swirl, Kaleidoscope Spin, Lens Flare Wipe, Luma Fade, Radial Zoom Blur
- **Glitch:** Analog Interference, Matrix Rain, RGB Displacement, VHS Scanline
- **Liquid:** Bubbling Dissolve, Ink Bleed, Liquid Smudge, Particle Wind, Plasma Burn
- **Geometric:** Honeycomb, Linear Blinds, Pixelate Matrix, Triangle Mosaic, Voronoi Shatter

| Feature | bay | Proof |
|---|---|---|
| Dissolve, dips, wipe, push, slide, iris with direction and ease | Has (7 kinds) | `project.ts:649` |
| Audio crossfade / dip transitions | Has | `editor/library/transitions.ts:31-32` |
| Zoom, blur, glitch, luma, geometric, liquid families | Lacks | not in `TransitionKind` |
| Per-transition parameters | Lacks | `Transition` holds kind, duration, direction, ease |

### Colour

bay has wheels, curves, temperature/tint, LUT, grain, halation, vignette and copy/paste grade (`editor/color/ColorPanel.tsx:76-129`). Drift has none of those, only the six colour effects and a "Cinematic" look. No gap.

### Audio

Drift's 30 audio effects:

- **Utility:** Compressor, De-esser, EQ, Noise Gate, Voice Leveler, Limiter
- **Space:** Auto-Pan, Chorus, Echo, Flanger, Phaser, Slapback, Tremolo, Stereo Widen
- **Texture:** Bitcrush, Crystalize, 8-Bit, Tape, Vinyl
- **Transmission:** Megaphone, Muffled, Telephone, Underwater, Walkie-Talkie
- **Voice:** Alien, Chipmunk, Deep, Robot, Dark Lord, Wobble

Unreleased in Drift (CHANGELOG): pedalboard-style audio effects with series/parallel/band-split routing, LFO/envelope/step modulation, convolution reverb, keyframable audio-effect parameters.

| Feature | bay | Proof |
|---|---|---|
| Mixer with track faders, pan, master, meters | Has (Drift's own docs say it has no track volume) | `editor/audio/Mixer.tsx`; `project.ts:629` |
| Clip volume keyframes, fades, pan | Has | `KEYFRAME_PROPERTIES` `project.ts:284` |
| Ducking | Has | `project.ts:523` |
| Loudness measure and master | Has (stronger) | `src/main/export/master.ts`; `level_voices` |
| Beat detection and snap | Has | `detect_beats`; `lib/snap.ts` |
| Split on beats / quantise clips to beats / beats as markers | Partial | beats are snap targets and a tool result; no one-call split/quantise |
| Audio effects per clip or track | Lacks | `equali[sz]er\|compressor\|deesser\|reverb\|noise gate` → only prose in `audio-gain.ts`, the `export_timeline` description and `shared/sfx/*` |
| Noise removal | Lacks | `afftdn` and `arnndn` are in the ffmpeg build's required list (`script/build-ffmpeg.sh:67`) with no caller in `src` |
| Voiceover recording | Lacks | `getUserMedia\|MediaRecorder` → 0 files; `electron-builder.yml:112` says "bay does not use the microphone" |
| Fade shapes (linear, smooth, equal-power, custom) | Lacks | fades are linear (`src/shared/audio-gain.ts:80`) |
| Pick among a file's audio streams, extract all | Lacks | no stream index on `Item` |
| Keep pitch on speed change | Has | `src/renderer/src/engine/sync.ts:95` |
| TTS, SFX | Has | `generate_speech`, `score_sfx` |

### Titles, text, shapes

| Feature | bay | Proof |
|---|---|---|
| Font, weight, size, spacing, alignment, outline, shadow, plate | Has | `TextStyle` `project.ts:327` |
| Shading stack (several fills/strokes/shadows/glow/extrude; gradient and texture paint) | Lacks | single `stroke`, `shadow`, `background` |
| One-click looks (15) and style packs (33) | Partial | 7 templates (`src/shared/templates.ts:59`), 5 subtitle designs (`src/shared/subtitles.ts:55-93`) |
| Text In / Out / Loop animations (47 presets, per character/word/line) | Lacks | `typewriter\|text animation\|karaoke` → only `TextStyleSection.tsx` and `captions.ts`, neither an animation system. Word highlight exists only inside subtitle compositions |
| Clip In/Out animation presets (fade, slide ×4, zoom ×2, pop, spin ×2, bounce) | Lacks | no `animIn`/`animOut` on `Item` |
| Text on a curve, word accent rules | Lacks | — |
| Word-by-word subtitles from a transcript | Has | `add_subtitles`; `store/types.ts:549` |
| Subtitle cue editor, SRT/VTT import and export | Has | `file.importCaptions`; `src/shared/caption-export.ts:35` |
| Copy one caption style to all | Partial | re-running `add_subtitles` swaps a design; no "apply this text style to all" |
| Shapes (29), stickers, emoji as clips | Lacks as a user feature | `sticker\|emoji\|add_shape` → no editor hit. `.brf` draws rect/ellipse/path but only as code |
| Lottie / SVG vector clips with slots | Lacks | `lottie\|bodymovin` → 0 files. `.brf` covers authored motion |
| 3D model clips, 3D clip tilt, scene camera | Lacks | `gltf\|\.glb` → 0 files; `.brf` has its own 3D scene (`src/shared/scene3d.ts`) |

### Keyframing

| Feature | bay | Proof |
|---|---|---|
| Keys on position, size, rotation, scale, opacity, volume | Has | `project.ts:284` |
| Linear / hold / ease / cubic-bezier per segment | Has | `project.ts:265`; `components/controls/EaseEditor.tsx` |
| Keys on effect parameters, mask, text, crop, grade | Lacks | the 8 properties above are the whole list |
| Graph editor (value curves over time, several properties overlaid, beat markers) | Lacks | `curve editor\|graph editor\|tangent` → only grade-curve and motion-ease files |
| Mute a property's animation without deleting keys | Lacks | — |
| Auto-key | Has | `store/types.ts:434` comment |

### Speed, stabilisation, masks

| Feature | bay | Proof |
|---|---|---|
| Constant speed 0.1–16×, ripple option | Has | `src/shared/speed.ts:42`; `types.ts:405` |
| Speed ramps (curve editor, smooth/sharp points) | Lacks | `speedCurve\|speedRamp\|time remap` → only `prompt-kits.ts` |
| Reverse | Lacks | `reverse` → no hit in `project.ts`, `speed.ts`, `edit-item.ts`, `ClipSection.tsx` (hits elsewhere are shuttle and UI ordering) |
| Stabilise (re-rendered copy, or sparse transform keyframes; smoothing; tripod) | Lacks | `stabili[sz]\|deshake\|vidstab` → 0 files. `deshake` is in the build's required list, unused |
| Shape masks: rectangle, ellipse, star, heart, bars, freeform, image/video matte; feather, invert, add/subtract/intersect; keyframable | Lacks | `Mask = SubjectMask` only (`matte.ts:32`) |
| Auto-reframe following a face | Lacks | `reframe` → only prose in `skills.ts` and `put-behind-subject.ts` |

### Media, export, project, UX

| Feature | bay | Proof |
|---|---|---|
| Search, sort, grid/list, details, relink, replace | Has | `editor/library/MediaPool.tsx`; `types.ts:342` |
| Bins/folders, favourites, tree view | Lacks | `BinFolder\|folderId\|createFolder` → only unrelated hits; `favou?rite` → 0 files |
| Collect media to a folder / package project with media | Lacks | `collect media\|package project\|consolidate` → 0 files |
| Trim/crop/rotate an asset before placing | Partial | source viewer with In/Out (`editor/SourceViewer.tsx`); no asset crop or rotation |
| Video upscale / compression removal | Lacks | — |
| Scene detection | Has | `detect_cuts`; `src/main/media/scene-cuts.ts` |
| Visual footage search | Has | `index_footage` / `search_footage` |
| Stock library browser | Lacks | `pexels\|pixabay\|stock (footage\|media\|search)` → 0 files |
| Import URL | Has | `import_url` |
| Export H.264 / ProRes / VP9, WAV/MP3, PNG sequence, alpha | Has | `src/shared/ipc.ts:258`; `src/shared/tools/export-timeline.ts` |
| Export GIF, HEVC, FLAC/Opus | Lacks | not in `ExportFormat` (`ipc.ts:258`) |
| Export controls: bitrate vs constant quality, fps, downscale, metadata tags | Partial | three quality tiers and size presets (`src/shared/export-presets.ts:18-64`); no bitrate, fps or tags |
| Export presets, range export, render queue | Has | `export-presets.ts:64`; `editor/deliver/queue.ts` |
| Autosave and "restore unsaved work" on launch | Lacks | `App.tsx:79` says "nothing autosaves". `store.autosave` (`src/main/project/store.ts:537`) is called only on lock and before an update (`AccessGate.tsx:55`, `UpdateBanner.tsx:74`), and nothing reads the sidecar back |
| Undo history list, jump to a version, named snapshots | Lacks | `history panel\|undo history\|list_history` → only a comment in `App.tsx` and `tools/spec.ts` |
| Rebind shortcuts | Lacks | `rebind\|setShortcut\|keymap` → no editor hit; Preferences › Keyboard is a read-only list (`settings/sections.tsx:366`) |
| Import Premiere / FCPXML / Resolve / Kdenlive / EDL / OTIO / MOGRT | Lacks | `fcpxml\|otio\|\.edl\|prproj` → only `resolve-tools.ts` |
| Transcript editing (cut by words, silence removal) | Has | `apply_script`, `remove_silences`, `editor/TranscriptPanel.tsx` |
| Speaker labels (diarisation), filler-word tagging | Lacks | `diari[sz]` → 0 files; `filler` → only prose in `dub.ts` and `skills.ts` |
| Workspace layouts (landscape / portrait / auto) | Partial | pages and AI layout; no portrait layout |
| UI languages (15) | Lacks | no i18n layer |
| Canvas presets, project setup on first clip | Has | `project.ts:1432`; `editor/NewProjectDialog.tsx` |
| Agent access (MCP), headless | Has | `src/shared/tools/` (67 tool files) |

## (c) Ranked gaps with build specs

**One architectural fact governs most of these.** bay composites the picture in the renderer (canvas plus one shared WebGL2 context) and pipes frames to ffmpeg. So a video effect is a shader pass in the compositor, never an ffmpeg filter — which is what keeps preview, `preview_frame` and export on one path. Audio is the opposite: Web Audio in preview, an ffmpeg filter graph in export. Every audio feature is therefore two implementations that must be measured against each other.

**ffmpeg build.** The built binary on this machine (`vendor/ffmpeg/darwin-arm64/ffmpeg`) has `chromakey`, `reverse`, `areverse`, `equalizer`, `acompressor`, `deesser`, `agate`, `aecho`, `chorus`, `flanger`, `aphaser`, `tremolo`, `stereowiden`, `acrusher`, `asetrate`, `atempo`, `minterpolate`, `palettegen`/`paletteuse`, and the `gif` and `hevc_videotoolbox` encoders. Only `afftdn`, `arnndn`, `deshake`, `scdet`, `lut3d`, `sidechaincompress` and `hevc_videotoolbox` (among those relevant here) are in `REQUIRED_*` (`script/build-ffmpeg.sh:65-67`). Anything else a feature uses must be added there so `capabilities.test.ts` guards it. **Absent from the build:** vid.stab, `drawtext`, rubberband, libx264.

### 1. Effect stack with a core library — L
- **Behaviour:** each clip has an ordered list of effects; each has typed parameters (number, colour, point, toggle), an on/off switch and drag-to-reorder. The Effects Library lists them by category with a thumbnail and drag-onto-clip. Start with about 15: gaussian/directional/zoom blur, sharpen, glow, vignette, chromatic split, pixelate, glitch, VHS, film grain overlay, duotone, light leak, mirror/flip, chroma key.
- **Where:**
  - Model: optional `Item.effects?: Effect[]` (`{ id, kind, enabled?, params }`), additive in `.bay`.
  - Catalog: `src/shared/effects/`, one file per effect declaring its parameters, like `src/shared/tools/`.
  - Drawing: in `#drawSource`, the same slot as the grade (`engine/grade.ts`), reusing `glContext.ts`.
  - Store: `addEffect`, `patchEffect`, `moveEffect`, `removeEffect` in `store/slices/items.ts`.
  - Tools: an `effects` field on `edit_item` or a small `edit_effects` tool, with the catalog exposed to the agent.
  - UI: the inspector's existing `effects` tab (`InspectorTab`).
- **Must not break:**
  - Identity must resolve to no pass (the `'none'` rule) so untouched projects cost nothing.
  - Do not create a second mapping for blur or saturation. Either the existing `adjustments` stay the only source for those, or they migrate.
  - A failed shader must go through the same `gradeIssues` / `#placeholder` reporting so an export never finishes as a clean `done`.
  - Render targets must be unbound before reading (the feedback-loop bug the grade already hit).
- **ffmpeg:** none needed (shader passes).
- **Verify:** unit-test each parameter mapping. Extend `test/app/grade.mjs`-style probes to compare preview, `preview_frame` and an exported frame per effect, with a positive control that an effect at non-identity changes pixels.

### 2. Autosave and crash recovery — S
- **Behaviour:** a dirty project is written to its sidecar every N seconds of idle and after each edit burst. On next open, a newer sidecar than the saved file raises "Unsaved work from last session — Restore / Discard". A project never saved appears on the projects screen as recoverable.
- **Where:** the writer exists (`src/main/project/store.ts:537`, `persistence.ts:148`). Add a debounced caller in the renderer, a reader plus `project:recover` in `src/shared/ipc.ts`, and a dialog in `home/` and on open.
- **Must not break:** the sidecar must never overwrite the user's file (already the design). A probe must not trigger it into a fixture. Recovery loads through the same migrations.
- **Verify:** `persistence.test.ts` with a literal sidecar, newer and older than the file. A probe that kills the process after an edit and checks the offer appears.

### 3. Shape masks — M
- **Behaviour:** rectangle, ellipse and freeform (pen) masks per clip; position, size, rotation, feather, invert; several masks combined add/subtract/intersect; edited with handles on the viewer.
- **Where:** widen `Mask` in `@shared/matte` from `SubjectMask` to a union (`kind: 'rect' | 'ellipse' | 'path'`); `checkMasks` at `matte.ts:192` already validates the list. Draw in `engine/subjectMask.ts`'s slot after the grade. Overlay beside `TransformOverlay.tsx`. Expose through `edit_item.masks`.
- **Must not break:** the cut-out partner logic (`cutoutPartner`); a mask on a cut-out's clip must follow layout, crop and keys as the subject mask does.
- **Verify:** a pixel probe inside and outside the shape in preview and export; a feather ramp measured, not eyeballed.

### 4. Audio effects and noise removal — L
- **Behaviour:** per clip and per track: EQ (high-pass, low-pass, 3–4 bands), compressor, noise gate, de-esser, limiter, noise removal, and a few voice presets ("Podcast voice", "Telephone"). Each has an on/off switch.
- **Where:** `Item.audioEffects?` and `Track.audioEffects?`. Preview nodes in `engine/audio.ts`. Export filters in `src/main/export/audio-graph.ts`. UI on the Audio page and the inspector's audio tab.
- **Must not break:**
  - "Preview and export share the curve, not merely agree." EQ is safe: Web Audio biquads and ffmpeg's `equalizer`/`highpass`/`lowpass` are the same filter family; verify with a sweep.
  - Dynamics are not safe: `DynamicsCompressorNode` and `acompressor` are different detectors. Either write the compressor, gate and de-esser once as an AudioWorklet and render that same code for export, or bake dynamics into a processed file through ffmpeg and play the baked file in both paths.
  - Noise removal should be baked (ffmpeg `afftdn`/`arnndn`, content-addressed like mattes); `arnndn` needs a model file bay would have to ship.
  - The mastering loop in `master.ts` must stay last.
- **ffmpeg:** `equalizer`, `highpass`, `lowpass`, `acompressor`, `agate`, `deesser` are in the binary but not in `REQUIRED_FILTERS` — add them.
- **Verify:** `audio-render.test.ts`-style tests through the real ffmpeg per effect, and a preview-vs-export level comparison per effect that states which path it measured.

### 5. Speed ramps and reverse — M (reverse), L (ramps)
- **Behaviour:** Reverse plays a clip backwards. Speed ramp is a curve of speed over the clip with smooth or sharp points and a few presets (ease in, ease out, bullet, montage); clip length follows the curve; sound follows with pitch kept.
- **Where:**
  - `Item.reverse?` and `Item.speedCurve?`.
  - `sourceTimeAt` (`project.ts:1092`) is the single source-time mapping and must stay the only one.
  - `@shared/speed`'s `planSpeed`.
  - Reverse preview cannot come from a backwards `<video>`; bake a reversed, all-intra file in main (ffmpeg `reverse`/`areverse`, content-addressed) and treat it as the source.
  - Ramps: drive `playbackRate` in `engine/sync.ts` and write the matching piecewise `atempo`/`setpts` chain in export.
- **Must not break:** keyframes are item-relative and unaffected by speed today — say what a ramp does to them. Links, beat mapping (`beatFramesForItem`), transcript word mapping (`segmentsToWords`) and mattes (`matteSpanForItem`) all read source time.
- **ffmpeg:** `reverse`, `areverse`, `atempo`, `setpts` are in the binary; add `reverse`/`areverse`/`atempo` to `REQUIRED_FILTERS`. `reverse` buffers the whole clip in memory, so bake in segments.
- **Verify:** property tests that the mapping is monotonic and its inverse round-trips; an export whose frame N is checked against the expected source frame.

### 6. Keyframes everywhere and a graph view — M
- **Behaviour:** any numeric inspector value (crop, grade, adjustment, effect parameter, mask) gets a diamond. A graph panel under the timeline shows the selected clip's curves with draggable keys and bezier handles; per-property enable/disable.
- **Where:** generalise `KeyframeProperty` to a path string. `animatedItemAt` in `@shared/keyframes` remains the one sampler. Graph UI is a new panel reusing `EaseEditor`.
- **Must not break:** split, trim and ripple key maintenance (`sliceKeyframes`, `keyframeShiftFrames`) must cover the new properties. One `NaN` drops a whole filter chain.
- **Verify:** extend `keyframes.test.ts` per property class; export-vs-preview at a mid-segment frame.
- **Dependency:** builds on gap 1.

### 7. Adjustment layer — M
- **Behaviour:** a clip on a video track with no media; its grade and effects apply to everything composited beneath it for its span.
- **Where:** a new asset kind (`'adjustment'`). The compositor snapshots the canvas so far and passes it through the grade and effect path.
- **Must not break:** blend order, the transparent-export path, and `preview_frame`.
- **Verify:** a probe that grades through an adjustment layer and compares with the same grade applied directly to a single full-frame clip.

### 8. Clip animation presets and text animations — M
- **Behaviour:** In / Out (and for text, Loop) presets — fade, slide ×4, zoom in/out, pop, spin, bounce — with duration and ease. For text: reveal by character, word or line (typewriter, rise, blur-in, pop, wave).
- **Where:** clip presets should write ordinary keyframes on existing properties (no new renderer); store as `Item.animIn?`/`animOut?` resolved inside `animatedItemAt` so trims keep them at the edges. Per-glyph text animation needs `engine/text.ts` to lay out and draw per unit.
- **Must not break:** the transition-wins-over-fade rule at junctions; text fit reports.
- **Verify:** sample the animated layout at frames 0, mid and end; a per-word reveal measured by which glyph boxes are painted at a frame.

### 9. Richer text styling — M
- **Behaviour:** several stacked fills, outlines, shadows and glow; gradient fill; one-click looks (neon, outline, lift, hollow, gradient); save a style and apply it to all captions.
- **Where:** `TextStyle.layers?` additive, with the current `stroke`/`shadow`/`background` as the default stack (`project.ts:327`); `engine/text.ts`; `editor/TextStyleSection.tsx`.
- **Must not break:** imported font handling, and the fit report's ordering (font substitution reported before clipping).
- **ffmpeg:** none; bay draws its own text (the build has no `drawtext`, and must not need it).
- **Verify:** a pixel-probe per layer type; the version-1 fixture still loads and round-trips.

### 10. Proxies and preview resolution — M
- **Behaviour:** "Create proxy" on an asset (or automatic above a size); a badge on the clip; preview plays the proxy, export always the original. Viewer quality Full/Half/Quarter.
- **Where:** main encodes with `h264_videotoolbox` into the cache, content-addressed. `Asset.proxyPath` is machine state and should not be a `.bay` field — keep it in the database. `mediaPool.ts` picks the URL. The compositor gets a preview scale.
- **Must not break:** export and `preview_frame` must never read a proxy (a wrong picture in a file); the `bay://` allow-list; `mediaRetry`.
- **Verify:** an export hash identical with and without a proxy present; a playback probe counting pictures, not ticks.

### 11. Compound clips — L
- **Behaviour:** select clips → "Make compound"; one clip replaces them; double-click opens its timeline in a tab; "Flatten" renders it to a file.
- **Where:** `Project.timelines[]` already exists. Add an asset kind referencing a timeline id, recursive compositor draw with a cycle check, and a timeline switcher.
- **Must not break:** every `activeTimeline` assumption (tools, exports, agent diff by id), transitions, links.
- **Verify:** nested vs flat export frame equality.
- **Note:** this also delivers the group move/fade that Drift's transform layers provide.

### 12. Stabilisation — M
- **Behaviour:** "Stabilise" on a clip with smoothing and a tripod option; progress; removable.
- **Where:** vid.stab is absent by licence choice and `deshake` is weak. The better fit is Drift's second mode as a behaviour: analyse motion in main, then write sparse position/scale/rotation keyframes on the clip. No new render path and it is undoable.
- **Must not break:** existing keyframes on the clip (refuse or merge explicitly).
- **ffmpeg:** **vid.stab is not in the build and cannot be added under LGPL**; `deshake` is the only built-in. The estimator must be bay's own or an LGPL-compatible one.
- **Verify:** measured inter-frame motion before and after on a shaky specimen.
- **Unknown:** the motion estimator has to be chosen and proven.

### 13. Voiceover recording — M
- **Behaviour:** arm an audio track, record while the timeline plays, pause/resume; the take lands as a clip at the start point; mic choice and input gain.
- **Where:** renderer `getUserMedia` + `MediaRecorder`; main writes the file and imports it.
- **Must not break:** this is a product decision. `electron-builder.yml:112` currently states bay does not use the microphone, and the signed build's only entitlement is `allow-jit` (`build/entitlements.mac.plist`). Needs the audio-input entitlement, a true usage string, a permission handler (compositions currently get no permissions, and must still not), and a re-run of `release-signed`'s checks.
- **Verify:** the recorded clip's offset against a click track.

### 14. Media bins and collect media — S each
- **Behaviour:** folders in the Media Pool with drag-to-file and breadcrumbs; "Collect media" copies every used file into one folder and repoints the project.
- **Where:** `Project.bins?` plus `Asset.binId?`, additive. Collect is a main-side copy feeding the existing `relinkAssets` (`types.ts:342`).
- **Must not break:** content-addressed generated and font folders.
- **Verify:** fixture round-trip; collect then open on a path where the originals are gone.

### 15. Smaller items worth batching — S each
- More transitions (zoom, blur, luma, glitch) as shader transitions in `engine/transitions.ts`; export audio already samples the shared gain curve.
- Export: GIF (`palettegen`/`paletteuse` and the `gif` encoder are in the binary; add to `REQUIRED_*`), HEVC, fps/downscale/bitrate, metadata tags.
- Rebindable shortcuts over the existing registry (`src/shared/commands/`).
- Undo history list with jump-to (`past`/`future` already hold snapshots).
- Custom guide sets.
- Flip H/V and rotate 90°.
- Track reorder.
- Heal a through-edit.
- Blurred background fill.
- Chroma key, if not delivered in gap 1.
- Speaker labels and filler tagging on transcripts.
- Auto-reframe (face-follow) — Vision is already in the process for mattes.
- Shapes and stickers as a user tool that generates `.brf`.
- Multicam angle viewer over the existing `sync_angles` / `applyAngleSwitch`.

## (d) What bay should not copy

| Drift feature | Reason |
|---|---|
| Stock marketplace with coins, quota and consent | Breaks "nothing reaches the network" beyond the six exceptions; a commerce product in itself |
| Cloud transcription that uploads audio | CLAUDE.md: audio never leaves the machine |
| Face swap, face warps, face props, retouch | Novelty and abuse surface; several model downloads; no value for the edits bay targets |
| 3D model clips, scene camera, per-clip 3D tilt, depth relight/fog | Large renderer surface; bay's `.brf` scene already covers authored 3D |
| Lottie/SVG slot system, MOGRT import | `.brf` and HTML compositions are bay's motion path; a third format splits it |
| Agent-authored shader packages installed to disk | Arbitrary GPU code from model output, not undoable, outside bay's sandbox model |
| Effects stored on a hidden linked adjustment clip | Drift's own comments record split and unlink bugs from it; keep effects on the item |
| "Allow overlap" and "ripple" as global modes | bay's explicit verbs (`delete_items` vs `remove_range`) are the safer design |
| Typed tracks (text/subtitle/shape/adjustment) | bay's two kinds are deliberate; adjustment and shape clips fit on video tracks |
| Non-atomic batch `apply`, seconds as timeline time | bay's `transact` and frame time are stronger |
| ONNX upscalers with community model folders, add-on pack manager | Download, licence and support burden for a niche feature |
| Android/touch UI, 15 UI languages | Out of scope for a Mac desktop product today |
| Importers for Premiere / Kdenlive / Resolve / FCPXML | Low use, high maintenance; revisit OTIO/FCPXML only if users ask |
| Pedalboard audio graph with modulation and convolution reverb | Far beyond what gap 4 needs; fixed, well-matched effects first |

## (e) What I could not determine

- **Drift's runtime quality.** It was never launched; every Drift "has" is from source, docs, menus and manifests.
- **Drift's "150+ transitions".** The repository bundles 28. The rest are presumably add-on packs or marketplace content, which I could not see.
- **Whether Drift has track lock or slip/slide/roll.** Neither appears in its toolbar, track-header or menu strings; I did not read all of `TimelinePanel.qml`'s gesture code.
- **Drift's hardware encoders.** Export codec ids found are h264, h265, vp9, aac, opus, mp3, flac, gif; which hardware encoders back them was not traced.
- **bay feature quality.** "Has" means present in model, store and UI or tool; nothing was exercised.
- **Why the ffmpeg build requires `afftdn`, `arnndn` and `deshake`.** No caller in `src`; either planned work or leftovers.
- **Whether the non-required filters are in the darwin-x64 build too.** Only the arm64 binary was queried.
- **Stabilisation estimator and compressor parity** (gaps 12 and 4) are open design questions, not settled plans.
- **Overlap with the `bay-inventory` teammate.** I did not coordinate with them, so their inventory may refine individual rows.

## Key files

- `/Users/himanshu/codes/synthai/vii/src/shared/project.ts`
- `/Users/himanshu/codes/synthai/vii/src/renderer/src/store/types.ts`
- `/Users/himanshu/codes/synthai/vii/src/shared/matte.ts`
- `/Users/himanshu/codes/synthai/vii/src/shared/grade.ts`
- `/Users/himanshu/codes/synthai/vii/src/main/project/store.ts`
- `/Users/himanshu/codes/synthai/vii/src/main/export/audio-graph.ts`
- `/Users/himanshu/codes/synthai/vii/script/build-ffmpeg.sh`
- `/private/tmp/claude-501/-Users-himanshu-codes-synthai-vii/9eba4df8-4cfd-4f9f-aa4f-965ab54329d4/scratchpad/ref/Drift/docs/MCP.md`
- `/private/tmp/claude-501/-Users-himanshu-codes-synthai-vii/9eba4df8-4cfd-4f9f-aa4f-965ab54329d4/scratchpad/ref/Drift/src/mcp/McpCatalog.cpp`
- `/private/tmp/claude-501/-Users-himanshu-codes-synthai-vii/9eba4df8-4cfd-4f9f-aa4f-965ab54329d4/scratchpad/ref/Drift/src/core/Clip.h`
