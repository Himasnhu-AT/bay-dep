# OpenCut — Limitations, Bottlenecks, Tech Debt & Test Coverage

> Agent 2 audit artifact. Generated 2026-08-01. Every claim below is grounded in a real file path.
> Severity is rated **High / Medium / Low**, and each item is framed as **"expected for this stage"**
> (a young, browser-first editor mid-migration to a Rust core) vs a **"genuine concern"** that will bite
> feature work or shipping.

---

## 1. Test Coverage Gaps (most important)

### 1.1 The headline finding: CI does not actually run the tests — **HIGH, genuine concern**

The repo ships **30 colocated test files** under `dep/apps/web/src/**/__tests__/`, but the CI workflow
`.github/workflows/bun-ci.yml` **never executes them**. Its final step is literally:

```yaml
- name: Run tests
  working-directory: dep/apps/web
  run: echo "No tests implemented yet"
  continue-on-error: true
```

So the 30 tests are **local-only, unenforced**, and even that placeholder is `continue-on-error: true`.
CI verifies a WASM build + `bun run build` (a Next.js typecheck/compile) and nothing else. Net effect:
the migration suite, timeline placement, animation, retime, fps and mask tests can all silently regress
and CI stays green. This is the single highest-leverage fix on the board — wiring `bun test` into CI is
one line.

### 1.2 What IS tested (all pure, deterministic logic)

Confirmed test files (`bun:test`, imported in all 30):
- **Storage migrations** — the bulk: 19 of the 31 migration steps have `__tests__/*.test.ts`
  (`services/storage/migrations/__tests__/`), plus shared `fixtures/` (v0–v5) and `helpers.ts`.
- **Timeline** — `timeline/placement/__tests__/resolve.test.ts`, `timeline/__tests__/update-pipeline.test.ts`.
- **Animation** — `animation/__tests__/animated-params.test.ts`.
- **Retime** — `retime/__tests__/resolve.test.ts`, `retime/__tests__/split.test.ts`.
- **FPS** — `fps/__tests__/fps.test.ts`.
- **Masks** — `masks/__tests__/snap.test.ts` (snapping math only, not rasterization).
- **Params** — `params/__tests__/channel-layout.test.ts`.
- **Stickers** — `stickers/__tests__/sticker-id.test.ts`.
- **Keybindings** — `actions/keybindings/__tests__/persistence.test.ts`.
- **Utils** — `utils/__tests__/math.test.ts` (includes a nice security case asserting
  `evaluateMathExpression` refuses `process.exit()`).

The tested surface is exactly the **pure-function core**: tick math, migration transforms, placement
resolution, curve/param evaluation. This is the right stuff to test first and is **expected/good for the stage**.

### 1.3 The large untested surface — **HIGH, genuine concern (given ~91k LOC)**

`dep/apps/web/src` is **~91,028 LOC across ~152 `.tsx` components** and 0 of them have any test. Untested subsystems:
- **Rendering pipeline** — `services/renderer/scene-builder.ts`, `resolve.ts`, `canvas-renderer.ts`,
  the whole `nodes/` scene-graph, `scene-exporter.ts`. No tests.
- **WASM compositor bridge** — `services/renderer/compositor/wasm-compositor.ts`,
  `frame-descriptor.ts`, `gpu-renderer.ts`. No tests (see §4).
- **Effects system** — `effects/registry.ts`, `definitions/`. No tests.
- **Editor managers** — the 12-manager `EditorCore` (`core/index.ts`, `core/managers/*`): command/undo-redo,
  playback, save/autosave, media, scenes, selection, clipboard. No tests despite being the state backbone.
- **React components** — every panel, timeline widget, preview viewport, graph editor. **No component or
  E2E tests at all** (no Testing Library, Playwright, or Cypress anywhere).
- **Media** — `media/mediabunny.ts`, `processing.ts`, `thumbnail.ts`, waveform/audio-mastering. No tests.

For the 6 queued features (background color, audio-extract+keyframes, more text/effects, save-as-motion-
graphics, and "test coverage for all of the above"), goal #5 lands squarely in this gap: there is **no
established pattern for testing effects, the renderer, or components** — only pure-logic patterns exist.

### 1.4 Hard dependency on `bun test` — **MEDIUM, genuine concern (conflicts with pnpm migration)**

