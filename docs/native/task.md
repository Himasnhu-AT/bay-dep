# Task list — native rewrite

> Flat, checkable backlog. IDs are stable and unique (`P<phase>-<area>-<n>`). Full detail + test gate for each task lives in the matching **[phase-N.md](phase-0.md)**. Dependencies noted inline.
> Total: **127 tasks** across 5 phases.

**Legend:** `- [ ] **ID** — title · _subsystem_ `kind` ⟵ depends: …`

## Phase 0 — De-risk spikes & foundational decisions  (12 tasks)

- [ ] **P0-GPU-01** — Freeze workspace-wide wgpu version & align crates · _wgpu compositor integration_ `infra`
- [ ] **P0-GPU-02** — Native texture upload into existing compositor (spike) · _Frame-descriptor bridge / compositor_ `spike`  ⟵ _depends: P0-GPU-01_
- [ ] **P0-GPU-03** — Drive Compositor::render_frame to a native winit/wgpu window · _wgpu compositor integration_ `spike`  ⟵ _depends: P0-GPU-01_
- [ ] **P0-GPU-04** — GPUI<->wgpu zero-readback preview interop GO/NO-GO gate · _Interactive preview GPUI shell_ `spike`  ⟵ _depends: P0-GPU-03, P0-GPU-05_
- [ ] **P0-GPU-05** — GPUI sourcing decision + Tauri fallback spike · _GPUI shell_ `spike`  ⟵ _depends: P0-GPU-01_
- [ ] **P0-MED-01** — FFmpeg vs GStreamer decode/hwaccel spike + licensing matrix decision · _media-demux-decode_ `spike`
- [ ] **P0-MED-02** — Color-management / bit-depth spike (10-bit HEVC -> RGB) · _media-demux-decode_ `spike`  ⟵ _depends: P0-MED-01_
- [ ] **P0-MED-03** — Cross-platform C/C++ CI build matrix de-risk · _packaging/CI_ `infra`  ⟵ _depends: P0-MED-01_
- [ ] **P0-TXT-01** — Text shaper selection + metric-parity spike · _text-layout-measure_ `spike`
- [ ] **P0-TXT-02** — tiny-skia raster determinism + golden harness spike · _Canvas2D->native raster_ `spike`
- [ ] **P0-ARCH-01** — Owned-Editor + Command-enum + EventBus borrow-model spike · _EditorCore singleton & lifecycle_ `spike`
- [ ] **P0-ARCH-02** — Golden-fixture capture tooling from the running web app · _cross-cutting test infra_ `infra`

## Phase 1 — opencut-core — headless framework-agnostic engine  (67 tasks)

