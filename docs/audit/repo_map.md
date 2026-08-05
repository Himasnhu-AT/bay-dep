# OpenCut Repository Map (`/Users/himanshu/codes/synthai/vii`)

> Raw output from the Explore agent. Orientation document for the audit team. Generated 2026-08-01.

OpenCut is a browser-first, privacy-focused video editor. It is a **Turborepo/pnpm monorepo** with a Next.js web app (the real, working editor), a nascent GPUI desktop shell, and a Rust core (compiled to WASM) that is the "single source of truth for non-UI logic" per an active migration.

## 1. Top-level Layout

```
/
├── apps/
│   ├── web/            # @opencut/web — the working Next.js 16 editor (~91k LOC TS/TSX)
│   └── desktop/        # opencut-desktop — GPUI native shell (41 LOC, skeleton only)
├── rust/
│   ├── crates/         # Platform-agnostic Rust core (compositor, effects, masks, gpu, time, bridge)
│   └── wasm/           # opencut-wasm — wasm-bindgen glue crate published to npm
├── docs/               # effects-renderer.md, keyframes.md, actions.md, countries-search.md, audit/
├── notes/              # primitives-vs-domains.md (design note)
├── script/             # setup-rust, setup-rust.ps1 (Rust toolchain bootstrap)
├── eslint/rules/       # custom ESLint rules
├── .github/workflows/  # bun-ci.yml (single CI workflow)
├── Cargo.toml          # Rust workspace (members: desktop + all rust crates)
├── turbo.json          # Turborepo tasks (build/dev/lint/deploy)
├── pnpm-workspace.yaml # workspaces: apps/*, packages/* (packages/ does NOT exist yet)
├── docker-compose.yml, wrangler.jsonc, biome.json, eslint.config.mjs
├── AGENTS.md           # architecture manifesto: logic → rust/, apps/ are replaceable UI shells
└── README.md, LICENSE (MIT)
```

Note: `pnpm-workspace.yaml` references `packages/*` but **no `packages/` directory exists** — shared code lives in `dep/apps/web/src` and `rust/`. Package manager is declared inconsistently: root `package.json` says `pnpm@11.13.0`, `dep/apps/web` says `bun@1.2.18`, and the test script is `bun test`.

## 2. Tech Stack & Tooling

**Monorepo/build:** Turborepo 2.8, pnpm 11 (root) / bun 1.2 (web + tests), TypeScript 6 (root) / 5.8 (web). Biome + Prettier + ESLint 9 (flat config, custom rules in `eslint/rules/`).

**Web app (`dep/apps/web/package.json`):**
- **Next.js 16.1.3** (App Router, Turbopack dev, `output: "standalone"`), **React 19**, Tailwind CSS 4.
- **Zustand 5** for UI stores; a custom class-based `EditorCore` manager layer for editor state (see §4).
- **Drizzle ORM 0.44** + `postgres`/`pg` (Postgres), **better-auth 1.2** (auth), **Upstash Redis + Ratelimit** (rate limiting).
- **opencut-wasm 0.2.10** (the Rust core), **mediabunny** (media demux/encode), **wavesurfer.js** + **soundtouchjs** (audio/waveforms), **@huggingface/transformers** (in-browser transcription/Whisper), **motion**, Radix UI, `@hello-pangea/dnd`.
- Deploy target: **Cloudflare** via `@opennextjs/cloudflare` (`open-next.config.ts`, `wrangler.jsonc`); also a `Dockerfile`. Content via `@content-collections` (blog/changelog markdown).

**Rust workspace (`Cargo.toml`, resolver 2):** members are `rust/desktop`, `rust/wasm`, and crates `time`, `bridge`, `effects`, `gpu`, `masks`, `compositor`. Core graphics use **wgpu 29** + **bytemuck**; WASM glue uses **wasm-bindgen 0.2**, **js-sys**, **web-sys**, **serde-wasm-bindgen**, **tsify-next** (generates TS types). Desktop uses **gpui 0.2.2**.

## 3. Entry Points