All 30 test files `import { ... } from "bun:test"`. The runner is bound to Bun's built-in test harness
(root `package.json`: `"test": "bun test"`). This is a **hard toolchain dependency**: with the repo now
migrated to pnpm (only `pnpm-lock.yaml` exists at root; no `bun.lock`), running the tests still requires a
Bun install on the machine, and `pnpm test` cannot drive them without Bun present. Migrating off `bun:test`
to a pnpm-runnable runner (vitest) is non-trivial (30 files) but removes the last hard Bun coupling in the
test path.

---

## 2. Tooling / Build Debt (bun vs pnpm, missing packages/, CI)

### 2.1 Package-manager schizophrenia — **HIGH, genuine concern**

Three different declarations coexist:
- Root `package.json`: `"packageManager": "pnpm@11.13.0"`, and a root `workspaces` field (`apps/*`, `packages/*`).
- `dep/apps/web/package.json`: `"packageManager": "bun@1.2.18"` — still declares Bun.
- `pnpm-workspace.yaml`: globs `apps/*` **and `packages/*`**.
- Test script: `"test": "bun test"` (Bun).

Only `pnpm-lock.yaml` exists at root now (no `bun.lock`, no root `package-lock`). So the source of truth
is pnpm, but `dep/apps/web` still advertises Bun and the test path still requires it.

### 2.2 CI still assumes Bun end-to-end — **HIGH, genuine concern**

`.github/workflows/bun-ci.yml` is entirely Bun-based even after the pnpm migration:
- Installs Bun 1.2.18 via `oven-sh/setup-bun`.
- Caches `~/.bun/install/cache` keyed on **`dep/apps/web/bun.lock`** — a file that **no longer exists** in the
  repo (the migration left only `pnpm-lock.yaml`). The cache key will never hit.
- `bun install` + `bun run build` in `dep/apps/web`.
- Does not run tests (§1.1).

So CI is out of sync with the declared package manager: it installs with Bun against a missing lockfile,
and a `pnpm install` was never wired in. This is the kind of drift that produces "works on my machine"
builds. **Genuine concern**, cheap to fix.

### 2.3 `packages/*` is referenced but does not exist — **LOW, expected for stage**

Both root `package.json` `workspaces` and `pnpm-workspace.yaml` glob `packages/*`, but there is **no
`packages/` directory** (confirmed in repo map §1; shared code lives in `dep/apps/web/src` and `rust/`). Harmless
today (empty glob), but it signals an intended-but-unrealized shared-package extraction. Expected for a repo
mid-refactor; worth deleting the glob until real packages land.

### 2.4 pnpm-workspace migration is partially done — **LOW/MEDIUM**

`pnpm-workspace.yaml` includes an `allowBuilds` / `onlyBuiltDependencies` block with a comment
"migrated from bun's trustedDependencies" (esbuild, onnxruntime-node, protobufjs, sharp, workerd,
@tailwindcss/oxide). The pnpm side of the migration was done thoughtfully — but the CI + `dep/apps/web`
package-manager field + the `bun:test` runner were left on Bun, so the migration is **half-complete**.

---

## 3. Desktop Gap

### 3.1 `rust/desktop` is a 41-LOC stub — **not a concern, but a scope reality (expected)**

`rust/desktop/src/main.rs` is **41 lines** (confirmed via `wc -l`): a GPUI `Application` that opens one
1280×720 window rendering centered "OpenCut" text. **No editor logic, no WASM/crate wiring, ~0% of editor
functionality.** Per `AGENTS.md` the intent is for desktop to eventually call the same Rust core, but today
it is a skeleton. For queued feature goal #6 ("Desktop version?") the honest answer is: **there is no desktop
editor** — it is a window shell. This is **expected for the stage** and should be scoped as greenfield, not
as "extend the existing desktop app."

---

## 4. Rendering / WASM / GPU Untested Risk

### 4.1 Rust GPU crates have zero test modules — **HIGH risk, but expected (GPU-bound)**

Only **4 Rust files** contain `#[cfg(test)]`, all in the `time`/`bridge` crates:
`rust/crates/time/src/{media_time,frame_rate,timecode}.rs` and `rust/crates/bridge/src/bridge.rs`.
The graphics crates — **`compositor` (~1.1k LOC), `effects` (~350), `masks` (~620), `gpu` (716)** — have
**no test modules at all**. This is the tick-math core being well-tested while the entire GPU compositing
path (blend modes, texture pool/store, JFA mask feathering, effect pipeline, WGSL shaders) is unverified.
It is **understandable** — these require a GPU/wgpu device and headless GPU CI is hard — but it means the
compositor is validated only by eyeball in the browser. **Frame it as: acceptable now, but a real
correctness blind spot** the moment effects/masks/blend behavior changes.