- [ ] **P1-FND-04** — time crate serde/non-wasm extension · _opencut-time_ `port`  ⟵ _depends: P0-ARCH-02_
- [ ] **P1-FND-01** — Domain model (opencut-core types) · _Project & timeline domain model_ `port`  ⟵ _depends: P1-FND-04_
- [ ] **P1-FND-02** — Params registry + color model (FOUNDATIONAL) · _params registry (completeness add)_ `port`  ⟵ _depends: P1-FND-04_
- [ ] **P1-FND-03** — fps utils · _fps handling (completeness add)_ `port`  ⟵ _depends: P1-FND-04_
- [ ] **P1-PER-01** — SerializedProject (de)serialization layer · _Project (de)serialization layer_ `port`  ⟵ _depends: P1-FND-01_
- [ ] **P1-PER-02** — Structured store (IndexedDB -> SQLite) + KvStore · _Structured store_ `rewrite`  ⟵ _depends: P1-PER-01_
- [ ] **P1-PER-03** — Media blob store (OPFS -> native filesystem) · _Media blob store_ `rewrite`  ⟵ _depends: P1-PER-02_
- [ ] **P1-PER-04** — 31-version project migration chain + golden strategy · _31-version migration chain_ `port`  ⟵ _depends: P1-PER-02, P0-ARCH-02_
- [ ] **P1-PER-05** — Storage quota / capacity gate · _Storage quota_ `rewrite`  ⟵ _depends: P1-PER-03_
- [ ] **P1-PER-06** — Keybindings persisted-state + 6-step migration chain · _actions/keybindings persistence (completeness add)_ `port`  ⟵ _depends: P1-PER-02, P0-ARCH-02_
- [ ] **P1-CORE-03** — Observable / EventBus reactivity model · _Observable/subscription reactivity model_ `rewrite`  ⟵ _depends: P1-FND-01_
- [ ] **P1-CORE-04** — SelectionManager · _SelectionManager_ `port`  ⟵ _depends: P1-FND-01_
- [ ] **P1-CORE-02** — Command pattern & undo/redo · _Command pattern & undo/redo_ `rewrite`  ⟵ _depends: P1-TL-01, P1-CORE-03, P1-CORE-04, P1-TL-07_
- [ ] **P1-CORE-01** — Owned Editor + EditorState central model + lifecycle · _EditorCore singleton & lifecycle_ `rewrite`  ⟵ _depends: P1-FND-01, P0-ARCH-01, P1-CORE-02, P1-CORE-03_
- [ ] **P1-CORE-05** — ClipboardManager · _ClipboardManager_ `port`  ⟵ _depends: P1-CORE-01, P1-TL-13_
- [ ] **P1-CORE-06** — SaveManager (autosave) · _SaveManager_ `rewrite`  ⟵ _depends: P1-CORE-01, P1-CORE-03, P1-PER-02_
- [ ] **P1-CORE-07** — DiagnosticsManager · _DiagnosticsManager_ `port`  ⟵ _depends: P1-CORE-01_
- [ ] **P1-CORE-08** — ProjectManager · _ProjectManager_ `port`  ⟵ _depends: P1-CORE-01, P1-FND-03, P1-PER-01_
- [ ] **P1-CORE-09** — ScenesManager (single-owner scenes) · _ScenesManager_ `rewrite`  ⟵ _depends: P1-CORE-01, P1-TL-09_
- [ ] **P1-CORE-10** — PlaybackManager (clock injection) · _PlaybackManager_ `rewrite`  ⟵ _depends: P1-CORE-01, P1-TL-13_
- [ ] **P1-CORE-11** — MediaManager (asset registry) · _MediaManager_ `port`  ⟵ _depends: P1-CORE-01_
- [ ] **P1-CORE-12** — RendererManager (render-tree state & export orchestration) · _RendererManager_ `port`  ⟵ _depends: P1-CORE-01, P1-RND-03_
- [ ] **P1-TL-01** — timeline-core-model · _timeline-core-model_ `port`  ⟵ _depends: P1-FND-01, P1-FND-02_
- [ ] **P1-TL-08** — retime-speed (rate math) · _retime-speed_ `port`  ⟵ _depends: P1-TL-01_
- [ ] **P1-TL-02** — update-pipeline · _update-pipeline_ `port`  ⟵ _depends: P1-TL-01, P1-TL-08, P1-ANIM-01_
- [ ] **P1-TL-03** — placement-engine · _placement-engine_ `port`  ⟵ _depends: P1-TL-01_
- [ ] **P1-TL-04** — snapping · _snapping_ `port`  ⟵ _depends: P1-TL-01, P1-ANIM-02_
- [ ] **P1-TL-05** — group-move · _group-move_ `port`  ⟵ _depends: P1-TL-01, P1-TL-03, P1-TL-04_
- [ ] **P1-TL-06** — group-resize · _group-resize_ `port`  ⟵ _depends: P1-TL-01, P1-TL-08_
- [ ] **P1-TL-07** — ripple · _ripple_ `port`  ⟵ _depends: P1-TL-01_
- [ ] **P1-TL-09** — bookmarks-model · _bookmarks-model_ `port`  ⟵ _depends: P1-TL-01, P1-TL-04_
- [ ] **P1-TL-11** — scale-ruler-viewport-utils (pure math) · _scale-ruler-viewport-utils_ `port`  ⟵ _depends: P1-TL-01, P1-FND-03_
- [ ] **P1-TL-12** — drop-target-computation · _drop-target-computation_ `port`  ⟵ _depends: P1-TL-01, P1-TL-03_
- [ ] **P1-TL-13** — TimelineManager (mutation & query surface) · _TimelineManager (mutation & query surface)_ `rewrite`  ⟵ _depends: P1-CORE-02, P1-TL-01, P1-TL-02, P1-TL-03, P1-TL-05, P1-TL-06, P1-TL-07, P1-ANIM-02_
- [ ] **P1-ANIM-01** — animation-channel-curve-math · _animation-channel-curve-math_ `port`  ⟵ _depends: P1-FND-04, P1-FND-02_
- [ ] **P1-ANIM-02** — animation-keyframe-crud · _animation-keyframe-crud_ `port`  ⟵ _depends: P1-ANIM-01_
- [ ] **P1-ANIM-03** — animation-param-channels · _animation-param-channels_ `port`  ⟵ _depends: P1-ANIM-01, P1-FND-02, P1-FX-01_
- [ ] **P1-ANIM-04** — motion-presets · _motion presets (completeness add)_ `port`  ⟵ _depends: P1-ANIM-03, P1-FX-01, P1-CORE-02_
- [ ] **P1-FX-01** — effects-registry-and-definitions · _effects-registry-and-definitions_ `rewrite`  ⟵ _depends: P1-FND-02_
- [ ] **P1-FX-02** — effects-gpu-pipeline (native de-wasm) · _effects-gpu-pipeline_ `integration`  ⟵ _depends: P1-FX-01, P0-GPU-01, P0-GPU-03_
- [ ] **P1-MASK-02** — masks-interaction-and-snapping (math) · _masks-interaction-and-snapping_ `port`  ⟵ _depends: P1-FND-02_
- [ ] **P1-MASK-01** — masks-shapes-and-rasterization (tiny-skia) · _masks-shapes-and-rasterization_ `rewrite`  ⟵ _depends: P1-MASK-02, P1-TXT-02, P1-GRAD-01, P0-TXT-02_
- [ ] **P1-MASK-03** — masks-gpu-feather (native de-wasm) · _masks-gpu-feather_ `integration`  ⟵ _depends: P1-MASK-01, P0-GPU-01, P0-GPU-03_
- [ ] **P1-GFX-01** — graphics-definitions registry · _graphics definitions (completeness add)_ `port`  ⟵ _depends: P1-FND-02, P1-ANIM-03_
- [ ] **P1-GRAD-01** — gradients parser + tiny-skia rasterizer · _gradients (completeness add)_ `rewrite`  ⟵ _depends: P1-FND-02, P0-TXT-02_
- [ ] **P1-MED-02** — audio-decode-resample · _audio-decode-resample_ `rewrite`  ⟵ _depends: P0-MED-01_
- [ ] **P1-MED-01** — media-demux-decode (ffmpeg-next + hwaccel) · _media-demux-decode_ `rewrite`  ⟵ _depends: P0-MED-01, P0-MED-02, P1-MED-02_
- [ ] **P1-MED-03** — audio gain & source-audio model (merged) · _audio-gain-model + audio-separation-and-state_ `port`  ⟵ _depends: P1-TL-01, P1-ANIM-01_
- [ ] **P1-MED-04** — audio-retime-pitch (rubato + signalsmith) · _audio-retime-pitch_ `rewrite`  ⟵ _depends: P1-MED-02, P1-TL-08_
- [ ] **P1-MED-06** — audio-mastering (native limiter) · _audio-mastering_ `rewrite`
- [ ] **P1-MED-05** — audio-mix-export (offline mixer + WAV) · _audio-mix-export_ `port`  ⟵ _depends: P1-MED-02, P1-MED-03, P1-MED-04, P1-MED-06_
- [ ] **P1-MED-07** — waveform · _waveform_ `port`  ⟵ _depends: P1-MED-02_
- [ ] **P1-MED-08** — thumbnails · _thumbnails_ `rewrite`  ⟵ _depends: P1-MED-01_
- [ ] **P1-MED-09** — media-import-pipeline · _media-import-pipeline_ `port`  ⟵ _depends: P1-MED-01, P1-MED-08, P1-MED-02, P1-CORE-11_
- [ ] **P1-MED-10** — audio-playback-scheduling (cpal engine) · _audio-playback-scheduling / AudioManager_ `rewrite`  ⟵ _depends: P1-MED-02, P1-MED-03, P1-MED-04, P1-MED-06, P1-CORE-10_
- [ ] **P1-ASR-01** — transcription ASR runner · _transcription-subtitles (ASR)_ `rewrite`  ⟵ _depends: P1-MED-05, P1-MED-02, P1-TXT-03_
- [ ] **P1-TXT-01** — fonts (FontRegistry) · _fonts_ `rewrite`  ⟵ _depends: P0-TXT-01_
- [ ] **P1-TXT-02** — text-layout-measure (metric parity) · _text-layout-measure_ `rewrite`  ⟵ _depends: P1-TXT-01, P0-TXT-01, P1-FND-02_
- [ ] **P1-TXT-03** — subtitle formats + caption chunking · _subtitle formats (completeness split)_ `port`  ⟵ _depends: P1-TL-01, P1-FND-02_
- [ ] **P1-STK-01** — stickers source vendoring + resolver + intrinsic-size · _stickers library (completeness add, engine-side)_ `rewrite`  ⟵ _depends: P1-FND-02_
- [ ] **P1-RND-01** — Scene-graph model + scene builder · _Scene-graph model + scene builder_ `port`  ⟵ _depends: P1-TL-01, P1-FND-02, P1-ANIM-01_
- [ ] **P1-RND-02** — Preview geometry (hit-test/bounds/coords/snap) · _Pure geometry_ `port`  ⟵ _depends: P1-TL-01, P1-ANIM-01, P1-TXT-02_
- [ ] **P1-RND-03** — Frame-descriptor build + texture cache/bridge · _Frame-descriptor build + texture cache/bridge_ `rewrite`  ⟵ _depends: P1-RND-01, P0-GPU-02_
- [ ] **P1-RND-04** — wgpu compositor integration + GPU init · _wgpu compositor integration + GPU init_ `integration`  ⟵ _depends: P0-GPU-01, P0-GPU-03, P1-FX-02, P1-MASK-03_
- [ ] **P1-RND-05** — Render-tree resolve (per-frame sampling) · _Render-tree resolve_ `rewrite`  ⟵ _depends: P1-RND-01, P1-MED-01, P1-ANIM-01, P1-ANIM-03, P1-TXT-02, P1-FX-01, P1-GFX-01, P1-STK-01_
- [ ] **P1-RND-06** — Canvas2D -> native 2D rasterization · _Canvas2D->native 2D rasterization_ `rewrite`  ⟵ _depends: P1-RND-05, P1-TXT-02, P1-GRAD-01, P1-MASK-01, P1-GFX-01_
- [ ] **P1-RND-07** — Export pipeline + native muxing · _Export pipeline + native muxing_ `rewrite`  ⟵ _depends: P1-RND-04, P1-RND-06, P1-MED-05, P0-MED-01, P1-FND-03_