**Web router (`dep/apps/web/src/app/`):**
- `page.tsx` (landing), `projects/page.tsx` (+ `projects/store.ts`) — project gallery.
- **`editor/[project_id]/page.tsx`** — the editor route. It renders `MobileGate → EditorProvider(projectId) → EditorHeader + EditorLayout`. `EditorLayout` is a `ResizablePanelGroup`: vertical split (main content / timeline), main content is a horizontal 3-pane split of `AssetsPanel | PreviewPanel | PropertiesPanel` (`@/timeline/components`, `@/preview/components`, `@/components/editor/panels/*`).
- Marketing/content routes: `blog/`, `changelog/`, `roadmap`, `contributors`, `sponsors`, `brand`, `privacy`, `terms`, plus `robots.ts`, `sitemap.ts`, `rss.xml/route.ts`.
- **API routes (`app/api/`):** `auth/[...all]` (better-auth), `feedback`, `health`, `sounds/search` (Freesound proxy). Very thin server surface.

**Project load flow:** `components/providers/editor-provider.tsx` drives it — on mount it gets the `EditorCore` singleton, calls `initializeGpuRenderer()`, sets degraded mode if no GPU, then `editor.project.loadProject({ id: projectId })`. If not found it auto-creates "Untitled Project" and `router.replace`s. Loading/error/exiting states render spinners. Project data is read from IndexedDB via `storageService` (§7).

**Desktop:** `rust/desktop/src/main.rs` (41 LOC) — a GPUI `Application` opening a 1280×720 window that renders a dark div with the centered text "OpenCut". No editor logic.

**WASM entry:** `rust/wasm/src/wasm.rs` is the crate lib root (`crate-type = ["cdylib","rlib"]`). It gates `compositor/effects/gpu/masks/perf` behind `target_arch = "wasm32"` and always re-exports `time::*`. Built via `wasm-pack build rust/wasm --target bundler` → published as npm `opencut-wasm`.

## 4. Editor Architecture (priority)

The editor uses a **hybrid state model**: a hand-written OOP manager layer (`EditorCore`) for domain/editor state, plus **Zustand** stores for UI-only concerns.

**`EditorCore` singleton (`dep/apps/web/src/core/index.ts`, `core/managers/`):** A singleton composing 12 managers:
`timeline`, `command`, `playback`, `scenes`, `project`, `media`, `renderer`, `save`, `audio`, `selection`, `clipboard`, `diagnostics`. Each manager is an observable (`subscribe(onChange)` external store). `useEditor(selector)` (`editor/use-editor.ts`) is a `useSyncExternalStore` hook that subscribes to all managers and memoizes selector output with shallow-array equality. Constructor registers default effects/masks, wires a "prune empty tracks" reactor into the command manager, and starts autosave.
- `command/managers/commands.ts` — command pattern for undo/redo; concrete commands live in `dep/apps/web/src/commands/{media,project,scene,timeline}` (e.g. `timeline/element`, `timeline/track`, `scene/toggle-bookmark`, `tracks-snapshot.ts`) built on `commands/base-command.ts` + `batch-command.ts`.
- `save-manager.ts` — debounced autosave (800ms), subscribes to `scenes` + `timeline` changes, calls `storageService.saveProject`.
- `project-manager.ts` — active project, project list, export state, storage migrations, new-project creation.

**Zustand stores (UI):** `editor/editor-store.ts` (init flags, canvas presets), `editor/panel-store.ts` (panel sizes), `timeline/timeline-store.ts`, `preview/preview-store.ts`, `actions/keybindings-store.ts`, `stickers/stickers-store.ts`, `sounds/sounds-store.ts`, `timeline/components/graph-editor/custom-presets-store.ts`, `app/projects/store.ts`.