### 4.2 The TS↔WASM render bridge is untested — **HIGH, genuine concern**

`services/renderer/compositor/wasm-compositor.ts` builds a `FrameDescriptor` (serde-wasm-bindgen
deserialized on the Rust side) and manages a **derived-texture cache** (`private cache = new Map<...>()`).
Both the descriptor serialization contract and the cache lifecycle are untested. A schema drift between the
TS `FrameDescriptor` and the Rust deserializer would fail only at runtime. The one place the WASM boundary
IS guarded is `wasm/media-time.ts`, which brands `MediaTime` and asserts integer ticks — but that guard
covers time math only, not the compositor payload.

### 4.3 GPU-absent degraded mode — **MEDIUM, correctness/UX edge case**

`components/providers/editor-provider.tsx` calls `editor.renderer.setDegraded(!isGpuAvailable())` on mount.
So a no-WebGPU/no-WebGL browser silently enters "degraded" rendering. What "degraded" actually produces
(and whether export works in it) is untested and undocumented — a real edge case for users on locked-down
or old browsers.

---

## 5. Persistence Complexity (31 migrations) & Server Coupling

### 5.1 A 31-step migration chain — **MEDIUM, genuine concern (fragility/complexity)**

`services/storage/migrations/` holds a linear **v0-to-v1 … v30-to-v31 chain** (`CURRENT_PROJECT_VERSION = 31`),
run by `runner.ts` over every project in IndexedDB (`video-editor-projects`). Observations:
- **Only 19 of 31 steps have tests** — untested steps: v6→v7, v7→v8, v9→v10, v10→v11, v11→v12, v12→v13,
  v13→v14, v14→v15, v17→v18, v23→v24, v24→v25, v25→v26. A silent bug in any of these corrupts a real
  user's saved project on upgrade, with no server-side copy to recover from (§5.3).
- The chain runs **sequentially per project on the client** at load time (`runner.ts` sorts migrations and
  iterates all projects). For a user with many/large projects this is startup latency; there is a
  `MIN_MIGRATION_DISPLAY_MS = 1000` UX floor implying it's already noticeable.
- Error handling is coarse: the meta-DB cleanup swallows errors (`catch {}`), which is fine, but a failing
  migration mid-chain leaves a project in a partially-migrated state (no transactional rollback visible).

Deep migration chains are a **normal cost of a client-first, no-server-schema editor** — but the 12 untested
steps are a genuine data-loss exposure.

### 5.2 Editor needs no server; auth/feedback need Postgres+Redis — **LOW, by design**

Per repo map §7, **all editor content lives client-side** (IndexedDB + OPFS); `db/schema.ts` defines only
auth tables + `feedback`, and Redis is only auth rate-limiting (`auth/rate-limit.ts`). So the editor itself
has **no DB dependency** — good. But the CI env block in `bun-ci.yml` hard-codes `DATABASE_URL`,
`BETTER_AUTH_SECRET`, `UPSTASH_REDIS_*`, `FREESOUND_*`, `MARBLE_*` just to get `next build` to pass,
coupling the *build* to server config even though the editor doesn't need it. Minor.

### 5.3 No cloud backup of projects — **MEDIUM edge case**

Because projects live only in OPFS/IndexedDB, a browser cache clear, private-window session, or OPFS
eviction under storage pressure destroys the user's work irrecoverably. There is quota handling
(`services/storage/quota.ts`, `STORAGE_HEADROOM_RESERVE_BYTES = 50MB`, persistence dialog) but no export/
sync safety net. Expected for a privacy-first design, but a real user-facing risk to note.

---

## 6. Perf / Scale / Edge Cases

- **OPFS quota** — `services/storage/quota.ts` reserves a 50MB headroom and checks
  `navigator.storage.estimate()`, degrading gracefully when the API is absent (`estimate-unavailable`).
  Reasonable, but large-media projects can still hit browser quota walls; behavior on mid-import quota
  exhaustion is the risky path. **MEDIUM.**
- **WASM compositor texture cache** — `wasm-compositor.ts` keeps a persistent `Map` of derived-texture
  entries (OffscreenCanvas-backed). Eviction is keyed off per-frame ID reconciliation
  (it deletes cache keys not present in the current frame), not a size/LRU budget — so a scene churning
  many distinct textures could grow GPU memory unbounded within a frame set. **MEDIUM, worth profiling.**
