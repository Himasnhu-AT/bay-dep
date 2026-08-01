# Phase 4 — Harden & ship

[← Phase 3](phase-3.md) · [Plan](plan.md) · [Tasks](task.md)

**Estimated duration:** 4-6 months · **Tasks:** 15

## Goal
Take the feature-complete editor to production: hit the 4K/60 preview frame budget, harden hardware decode across the codec/color matrix with reliable SW fallback, finalize the encode codec/licensing matrix, and produce signed/notarized cross-platform installers with auto-update, bundled fonts, and model-download UX — all under a green full-app regression suite.

## ✅ Exit gate (must all pass to advance)
- [ ] 4K60 preview holds on target hardware; audio has no underruns; export throughput meets target
- [ ] Hardware decode is stable with SW fallback across the codec matrix; 10-bit/HDR color correct
- [ ] Encode/licensing matrix is legally clean (cargo-deny green, no GPL contamination)
- [ ] Signed/notarized installers ship on macOS/Windows/Linux with auto-update; fonts bundled; models download reliably
- [ ] Full golden/perf/migration/e2e suites green in CI cross-platform; degraded no-GPU mode ships

## Test strategy for this phase
Release gating is the union of all prior suites (unit/property/golden three-tier/migration/parity) run cross-platform in CI, PLUS perf benches with hard budget thresholds (4K60, audio deadline, export throughput) and an e2e import->edit->export flow. Hardware-decode and packaging are validated on clean per-OS VMs. Licensing is enforced by cargo-deny in CI.

## Deliverables
- 4K/60 preview within frame budget; hardened large-timeline drag, audio callback, and export throughput
- Stable hardware decode across the codec matrix with SW fallback and correct 10-bit/HDR color
- Finalized, license-clean encode matrix (LGPL build + hw/SW encoders; webm/VP9/Opus clean path)
- Signed/notarized installers for macOS/Windows/Linux with auto-update, bundled fonts, and model-download UX
- Green full-app regression suite, cross-platform parity sign-off, and a shippable degraded no-GPU mode

## Workstreams & tasks

### Workstream: Performance

#### `P4-PERF-01` — 4K/60 preview frame budget
Profile and optimize the resolve+composite(+optional readback) pipeline to a 60fps budget at 4K: async decode with last-good-frame, texture-cache upload minimization, and per-layer effect cost control.

> **Test gate:** Perf: a representative 4K project sustains 60fps preview on target hardware within the frame budget; regression benches gate CI.

#### `P4-PERF-02` — Timeline drag perf (12-track/500-element)
Ensure previewElements overlay merge + snapping stay within budget on large timelines via imbl structural sharing + indexed snapping.

> **Test gate:** Perf: 60fps drag on 12-track/500-element within budget; indexed snapping beats linear scan.

#### `P4-PERF-03` — Audio callback deadline / no-underrun hardening
Guarantee the cpal callback is allocation/lock-free at device sample rate with off-thread decode/resample/stretch; add underrun telemetry.

> **Test gate:** Perf: 8+ voices at device rate, zero underruns over a long session; no allocation in the callback (verified).

#### `P4-PERF-04` — Export throughput (double-buffered readback)
Double-buffer GPU->CPU readback against encode so ffmpeg stays fed; row-pitch/pix-fmt correct.

> **Test gate:** Perf: export throughput target for 1080p/4K; A/V duration alignment preserved.

### Workstream: Decode / hardware stability

#### `P4-HW-01` — Hw-decode stability matrix + fallback
Stabilize VideoToolbox/NVDEC/VAAPI across the codec matrix with automatic SW fallback and surface-format handling.

> **Test gate:** Integration: the full fixture codec matrix decodes with hw accel where available and SW fallback elsewhere, no crashes over a stress run.

#### `P4-HW-02` — 10-bit / HDR color-conversion correctness
Finalize the P0-MED-02 color stage for 10-bit/HDR (P010, BT.2020, transfer functions) into the compositor path.

> **Test gate:** Golden: 10-bit HEVC + HDR fixtures convert to expected color within tolerance.

#### `P4-HW-03` — Encode codec/licensing matrix finalization
Lock the LGPL FFmpeg build (GPL encoders off) + hw encoders (VideoToolbox/NVENC/QSV/VAAPI) + LGPL SW encoders (openh264/libvpx/aom/Opus/AAC); document the shippable matrix and the always-clean webm/VP9/Opus path.

> **Test gate:** cargo-deny/licensing audit passes; each shippable format encodes and validates via ffprobe with no GPL contamination.

### Workstream: Packaging & signing

#### `P4-PKG-01` — macOS packaging + notarization/signing
Signed/notarized .app/.dmg with entitlements for GPU/audio/file access.

> **Test gate:** Notarized build installs and launches clean on a fresh macOS; gatekeeper passes.

#### `P4-PKG-02` — Windows packaging + signing
Signed installer with the MSVC + FFmpeg (+optional CUDA) runtime from the P0-MED-03 matrix.

> **Test gate:** Signed installer runs on a clean Windows VM; SmartScreen passes; hw + SW decode both work.

#### `P4-PKG-03` — Linux packaging + clipboard/Wayland edge cases
AppImage/Flatpak with VAAPI runtime; resolve arboard clipboard ownership on X11/Wayland (paste needs a live event loop).

> **Test gate:** Package runs on a clean X11 and Wayland session; copy/paste survives app focus loss.

#### `P4-PKG-04` — Font bundling + model download UX
Bundle shipped fonts (licensing-cleared) and add on-demand Whisper model download/caching UX (tiny..large-v3-turbo ~1.5GB) with progress + offline behavior.

> **Test gate:** Manual: fonts render offline; model download resumes/caches and transcription runs without network after fetch.

#### `P4-PKG-05` — Auto-update
Cross-platform auto-update with signature verification.

> **Test gate:** Integration: an update is detected, verified, and applied on each OS.

### Workstream: Release QA

#### `P4-QA-01` — Full-app golden/e2e regression suite
End-to-end suite driving the shell (import -> edit -> export) plus the full golden/migration/perf ladders as a release gate.

> **Test gate:** CI: the full suite is green on all three OSes with the software GPU adapter for frame goldens.

#### `P4-QA-02` — Cross-platform parity QA
Structured parity pass across macOS/Windows/Linux for rendering, playback, export, and text layout (per-font).

> **Test gate:** Parity checklist signed off; platform-specific deltas documented and within tolerance.

#### `P4-QA-03` — Crash/telemetry + degraded (no-GPU) mode
Crash reporting + the degraded/no-adapter path (skip effects, simple blit) so the app still runs without a usable GPU.

> **Test gate:** Integration: forcing no adapter yields degraded mode that still edits/exports; crashes report with symbols.

---
[← Phase 3](phase-3.md) · [Plan](plan.md) · [Tasks](task.md)
