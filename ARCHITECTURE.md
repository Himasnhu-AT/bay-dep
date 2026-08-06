# Architecture of the archived web stack (`dep/`)

> **This documents `dep/` — the JS/web editor vii was forked from — as it stood on
> 2026-08-01.** It is kept because `dep/` is the parity reference: when porting a behaviour
> out of the web app, this is the map. It is **not** a description of vii.
>
> For vii itself see [`README.md`](README.md), [`docs/native/`](docs/native/) and
> [`todo.md`](todo.md).
>
> Synthesized from a file-system-coordinated audit: `docs/audit/repo_map.md` (structure),
> `docs/audit/features.md` (mechanics), `docs/audit/limitations.md` (risks),
> `docs/audit/feature-hooks.md` (implementation map).

---

## 1. What this is

The archived web app is a **browser-first, privacy-focused video editor**: all project and media data lives
on the client (IndexedDB + OPFS), never on a server. It is a **Turborepo monorepo** (migrated to
pnpm) with three targets and a shared Rust core:

- **`dep/apps/web`** — the real, working editor. Next.js 16 (App Router, Turbopack) + React 19 +
  Tailwind 4. ~91k LOC. This is where everything happens.
- **`rust/desktop`** — at the time of this audit, a 41-LOC GPUI skeleton. **Now stale:** the
  native editor is the product and this document no longer tracks it. See
  [`docs/native/`](docs/native/).
- **`rust/`** — a platform-agnostic Rust core compiled to WASM (`vii-wasm`): a **wgpu GPU
  compositor**, effects, masks (JFA SDF feathering), and the `MediaTime` tick-math library. Per
  `AGENTS.md`, non-UI logic is actively migrating here so `apps/*` become thin, swappable shells.

Server surface is deliberately tiny: `app/api/{auth,feedback,health,sounds/search}`. Postgres +
Redis back **only** auth/feedback/rate-limiting — **no project data**. So the editor runs fully
**without Docker**.

---

## 2. System shape

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     Turborepo monorepo (turbo + pnpm)                       │
│                                                                            │
│   dep/apps/web  (Next.js 16 — THE EDITOR)          rust/desktop  (GPUI stub)   │
│   ├── app/editor/[project_id]  ── EditorProvider → EditorLayout            │
│   │      AssetsPanel │ PreviewPanel │ PropertiesPanel │ Timeline           │
│   ├── core/  EditorCore singleton = 12 managers (observable/subscribe)     │
│   ├── timeline/ · animation/ · effects/ · text/ · masks/ · media/         │
│   └── services/renderer/ ── scene-builder → nodes → canvas-renderer ──┐    │
│                                                                       │    │
│   rust/  (compiled to WASM: vii-wasm)                             ▼    │
│   crates: compositor · effects · masks · gpu (wgpu) · time      WASM GPU   │
│                                                                 compositor │
│   client persistence:  IndexedDB (projects/media meta) + OPFS (blobs)     │
│   server (auth only):  Postgres + Redis  ── NOT needed to edit            │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Editor architecture (the important part)

### 3.1 State model — hybrid
- **`EditorCore` singleton** (`dep/apps/web/src/core/index.ts`, `core/managers/*`) composes **12
  managers**: `timeline, command, playback, scenes, project, media, renderer, save, audio,
  selection, clipboard, diagnostics`. Each is an **observable external store** (`subscribe`).
- **`useEditor(selector)`** (`editor/use-editor.ts`) is a `useSyncExternalStore` hook subscribing
  to all managers with shallow-equality memoization.
- **Zustand** stores handle UI-only state (panel sizes, canvas presets, keybindings, stickers/sounds).

### 3.2 Mutation — command pattern (undo/redo)
All edits go through `Command` (`commands/base-command.ts`): a command snapshots the active scene's
`SceneTracks`, computes new tracks, and calls `editor.timeline.updateTracks(...)`. History is pushed
by `editor.command.execute({ command })`. Concrete commands live in
`commands/{media,project,scene,timeline}`. Element edits use helpers in
`timeline/track-element-update.ts`. Commands call `editor.save.markDirty()`.

### 3.3 Persistence — client-only, debounced autosave
`SaveManager` (800 ms debounce) → `storageService.saveProject` (`services/storage/service.ts`):
- **IndexedDB** — structured project/media-metadata (`video-editor-projects`, `video-editor-media-*`)
- **OPFS** — binary media blobs (`media-files-{projectId}`)
- **31-version migration chain** (`services/storage/migrations/`, `CURRENT_PROJECT_VERSION = 31`)
  upgrades old projects on load. Adding a project-model field = a new paired `vN-to-vN+1` transformer
  + wrapper + test.