- **Autosave debounce** — `core/managers/save-manager.ts` debounces saves at **800ms**, serializing the
  whole project to IndexedDB on every settle. For large timelines this is a full re-serialize
  (`storageService.saveProject` strips audio buffers + ISO-serializes dates) on an 800ms cadence — a
  potential main-thread/IO cost on big projects. **MEDIUM.**
- **~91k LOC / ~152 components on the client** — large bundle and a big untested UI surface; Next.js 16 +
  React 19 + Turbopack, single-page editor. Bundle/perf not measured here but flagged as scale surface. **LOW/MEDIUM.**
- **Transcription** — Whisper via `@huggingface/transformers` in-browser (a worker) is heavy; first-run
  model download + CPU/GPU inference is a known latency/memory edge case. **LOW (feature-gated).**

---

## 7. TODO / FIXME / Correctness Concerns Found

### 7.1 Marker sweep — **LOW, notably clean**

A grep across `dep/apps/web/src` and `rust` for `TODO/FIXME/HACK/XXX` found **exactly one** marker:
`changelog/components/changelog-notification.tsx:34` —
`// TODO(v0.4): revert to the standard "null = first-time visitor, record silently"`.
No `FIXME`/`HACK`/`XXX` anywhere. For a ~91k-LOC codebase this is **unusually clean** and speaks well of
the code's maturity — the debt here is structural (tests/tooling), not littered.

### 7.2 Suppression comments are disciplined — **LOW, not a concern**

The `eslint-disable`/`biome-ignore` usages found are all **justified with inline rationale** — e.g.
`opencut/prefer-object-params` disabled for reducer/registry `(action, handler)` signatures
(`actions/registry.ts`, `use-action-handler.ts`, `subtitles/components/assets-view.tsx`), and
`jsx-a11y` disables on spatial gesture surfaces (timeline track/keyframe-lane/box-select divs in
`timeline/components/{timeline-track,index,timeline-element,audio-volume-line}.tsx`), each explaining the
keyboard-a11y path lives in global shortcuts. These are documented trade-offs, not silent suppressions.
Two `@typescript-eslint/no-unsafe-type-assertion` disables in `actions/keybindings-store.ts` (persistence
deserialization) are the only ones touching type-safety and are the most worth revisiting.

### 7.3 No disabled/skipped tests — **not a concern**

No `.skip`/`.todo`/`xit`/`xdescribe` in the suite (the `result.skipped` hits in migration tests are
assertions about migration *skip semantics*, not skipped tests). The suite is fully live — it just isn't run by CI.

---

## Severity Summary

| # | Item | Severity | Framing |
|---|------|----------|---------|
| 1.1 | CI never runs the 30 tests (`echo "No tests..."` + `continue-on-error`) | **High** | Genuine concern — one-line fix |
| 1.3 | Renderer / effects / managers / components untested (~91k LOC) | **High** | Genuine concern |
| 1.4 | Hard `bun:test` dependency conflicts with pnpm migration | **Medium** | Genuine concern |
| 2.1 | pnpm vs bun package-manager declarations disagree | **High** | Genuine concern |
| 2.2 | CI is all-Bun, caches a missing `bun.lock`, no pnpm install | **High** | Genuine concern |
| 2.3 | `packages/*` globbed but absent | **Low** | Expected for stage |
| 3.1 | Desktop is a 41-LOC window shell, no editor | **Info** | Expected — scope as greenfield |
| 4.1 | Rust GPU crates (compositor/effects/masks/gpu) have no tests | **High risk** | Expected (GPU-bound), real blind spot |
| 4.2 | TS↔WASM `FrameDescriptor`/texture-cache bridge untested | **High** | Genuine concern |
| 4.3 | GPU-absent "degraded" mode untested/undocumented | **Medium** | Edge case |
| 5.1 | 31-step migration chain, 12 steps untested, client-only | **Medium** | Genuine concern (data loss) |
| 5.3 | No cloud backup — OPFS eviction = lost work | **Medium** | By design, real risk |
| 6 | Texture-cache growth, 800ms full-serialize autosave, OPFS quota | **Medium** | Profile before scaling |
| 7.1 | Only 1 TODO, 0 FIXME/HACK in entire tree | **Low** | Notably clean |

**Bottom line:** the codebase itself is clean and its *pure* logic is well-tested; the real, actionable debt
is a **test/tooling delivery gap** — CI doesn't run the tests it has, the pnpm migration left CI + the test
runner + `dep/apps/web` on Bun, and the entire render/WASM/GPU/component surface (the code the 6 queued features
touch) has no tests or established test pattern.