**Timeline system (`dep/apps/web/src/timeline/`, ~105 files):**
- Types in `timeline/types.ts` (see §7). Store in `timeline-store.ts`; pure update logic in `update-pipeline.ts`, `track-element-update.ts`, `tracks.ts`, `scenes.ts`, `creation.ts`, `defaults.ts`.
- **Controllers** (`controllers/`): `drag-drop`, `element-interaction`, `keyframe-drag`, `playhead`, `resize`, `seek`, `zoom`.
- **Components** (`components/`): `timeline-track`, `timeline-element`, `timeline-playhead`, `timeline-ruler`, `timeline-toolbar`, `audio-waveform`, `audio-volume-line`, plus a **keyframe graph editor** (`components/graph-editor/`: `bezier-graph.tsx`, `easing-presets.ts`, `use-controller.ts`, `custom-presets-store.ts`).
- **Placement engine** (`placement/`): `resolve`, `overlap`, `compatibility`, `main-track`, `insert-index`, `track-factory` — resolves where dropped/moved clips land. **Snapping** (`snapping/`) and **group-move**/**group-resize** subsystems. **Bookmarks** (`bookmarks/`). Hooks in `hooks/` and `hooks/element/`.

**Effects system (`dep/apps/web/src/effects/`):** `types.ts` defines `Effect {id,type,params,enabled}`, `EffectDefinition` (params + WGSL `renderer` passes with uniform builders). `registry.ts` + `definitions/` (`blur.ts`) — GPU effects are shader passes fed to the Rust `effects` crate. UI in `components/effects-tab.tsx`. Docs: `docs/effects-renderer.md`.

**Keyframe/animation system (`dep/apps/web/src/animation/`):** `types.ts` defines `ANIMATION_PROPERTY_PATHS` (transform.positionX/Y, scaleX/Y, rotate, opacity, volume, color, background.*), `ScalarAnimationKey` (bezier handles, tangent modes `auto|aligned|broken|flat`, segment types `step|linear|bezier`), `ScalarChannel`/`DiscreteChannel`, `ElementAnimations` (path→channel map). Evaluation: `interpolation.ts`, `bezier.ts`, `resolve.ts`, `keyframe-query.ts`, `curve-bridge.ts`, `graph-channels.ts`, `effect-param-channel.ts`, `graphic-param-channel.ts`. `rendering/animation-values.ts` samples animated values at a time. Docs: `docs/keyframes.md`.

**Text elements (`dep/apps/web/src/text/`):** `typography.ts`, `layout.ts`, `measure-element.ts`, `background.ts`, `primitives.ts`. Fonts in `dep/apps/web/src/fonts/` (`google-fonts.ts`, `system-fonts.ts`, `use-font-atlas.ts` — a font-atlas is loaded for GPU text). Subtitles/captions in `subtitles/` (SRT/ASS parse+build) and `transcription/` (Whisper via transformers.js in a worker).

**Preview/renderer (`dep/apps/web/src/services/renderer/` + `dep/apps/web/src/preview/`):**
- `preview/` is the interactive viewport: `preview-viewport.tsx`, `transform-handles.tsx`, `mask-handles.tsx`, `text-edit-overlay.tsx`, `snap-guides.tsx`, controllers for transform/interaction, `hit-test.ts`, `preview-store.ts`.
- `services/renderer/` is the render pipeline. `scene-builder.ts` builds a render tree; `resolve.ts` (`resolveRenderTree`) resolves nodes; **nodes/** is a scene-graph (`root-node`, `visual-node`, `video-node`, `image-node`, `text-node`, `sticker-node`, `graphic-node`, `color-node`, `blur-background-node`, `effect-layer-node`). `canvas-renderer.ts` (`CanvasRenderer`) rasterizes into OffscreenCanvas then hands textures to the WASM compositor. `gpu-renderer.ts` initializes the GPU (`initializeGpuRenderer`, `isGpuAvailable`). `compositor/wasm-compositor.ts` (`wasmCompositor` singleton) manages a texture cache and calls into WASM (`initCompositor`, `uploadTexture`, `renderFrame`, etc.); `compositor/frame-descriptor.ts` builds the `FrameDescriptor` serialized to Rust. `scene-exporter.ts` handles export; export options in `dep/apps/web/src/export/` (mp4/webm, quality tiers).

**Media handling (`dep/apps/web/src/media/`):** `mediabunny.ts` (demux/decode), `processing.ts`, `thumbnail.ts`, `audio.ts`, `audio-mastering.ts`, `waveform-summary.ts`, `use-file-upload.ts`, `use-paste-media.ts`. Caches in `services/video-cache/` and `services/waveform-cache/`.

**Other editor subsystems:** `masks/` (builtin shapes: rectangle/ellipse/star/heart/diamond/cinematic-bars/split/text + freeform, feathering, SDF handles), `stickers/`, `graphics/`, `gradients/`, `guides/`, `retime/` (speed/time-stretch), `speed/`, `ripple/` (ripple edit), `selection/`, `clipboard/`, `actions/` (keybindings registry + handlers, `docs/actions.md`), `fps/`, `params/` (param registry/channel layout), `background/`, `sounds/` (Freesound), `feedback/`, `diagnostics/` (`render-perf.ts`).

## 5. Rust/WASM Core (`rust/`)

Core crates (LOC excludes tests; total Rust ~4.4k LOC):
- **`gpu`** (716 LOC) — `GpuContext` wrapping **wgpu 29**; canvas texture import, surface config, WebGL/WebGPU abstraction; shaders `blit.wgsl`, `fullscreen.wgsl`. Format `Bgra8Unorm`. `wasm` feature enables `wgpu/webgl`.
- **`compositor`** (~1.1k LOC) — the layer compositor. `Compositor::render_frame` consumes a `FrameDescriptor`, composites layers with `BlendMode`, `texture_pool`/`texture_store` manage GPU textures; shaders `layer.wgsl`, `blend.wgsl`, `mask.wgsl`. Depends on `effects`, `masks`, `gpu`.
- **`effects`** (~350 LOC) — GPU effect pipeline (`pipeline.rs`), `gaussian_blur.wgsl`.
- **`masks`** (~620 LOC) — mask rasterization + feathering via **Jump-Flood Algorithm** SDF (`sdf.rs`, `feather.rs`, shaders `jfa_init/step/distance.wgsl`).
- **`time`** (~855 LOC) — `MediaTime` (i64 integer ticks), `FrameRate`, `TimeCode`. This is the tick math shared with TS. Has `wasm` feature exporting via tsify. Contains most Rust unit tests.
- **`bridge`** (95 LOC) — proc-macro helper crate (`syn`/`quote`) used by `time` for codegen.

**`rust/wasm`** (`opencut-wasm`, v0.2.10) — the wasm-bindgen boundary. Modules mirror crates: `compositor.rs` (exposes `initCompositor`, `resizeCompositor`, `getCompositorCanvas`, `uploadTexture`, `releaseTexture`, `renderFrame` — deserializes `FrameDescriptor` via serde-wasm-bindgen, chooses WebGPU surface vs WebGL texture path), `effects.rs`, `gpu.rs`, `masks.rs`, `perf.rs` (frame profiling). `time` is always exported.

**How web calls WASM:** `dep/apps/web/src/wasm/` wraps `opencut-wasm` — `wasm/media-time.ts` brands `MediaTime` as `number & {__mediaTime}` and wraps every time function (`roundMediaTime`, `mediaTimeFromSeconds`, `roundFrameTime`, `snapSeekMediaTime`, `parseMediaTimecode`, etc.), asserting integer ticks at the boundary. GPU/compositor calls go through `services/renderer/compositor/wasm-compositor.ts` and `gpu-renderer.ts`. TS types come from the generated `opencut-wasm` `.d.ts`.

## 6. Desktop App (`rust/desktop/`)

**A skeleton, not a real editor.** Contents: `Cargo.toml` (binary `opencut`, single dep `gpui = "0.2.2"`), `src/main.rs` (**41 LOC** — opens one window showing centered "OpenCut" text, no editor logic, no WASM/crate wiring), `README.md` (build instructions for Linux/macOS/Windows/WSL), and `script/setup`(+`.ps1`) for native deps. Per `AGENTS.md`, the intent is for desktop to eventually call the same Rust core, but currently **~0% of editor functionality is implemented**.

## 7. Data Model & Persistence

**Types (client-side, `dep/apps/web/src/`):**
- `project/types.ts`: `TProject { metadata: TProjectMetadata, scenes: TScene[], currentSceneId, settings: TProjectSettings, version, timelineViewState }`. `TProjectSettings { fps: FrameRate, canvasSize, background: TBackground(color|blur) }`.
- `timeline/types.ts`: `TScene { id, name, isMain, tracks: SceneTracks, bookmarks: Bookmark[], createdAt, updatedAt }`. `SceneTracks { overlay: OverlayTrack[], main: VideoTrack, audio: AudioTrack[] }`. Track types: `video|text|audio|graphic|effect`. Elements (all extend `BaseTimelineElement` with `MediaTime` startTime/duration/trimStart/trimEnd, `animations?`, `params`): `VideoElement`, `ImageElement`, `TextElement`, `StickerElement`, `GraphicElement`, `EffectElement`, `AudioElement` (upload/library variants). Elements carry optional `effects: Effect[]` and `masks: Mask[]` (video/image/graphic are maskable).

**Persistence — client-side (primary):** `dep/apps/web/src/services/storage/service.ts` (`storageService` singleton). Split storage:
- **IndexedDB** for structured data — DBs `video-editor-projects` (store `projects`), `video-editor-media-{projectId}` (media metadata), `video-editor-saved-sounds`. Adapter: `indexeddb-adapter.ts`.
- **OPFS** (Origin Private File System) for binary media blobs — one directory `media-files-{projectId}` per project. Adapter: `opfs-adapter.ts`. Quota handling in `quota.ts` + `services/storage/components/storage-persistence-dialog.tsx`.
- Serialization: `saveProject` strips audio `buffer`s, ISO-serializes dates → `SerializedProject`/`SerializedScene` (`storage/types.ts`). **All project/timeline/media data lives entirely on the client** — no project data goes to the server.

**Schema migrations:** `services/storage/migrations/` — a **31-version migration chain** (`CURRENT_PROJECT_VERSION = 31`, `v0-to-v1` … `v30-to-v31`), with a `runner.ts`, `transformers/`, and per-version tests. This is the largest single subsystem after timeline (129 files under `services/`, most are migrations).

**Persistence — server-side (auth only):** `dep/apps/web/src/db/schema.ts` (Drizzle/Postgres) defines **only auth + feedback**: `users`, `sessions`, `accounts`, `verifications` (all better-auth tables, RLS-enabled), and `feedback`. **No project/timeline/media tables exist server-side.** Redis (Upstash) is used solely for **auth rate limiting** (`auth/rate-limit.ts`), not project data. Auth in `dep/apps/web/src/auth/{client,server,rate-limit}.ts`; drizzle config at `dep/apps/web/drizzle.config.ts` (migrations in `dep/apps/web/migrations/`).

Summary: **client (IndexedDB + OPFS) = all editor content; server (Postgres + Redis) = only user accounts, sessions, feedback, and rate limits.**

## 8. Testing Setup

- **JS/TS: `bun test`** (root `package.json` `"test": "bun test"`). **30 test files** in `dep/apps/web/src`, colocated in `__tests__/` dirs. Coverage is focused on pure logic: storage migrations (~20 files, `services/storage/migrations/__tests__/`), plus `timeline/placement`, `timeline/update-pipeline`, `animation/animated-params`, `masks/snap`, `retime`, `fps`, `params/channel-layout`, `stickers/sticker-id`, `actions/keybindings/persistence`, `utils/math`. No React component/E2E tests present.
- **Rust: `cargo test`** — unit tests via `#[cfg(test)]` in `rust/crates/time/{media_time,frame_rate,timecode}.rs` and `rust/crates/bridge/bridge.rs`. The `time` crate is the best-tested Rust code; `compositor`/`effects`/`masks`/`gpu` have no visible test modules (GPU-bound).
- **CI:** single workflow `.github/workflows/bun-ci.yml`.

### Key files to start from
- Editor entry & load: `dep/apps/web/src/app/editor/[project_id]/page.tsx`, `dep/apps/web/src/components/providers/editor-provider.tsx`
- State core: `dep/apps/web/src/core/index.ts` + `dep/apps/web/src/core/managers/*`, `dep/apps/web/src/editor/use-editor.ts`
- Timeline model: `dep/apps/web/src/timeline/types.ts`, `dep/apps/web/src/timeline/update-pipeline.ts`, `dep/apps/web/src/timeline/placement/resolve.ts`
- Render pipeline: `dep/apps/web/src/services/renderer/scene-builder.ts`, `canvas-renderer.ts`, `compositor/wasm-compositor.ts`; Rust `rust/crates/compositor/src/compositor.rs`
- Animation: `dep/apps/web/src/animation/types.ts` + `resolve.ts`; `dep/apps/web/src/rendering/animation-values.ts`
- Persistence: `dep/apps/web/src/services/storage/service.ts`, `migrations/index.ts`; `dep/apps/web/src/db/schema.ts`
- WASM boundary: `dep/apps/web/src/wasm/media-time.ts`, `rust/wasm/src/*.rs`
