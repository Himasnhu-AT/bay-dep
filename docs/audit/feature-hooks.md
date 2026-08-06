# Feature Implementation Map (`docs/audit/feature-hooks.md`)

> Agent 3 — implementation recon for the 5 queued features. All paths absolute.
> Read `docs/audit/repo_map.md` first for orientation. Generated 2026-08-01.

**Cross-cutting facts every feature relies on:**
- **State mutation** goes through the **command pattern** (`dep/apps/web/src/commands/base-command.ts`, abstract `Command` with `execute(): CommandResult | undefined` and `undo()`). Commands snapshot `EditorCore.getInstance().scenes.getActiveScene().tracks`, compute new `SceneTracks`, and call `editor.timeline.updateTracks(...)`. History is pushed **externally** by the manager (`editor.command.execute({ command })`), not by the command itself.
- **Element mutation helpers:** `dep/apps/web/src/timeline/track-element-update.ts` — `findTrackInSceneTracks`, `updateElementInSceneTracks({ tracks, trackId, elementId, update, elementPredicate })`, `updateTrackInSceneTracks`.
- **Persistence** is entirely client-side: `SaveManager` (debounced 800ms autosave) → `storageService.saveProject` → IndexedDB (`dep/apps/web/src/services/storage/service.ts`). Commands call `editor.save.markDirty()`.
- **Params UI is data-driven:** the properties panel (`dep/apps/web/src/components/editor/panels/properties/components/element-params-tab.tsx`) auto-renders any `ElementParamDefinition` via `PropertyParamField`. Effect params UI (`dep/apps/web/src/effects/components/effects-tab.tsx`) does the same from `EffectDefinition.params`. **New params generally need zero panel code.**
- **Migrations:** `dep/apps/web/src/services/storage/migrations/`, `CURRENT_PROJECT_VERSION = 31` (`index.ts`). Adding a version = (1) new `transformers/vN-to-vN+1.ts` (pure fn `transformProjectVNToVN1`), (2) wrapper class `vN-to-vN+1.ts` extending `StorageMigration` (`from`/`to`/`run`), (3) register both in `index.ts` (import + push to `migrations[]`) and bump `CURRENT_PROJECT_VERSION`, (4) add `__tests__/vN-to-vN+1.test.ts`. See `v30-to-v31.ts` + `transformers/v30-to-v31.ts` as the template.
- **Tests:** `bun test`, colocated `__tests__/` dirs, `import { describe, expect, test } from "bun:test"`. Coverage is **pure-logic only** (no React/E2E). Existing dirs: `stickers/`, `animation/`, `utils/`, `retime/`, `params/`, `timeline/`, `timeline/placement/`, `masks/`, `fps/`, `actions/keybindings/`, `services/storage/migrations/`.

---

## Feature 1 — Set background color

**Status: EXISTS (fully implemented end-to-end). Only gap is test coverage; UX polish optional.**

Background color already works: set → command (undo/redo) → persist → render, plus it is even keyframeable (`background.color` is in `ANIMATION_PROPERTY_PATHS`, resolved for text; the project-level color node is static).

### Data flow (already wired)
1. **Type:** `dep/apps/web/src/project/types.ts` — `TBackground = { type: "color"; color: string } | { type: "blur"; blurIntensity: number }`; lives on `TProjectSettings.background`.
2. **UI:** `dep/apps/web/src/components/editor/panels/assets/views/settings/background.tsx` — `BackgroundContent` renders solid swatches (`@/data/colors/solid`), gradient sets (`pattern-craft`, `syntax-ui`), a custom `ColorPickerContent` (`@/components/ui/color-picker`), and blur presets. Calls `editor.project.updateSettings({ settings: { background: { type: "color", color } }, pushHistory })`. It already distinguishes **preview** (`pushHistory:false`, live drag) from **commit** (`pushHistory:true`).
3. **Command:** `dep/apps/web/src/commands/project/update-project-settings.ts` — `UpdateProjectSettingsCommand` (execute/undo, spreads settings, `editor.save.markDirty()`).
4. **Manager:** `dep/apps/web/src/core/managers/project-manager.ts` `updateSettings({ settings, pushHistory=true })` (line 486).
5. **Render:** `dep/apps/web/src/services/renderer/scene-builder.ts` `buildScene` (line 261-266) adds `new ColorNode({ color })` to the root when `background.type === "color" && color !== "transparent"`. `ColorNode` = `dep/apps/web/src/services/renderer/nodes/color-node.ts`.
6. **Rasterize:** `dep/apps/web/src/services/renderer/compositor/frame-descriptor.ts` (line 93-107) — draws the color as a full-frame texture; **supports CSS gradients** (`/gradient\(/i` → `drawCssBackground`) and solid `ctx.fillStyle`.
7. **Persist:** via `SaveManager` (settings are part of `TProject`, serialized by `storageService`). No migration needed — `background` is already in the model.
8. **Defaults:** `dep/apps/web/src/background/color.ts` (`DEFAULT_BACKGROUND_COLOR = "#000000"`), `dep/apps/web/src/background/blur.ts`.