## Phase 2 — Native MCP server (rmcp over opencut-core)  (6 tasks)

- [ ] **P2-MCP-01** — Core actor / single-writer command-queue front · _Native MCP server_ `new`  ⟵ _depends: P1-CORE-01, P1-CORE-02, P1-PER-02_
- [ ] **P2-MCP-02** — rmcp server shell + transport · _Native MCP server_ `new`  ⟵ _depends: P2-MCP-01_
- [ ] **P2-MCP-03** — Tool surface (Command/Query -> tools) · _Native MCP server_ `new`  ⟵ _depends: P2-MCP-02, P1-CORE-02_
- [ ] **P2-MCP-04** — Resource providers (project/timeline/media) · _Native MCP server_ `new`  ⟵ _depends: P2-MCP-02, P1-PER-01_
- [ ] **P2-MCP-05** — Import/quota guards + error mapping · _Native MCP server_ `new`  ⟵ _depends: P2-MCP-03, P1-PER-05, P1-MED-09_
- [ ] **P2-MCP-06** — Change-notifications (EventBus -> MCP) · _Native MCP server_ `new`  ⟵ _depends: P2-MCP-02, P1-CORE-03_

## Phase 3 — GPUI UI shell (timeline / preview / inspector / asset browser)  (27 tasks)

