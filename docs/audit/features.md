# vii — Feature, Data-Flow & Mechanics Map (Agent 1)

> Source-grounded audit of how the *actual, working* editor behaves. Every claim below is
> tied to a real file under `/Users/himanshu/codes/synthai/vii`. Generated 2026-08-01.
> Companion to `repo_map.md`. Investigate against the source, not the map — where this
> document and the map disagree, this document was written from the code.

---

## 1. What the product is

vii is a **browser-first, privacy-focused, non-linear video editor** (`README.md`).
All project/timeline/media content lives on the user's device (IndexedDB + OPFS); the server
holds only auth/feedback. The web app (`dep/apps/web`, Next.js 16 + React 19) is the real editor;
`rust/desktop` is a 41-LOC GPUI stub (empty window). Per `AGENTS.md` there is an **ongoing
migration** to move all non-UI logic into `rust/` (compiled to WASM, published as
`vii-wasm`); today the migration has landed the **time math** (`rust/crates/time`) and the
whole **GPU compositor / effects / masks pipeline** (`rust/crates/{compositor,effects,masks,gpu}`),
while the editor's domain logic (timeline, commands, animation, scene building) still lives in TS.

Note the repo's own README is the *legacy* vii README ("archived… rewrite is happening
at vii-app/vii") — so this codebase is a snapshot mid-rewrite. Contributor guidance in
README explicitly says the **preview panel (fonts, stickers, effects) and export are being
refactored with a new binary rendering approach** — which is exactly the Rust/WASM compositor
seen here. Treat preview/export internals as actively-moving targets.

---

## 2. Feature catalog (with maturity)

Grounded in real paths. Maturity: **Solid** = fully wired end-to-end; **Working** = functional
but narrow; **Nascent** = scaffolding/one example only.

### Timeline editing — Solid
- Model: `timeline/types.ts`. A project has **scenes** (`TScene`); each scene has
  `SceneTracks { overlay: OverlayTrack[]; main: VideoTrack; audio: AudioTrack[] }`. Track types:
  `video | text | audio | graphic | effect` (`TrackType`). There is exactly one `main` video
  track; everything else is an overlay or audio track.
- Elements all extend `BaseTimelineElement` (`id, name, duration, startTime, trimStart, trimEnd,
  sourceDuration?, animations?, params`) with `MediaTime` (integer-tick) times. Concrete types:
  `VideoElement, ImageElement, TextElement, StickerElement, GraphicElement, EffectElement,
  AudioElement` (upload/library variants).
- Editing verbs are methods on `TimelineManager` (`core/managers/timeline-manager.ts`): add/remove
  track, insert/delete/duplicate/split/move elements, trim, retime, toggle mute/visibility,
  clip effects add/remove/reorder/toggle, mask ops, keyframe upsert/remove/retime/curve edits.
  **Every mutation goes through a Command** (`editor.command.execute`) for undo/redo (§3).
- Placement / drag-drop / snapping / group-move / ripple: `timeline/placement/*`,
  `timeline/snapping/*`, `timeline/group-move`, `ripple/*`. Controllers in
  `timeline/controllers/` (drag-drop, resize, seek, zoom, playhead, keyframe-drag,
  element-interaction).
- **Live drag preview without history**: `TimelineManager.previewElements / commitPreview /
  discardPreview` maintain an overlay map (`previewOverlay`) merged over committed tracks; commit
  writes a single `TracksSnapshotCommand`. This is how dragging feels instant but only records
  one undo entry.

### Media import — Solid
- `media/mediabunny.ts` (demux/decode via `mediabunny`), `media/processing.ts`,
  `media/thumbnail.ts`, `media/use-file-upload.ts`, `media/use-paste-media.ts`.
- Decoded video frames are cached in `services/video-cache/service.ts` (`videoCache.getFrameAt`),
  which is what the renderer samples per frame. Waveforms cached in `services/waveform-cache/`.
- Assets exposed to the renderer via `MediaManager.getAssets()` (`core/managers/media-manager.ts`),
  shape `MediaAsset { id, type: 'video'|'image'|'audio', file, url, ... }`.

### Text — Working/Solid
- `text/{typography,layout,measure-element,background,primitives}.ts`. Text is measured
  (`measureTextElement`) then rasterized to a canvas texture (`renderTextToContext`) each frame.
- Fonts: `fonts/{google-fonts,system-fonts,use-font-atlas}.ts`. Text color, background color,
  padding/offset/cornerRadius are keyframeable (see the `background.*` and `color` property paths
  in `animation/types.ts`).