### Files to touch (only if extending/hardening)
- Tests (see below) — currently none.
- Optional UX: "transparent" is a recognized sentinel (skips the ColorNode) but has no swatch; add one to `background.tsx` if a transparent/checkerboard option is desired.

### Data-model changes
None. `TBackground` already covers solid color. **No migration required.**

### Test plan
- New: `dep/apps/web/src/services/renderer/__tests__/scene-builder-background.test.ts` — assert `buildScene({ background: { type: "color", color: "#ff0000" } })` adds exactly one `ColorNode` with `params.color === "#ff0000"`; assert `color: "transparent"` adds **no** ColorNode; assert `type: "blur"` adds blur nodes not a ColorNode.
- New: `dep/apps/web/src/commands/project/__tests__/update-project-settings.test.ts` — execute sets `settings.background`, `undo()` restores prior settings and `updatedAt`.

---

## Feature 2 — Audio extractor (+ keyframes)

**Status: EXISTS (fully implemented as "source-audio separation"). Volume keyframing already works. A new `ExtractAudioCommand` would be redundant.**

The feature ships as **Extract audio / Recover audio** (toggle). "Extract" sets `isSourceAudioEnabled = false` on the `VideoElement` (muting its own audio path) and inserts an upload `AudioElement` referencing the **same `mediaId`** onto an audio track — no re-encode. "Recover" flips the flag back and (per the command) restores prior tracks.

### What exists
- **Core module:** `dep/apps/web/src/timeline/audio-separation/index.ts` — `isSourceAudioEnabled`, `isSourceAudioSeparated`, `canExtractSourceAudio` (guard: `element is VideoElement`, requires `mediaAsset.hasAudio !== false`), `canRecoverSourceAudio`, `canToggleSourceAudio`, `doesElementHaveEnabledAudio`, `buildSeparatedAudioElement({ sourceElement }) → CreateUploadAudioElement` (copies mediaId/name/timing/retime/`params.volume`+`muted` and **clones the `volume` animation channel** with fresh keyframe ids), `getSourceAudioActionLabel`.
- **Command:** `dep/apps/web/src/commands/timeline/element/toggle-source-audio-separation.ts` — `ToggleSourceAudioSeparationCommand`. Uses `resolveTrackPlacement({ trackType: "audio", strategy: { type: "firstAvailable" } })` + `applyPlacement` (`dep/apps/web/src/timeline/placement/`) to place the new audio element; `updateElementInSceneTracks` to flip `isSourceAudioEnabled`.
- **Wiring:** action `"toggle-source-audio"` in `dep/apps/web/src/actions/definitions.ts` (~line 101) → handler `dep/apps/web/src/actions/use-editor-actions.ts` (~line 338) → `editor.timeline.toggleSourceAudioSeparation(...)` in `dep/apps/web/src/core/managers/timeline-manager.ts` (~line 260). UI labels ("Extract audio") in `dep/apps/web/src/timeline/components/timeline-element.tsx` (~line 345) and `timeline-toolbar.tsx` (~line 121).
- **Migration precedent:** `dep/apps/web/src/services/storage/migrations/transformers/v19-to-v20.ts` already backfills `isSourceAudioEnabled`.