- [ ] **P3-SHELL-01** — GPUI app skeleton + Models wired to EventBus · _GPUI shell_ `rewrite`  ⟵ _depends: P0-GPU-04, P1-CORE-01, P1-CORE-03_
- [ ] **P3-SHELL-02** — Native wgpu preview surface embed · _GPUI shell / preview surface_ `integration`  ⟵ _depends: P3-SHELL-01, P1-RND-04, P0-GPU-04_
- [ ] **P3-SHELL-03** — a11y (AccessKit) integration · _GPUI shell / a11y_ `new`  ⟵ _depends: P3-SHELL-01_
- [ ] **P3-SHELL-04** — IME / text input integration · _GPUI shell / IME_ `new`  ⟵ _depends: P3-SHELL-01_
- [ ] **P3-SHELL-05** — Tauri disjoint-surface fallback shell · _Tauri fallback shell_ `integration`  ⟵ _depends: P1-RND-04, P0-GPU-05_
- [ ] **P3-PRV-01** — Preview viewport (RAF loop, pan/zoom, skip-unchanged) · _Interactive preview GPUI shell_ `rewrite`  ⟵ _depends: P3-SHELL-02, P1-RND-02_
- [ ] **P3-PRV-02** — Transform-handle controller + rendering · _Interactive preview GPUI shell_ `rewrite`  ⟵ _depends: P3-PRV-01, P1-RND-02, P1-TL-13_
- [ ] **P3-PRV-03** — Mask-handle controller + rendering · _masks-interaction-and-snapping (UI)_ `rewrite`  ⟵ _depends: P3-PRV-01, P1-MASK-02_
- [ ] **P3-PRV-04** — Text-edit overlay (WYSIWYG) · _Interactive preview GPUI shell_ `rewrite`  ⟵ _depends: P3-PRV-01, P1-TXT-02, P3-SHELL-04_
- [ ] **P3-PRV-05** — Snap guides, overlays, toolbar, context menu · _Interactive preview GPUI shell_ `rewrite`  ⟵ _depends: P3-PRV-01, P1-RND-02_
- [ ] **P3-PRV-06** — Guides & grid overlays · _guides/grid (completeness add)_ `port`  ⟵ _depends: P3-PRV-01_
- [ ] **P3-TL-01** — Timeline view (tracks/ruler/elements) · _timeline UI_ `rewrite`  ⟵ _depends: P3-SHELL-01, P1-TL-11_
- [ ] **P3-TL-02** — Interaction controllers (drag/resize/seek/zoom/playhead/keyframe) · _interaction-controllers-gpui_ `rewrite`  ⟵ _depends: P3-TL-01, P1-TL-13, P1-TL-05, P1-TL-06, P1-TL-12, P1-TL-04_
- [ ] **P3-TL-03** — Edge auto-scroll, scroll sync, box-select · _interaction-controllers-gpui_ `rewrite`  ⟵ _depends: P3-TL-02_
- [ ] **P3-TL-04** — Waveform rendering + bookmarks UI · _timeline UI (waveform/bookmarks)_ `rewrite`  ⟵ _depends: P3-TL-01, P1-MED-07, P1-TL-09_
- [ ] **P3-INS-01** — Inspector (data-driven param panels) · _inspector / params UI_ `rewrite`  ⟵ _depends: P3-SHELL-01, P1-FND-02, P1-TL-13_
- [ ] **P3-INS-02** — Graph editor UI (bezier curve editor) · _animation-graph-editor-ui_ `rewrite`  ⟵ _depends: P3-INS-01, P1-ANIM-02_
- [ ] **P3-INS-03** — Effects/masks browse + apply panels · _effects/masks UI_ `rewrite`  ⟵ _depends: P3-INS-01, P1-FX-01, P1-MASK-01_
- [ ] **P3-AST-01** — Media asset browser + import UX · _asset browser_ `rewrite`  ⟵ _depends: P3-SHELL-01, P1-MED-09_
- [ ] **P3-AST-02** — Stickers library browser · _stickers library (completeness add, UI)_ `rewrite`  ⟵ _depends: P3-AST-01, P1-STK-01_
- [ ] **P3-AST-03** — Sounds library (Freesound) + saved-sounds · _sounds library (completeness add)_ `rewrite`  ⟵ _depends: P3-AST-01, P1-MED-02_
- [ ] **P3-AST-04** — Subtitles / transcription UI · _transcription-subtitles (UI)_ `rewrite`  ⟵ _depends: P3-AST-01, P1-ASR-01, P1-TXT-03_
- [ ] **P3-ACT-01** — Action registry + definitions + dispatch · _actions & keybindings (completeness add)_ `rewrite`  ⟵ _depends: P3-SHELL-01, P1-CORE-02_
- [ ] **P3-ACT-02** — Keybinding matching + customizable bindings · _actions & keybindings (completeness add)_ `rewrite`  ⟵ _depends: P3-ACT-01, P1-PER-06_
- [ ] **P3-ACT-03** — Shortcuts-help UI · _actions & keybindings (completeness add)_ `rewrite`  ⟵ _depends: P3-ACT-02_
- [ ] **P3-PB-01** — Wire cpal playback + A/V sync to preview clock · _audio-playback-scheduling (validation)_ `integration`  ⟵ _depends: P3-PRV-01, P1-MED-10, P1-CORE-10_
- [ ] **P3-PKG-01** — Dev app bundle scaffolding per-OS · _packaging_ `packaging`  ⟵ _depends: P3-SHELL-01_