### Subtitles / captions + Transcription — Working
- `transcription/*` runs Whisper in-browser via `@huggingface/transformers`
  (`transcription/{models,audio,caption,languages}.ts`); diagnostics registered at editor
  construction (`registerTranscriptionDiagnostics`, `core/index.ts:47`).
- `subtitles/*` parses/builds **SRT and ASS** (`subtitles/{srt,ass,parse}.ts`) and turns cues
  into text elements (`subtitles/build-subtitle-text-element.ts`, `insert.ts`).

### Stickers — Working
- `stickers/{registry,resolver,categories,intrinsic-size}.ts`, provider sources in
  `stickers/providers/`. Rendered by `StickerNode`; intrinsic size stored at insert time so
  preview bounds and renderer agree (`StickerElement.intrinsicWidth/Height`).

### Graphics (vector shapes) — Working
- `graphics/definitions/` ships **rectangle, ellipse, polygon, star** (`graphics/definitions/index.ts`);
  registry in `graphics/registry.ts`, stroke handling in `graphics/stroke.ts`. Rendered by
  `GraphicNode` (params resolved per-frame via `resolveGraphicElementParamsAtTime`).

### Masks — Solid (rich)
- Builtins in `masks/builtin/definitions/`: **rectangle, ellipse, star, heart, diamond,
  cinematic-bars, split, text**, plus **freeform** paths (`masks/freeform/`). Feathering is done
  on GPU via a **Jump-Flood-Algorithm SDF** in the Rust `masks` crate; some masks (e.g. split)
  encode feather analytically on the CPU and zero the GPU feather (`frame-descriptor.ts:399-408`).
- Only **`masks[0]` is honored by the renderer** today (`frame-descriptor.ts:388` — `node.params.masks?.[0]`).
  Stroke rendered as a separate overlay layer.

### Effects — Working but **narrow** (see §5)
- Engine is fully built (Effect vs EffectDefinition, WGSL passes, Rust pipeline), but only **one
  effect definition is registered**: **blur** (`effects/definitions/index.ts` →
  `[blurEffectDefinition]`). Adding effects means adding `EffectDefinition`s. Effects attach to
  visual elements (`effects?: Effect[]` on video/image/text/sticker/graphic) OR as a full-scene
  `EffectElement` on an `effect` track (`EffectLayerNode`).

### Keyframe animation + graph editor — Solid (see §4)
- Property/effect-param/graphic-param channels, bezier handles, tangent modes, extrapolation.
  Graph editor UI: `timeline/components/graph-editor/` (`bezier-graph.tsx`, `easing-presets.ts`,
  `custom-presets-store.ts`).

### Retime / speed — Working
- `retime/*` (`rate.ts, resolve.ts, audio-stretch.ts, split.ts, presets.ts`), `speed/components/`.
  `RetimeConfig { rate, maintainPitch? }` on video/audio elements; source time is derived from clip
  time via `getSourceTimeAtClipTime` (`retime/`) during resolve (`services/renderer/resolve.ts:199`).
  Audio pitch handled by `soundtouchjs` in mastering.

### Ripple edit — Working
- `ripple/{apply,diff,shift}.ts`. Applied **automatically after any command** when
  `CommandManager.isRippleEnabled` (`commands.ts:127 applyRippleIfEnabled`) — it diffs
  before/after tracks and shifts downstream elements, writing the result back via
  `timeline.updateTracks`.

### Audio — Working
- `core/managers/audio-manager.ts` (largest manager, 18 KB): playback mixing / mastering.
  `media/audio.ts:createTimelineAudioBuffer` builds a mixed `AudioBuffer` for export.
  `media/audio-mastering.ts`, `media/waveform-summary.ts`. Source-audio separation from video is a
  command (`ToggleSourceAudioSeparationCommand`). Waveform UI: `timeline/components/audio-waveform`,
  `audio-volume-line`. **Note for the audio-extractor goal**: separation exists, but
  `volume` is already a keyframeable animation path (`animation/types.ts:14`).

### Background — Working (relevant to the "background color" goal)
- `TProjectSettings.background: TBackground` is a union: `{type:'color', color}` **or**
  `{type:'blur', blurIntensity}` (`project/types.ts:5-13`). `buildScene` (`scene-builder.ts:251-266`)
  emits a `ColorNode` for a solid/gradient color (skipped when `"transparent"`) or
  `BlurBackgroundNode`s (backdrop = blurred main-track media) for blur. Preview mount div also
  paints the color as a CSS fallback (`preview/components/index.tsx:319-323`). So background color
  is *already modeled*; the goal is UI + persistence, not a new data path.