### Volume keyframes (confirmed working)
- `"volume"` is in `ANIMATION_PROPERTY_PATHS` (`dep/apps/web/src/animation/types.ts` line 11).
- Volume is **not** in the visual renderer (`rendering/animation-values.ts` has no volume). It is applied in the audio layer:
  - Gain resolution: `dep/apps/web/src/timeline/audio-state.ts` — `getElementVolume`, `isElementMuted`, `hasAnimatedVolume`, `resolveEffectiveAudioGain`, `buildAudioGainAutomation`.
  - **Playback:** `dep/apps/web/src/core/managers/audio-manager.ts` — per-clip `GainNode`, animated volume scheduled via `linearRampToValueAtTime` on the clip gain; master gain from `editor.playback.getVolume()`.
  - **Export:** `dep/apps/web/src/core/managers/renderer-manager.ts` → `createTimelineAudioBuffer` in `dep/apps/web/src/media/audio.ts` (`mixAudioChannels` applies `resolveEffectiveAudioGain({ element, localTime })` per sample when animated). Mastering in `dep/apps/web/src/media/audio-mastering.ts`.
- **Audio decode from a video file already exists:** `resolveAudioBufferForAsset` in `dep/apps/web/src/media/audio.ts` (mediabunny `Input`/`AudioBufferSink` + `OfflineAudioContext` resample). `extractTimelineAudio` in `dep/apps/web/src/media/mediabunny.ts` renders a full-timeline WAV `Blob`.

### If a distinct one-way "Extract" (vs toggle) or a rendered standalone WAV asset is wanted
- Files to touch: new command `dep/apps/web/src/commands/timeline/element/extract-audio.ts` (mimic `ToggleSourceAudioSeparationCommand`; reuse `buildSeparatedAudioElement` + `resolveTrackPlacement`/`applyPlacement`); register in `dep/apps/web/src/commands/timeline/element/index.ts`; add a dispatch method on `core/managers/timeline-manager.ts`; add action in `actions/definitions.ts` + handler in `actions/use-editor-actions.ts`; menu label in `timeline/components/timeline-element.tsx`.
- For a real detached WAV media asset (independent of the video): use `resolveAudioBufferForAsset` → encode WAV → register a new `MediaAsset` via the media manager, then create a `UploadAudioElement` pointing at the new `mediaId`.

### Data-model changes
None for the existing behavior. If adding a rendered-WAV asset, that goes through the normal media pipeline (no schema change to `TProject`). **No migration required** unless a new element field is introduced.

### Test plan
- New: `dep/apps/web/src/timeline/audio-separation/__tests__/audio-separation.test.ts` — `canExtractSourceAudio`/`canRecoverSourceAudio` truth table; `buildSeparatedAudioElement` copies mediaId/timing/retime and clones the volume channel with **new** keyframe ids and preserved keyframe times/values.
- New: `dep/apps/web/src/timeline/__tests__/audio-state.test.ts` — `resolveEffectiveAudioGain` at keyframed times (linear ramp), `isElementMuted`, `hasAnimatedVolume` on an element with/without a `volume` channel.
- (If new command) `dep/apps/web/src/commands/timeline/element/__tests__/extract-audio.test.ts` — execute adds one AudioElement on an audio track + sets `isSourceAudioEnabled=false`; `undo()` restores original tracks.

---

## Feature 3 — More text + effects

**Status: PARTIAL — both subsystems are extensible and data-driven; text is easy (pure TS), a genuinely new GPU effect requires Rust/WGSL changes.**

Key architecture fact: **text is Canvas2D, param-driven; effects are GPU/WGSL via the Rust `effects` crate.** They are separate. `fonts/use-font-atlas.ts` is a font-name loader, NOT a GPU glyph atlas.

### 3A. Add a new TEXT property (e.g. `textStroke` width+color)
Text properties live in the untyped `element.params` bag; schema is `textElementParams` in `dep/apps/web/src/params/registry.ts` (lines 176-327). `TextElement` (`dep/apps/web/src/timeline/types.ts` 135-139) only adds `hidden?`/`effects?`. **letterSpacing is a complete reference implementation** for a numeric visual prop.

