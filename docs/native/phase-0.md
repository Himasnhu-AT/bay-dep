# Phase 0 — De-risk spikes & foundational decisions

[Plan](plan.md) · [Tasks](task.md) · [Phase 1 →](phase-1.md)

**Estimated duration:** 8-10 weeks · **Tasks:** 12

## Goal
Resolve the three go/no-go unknowns that gate the entire program (GPUI<->wgpu preview interop, media codec licensing + hwaccel, text-raster parity), freeze one workspace-wide wgpu version, stand up the cross-platform C/C++ CI build matrix, prove the owned-Editor borrow model, and build the golden-fixture capture tooling. Nothing here is throwaway UI; each spike either unblocks a phase or forces a documented architectural decision.

## ✅ Exit gate (must all pass to advance)
- [ ] wgpu version frozen and every native crate builds against it
- [ ] GPUI preview-interop gate decided (GO enables native surface; NO-GO commits the Tauri fallback) — no Phase 3 UI effort scheduled until this is resolved
- [ ] FFmpeg-vs-GStreamer backend chosen and codec/licensing matrix written and legally acceptable
- [ ] CI is green on all three OSes with the full C/C++ toolchain
- [ ] Text shaper committed with a written parity tolerance; tiny-skia goldens byte-stable cross-platform
- [ ] Borrow model validated on two pure managers; fixture-capture tooling producing committed fixtures

## Test strategy for this phase
Spikes are validated by explicit written decisions plus minimal executable proofs (a rendered frame, a decoded 10-bit fixture, identical cross-platform PNG hashes, a one-event-per-command trace). CI cross-platform build health is itself the primary gate for the media/text workstreams. No production code ships from Phase 0 except the golden-capture tooling and the golden harness scaffolding.

## Deliverables
- Frozen single workspace wgpu version with all native crates aligned
- GO/NO-GO decision on GPUI zero-readback preview interop (+ Tauri fallback demo) and committed GPUI source pin
- Codec backend + licensing matrix decision; color-conversion stage contract; 10-bit decode proof
- Green macOS/Windows/Linux CI building FFmpeg + whisper.cpp + Signalsmith
- Committed text shaper choice with a measured metric-parity budget; deterministic tiny-skia golden harness
- Owned-Editor/Command/EventBus borrow model proven on Selection+Clipboard
- Provenance-correct golden fixtures (per-version projects, descriptors, media probes, audio refs) and capture tooling

## Workstreams & tasks

### Workstream: GPU & windowing

#### `P0-GPU-01` — Freeze workspace-wide wgpu version & align crates
Compositor/effects/masks/gpu target wgpu 29; vello wants 28; gpui pins its own in-tree wgpu. Two majors cannot share a Device/Texture. Choose ONE wgpu for the whole workspace driven by the committed GPUI source, align all crates, and drop vello from v1 (revisit only if a single-wgpu vello ships).

> **Test gate:** Workspace compiles with a single wgpu major; a smoke test creates one Device and passes a Texture between the compositor crate and a raw window handle from the chosen GPUI source.

#### `P0-GPU-02` — Native texture upload into existing compositor (spike)
Prove queue.write_texture into the reused Compositor's texture_store with correct 256-byte row-pitch alignment and Bgra8Unorm/RGBA swizzle, replacing the wasm uploadTexture path.

> **Test gate:** Upload a known RGBA buffer, render one layer via render_frame_to_texture, read back, and assert the fill matches within tolerance (validates format + alignment end-to-end).

#### `P0-GPU-03` — Drive Compositor::render_frame to a native winit/wgpu window
Bind a wgpu::Surface to a native window from raw-window-handle and present the compositor output each frame (the always-surface native path replacing the wasm WebGPU/WebGL branch).

> **Test gate:** A windowed demo presents a composited multi-layer FrameDescriptor at interactive rate with correct surface format; screenshot matches an offscreen render.

#### `P0-GPU-04` — GPUI<->wgpu zero-readback preview interop GO/NO-GO gate
The pivotal gate: prove a wgpu texture produced by our Compositor (sharing the same Device) can be composited into a GPUI custom element with no CPU round-trip. If NO-GO, the Tauri disjoint-surface fallback (P0-GPU-05 / P3-SHELL-05) is selected for Phase 3.

> **Test gate:** Written GO/NO-GO decision with a working demo embedding a live compositor texture in a GPUI element at 60fps, OR a documented failure that triggers the Tauri fallback path.

