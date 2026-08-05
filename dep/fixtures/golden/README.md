# Golden fixtures (`dep/fixtures/golden/`)

Provenance-correct reference data captured from the **web** app, consumed by the **native**
Rust port's tests (Phase 1 migration-parity / descriptor-parity suites). These are *captured
from the real code*, never hand-authored — see the capture command for each below.

> **Do not edit these JSON files by hand.** Change the source (a migration, the keybinding
> defaults) and re-run the capture command; the committed fixtures then reflect real behavior.

## What's here (captured headlessly, deterministic)

| Path | Source | Capture |
|------|--------|---------|
| `migrations/v0.json … v31.json` | The real project migration chain (`dep/apps/web/src/services/storage/migrations`) threaded from a v0 seed through every step | vitest, below |
| `migrations/_manifest.json` | Per-step `{from,to,skipped,reason}` record of the chain run | vitest, below |
| `keybindings/default.json` | `serializeKeybindingsState({ keybindings: getDefaultShortcuts(), isCustomized:false })` | vitest, below |

**Capture / re-capture command** (from `dep/apps/web`):
```bash
CAPTURE_GOLDEN=1 pnpm exec vitest run \
  src/services/storage/migrations/__tests__/golden-fixtures.test.ts
```
Running the same spec **without** `CAPTURE_GOLDEN` (i.e. in the normal `pnpm --filter web test`
suite) asserts the current code still reproduces these fixtures byte-for-byte — it is the drift
guard, so a migration change that isn't re-captured fails CI.

### Determinism
The capture freezes the clock to `2020-01-01T00:00:00Z` and replaces `crypto.randomUUID` with a
counter (`00000000-0000-4000-8000-<hex counter>`), because the real transformers call `new Date()`
and `crypto.randomUUID`. This makes the goldens byte-stable across machines and runs.

### Migration seed & the v1→v2 note
- **Seed (v0):** `{ "id": "golden-project", "name": "Golden Project" }` — the exact shape of a
  brand-new pre-scenes project. The chain wraps it into a main scene and carries it to v31. The
  authored input is a legacy *seed*; every `vN.json` output is produced by the real transform.
- **v1→v2** is the one migration whose `.run()` loads legacy per-scene tracks from separate
  IndexedDB stores and then *deletes* them. To stay headless and non-destructive, the capture
  drives its pure `transformProjectV1ToV2({ project, context })` with an explicit empty context
  (correct for this seed, which has no legacy tracks) — the same call its own unit test makes.
  All other 30 steps run their real `.run()` wrapper unchanged.

To exercise content-transforming migrations (elements/effects/animations) more deeply later, add
a richer seed at the version that first has that content and thread it forward the same way.

## Browser-only fixtures (deferred — need a real runtime)

The remaining P0-ARCH-02 goldens cannot be captured headlessly: their producers bind to WebCodecs,
Web Audio, and a `CanvasRenderer`/GPU at module load. Capture these from the **running app**
(`pnpm --filter web dev`, DevTools console) and drop the JSON next to this file.

### `descriptor/` — FrameDescriptor scene golden
The Rust compositor's `FrameDescriptor` counterpart. Source: `buildFrameDescriptor({ node, renderer })`
in `dep/apps/web/src/services/renderer/compositor/frame-descriptor.ts`, fed by `buildScene(...)`
(`scene-builder.ts`) + `resolveRenderTree({ node, renderer, time })` (`resolve.ts`). Needs a live
`CanvasRenderer` and decoded sources, so it runs during a real preview/export.
- Capture: in the running editor with a scene loaded, obtain the preview renderer's built root
  node and call `buildFrameDescriptor`, then `JSON.stringify(frame)` (the `frame` half is
  serializable; the `textures` half carries `CanvasImageSource`/`draw` callbacks — drop it or
  record only `{id,width,height,kind}`). Save as `descriptor/<sceneName>@<timeMs>.json`.
- Schema: `dep/apps/web/src/services/renderer/compositor/types.ts` (`FrameDescriptor`), mirrored in
  Rust at `rust/crates/compositor/src/frame.rs`.

### `media-probe/` — media-probe table
Source: `readVideoFile({ file })` in `dep/apps/web/src/media/mediabunny.ts` (WebCodecs). Persisted shape:
`MediaAssetData` in `dep/apps/web/src/services/storage/types.ts` (`{id,name,type,size,lastModified,
width?,height?,duration?,fps?,hasAudio?,codec?}`).
- Capture: import a known test clip in the app, read the resulting `MediaAsset`/`MediaAssetData`
  from the media store, and save the array as `media-probe/<clip>.json`.

### `audio-mix/` — audio-mix reference buffer
Source: `createTimelineAudioBuffer({ tracks, mediaAssets, duration, sampleRate })` in
`dep/apps/web/src/media/audio.ts` (OfflineAudioContext).
- Capture: run it for a small known scene, then serialize the resulting `AudioBuffer` to a compact
  reference — `{ sampleRate, length, numberOfChannels, channels: number[][] }` (or a WAV) — as
  `audio-mix/<scene>.json`. Keep the scene tiny; these files are large.

When the native decode/audio/raster paths exist, prefer regenerating descriptor/media-probe/audio
goldens *natively* and treating the web captures as cross-checks (the web renderer is Canvas2D/
Web Audio and will differ from the native tiny-skia/cpal path within a documented tolerance).