Files to touch (in order):
1. `dep/apps/web/src/params/registry.ts` — add entries to `textElementParams` (e.g. `strokeWidth` number, `strokeColor` color; optional `dependencies: [{ param: "strokeWidth" }]`, `keyframable`).
2. `dep/apps/web/src/timeline/defaults.ts` — add the same keys to `defaultTextElement.params` (**second source of truth — must stay in sync with the registry**), and a `DEFAULTS.text` constant if other modules reference it.
3. `dep/apps/web/src/text/primitives.ts` — extend `TextLayoutParams`; apply in draw. Note `strokeMeasuredTextLayout` **already exists but is never called** — wire it into `drawMeasuredTextLayout` (or call from the node).
4. `dep/apps/web/src/text/measure-element.ts` — read the new keys in `buildTextLayoutParamsFromElement` (typed fallback: `readNumberParam`/`readStringParam`).
5. `dep/apps/web/src/services/renderer/resolve.ts` (`resolveTextNode`) + `dep/apps/web/src/services/renderer/nodes/text-node.ts` — **only if** the value must be time-animated as a distinct color/number (mirror how `textColor`/`backgroundColor` are resolved into `ResolvedTextNodeState` and consumed in `renderTextToContext`). Params read directly inside `measureTextElement` need no node changes.
6. `dep/apps/web/src/preview/components/text-edit-overlay.tsx` — mirror the visual (`contentEditable` CSS, e.g. `-webkit-text-stroke`) so live WYSIWYG editing matches the render.
7. Panel UI: **nothing** — `element-params-tab.tsx` + `property-param-field.tsx` render any registry param automatically (only touch these for a brand-new `param.type` widget).
8. Persistence: params serialize inline in `element.params`; typed fallbacks make old projects degrade gracefully → **migration optional** (add a `vN-to-vN+1` only if you want to backfill the key eagerly).

### 3B. Add a new EFFECT (e.g. `brightness`)
Types: `dep/apps/web/src/effects/types.ts` (`Effect`, `EffectPass`, `EffectPassTemplate`, `EffectRendererConfig`, `EffectDefinition`). Registry: `dep/apps/web/src/effects/registry.ts` (`effectsRegistry`). Template: `dep/apps/web/src/effects/definitions/blur.ts`.

**TypeScript side (sufficient if reusing an existing shader/uniforms):**
1. Create `dep/apps/web/src/effects/definitions/brightness.ts` — export a shader-id const + `brightnessEffectDefinition: EffectDefinition` (`type`, `name`, `keywords`, `params: [{ key:"amount", type:"number", default, min, max, step }]`, `renderer.passes: [{ shader, uniforms: ({effectParams}) => ({...}) }]`; add `buildPasses` only for multi-pass).
2. Register: add to `defaultEffects` in `dep/apps/web/src/effects/definitions/index.ts`. Startup wiring (`registerDefaultEffects` called in `dep/apps/web/src/core/index.ts` line 33) picks it up. **Browse list (`dep/apps/web/src/effects/components/assets-view.tsx`, `effectsRegistry.getAll()`), add-to-timeline, param panel (`effects-tab.tsx`), and persistence are all generic — no changes.**

**Rust/WGSL side (REQUIRED for a genuinely new shader or new uniform names — load-bearing constraint):**
3. Add `rust/crates/effects/src/shaders/brightness.wgsl` (entry `fragment_main`).
4. `rust/crates/effects/src/pipeline.rs` — add a shader-id const + `include_str!`, build a `RenderPipeline` in `EffectPipeline::new`, insert into the `pipelines` HashMap (currently **only** `"gaussian-blur"` at ~line 134).
5. **Extend `pack_effect_uniforms`** (`pipeline.rs` ~line 265) — it currently hard-accepts only `u_sigma`/`u_step`/`u_direction` and errors (`UnsupportedUniform`) on any other name; also `EffectUniformBuffer` struct (~line 47). Branch per-shader or generalize the packing to pass `u_amount`.
6. Rebuild WASM (`vii-wasm`) so the browser gets the new pipeline.