> ⚠️ **Phase-0 finding (2026-08-01) — the premise needs restating.** GPUI 0.2.2 (crates.io, the `apps/desktop` shell) renders through **blade-graphics 0.7.1 + naga 25**, *not wgpu*. So there is **no shared wgpu `Device`** to hand a compositor texture into — the "same-Device zero-readback" path as originally written does not exist for this GPUI. The real interop question is **blade ↔ wgpu**: can a wgpu `Texture` and a blade texture alias the *same underlying Metal/Vulkan image* (IOSurface / `VK_KHR_external_memory`) with no CPU round-trip? Reframed options for this gate: (a) blade↔wgpu shared native image (hard, per-platform); (b) one GPU→GPU texture copy per frame handed to GPUI as an image (not a full CPU readback — a viable middle ground); (c) a pinned Zed-monorepo GPUI revision *if/when* it moves to wgpu; (d) the Tauri disjoint-surface fallback. This does **not** threaten `P0-GPU-01` — because GPUI never pulls wgpu, freezing wgpu at 29 cannot collide with it. See [phase-0-progress.md](phase-0-progress.md).

#### `P0-GPU-05` — GPUI sourcing decision + Tauri fallback spike
Decide GPUI source (crates.io 0.2.2 vs pinned Zed monorepo revision vs community fork) balancing wgpu/raw-window-handle compatibility and maintenance; spike a minimal Tauri shell rendering a compositor texture as the fallback surface on the same core.

> **Test gate:** Pinned GPUI dependency committed and building on all three OSes; Tauri fallback demo renders one composited frame from opencut-core.

### Workstream: Media, codec & licensing

#### `P0-MED-01` — FFmpeg vs GStreamer decode/hwaccel spike + licensing matrix decision
Prototype demux+decode+seek and hardware decode (VideoToolbox/NVDEC/VAAPI) on both ffmpeg-next (in-process, manual hwaccel plumbing) and gstreamer-rs; decide the engine backend and freeze the codec/licensing matrix (default LGPL FFmpeg, GPL encoders OFF, hw encoders + openh264/libvpx-VP9/aom-AV1/Opus/AAC; webm/VP9/Opus as always-clean path).

> **Test gate:** Written backend + licensing decision; a spike decodes h264/hevc/vp9/av1 fixtures with hw accel and SW fallback and reports codec/duration/fps.

#### `P0-MED-02` — Color-management / bit-depth spike (10-bit HEVC -> RGB)
Define the YUV->RGB + transfer-function conversion stage for decoder surfaces (NV12/P010, BT.709/BT.2020) and decide 8-bit vs 10-bit/HDR handling into the Bgra8 compositor path.

> **Test gate:** A 10-bit HEVC fixture decodes and converts to RGB matching a reference within tolerance; conversion stage contract documented for P1-MED-01.

#### `P0-MED-03` — Cross-platform C/C++ CI build matrix de-risk
Stand up macOS/Windows/Linux CI that builds the three native C/C++ deps (FFmpeg, whisper.cpp via whisper-rs, Signalsmith via ssstretch cxx), including MSVC + optional CUDA, with toolchain caching. This is the real long pole for packaging.

> **Test gate:** Green CI on all three OSes linking all three native deps; documented build recipe + fallback (candle for ASR, ffmpeg-sidecar as escape hatch).

### Workstream: Text & raster parity

#### `P0-TXT-01` — Text shaper selection + metric-parity spike
Compare cosmic-text (HarfRust+swash+skrifa, color-emoji/bidi) vs parley against Canvas2D measureText for advance widths, actualBoundingBox ascent/descent, letterSpacing semantics, and 'middle'-baseline centering; commit one shaper and quantify the parity gap.

> **Test gate:** Written shaper decision + a measured parity report on a font/size/weight/letterSpacing matrix, establishing the tolerance budget and per-font calibration need for P1-TXT-02.

#### `P0-TXT-02` — tiny-skia raster determinism + golden harness spike
Prove tiny-skia produces byte-identical RGBA across runs/platforms for fills/strokes/gradients and stand up the tier-1 CPU-raster golden PNG harness (0-tolerance) that masks/gradients/graphics/text will use.

> **Test gate:** The same shape rasterized on macOS/Windows/Linux CI yields identical PNG hashes; golden harness committed.

### Workstream: Architecture & tooling

#### `P0-ARCH-01` — Owned-Editor + Command-enum + EventBus borrow-model spike
Validate the central-EditorState + stateless-module design on the two pure managers (Selection, Clipboard): a serde-tagged Command enum, Editor::execute(&mut EditorState), a History with selectionOverride semantics, and a coalesced EventBus — proving no &mut aliasing and no per-manager locking is needed.

> **Test gate:** A minimal Editor executes/undoes Selection+Clipboard commands, emits exactly one coalesced event per command, and compiles with zero Arc<RwLock>-per-manager; borrow model signed off.

#### `P0-ARCH-02` — Golden-fixture capture tooling from the running web app
Script the web storageService/renderer to dump per-version project JSON (v0..v31), keybindings-store snapshots, descriptor-level scene snapshots, media-probe tables, and audio-mix reference buffers — the provenance-correct fixtures the whole test strategy depends on (do NOT hand-author).

> **Test gate:** Committed fixture set: real project JSON for every migration version, at least one descriptor golden, one media-probe table, and one audio-mix reference, each reproducible by a documented capture command.

---
[Plan](plan.md) · [Tasks](task.md) · [Phase 1 →](phase-1.md)