### Export — Working (being refactored)
- `RendererManager.exportProject` (`renderer-manager.ts:141`) → `services/renderer/scene-exporter.ts`
  (uses **mediabunny** for muxing/WebCodecs encode). Formats/quality in `export/{defaults,mime-types}.ts`
  (mp4/webm tiers). Audio optionally mixed in via `createTimelineAudioBuffer`. Also single-frame
  PNG **snapshot** to file or clipboard (`renderer-manager.ts:42-139`).

### Autosave / persistence — Solid (see §3)
- Debounced 800 ms autosave (`core/managers/save-manager.ts`) → `storageService.saveProject`
  (IndexedDB + OPFS). **31-version migration chain** (`services/storage/migrations/`).

### Desktop — Nascent (~0%)
- `rust/desktop/src/main.rs` = 41 LOC GPUI window titled "vii", no editor wiring. Answer to
  the goal-6 question: today it is a placeholder shell, not an editor.

---

## 3. Core data flow

### 3a. How a preview frame is produced (state → GPU)

Two decoupled loops, joined by `RendererManager.renderTree`:

1. **Scene-tree build (data-driven).** `RenderTreeController` (`preview/components/index.tsx:95`)
   subscribes via `useEditor` to `timeline.getPreviewTracks()` (preview overlay or committed
   tracks), `media.getAssets()`, and `project.settings.background`. On any deep change it calls
   `buildScene(...)` (`services/renderer/scene-builder.ts`) and stores the resulting `RootNode`
   on `editor.renderer.setRenderTree`. `buildScene` walks tracks **bottom-to-top** (overlays
   reversed, main last), filters hidden tracks/elements, and creates one scene-graph node per
   element: `VideoNode | ImageNode | TextNode | StickerNode | GraphicNode | EffectLayerNode`, plus
   `ColorNode`/`BlurBackgroundNode` for the background. Transform/opacity/blend are read from
   `element.params` via `rendering` helpers (`buildTransformFromParams`, etc.).

2. **Raster/composite loop (time-driven).** `PreviewCanvas` runs a RAF loop (`useRafLoop(render)`,
   `preview/components/index.tsx:185-214`). Each tick computes `renderTime = min(playhead,
   lastFrameTime)`, snaps it to a frame index, and **skips** if `(frame, renderTree)` are
   unchanged — so a paused, static scene does no GPU work. Otherwise `CanvasRenderer.render`:
   - `resolveRenderTree` (`services/renderer/resolve.ts`): for each node, samples its state **at
     `time`** — decodes/gets the video frame from `videoCache`, computes animated transform/opacity/
     color, measures text, resolves effect passes per node. Off-clip nodes resolve to `null`.
   - `buildFrameDescriptor` (`compositor/frame-descriptor.ts`): flattens resolved nodes into a
     serializable `FrameDescriptor { width, height, clear, items[] }` plus a
     `TextureUploadDescriptor[]`. Each visual layer becomes a `{type:'layer', textureId, transform
     (center/size/rotation/flip), opacity, blendMode, effectPassGroups, mask}` item; scene effects
     become `{type:'sceneEffect', effectPassGroups}`. Textures are either **external** (decoded
     video/image/sticker canvas, cached by object identity) or **rendered** (color/text/mask/blur,
     cached by a `contentHash` string so an unchanged layer is neither redrawn nor re-uploaded).
   - `wasmCompositor.ensureInitialized` → `syncTextures` (diff against cache; `uploadTexture` /
     `releaseTexture` into WASM) → `render(frame)` (`compositor/wasm-compositor.ts`).

3. **WASM/GPU composite.** `renderFrame(frame)` (`rust/wasm/src/compositor.rs:154`) deserializes the
   `FrameDescriptor` (serde-wasm-bindgen) and calls `Compositor::render_frame`
   (`rust/crates/compositor/src/compositor.rs:344`). It clears a scene texture, then **for each
   item in order**: renders the source texture through the **layer** pipeline (position/scale/
   rotate/flip/opacity via `LayerUniformBuffer`, shader `layer.wgsl`), applies per-layer
   `effect_pass_groups` (each group = a WGSL effect chain), applies the **mask** pipeline
   (`mask.wgsl`; JFA feather from the `masks` crate when `feather>0`), then **blends** onto the
   accumulating scene via `blend.wgsl` (`BlendMode`). Scene effects run over the whole
   accumulated scene. On **WebGPU** it renders straight to the canvas surface; on **WebGL** it
   composites to a texture then `present_texture_to_surface`. The compositor's canvas is **mounted
   directly into the preview DOM** (`preview/components/index.tsx:170-183`) — no per-frame pixel copy.

   GPU availability is decided at load: `EditorProvider` calls `initializeGpuRenderer()`
   (`services/renderer/gpu-renderer.ts`) and sets `renderer.setDegraded(true)` if no GPU.