**Persistence:** effects are stored inline as `Effect[]` on visual elements (`VideoElement`/`ImageElement`/`TextElement`/`StickerElement`/`GraphicElement`) or as standalone `EffectElement` (`type:"effect"`, rendered by `EffectLayerNode`). New effects need **no migration** (absent effects just don't render; new params default via `buildDefaultParamValues`). Numeric effect params animate via `resolveEffectParamsAtTime` automatically (path `effects.<id>.params.<key>`).

### Data-model changes
Text: none required (optional backfill migration). Effects: none required.

### Test plan
- New: `dep/apps/web/src/params/__tests__/text-params.test.ts` — assert new text param defaults present in both `getElementParams({ element: textElement })` and `DEFAULTS.text.element.params` (guards the two-source-of-truth drift).
- New: `dep/apps/web/src/text/__tests__/measure-element.test.ts` — `buildTextLayoutParamsFromElement` reads the new prop and falls back correctly when absent.
- New: `dep/apps/web/src/effects/__tests__/brightness.test.ts` — after `registerDefaultEffects`, `effectsRegistry.get("brightness")` exists; `renderer.passes[i].uniforms({ effectParams, width, height })` returns the expected uniform map; `buildDefaultEffectInstance({ effectType: "brightness" })` yields default params.
- Rust: add `#[cfg(test)]` uniform-packing test in `rust/crates/effects/src/pipeline.rs` for the new shader's uniforms (GPU pipeline itself remains untested per repo convention).

---

## Feature 4 — Save effects as motion graphics (presets)

**Status: MISSING (greenfield). No reusable effect/animation-bundle preset mechanism exists anywhere.** Only two unrelated "preset" things exist: custom **easing** presets (localStorage) and sticker **MRU** list.

### What exists (as reference only)
- `dep/apps/web/src/timeline/components/graph-editor/custom-presets-store.ts` — custom **easing** presets. Hand-rolled `useSyncExternalStore` over **localStorage** key `"graph-editor-presets"` (NOT Zustand, NOT storageService). Shape `EasingPreset[]` = `{ id, label, value: NormalizedCubicBezier, isCustom }`. API `useCustomPresets()`, `savePreset({value})`, `removePreset({id})`. **Good API-shape template, wrong storage** for large bundles.
- `dep/apps/web/src/stickers/stickers-store.ts` — Zustand + `persist` (localStorage `"stickers-settings"`); only persists `selectedCategory` + `recentStickers` (id strings, MRU). Not a bundle.
- `dep/apps/web/src/graphics/{types,registry,index}.ts` — `GraphicDefinition` is a **code-defined** catalog (`graphicsRegistry`); no user-saved presets.

### Recommended storage: mirror **saved-sounds** (IndexedDB via storageService), not localStorage
- `dep/apps/web/src/services/storage/service.ts` (`StorageService`) has no generic KV store; it wires fixed IndexedDB DBs via `IndexedDBAdapter<T>` (`dep/apps/web/src/services/storage/indexeddb-adapter.ts`). **`IndexedDBAdapter.set({key,value})` does `store.put({ id: key, ...value })`** → the value must be an object collection wrapper.
- **Saved-sounds is the exact pattern:** `savedSoundsAdapter` (DB `video-editor-saved-sounds`, store `saved-sounds`), whole collection stored under a single record key `"user-sounds"` as `SavedSoundsData { sounds; lastModified }`; methods `loadSavedSounds`/`saveSoundEffect`/`removeSavedSound`. Consumed by a Zustand store `dep/apps/web/src/sounds/sounds-store.ts`.

### Data shape
Preset payload is cleanly serializable JSON (keyframe times are element-relative → transplant directly):
```ts
// dep/apps/web/src/motion-presets/types.ts (new)
interface MotionGraphicsPreset {
  id: string; name: string; savedAt: string;
  effects: Effect[];               // from element.effects  (@/effects/types)
  animations: ElementAnimations;   // from element.animations (@/animation/types)
}
interface MotionGraphicsPresetsData { presets: MotionGraphicsPreset[]; lastModified: string }
```
**Caveat:** `ElementAnimations` may contain paths `effects.<effectId>.params.<key>`. On apply, remap effect ids **and** the matching animation-path prefixes together, or preserve original ids, so channels stay bound to the stamped effects.

### Files to touch
Save side:
- `dep/apps/web/src/motion-presets/types.ts` (new) — types above (reuse `Effect`, `ElementAnimations`).
- `dep/apps/web/src/services/storage/service.ts` — add `presetsAdapter = new IndexedDBAdapter<MotionGraphicsPresetsData>({ dbName: "video-editor-motion-presets", storeName: "motion-presets", version })` + `loadPresets`/`savePreset`/`removePreset`/`clearPresets` (copy saved-sounds methods, key `"user-presets"`).
- `dep/apps/web/src/services/storage/types.ts` — extend `StorageConfig` with `presetsDb` (match existing style).
- `dep/apps/web/src/motion-presets/motion-presets-store.ts` (new) — Zustand store mirroring `sounds/sounds-store.ts`; `save` captures from the selected element via `EditorCore.getInstance().scenes.getActiveScene().tracks` + `findTrackInSceneTracks`, reading `element.effects` + `element.animations`.

Apply side:
- `dep/apps/web/src/commands/timeline/element/effects/apply-motion-preset.ts` (new) — mirror `add-effect.ts` (`AddClipEffectCommand`) / `clipboard/paste-keyframes.ts` (closest existing analog — writes a merged `animations` object). Guard with `isVisualElement`; `updateElementInSceneTracks` to set `effects` (append or replace, remapping ids) + merge `animations` (remapping `effects.<id>.` paths); `editor.timeline.updateTracks(...)`; save `savedState` for undo.
- Register in `dep/apps/web/src/commands/timeline/element/effects/index.ts`; add dispatch on `dep/apps/web/src/core/managers/timeline-manager.ts` (alongside `addClipEffect` ~line 300).
- UI: "Save as preset" action in the effects panel (`dep/apps/web/src/effects/components/effects-tab.tsx`) + a preset browse/apply list (mirror `dep/apps/web/src/sounds/components/assets-view.tsx`).

### Data-model changes / migration
- `TProject` is unchanged (presets are a **separate DB**, not project data).
- **No storage migration required:** a brand-new IndexedDB DB is created lazily by `IndexedDBAdapter` on first `open` (`onupgradeneeded`), exactly like saved-sounds. `CURRENT_PROJECT_VERSION` stays at 31. (Only bump it if you later choose to embed presets inside project data instead.)

### Test plan
- New: `dep/apps/web/src/motion-presets/__tests__/capture-apply.test.ts` — capture from a mock element produces `{ effects, animations }`; apply onto a target element merges effects + animations and **remaps** `effects.<id>.params.*` paths to the new effect ids consistently; round-trip preserves keyframe times/values.
- New: `dep/apps/web/src/commands/timeline/element/effects/__tests__/apply-motion-preset.test.ts` — execute stamps effects+animations on a visual element; rejects non-visual; `undo()` restores original tracks.
- New: `dep/apps/web/src/services/storage/__tests__/motion-presets-adapter.test.ts` (or extend saved-sounds test style) — `savePreset`/`loadPresets`/`removePreset` round-trip under key `"user-presets"` (note `IndexedDBAdapter.set` injects `id`; use the collection-wrapper shape).

---

## Feature 5 — Testing (summary)

Convention: `bun test`, colocated `__tests__/`, `import { describe, expect, test } from "bun:test"`, **pure-logic only** (no React render, no GPU). Concrete files & assertions, by feature:

| Feature | New test file(s) | Key assertions |
|---|---|---|
| 1 Background | `dep/apps/web/src/services/renderer/__tests__/scene-builder-background.test.ts`; `dep/apps/web/src/commands/project/__tests__/update-project-settings.test.ts` | ColorNode added iff `type:"color" && color!=="transparent"`; command execute/undo restores settings |
| 2 Audio extract | `dep/apps/web/src/timeline/audio-separation/__tests__/audio-separation.test.ts`; `dep/apps/web/src/timeline/__tests__/audio-state.test.ts` | `can*SourceAudio` truth table; `buildSeparatedAudioElement` clones volume channel w/ fresh ids; `resolveEffectiveAudioGain` at keyframed times |
| 3 Text | `dep/apps/web/src/params/__tests__/text-params.test.ts`; `dep/apps/web/src/text/__tests__/measure-element.test.ts` | new param present in registry **and** defaults (drift guard); `buildTextLayoutParamsFromElement` reads/falls-back |
| 3 Effects | `dep/apps/web/src/effects/__tests__/brightness.test.ts`; Rust `#[cfg(test)]` in `rust/crates/effects/src/pipeline.rs` | definition registered; `uniforms(...)` map correct; `buildDefaultEffectInstance` defaults; Rust uniform-packing accepts new uniforms |
| 4 Presets | `dep/apps/web/src/motion-presets/__tests__/capture-apply.test.ts`; `dep/apps/web/src/commands/timeline/element/effects/__tests__/apply-motion-preset.test.ts`; `dep/apps/web/src/services/storage/__tests__/motion-presets-adapter.test.ts` | capture→apply merge + id remap; command execute/undo; IndexedDB round-trip |
| Migrations (if any feature adds a project-model field) | `dep/apps/web/src/services/storage/migrations/__tests__/vN-to-vN+1.test.ts` | idempotent, version-gated, backfills default; mirror `v30-to-v31.test.ts` |

**Migration reminder:** only Features 3-text (optional eager backfill) and a hypothetical rendered-WAV variant of Feature 2 could touch the project data model. Features 1, 2 (as shipped), and 4 need **no** `CURRENT_PROJECT_VERSION` bump. If any project-model field IS added, follow the 4-step migration recipe at the top and add the paired `__tests__` file (current head: `v30-to-v31`, next would be `v31-to-v32`).