### 3.4 Render pipeline (state → pixels)
`scene-builder.ts:buildScene` builds a render tree → `resolve.ts` resolves per-frame node state →
scene-graph **nodes/** (`video/image/text/sticker/graphic/color/blur-background/effect-layer`) →
`canvas-renderer.ts` rasterizes to OffscreenCanvas → `compositor/wasm-compositor.ts` builds a
`FrameDescriptor` (`frame-descriptor.ts`) and calls the **Rust wgpu compositor** (`renderFrame`),
which composites layers/blend/masks/effects on the GPU. Export goes through
`services/renderer/scene-exporter.ts` + `export/` (mp4/webm).

### 3.5 Animation / keyframes
`animation/types.ts` defines `ANIMATION_PROPERTY_PATHS` (transform position/scale/rotate, `opacity`,
`volume`, `color`, `background.*`), bezier `ScalarAnimationKey`s (tangent modes, step/linear/bezier
segments), and per-path `ScalarChannel`s. `resolve.ts`/`interpolation.ts`/`bezier.ts` evaluate;
`rendering/animation-values.ts` samples visual props per frame; **audio volume** is sampled in the
audio layer (`timeline/audio-state.ts` → `audio-manager.ts` playback, `media/audio.ts` export). A
full **keyframe graph editor** exists (`timeline/components/graph-editor/`).

### 3.6 Effects (GPU/WGSL)
`effects/types.ts` (`Effect`, `EffectDefinition` with WGSL renderer passes + uniform builders),
`effects/registry.ts`, template `effects/definitions/blur.ts`. **Only one effect (gaussian blur) is
actually wired** — `rust/crates/effects/pipeline.rs` hard-codes that one pipeline and accepts only
`u_sigma`/`u_step`/`u_direction`. New TS-only effects (reusing the shader) are easy; a genuinely new
shader needs Rust/WGSL + a WASM rebuild.

---

## 4. Feature readiness (your five requests, mapped)

Full detail with exact files/steps/tests in **`docs/audit/feature-hooks.md`**.

| # | Feature | Status | Work required |
|---|---------|--------|---------------|
| 1 | **Set background color** | ✅ **Already works** end-to-end (`TProjectSettings.background` → `UpdateProjectSettingsCommand` → `ColorNode` → gradient-aware frame descriptor). Even keyframeable. | **Tests only** (+ optional "transparent" swatch) |
| 2 | **Audio extractor (+ keyframes)** | ✅ **Already works** as *Extract/Recover audio* (`ToggleSourceAudioSeparationCommand`, source-audio separation); **volume keyframes** already apply in playback + export | **Tests only** (+ optional one-way "Extract" / rendered-WAV asset) |
| 3a | **More text** | 🟡 Extensible, **pure TS** — add param to `params/registry.ts` + `timeline/defaults.ts` + `text/primitives.ts`; panel UI auto-generates. (`strokeMeasuredTextLayout` exists but is unwired) | Small, additive |
| 3b | **More effects** | 🟡 TS side easy; a **new GPU shader needs Rust/WGSL** (`effects/pipeline.rs` + new `.wgsl` + generalize `pack_effect_uniforms`) + `wasm-pack` rebuild | Medium (Rust + WASM) |
| 4 | **Save effects as motion graphics (presets)** | 🔴 **Greenfield** — no effect/animation-bundle presets exist. Mirror the **saved-sounds IndexedDB** pattern: new `motion-presets/` module + `apply-motion-preset` command + store + UI | Largest; net-new |

Key subtlety for #4: `ElementAnimations` can key on `effects.<effectId>.params.*`, so applying a
preset must **remap effect ids and their animation-path prefixes together**. No project migration
needed (presets live in a separate DB).

---

## 5. Testing & tooling reality (must resolve before "cover all with tests")

- **30 real test files exist**, but they are **pure-logic only** (storage migrations 19/31, timeline
  placement, animation, retime, fps, mask-snap) and all `import { ... } from "bun:test"`.
- **CI does not run them**: `.github/workflows/bun-ci.yml`'s test step is `echo "No tests
  implemented yet"` with `continue-on-error: true`.
- **The pnpm migration is half-done for tests**: the runner is `bun test`, `dep/apps/web/package.json`
  still declares `bun@1.2.18`, and **bun is not installed** here. So neither the existing tests nor
  new ones run until we pick a runner: **(a) install bun as a test-runner only**, or **(b) port
  `bun:test` → vitest** (single pnpm/vitest toolchain, no bun). Whole render/WASM/GPU/React surface
  (~91k LOC) — exactly what these features touch — is currently untested.
- Rust: `time`/`bridge` crates are tested; `compositor/effects/masks/gpu` have no test modules (GPU-bound).

---

## 6. Bottom line

This is a **mature, working browser video editor** with a sophisticated architecture (command/undo,
observable managers, a keyframe graph editor, a Rust/WASM GPU compositor, 31-version client
persistence). Of the five requested features, **two already exist** and need only tests, two are
additive TS work (one needing a Rust/WASM effect), and one (motion-graphics presets) is greenfield
but has a clean precedent (saved-sounds). The gating decision before writing any tests is the
**test runner** (bun vs vitest), since the current one doesn't run in this pnpm environment.

---

*Sources: `docs/audit/{repo_map,features,limitations,feature-hooks}.md`. Board: `docs/audit/team_sync.md`.
The repo's own subsystem docs (`docs/effects-renderer.md`, `docs/keyframes.md`, `docs/actions.md`)
are preserved and worth reading.*