### 3b. Command / undo-redo flow
`CommandManager` (`core/managers/commands.ts`) holds `history[]` + `redoStack[]` of
`CommandHistoryEntry { command, previousSelection, selectionOverride? }`. `execute({command})`:
snapshots selection → `command.execute()` → optional **ripple** pass → applies a returned
`CommandResult.selection` patch → runs **reactors** → pushes to history and clears redo. Commands
live in `commands/{media,project,scene,timeline}` on `commands/base-command.ts` + `batch-command.ts`
(`BatchCommand` groups many into one undo step; the timeline manager uses it for multi-keyframe
edits). `undo()` pops, calls `command.undo()`, and **only restores selection when the command
declared a `selectionOverride`** (so UI selection made between commands survives undo). One reactor
is registered in `core/index.ts:49` — it **prunes empty overlay/audio tracks** after every command.

### 3c. Autosave / persistence flow
`SaveManager` (`core/managers/save-manager.ts`) subscribes to `scenes` + `timeline` changes;
each change `markDirty()` → debounced 800 ms `saveNow()` → skips if loading/migrating →
`project.saveCurrentProject()` → `storageService.saveProject`. `StorageService`
(`services/storage/service.ts`): projects in IndexedDB DB `video-editor-projects`; media metadata
in per-project DB `video-editor-media-{projectId}`; **binary media blobs in OPFS**
(`media-files-{projectId}`, `opfs-adapter.ts`); saved sounds in `video-editor-saved-sounds`.
`saveProject` strips audio `buffer`s and ISO-serializes dates into `SerializedProject/Scene`
(`storage/types.ts`). On load, `ensureMigrations()` runs the **31-step chain**
(`migrations/`, `CURRENT_PROJECT_VERSION = 31`). Quota handled by `storage/quota.ts` +
`storage-persistence-dialog.tsx`. Server DB (`db/schema.ts`) stores **only** auth + feedback —
no project data.

### 3d. Playback clock
`PlaybackManager` (`core/managers/playback-manager.ts`) drives time with a RAF timer measuring
wall-clock elapsed from `playbackStartWallTime`, converting via `mediaTimeFromSeconds` and snapping
to the frame grid with `roundFrameTime` (all through the WASM time module). It clamps to timeline
duration, auto-pauses at the end, and re-clamps whenever tracks/scenes change (`bindTimelineScope`
subscribes to timeline + scenes). The preview RAF loop reads `playback.getCurrentTime()` — playback
and rendering are independent loops joined only by the current-time read.

---

## 4. Animation / keyframe system mechanics

Types in `animation/types.ts`; sampling in `animation/interpolation.ts` + `resolve.ts`;
per-frame application in `rendering/animation-values.ts`.

- **Property paths.** Built-in animatable paths (`ANIMATION_PROPERTY_PATHS`):
  `transform.positionX/positionY/scaleX/scaleY/rotate`, `opacity`, `volume`, `color`,
  `background.color`, `background.paddingX/paddingY/offsetX/offsetY/cornerRadius`. Beyond these,
  paths are **dynamic strings**: graphic params `params.<key>` (`GraphicParamPath`) and effect
  params `effects.<effectId>.params.<key>` (`EffectParamPath`,
  `animation/effect-param-channel.ts`). `ANIMATION_PROPERTY_GROUPS` links `transform.scale` →
  scaleX+scaleY for grouped UI editing.
- **Channels.** `ElementAnimations` is a map `path → ChannelData`. `ChannelData` is either a
  **leaf** channel or a **composite** (`Record<string, Channel>`) — colors are composite with
  `r/g/b/a` scalar sub-channels (`resolve.ts:110-152`). A `ScalarChannel` = `{ keys:
  ScalarAnimationKey[]; extrapolation?: {before, after: 'hold'|'linear'} }`. A `DiscreteChannel`
  holds `DiscreteAnimationKey`s (boolean/string, step-held).