## Phase 4 — Harden & ship  (15 tasks)

- [ ] **P4-PERF-01** — 4K/60 preview frame budget · _rendering perf_ `perf`  ⟵ _depends: P3-PB-01, P3-PRV-01, P1-RND-04, P1-RND-05, P1-RND-06_
- [ ] **P4-PERF-02** — Timeline drag perf (12-track/500-element) · _timeline perf_ `perf`  ⟵ _depends: P3-TL-02_
- [ ] **P4-PERF-03** — Audio callback deadline / no-underrun hardening · _audio perf_ `perf`  ⟵ _depends: P3-PB-01_
- [ ] **P4-PERF-04** — Export throughput (double-buffered readback) · _export perf_ `perf`  ⟵ _depends: P1-RND-07_
- [ ] **P4-HW-01** — Hw-decode stability matrix + fallback · _media-demux-decode (hardening)_ `integration`  ⟵ _depends: P1-MED-01, P0-MED-02_
- [ ] **P4-HW-02** — 10-bit / HDR color-conversion correctness · _media-demux-decode (color)_ `integration`  ⟵ _depends: P1-MED-01, P0-MED-02_
- [ ] **P4-HW-03** — Encode codec/licensing matrix finalization · _export / licensing_ `packaging`  ⟵ _depends: P1-RND-07, P0-MED-01_
- [ ] **P4-PKG-01** — macOS packaging + notarization/signing · _packaging_ `packaging`  ⟵ _depends: P3-PKG-01_
- [ ] **P4-PKG-02** — Windows packaging + signing · _packaging_ `packaging`  ⟵ _depends: P3-PKG-01, P0-MED-03_
- [ ] **P4-PKG-03** — Linux packaging + clipboard/Wayland edge cases · _packaging_ `packaging`  ⟵ _depends: P3-PKG-01_
- [ ] **P4-PKG-04** — Font bundling + model download UX · _fonts / transcription packaging_ `packaging`  ⟵ _depends: P1-TXT-01, P1-ASR-01_
- [ ] **P4-PKG-05** — Auto-update · _packaging_ `packaging`  ⟵ _depends: P4-PKG-01, P4-PKG-02, P4-PKG-03_
- [ ] **P4-QA-01** — Full-app golden/e2e regression suite · _release QA_ `qa`  ⟵ _depends: P3-SHELL-02, P3-TL-02, P1-RND-07_
- [ ] **P4-QA-02** — Cross-platform parity QA · _release QA_ `qa`  ⟵ _depends: P4-PKG-01, P4-PKG-02, P4-PKG-03_
- [ ] **P4-QA-03** — Crash/telemetry + degraded (no-GPU) mode · _release QA_ `qa`  ⟵ _depends: P1-RND-04, P3-SHELL-01_