- **Keyframe shape.** `ScalarAnimationKey { id, time (MediaTime, relative to element start),
  value:number, leftHandle?, rightHandle? (CurveHandle {dt:MediaTime, dv:number}),
  segmentToNext: 'step'|'linear'|'bezier', tangentMode: 'auto'|'aligned'|'broken'|'flat' }`.
- **Evaluation** (`getScalarChannelValueAtTime`, `interpolation.ts:241`): channel is normalized
  (keys sorted, handles clamped to the neighbor span — `normalizeScalarChannel`). Before the first
  / after the last key it **extrapolates** (`hold` returns the edge value; `linear` extends the
  slope to the nearest neighbor). Between two keys it dispatches on the left key's `segmentToNext`:
  `step` → hold left value; `linear` → `lerp`; `bezier` → solve progress for time
  (`solveBezierProgressForTime`) then evaluate the cubic (`getBezierPoint`, `bezier.ts`) using
  the left key's `rightHandle` and the right key's `leftHandle` (defaults derived if absent).
  Discrete channels (`getDiscreteChannelValueAtTime`) return the last key at/ before `time`.
- **Per-frame sampling.** During resolve, `getElementLocalTime` maps timeline time → element-local
  time clamped to `[0, duration]` (`rendering/animation-values.ts` also clamps ≥0). Then
  `resolveAnimationPathValueAtTime(animations, path, localTime, fallbackValue)` returns the animated
  value or the element's static base value. This feeds `resolveTransformAtTime`
  (`rendering/animation-values.ts`), `resolveOpacityAtTime`, `resolveColorAtTime`
  (`animation/values.ts`), `resolveEffectParamsAtTime` (`effect-param-channel.ts:57`), and
  `resolveGraphicElementParamsAtTime` — all invoked in `services/renderer/resolve.ts`. Deleting all
  keyframes on a property pre-samples the playhead value so "what you see is what you get"
  (`timeline-manager.ts:537-590`).
- **Editing.** Keyframe CRUD are commands (`commands/timeline/keyframes/`), surfaced by
  `TimelineManager.upsertKeyframes / removeKeyframes / retimeKeyframe / updateKeyframeCurves /
  upsertEffectParamKeyframe`. The **graph editor** (`timeline/components/graph-editor/`) edits bezier
  handles/tangents and has easing presets (`easing-presets.ts`) + user-saved custom presets
  (`custom-presets-store.ts`). Bridging helpers: `animation/{curve-bridge,graph-channels,
  keyframe-query}.ts`.

---

## 5. Effects system mechanics

- **Two concepts** (`effects/types.ts`):
  - `Effect { id, type, params: ParamValues, enabled }` — an **instance** stored on an element
    (`element.effects?: Effect[]`) or an `EffectElement` (`effectType`) on an effect track.
  - `EffectDefinition { type, name, keywords, params: ParamDefinition[], renderer:
    EffectRendererConfig }` — the **template**, registered in `effectsRegistry`
    (`effects/registry.ts`, a `DefinitionRegistry`). `renderer` holds `passes:
    EffectPassTemplate[]` (each builds `uniforms` from `{effectParams, width, height}`) and an
    optional `buildPasses(...)` that returns a full `EffectPass[]` (used when the pass count is
    data-dependent — e.g. blur picks an iteration count).
- **Registration.** `registerDefaultEffects()` runs in the `EditorCore` constructor
  (`core/index.ts:33`). Today it registers exactly **one** definition: **blur**
  (`effects/definitions/{index,blur.ts}`). Blur is a separable Gaussian: N horizontal+vertical
  passes of shader `"gaussian-blur"`, sigma derived from an `intensity` param scaled by resolution
  (`intensityToSigma`, reference 1920×1080). This is the extension point for the "more effects" goal.
- **Resolution to passes.** `resolveEffectPasses` (`effects/index.ts:11`) turns a definition +
  resolved params into `EffectPass[] { shader, uniforms: Record<string, number|number[]> }`. In the
  render resolve, `resolveEffectPassGroups` (`services/renderer/resolve.ts:99`) filters
  `enabled` effects, samples each effect's params at the current time via
  `resolveEffectParamsAtTime` (so **effect params are keyframeable**), and produces
  `EffectPass[][]` (one inner array per effect, preserving order). This lands on the resolved node
  as `effectPasses`, then on the frame item as `effectPassGroups`.
- **Reaching Rust.** `frame-descriptor.ts` copies `effectPassGroups` onto each `layer`/`sceneEffect`
  item. `renderFrame` deserializes them; `Compositor::apply_effect_groups`
  (`compositor.rs:485`) runs each group as a chain via the Rust `effects` crate
  (`EffectPipeline::apply_with_encoder`, WGSL in `rust/crates/effects/`, e.g. `gaussian_blur.wgsl`).
  Per-layer effects run **after** the layer is rasterized and **before** masking/blending
  (`compositor.rs:433-442`); scene effects run over the accumulated scene. `map_effect_passes`
  (`compositor.rs:852`) converts the descriptor uniforms (`Number`/`Vector`) into the crate's
  `UniformValue`. **The shader must exist in the Rust `effects` crate** — adding a TS
  `EffectDefinition` with a new shader name requires a matching WGSL pass on the Rust side. Docs:
  `docs/effects-renderer.md`.

---

## 6. State model

**Hybrid: an OOP manager layer for editor/domain state + Zustand for UI-only state.**

### 6a. EditorCore managers (the source of truth)
`EditorCore` (`core/index.ts`) is a **singleton** (`getInstance()`, `reset()` for tests) composing
**12 managers**, each constructed with a back-reference to the core:
`command, timeline, playback, scenes, project, media, renderer, save, audio, selection, clipboard,
diagnostics`. Construction order matters (command first, since managers route mutations through it);
the constructor also `registerDefaultEffects()/Masks()`, registers transcription diagnostics,
binds the playback timeline scope, registers the empty-track-pruning reactor, and starts autosave.

**Each manager is its own observable external store**: a private `Set<listener>` with
`subscribe(fn)` returning an unsubscribe, and a private `notify()`. There is no central store —
state lives inside each manager (e.g. `PlaybackManager.currentTime`, `TimelineManager.previewOverlay`,
`RendererManager.renderTree`). Managers read each other through `this.editor.<manager>` and mutate
tracks through `scenes.updateSceneTracks` (via `timeline.updateTracks`).

### 6b. The observable / subscribe bridge to React
`useEditor` (`editor/use-editor.ts`) is a `useSyncExternalStore` hook:
- `useEditor()` returns the singleton (no subscription).
- `useEditor(selector)` subscribes to **nine** managers at once (playback, timeline, scenes,
  project, media, renderer, selection, clipboard, diagnostics — note **not** command/save/audio),
  runs `selector(editor)` in `getSnapshot`, and memoizes with **shallow-array equality**
  (`isShallowEqual`) so a selector returning an array of stable refs doesn't cause re-renders.
  Because it subscribes to all nine on every use, any manager `notify()` re-evaluates the selector;
  the equality check is what prevents render storms.

### 6c. Zustand stores (UI-only)
Purely presentational/ephemeral concerns: `editor/editor-store.ts` (init flags, canvas presets),
`editor/panel-store.ts`, `timeline/timeline-store.ts`, `preview/preview-store.ts`,
`actions/keybindings-store.ts`, `stickers/stickers-store.ts`, `sounds/sounds-store.ts`,
`timeline/components/graph-editor/custom-presets-store.ts`, `app/projects/store.ts`. These never
hold canonical project data — that always lives in the managers and is persisted from there.

---

## Key entry points (fast index)
- Editor route/load: `app/editor/[project_id]/page.tsx`, `components/providers/editor-provider.tsx`
- State core: `core/index.ts`, `core/managers/*`, `editor/use-editor.ts`
- Timeline: `timeline/types.ts`, `core/managers/timeline-manager.ts`, `timeline/placement/resolve.ts`
- Commands: `core/managers/commands.ts`, `commands/**`
- Render build: `services/renderer/scene-builder.ts`; resolve: `services/renderer/resolve.ts`
- Frame → GPU: `services/renderer/compositor/frame-descriptor.ts`, `compositor/wasm-compositor.ts`
- Rust composite: `rust/wasm/src/compositor.rs`, `rust/crates/compositor/src/compositor.rs`
- Animation: `animation/{types,interpolation,resolve,bezier,effect-param-channel}.ts`,
  `rendering/animation-values.ts`
- Effects: `effects/{types,registry,index}.ts`, `effects/definitions/blur.ts`
- Persistence: `core/managers/save-manager.ts`, `services/storage/service.ts`, `migrations/`
- Background: `project/types.ts` (`TBackground`), `scene-builder.ts:251-266`
