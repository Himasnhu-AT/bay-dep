# Gausian Native Editor — competitive teardown for bay

Recon date: 2026-08-08. Subject: `github.com/gausian-AI/Gausian_native_editor` at `2e173a0`
(24 commits, one author, ~43.7k LOC Rust, 28 tests, no CI). Reference: bay at
`/Users/himanshu/codes/synthai/vii`.

The working clone lived at `vii/tmp/Gausian_native_editor` and has been deleted; `tmp/…` paths
below are relative to a fresh clone of that commit. **Licence verdict is ideas-only — see §2
before copying a line of it.** Actionable items have been folded into
[`todo.pending.md`](../../todo.pending.md).

---

## 1. What Gausian is, and how it differs from bay

Gausian is a single-author Rust desktop video editor built on eframe/egui, with an ambitious
surface area and very little of it finished: a VideoToolbox/IOSurface/GStreamer decode layer,
a wgpu renderer with YUV shaders, a SQLite project catalog, FCPXML/FCP7/EDL exporters, a
manifest-driven plugin host with Wasm/Python/native runtimes, a marketplace client, a ComfyUI
lifecycle manager, a Modal cloud backend, a FastAPI WebSocket relay, and OpenAI/Gemini/Twelve
Labs clients. The centre of gravity is a 6,816-line `app.rs` `include!`d into the binary that
owns cloud calls, ComfyUI orchestration, screenplay LLM sessions, preview and export — there
is no engine/UI split, and the 525-line CLI cannot reach any of it.

Philosophically it is bay's opposite. Gausian is a **frontend to other people's compute**: the
editor is where you assemble things that a datacenter, a Python graph engine or a hosted LLM
produced. bay is an **engine with replaceable front ends**: `rust/` owns all logic, the GPUI
shell and `bay-mcp` are peers over the same crates, and the only outbound hosts in the entire
tree are the pinned provisioning mirrors. Gausian also ships aspiration as fact — its README
claims "only local ComfyUI, no cloud connection" while a fully-implemented Modal backend is
wired into the UI; its WASM plugin executor returns `success: true` from a stub; its CLI
`export` prints "Export completed (demo mode)" and exits 0. bay's three-way `todo.md` split
exists precisely to make that impossible.

Net: they are ahead of bay in exactly one place (native hardware decode plumbing, and even
that is half-stubbed), behind everywhere the code has to actually be correct.

---

## 2. Licence verdict

**File read: `/Users/himanshu/codes/synthai/vii/tmp/Gausian_native_editor/LICENSE` — 17 lines,
Apache License 2.0 boilerplate header, `Copyright (c) 2025 Mingeon Kim`. It is only the short
"how to apply" appendix, not the full Apache text, and there is no `NOTICE` file. The README
(line 240) instead claims "Core: MPL-2.0" plus a separate commercial licence for "Pro
Features".**

Verdict: **ideas only. Do not copy a single line of their code into bay.**

Reasons, in order of weight:

1. **The repo contradicts itself.** LICENSE says Apache-2.0; README says MPL-2.0 core plus an
   unspecified commercial tier. Nothing in the tree marks which files are "Pro". A grant you
   cannot identify is a grant you cannot rely on, and the author may believe he shipped
   file-level copyleft (MPL §3.1 would follow any copied file into bay and require source for
   that file).
2. **Even the clean reading is expensive.** bay's tree is single-licence MIT
   (`/Users/himanshu/codes/synthai/vii/LICENSE`, "Copyright 2025-2026 OpenCut"). Taking
   Apache-2.0 files means carrying a NOTICE, §4(b) change markers, and a patent-grant clause
   into an otherwise permissive repo — for code that is single-author, largely untested, and
   in several places demonstrably wrong (inverted blend branches, half-width chroma copy,
   double-retained IOSurface, unaligned readback).
3. **There is no payoff.** The parts worth having are *designs* (two-stage seek, decode
   intent, job progress), not implementations. bay's model — `MediaTime` ticks, `Tracks`,
   `Command`/`ProjectPatch` — does not resemble theirs, so the mapping is the work anyway.

Obligations if this is ever overridden: reproduce the full Apache-2.0 text, add a `NOTICE`
retaining `Copyright (c) 2025 Mingeon Kim`, mark modified files per §4(b), fence the code in
one clearly-labelled module, and record the LICENSE/README ambiguity in a comment. Treat the
licence the way `bay-provision` already treats a provisioned artifact: a declared field with a
test behind it (`manifest.rs:466-476`), not a sentence in a README.

**Reading their WGSL, their FCPXML structure, and their decode state machine as prior art is
fine and is what this report recommends. Writing bay's own from that reading is fine. Copy-paste
is not.**

---

## 3. The top 5 things worth taking

Ranked by value ÷ effort. Each is an idea to re-implement natively, never a file to lift.

### 1. Two-stage seek: instant approximate frame, then accurate refine — the missing design piece for M9

**What it is.** On scrub, they seek `KEY_UNIT` (nearest keyframe, instant), paint that frame
tagged `accurate: false`, then decode `ACCURATE` in the background and replace it. Their
GStreamer backend only — the VideoToolbox path falls through to the default trait impl and
just seeks accurately, which is the split bay must avoid by having one decode layer.

**Where their code is.** `crates/native-decoder/src/gstreamer_backend.rs` (the two-stage seek
and the `accurate` flag on the frame struct); `crates/native-decoder/src/lib.rs` (the trait
whose default impl silently loses the optimisation).

**What bay does today.** bay has no seek at all. `decode_video_clip`
(`/Users/himanshu/codes/synthai/vii/rust/crates/bay-preview/src/lib.rs:1003-1059`) decodes the
*whole* clip once at a planned proxy size and `render()` indexes the pre-decoded `Vec<Vec<u8>>`
by time (lib.rs:893-902). Scrub is therefore instant — but a 10-minute clip is a ~2 fps,
272×154 proxy, documented at `docs/native/parity-status.md:53`. `plan_decode` (lib.rs:267-335)
trades frame rate away to keep whole-duration coverage inside a 192 MB budget.

**Concrete first step.** In `bay-preview`, add a `preview_frame_at(media_id, t)` fast path that
spawns `ffmpeg -ss <t> -i <path> -frames:v 1 -f rawvideo -pix_fmt rgba pipe:1` (input-side
`-ss` is a keyframe seek and is O(1)), returns `DecodedFrame { rgba, accurate: false }`, and is
superseded when the windowed decode for that region lands. Carry `accurate: bool` on the frame
so `editor_view` can render a provisional badge. Write the two regression tests their code
would have failed: a window is decodable **past its first 2 seconds**, and the previous
window's frames are dropped before the new window's are served.

### 2. Export progress, cancellation, atomic finalize — on bay's existing job registry

**What it is.** They parse ffmpeg `-progress pipe:2`, run background work through a job
scheduler, and finalize generated artifacts with tmp-write → `fs::rename` on success, unlink on
failure.

**Where their code is.** `apps/desktop/src/export/ffmpeg.rs` (progress parsing — note they read
`out_time_ms` as milliseconds when it is microseconds, a 1000× bug; do not copy);
`apps/desktop/src/cache/manager.rs:632` (`finalize_job`, the tmp→rename pattern);
`apps/desktop/src/cache/manager.rs:41-70` (`JobSemaphore`: `Mutex<usize>` + `Condvar` + RAII
permit, max = `num_cpus - 1`).

**What bay does today.** `export_video`
(`/Users/himanshu/codes/synthai/vii/rust/crates/bay-preview/src/lib.rs:660`, frame loop at
755-770) takes no callback, has no cancel flag, returns a bare `bool`, and writes the MP4 in
place — a cancelled encode leaves a truncated file that looks like output. `bay-mcp`
(`studio.rs:806`) blocks until the encode finishes and dies on the flat 20 s `ATTACHED_TIMEOUT`
(`bay-mcp/src/server.rs:198,228`), which `todo.pending.md:36-49` already names as a problem. The
UI calls the blocking export straight on the GPUI main thread
(`bay-ui/src/editor_view.rs:1374` → `962` → `renderer.export_video`), which is why the 1280 px
cap at editor_view.rs:971 exists at all.

**Concrete first step.** Three changes, one afternoon each, in this order:
(a) change `export_video`'s signature to `(&mut self, …, progress: &mut dyn FnMut(u64, u64) ->
ControlFlow<()>) -> Result<(), String>` — bay owns the frame loop, so progress is exactly
`index / total_frames`, free and exact, which a `filter_complex` export can never be;
(b) write to `<out>.tmp` and `fs::rename` on success, unlink on cancel/error;
(c) register the export in `/Users/himanshu/codes/synthai/vii/rust/crates/bay-provision/src/jobs.rs`
(it already has `start() -> JobId`, dedup, byte tallies, and `fraction() -> Option<f32>` that
returns `None` rather than inventing a number) and route the UI call through the
`bay-agent/src/slow.rs` worker + `FollowUp` machinery that the agent path already uses
correctly (`slow.rs:111-116`). That closes the 20 s MCP timeout, the frozen window, and the
truncated-file bug in one pass, and lets the 1280 px cap be deleted.

### 3. Export must not decode from the 480 px preview cache

**What it is.** Not a feature of theirs to admire — the comparison exposed it. Their
ffmpeg-CLI export is architecturally worse (one `-filter_complex` concat, so no effect,
transform, mask or blend survives export and preview can never match output), yet it decodes
the source at **full resolution**, and bay does not.

**Where their code is.** `apps/desktop/src/export/ffmpeg.rs` (`run_ffmpeg_timeline`).

**What bay does today.** `export_video`
(`/Users/himanshu/codes/synthai/vii/rust/crates/bay-preview/src/lib.rs:660`) calls the same
`render()` as the preview (lib.rs:781), which pulls from `video_cache` — populated by
`plan_decode` with `VIDEO_MAX_WIDTH = 480`, `VIDEO_MAX_FPS = 30`, `VIDEO_MIN_FPS = 2.0`
(lib.rs:266-270). A 4K source therefore exports upscaled from a ≤480 px, possibly 2 fps proxy.
Nothing in `todo.pending.md` tracks this. It is bay's single largest export-quality defect and
it is invisible in short-clip testing.

**Concrete first step.** Add `enum DecodeIntent { Preview, Export }` as a parameter to
`plan_decode` (lib.rs:275). For `Export`, target the canvas size at the source frame rate and
stream a bounded window of frames rather than caching the whole clip — the 192 MB budget cannot
hold a full-res clip, so this lands naturally with the windowed decode of item 1. Ship a test
asserting the export plan is *not* width-capped at 480, and add a line to
`docs/native/parity-status.md` next to the existing long-clip note admitting the current
behaviour until it is fixed.

### 4. Readback: cached staging buffer, caller-pumped wait, and a degrade policy instead of `expect`

**What it is.** Two of their patterns. (a) A size-keyed staging-buffer cache (`ensure_cache`)
so a preview readback does not allocate a fresh GPU buffer every frame. (b) A two-tier error
policy: an *unsupported* input disables that path permanently; a *transient* GPU error gets
three strikes then falls back (`RendererReadbackBackend::handle_error`).

**Where their code is.** `crates/renderer/src/gpu/readback.rs` (`ensure_cache`, `align_to`,
`map_to_cpu`), `crates/renderer/src/gpu/sync.rs`, and `apps/desktop/clippy.toml` (they encode
"never block the shared device" as a `disallowed-methods` lint — a trick worth stealing on its
own).

**What bay does today.** `read_texture_native`
(`/Users/himanshu/codes/synthai/vii/rust/crates/bay-gpu/src/context.rs:756-813`) already gets
256-byte row alignment right (`div_ceil(256) * 256`, un-padded row by row) and already reads
BGRA natively to avoid a swizzle (`read_texture_bgra`, context.rs:830) — both better than
theirs. But it allocates a **fresh** staging buffer on every single readback (context.rs:761)
and blocks on `device.poll(wait_indefinitely())` (context.rs:798-800) on the GPUI main thread,
once per preview repaint (`bay-preview/src/lib.rs:1030-1040` →
`bay-ui/src/editor_view.rs:716-728`). Worse, the render path panics: `bay-preview/src/lib.rs:981`
is `.expect("compositor render_frame_to_texture failed")`, `bay-gpu/src/context.rs:719-724` is
an `assert_eq!` on upload length, and context.rs:800 `.expect`s a failed poll — all three
contradict CLAUDE.md's "the render path cannot panic on bad input".

**Concrete first step.** In `bay-gpu::GpuContext`, hold `staging: Option<(u32, u32, wgpu::Buffer)>`
and reuse it while `(width, height)` is unchanged; add a `pump: impl FnMut()` parameter to the
blocking readback so the GPUI window can service its event loop while the map is pending (do
**not** copy their 1 ms `thread::sleep` spin). Separately, turn `render_frame_to_texture`'s
`expect` into: log once, mark that layer/texture bad so it is not retried each frame (same
shape as the existing `ClipState::Failed`, `bay-preview/src/lib.rs:352-360`), and return the
last good frame. Turn the `assert_eq!` in `upload_rgba_texture` into a `Result`.

**Free rider, ~20 lines:** add `rust/clippy.toml` with `disallowed-methods` for blocking calls
that must never appear in the render path. `./test.sh` already runs clippy `-D warnings`, so
the guard costs nothing once written, and it converts an unwritten review rule into a build
failure.

### 5. NV12/P010 GPU upload as prior art for windowed decode

**What it is.** Their renderer samples YUV planes on the GPU — NV12 and P010 shaders plus a
BT.709 conversion — with plane descriptors (base address and bytes-per-row per plane) pulled
from an IOSurface. It is the only part of their tree that is genuinely ahead of bay.

**Where their code is.** `crates/renderer/src/shaders/preview_nv12.wgsl`,
`preview_p010.wgsl`, `yuv_to_rgb.wgsl`; `crates/native-decoder/src/wgpu_integration.rs` (plane
descriptor handling); `crates/renderer/src/cpu.rs` (a CPU implementation of the same
conversion — useful as a golden reference for a GPU/CPU parity test).

**What bay does today.** ffmpeg decodes to RGBA on the CPU (`-pix_fmt rgba`,
`/Users/himanshu/codes/synthai/vii/rust/crates/bay-preview/src/lib.rs:687-688`) and frames are
uploaded with `upload_rgba_texture` (`bay-gpu/src/context.rs:711-747`). There is no `nv12`,
`p010`, `bt709` or `ColorSpace` symbol anywhere under `rust/crates`; every shader is RGBA-only.
The cost is a full-frame RGBA copy over a pipe for every frame of every clip.

**Concrete first step.** Do not start this until items 1-3 land; it is the largest item here
and it only pays off once decode is windowed. When it starts: add an NV12 sampling path in
`bay-compositor` and a two-plane YUV upload in `bay-gpu`, switch the ffmpeg pipe to
`-pix_fmt nv12`, and gate it behind a GPU/CPU parity test using bay's own CPU path as the
oracle. Fix what they got wrong while reading: their uniform matrix is transposed, their chroma
siting is off by half a sample (should be a `0.25 / uv_width` offset), they have no
full/limited-range flag, and they treat P010 as SDR BT.709 rather than BT.2020/PQ. **Ignore
`gstreamer_backend.rs` entirely** and note that their "zero-copy" is aspirational —
`decode_frame_zero_copy`'s default body is `Err("IOSurface zero-copy not yet implemented")`
(`crates/native-decoder/src/lib.rs:78-80`), so it is not evidence that the wgpu-29 blocker at
`docs/native/parity-status.md:80` has a solution.

### Next five, briefly

6. **Skip the redundant frame upload.** `bay-preview/src/lib.rs:899-909` clones the decoded
   frame and calls `upload_rgba_texture` on *every* `render()`, even when the frame index has
   not changed — a paused editor re-does ~0.5 MB memcpy + GPU upload per video element per
   repaint. The text and shape paths right above it are already content-keyed
   (`ensure_text_texture` lib.rs:401-427). Add `last_uploaded: HashMap<String, usize>`. Small,
   high value.
7. **`schemaVersion: u32` on `Project`** (default 1 on read), and refuse — with a named error —
   to load a project newer than this build. Today `read_project`
   (`bay-project/src/library.rs`) is a bare `serde_json::from_str` and most fields are
   `#[serde(default)]`, so a newer bay's project loads into an older bay with fields silently
   dropped and the next autosave writes the loss back. Cheap now, expensive after the first
   format change.
8. **Real ffmpeg errors.** `export_video` runs with `-loglevel error`, pipes only stdin, and
   ends `.map(|s| s.success()).unwrap_or(false)` (lib.rs:744-775) — so every caller invents
   "is ffmpeg installed?" (`bay-agent/src/slow.rs:120`, `bay-mcp/src/studio.rs:826`,
   `bay-ui/src/editor_view.rs:988`) which bay can *prove* is wrong, since `bay_paths::tools`
   already resolved it. Pipe stderr, keep the last 2 KB, return `Result<(), String>`.
9. **Move `MotionPreset` out of `bay-ui`.** It is declared at
   `bay-ui/src/editor_view.rs:57` and held on the view (editor_view.rs:201) even though
   `Command::ApplyMotionPreset` is a first-class engine command
   (`bay-core/src/command.rs:128`) that `bay-agent/src/plan.rs:534` already emits. Presets die
   on quit and are invisible to MCP — a direct violation of bay's own "if the MCP server can't
   reach it, it's in the wrong crate". Their transferable detail: a deterministic id derived
   from the preset file path (`uuid_from_path`), so a preset keeps identity across machines
   with no registry. Same applies to `ensure_waveforms` (editor_view.rs:565-586), which does
   blocking `bay_audio::waveform_peaks` on the render tick into an unbounded `HashMap` — that
   also breaks "cache budgets are global, not per clip".
10. **The LLM provider seam, mock half only.** Their `ScreenplayLlmProvider` /
    `ScreenplayLlmSession` trait pair plus a fully offline `Mock` provider
    (`crates/.../screenplay/mock.rs`, ~224 lines) is the right shape for the assistant in
    `todo.pending.md` item 7 — an eval set needs a deterministic backend to test tool-call
    plumbing without a 4B model in CI. **Keep the enum closed: `Local | Mock`. No
    `Custom(String)`** — if a URL-shaped variant exists, someone will fill it with an API key.

---

## 4. Things we should deliberately not do

Hard stops, in descending danger:

- **The relay + Modal cloud path.** `relay/` is a FastAPI WebSocket fan-out broker between the
  user's Mac and a Modal job runner. That is "ship your life to a datacenter and rent it back",
  stated literally. Do not port it in any form, and do not port a "just for big renders"
  version of it.
- **Any third-party model API on user content.** They ship OpenAI, Gemini and Twelve Labs
  Pegasus clients; Pegasus uploads the user's actual footage to `api.twelvelabs.io`. bay's
  planned vision work (`todo.pending.md`, SigLIP + local Gemma 3 as ffmpeg-fed sidecars) is the
  correct shape. The **only** transferable thing here is their testing pattern: split
  `build_payload` from the network call so request construction is unit-testable offline
  (`footage_analysis.rs:255-315`) — which is what bay already does with `BAY_PROVISION_LIVE`.
- **The embedded WebView.** `comfywebview` is a wry/tao sidecar window, plus a feature-gated
  in-process WKWebView parented into the egui NSWindow. "Native or nothing. No Electron, no web
  view pretending to be an app." Refuse this even when proposed as a shortcut for a settings
  pane, a docs viewer, or an assistant chat panel.
- **The plugin host and marketplace.** Manifest-driven directory plugins with Wasm/Python/native
  runtimes, a `SecurityPolicy` that is stored and never read, signature validation that is a
  TODO returning `Ok`, and a Wasm executor that returns `success: true` from a stub
  (`crates/plugin-host/src/lib.rs:392-410`). A plugin host is a platform — it contradicts "one
  app, one job", and in-process third-party code makes any network call it likes, which no
  settings paragraph fixes. bay already has the better extension point: MCP, out-of-process,
  over a versioned tool contract. If someone asks for plugins, the answer is "write an MCP
  client". (Their unchecked zip extraction is also a live Zip Slip; bay's `archive.rs`
  `resolve_inside` already rejects it correctly.)
- **The ComfyUI installer.** `git clone` of GitHub HEAD, create a venv, `pip install` torch from
  `download.pytorch.org`, spawn `python main.py`. Unpinned remote code execution at install
  time — the exact inverse of `bay-provision`'s immutable URL + SHA-256 + redistributable
  licence, all three test-enforced (`manifest.rs:413-476`). Also breaks "never run a toolchain
  build that was not tested".
- **GStreamer.** A large non-Rust runtime with a plugin graph; its useful decoders live in
  `gst-plugins-bad/ugly` with a licensing matrix bay deliberately did not take on
  (`phase-0.md:63-64` froze on LGPL FFmpeg with GPL encoders off); and it would have to become
  a SHA-256-pinned provisioning artifact or break the zero-install promise. Take only the
  diagnostic idea: report *which* accelerator ffmpeg selected, in the capability report pattern
  `bay-compositor/tests/capability.rs` already establishes, so "hardware decode works" stops
  being a doc sentence (`docs/native/desktop-architecture.md:111`) and becomes an observable
  fact.
- **SQLite for the timeline.** One JSON blob inside a database, autosaved on every command with
  `let _ = save_project_timeline_impl(app)` swallowing the error, plus a migration file SQLite
  silently never runs and a committed `app.db` in the tree. bay's file-per-project library
  (`bay-project/src/library.rs`: `.json.tmp` + atomic rename, slugified ids, listing that skips
  an unparseable file, errors that name the path) is greppable, diffable, hand-editable and
  backup-able. That is what local-first means at the storage layer.
- **A `metadata: serde_json::Value` escape hatch on model types.** It is how their media-fps bug
  came to exist, and it would silently break bay's serde round-trip pinning.
- **Stub anything that reports success.** Their CLI `export` prints "Export completed (demo
  mode)" and exits 0; `convert` ignores its input and emits an empty 1920×1080 sequence;
  `FcpXml::from_xml` never reads the file and returns a hardcoded empty 1080p30 project
  (`crates/exporters/src/fcpxml.rs:469`); `import_fcp7xml` discards the file contents. If bay
  ever adds `bay --render project.json out.mp4`, it writes the file or exits non-zero.
- **Fake progress.** Their `proxy_queue.rs:505` polls the output file size against an estimated
  bitrate. bay owns the frame loop; use the real number.
- **FCPXML/EDL as a parity move.** Export-only, one direction, golden-file tested, and only if a
  real user asks. Never a stub import that silently succeeds with wrong data.

---

## 5. Where bay is already ahead

- **Engine/UI split is real, not aspirational.** 17 first-party crates, `bay-ui` at 6,178 LOC
  against ~19,000 LOC of engine, and the same engine drives GPUI, `bay-mcp` and the wasm build.
  Their counterfactual is commit `aa9bc11`, "WIP: partial split of main.rs (stalled)". Their
  headless CLI cannot reach the cloud, comfy, screenplay or export logic at all; `bay --mcp`
  reaches the whole engine. **This is bay's single strongest differentiator and belongs in
  MARKETING.md.**
- **Render-then-encode.** bay exports every frame through the *same* `render()` the preview
  uses, so what you see is what you get; their `-filter_complex` concat means effects,
  transforms, masks and blends cannot survive export. `await_decodes` (lib.rs:631) is an
  explicit barrier they have no concept of.
- **Time model.** `MediaTime(i64)` at 120,000 ticks/s with `FrameRate { num, den }` and
  `ticks_per_frame()` returning `None` for rates that do not divide evenly (23.976 → 5005,
  29.97 → 4004, pinned by test). They use plain `i64` frames and needed two duplicated
  `clip_media_fps` resolvers in the UI to answer a question bay's types never ask. Their
  timecode maths (`frames % fps.num`) is wrong for every non-integer rate and prints a
  drop-frame `;` while dropping nothing.
- **Blend correctness.** bay's `blend.wgsl` implements 16 modes including the non-separable
  Hue/Saturation/Color/Luminosity, with proper Porter-Duff source-over and `blend: None` on the
  pipeline. Theirs has 5 modes with 7 silently falling through to Normal, inverted `select()`
  branches in overlay and soft-light, `max(base.a, alpha)` compositing, and
  `BlendState::ALPHA_BLENDING` double-blending on top of in-shader blending.
- **Undo.** Serde-tagged `Command` that *lowers* against current state into `Vec<ProjectPatch>`,
  each patch returning its own inverse, with selection carried in the history entry. 26 tests.
  Theirs has zero tests and drops selection.
- **Decode hygiene.** One ffmpeg process per *clip* (they spawn two per *frame* in their
  fallback and upconvert every 8-bit source to P010); frame 0 cannot be eaten (theirs is
  consumed by a mislabelled "peek" probe); cache keyed by media id (theirs is keyed on nothing,
  so a second path decodes the first file's frames); exact frame indexing with a global LRU byte
  budget (theirs is a 10-entry Vec with a 0.1 s match tolerance, per decoder, cloning whole
  planes on every hit); NaN/±inf transform sanitising and 1×1 canvas tests they have nothing
  like.
- **Provisioning and archive safety.** Streaming SHA-256, content-addressed cache, `.part`
  staging, hard error on mismatch, and `resolve_inside` walking `Path::components()` with depth
  tracking — tested against hand-rolled malicious tar and zip. Theirs is unchecked extraction.
- **Correctness by construction where they hand-rolled.** No YUV plane strides to get half-width
  wrong; no CoreFoundation retain/release to double; no frame ring to overwrite; no
  `step_by(0)` panic (`waveform_peaks` guards every divisor, `bay-audio/src/lib.rs:111-158` —
  theirs kills a 2-worker pool permanently); no image-as-40 ms-video misclassification (called
  out by name at `editor_view.rs:840`).
- **Honesty as structure.** `todo.completed.md` / `todo.pending.md` / `todo.testing.md`,
  `parity-status.md` recording what verifies each fix, `STRICT=1 ./test.sh` turning skips into
  failures, clippy `-D warnings`, 363 `#[test]` sites vs their 28, 10 `unsafe` vs their 129.
  Their README claims a privacy property their code does not have — which is the manifesto's
  "privacy is a property of the software, not a paragraph in the settings", inverted.

**bay's own gaps, stated plainly:** no push/PR CI (only a manual-dispatch
`.github/workflows/windows.yml`, a documented cost decision that becomes a real gap with an
outside contributor); benchmarks never run and 6 of 10 planned ones missing
(`parity-status.md:64-65`); `bay-speech`'s sidecar inherits the parent environment
(`engine.rs:325` uses `.envs()` with no `env_clear()`) and `HF_HUB_OFFLINE=1` is not set yet, so
"no surprise network calls" is *nearly* true rather than true — back the claim with a test.

---

## 6. Every finding

Value/effort are as assessed per item. `bay-does-it-worse` and `bay-lacks-it` rows are where the
work is.

| Area | Finding | bay status | Value | Effort |
|---|---|---|---|---|
| Overview | Licence self-contradictory (Apache LICENSE vs MPL+commercial README) | not-applicable | medium | small |
| Overview | Fat desktop process + comfywebview / Python relay / CLI satellites | already-does-this | medium | small |
| Overview | No engine/UI split — 6816-line `app.rs` | already-does-this | medium | small |
| Overview | VideoToolbox + IOSurface + GStreamer decode, NV12/P010 WGSL | **does-it-worse** | **high** | large |
| Overview | Cloud surface: Modal, relay WS, OpenAI/Gemini/TwelveLabs, ComfyUI, pip torch | lacks-it (deliberate) | low | small |
| Overview | Maturity: 24 commits, 28 tests, no CI, 129 `unsafe` | already-does-this | low | small |
| Overview | NLE interchange exporters (FCPXML 1.9/1.10, FCP7, EDL, JSON) | lacks-it | medium | medium |
| Overview | SQLite project store with migrations + settings blob | already-does-this | low | small |
| Overview | Background job queue for derived media (waveform/thumb/proxy/index) | **does-it-worse** | **high** | medium |
| Timeline | Two parallel timeline representations synced by the UI | already-does-this | low | small |
| Timeline | Time as plain `i64` frames; rational Fps only as f64 seconds | already-does-this | medium | small |
| Timeline | media_range vs timeline_range; media fps via untyped metadata JSON | already-does-this | low | small |
| Timeline | Node/edge/track/automation graph with UUID newtypes + metadata hatch | lacks-it | low | medium |
| Timeline | Undo/redo as inverse-command stack (bay: unbounded, no `Batch`, no property test) | **does-it-worse** | **high** | medium |
| Timeline | Lossy heuristic migration; format version never branched on (bay has no version at all) | **lacks-it** | **high** | small |
| Timeline | Whole sequence into one SQLite JSON blob, autosave failure swallowed | already-does-this | medium | small |
| Timeline | SQLite catalog of assets / proxies / jobs / transcripts / caches | lacks-it | medium | large |
| Timeline | Dead normalized schema — but encodes rational speed + reverse | lacks-it | medium | large |
| Timeline | Interchange crate (FCPXML/xmeml/EDL), unsound timecode maths | lacks-it | low | large |
| Timeline | Zero tests in either crate (bay: no golden-fixture pin, no undo-identity test) | **already-does-this** | **high** | small |
| Renderer | Backend/pipeline inventory; no render graph | already-does-this | low | small |
| Renderer | Preview readback: row-pitch align, cached staging buffer, pump callback | **does-it-worse** | **high** | medium |
| Renderer | `validate()` gate + two-tier permanent/transient degrade policy | **does-it-worse** | **high** | medium |
| Renderer | Colour management: BT.709 matrices, transfer fns, linear-light, HDR/P010 | not-applicable | low | large |
| Renderer | BUG: inverted `select()` in overlay/soft-light; non-Porter-Duff composite | already-does-this | medium | small |
| Renderer | BUG: row-major Rust uniform read column-major by WGSL; struct size mismatch | already-does-this | low | small |
| Renderer | BUG: readback ignores `COPY_BYTES_PER_ROW_ALIGNMENT` (width % 64 != 0) | already-does-this | low | small |
| Renderer | Effects/transitions data-model-only; IOSurface conditional-repack upload | lacks-it (transitions) | medium | large |
| Decode | Compile-time backend selection makes a whole path dead | not-applicable | low | small |
| Decode | NV12 chroma plane copied at half the correct width | not-applicable | low | small |
| Decode | "Zero-copy IOSurface" is a CPU lock + `write_texture`; real types are stubs | lacks-it | low | large |
| Decode | IOSurface retained twice per frame, never released | not-applicable | low | small |
| Decode | Seek rebuilds `AVAssetReader` with a hard 2 s timeRange, leaks the old one | lacks-it | **high** | large |
| Decode | First compressed sample of every file eaten by a "peek" probe | already-does-this | medium | small |
| Decode | Frame ring can overwrite an occupied slot, dropping a retained buffer | not-applicable | low | small |
| Decode | Worker-per-path + latest-frame slot + wall-clock playback — plus a 2nd UI-thread decoder | already-does-this | medium | medium |
| Decode | **Two-stage seek: KEY_UNIT approximate then ACCURATE refine, `accurate:false` tag** | **lacks-it** | **high** | medium |
| Decode | Frame cache: 10-entry Vec, 0.1 s tolerance, per-decoder, clones planes | already-does-this | medium | small |
| Decode | bay re-clones + re-uploads the frame every render even when index unchanged | **does-it-worse** | **high** | small |
| Decode | Interactive/scrub mode = tear down and rebuild the session at half res | lacks-it | **high** | medium |
| Decode | Decoder cached keyed on nothing — second path decodes the first file | already-does-this | low | small |
| Decode | ffmpeg fallback spawns 2 subprocesses **per frame**, upconverts 8-bit → P010 | already-does-this | medium | small |
| Decode | Probe misclassifies every image as video; waveform `step_by(0)` panic | already-does-this | low | small |
| Decode | GStreamer CoreVideo meta via hand-rolled `repr(C)` matched by `g_type_name` | not-applicable | low | small |
| Decode | Per-OS hw-decoder priority table + surfaced "which decoder am I using" | **does-it-worse** | medium | small |
| Decode | ObjC shim wiring: `cc` + `-fobjc-arc`, `@autoreleasepool`/`@try` at every entry | lacks-it | low | medium |
| Decode | Dead code, stubs, hardcoded home path, no test decodes a real file | already-does-this | medium | small |
| Export | Render-then-encode: GPU compositor feeds the encoder | **already-does-this** | **high** | small |
| Export | bay composites export frames from the 480 px preview cache | **does-it-worse** | **high** | large |
| Export | Audio mux honours per-clip trim, gain, mute | already-does-this | medium | small |
| Export | Export progress and cancellation | **lacks-it** | **high** | medium |
| Export | ffmpeg failure text discarded (`Ok(bool)`, `-loglevel error`, stderr inherited) | **does-it-worse** | **high** | small |
| Export | Hardware (VideoToolbox) encode + codec/quality choice | **lacks-it** | **high** | medium |
| Export | Export runs on the GPUI main thread from the UI | **does-it-worse** | **high** | medium |
| Export | Background job scheduler with ids, dedup, progress polling | **already-does-this** | **high** | medium |
| Export | Concurrency semaphore for background work | lacks-it | low | small |
| Export | Atomic tmp→rename finalize for generated artifacts | already-does-this | medium | small |
| Export | Waveform peak extraction (theirs panics on short audio) | already-does-this | low | small |
| Export | CLI surface (theirs has two hollow subcommands that exit 0) | already-does-this | low | small |
| Export | NLE interchange export (FCPXML/xmeml/EDL/OTIO) | lacks-it | low | large |
| Export | Media relinking / missing-file handling | lacks-it | medium | medium |
| Export | Proxy / optimized-media transcode pipeline | does-it-worse | medium | large |
| UI | eframe/egui on wgpu, preview borrows egui's device; clippy.toml bans blocking it | already-does-this | medium | small |
| UI | No UI/logic split; `include!("app.rs")`; lib exposes 4 of ~30 modules | already-does-this | low | small |
| UI | Orphan source files never `mod`-declared — 643 lines silently rot | lacks-it (no guard) | low | small |
| UI | Plugin host: manifest plugins, Wasm/Python/Native runtimes, JSON contract | lacks-it (decline) | low | large |
| UI | Sandboxing declared but never enforced; Wasm executor returns `success:true` | already-does-this | medium | small |
| UI | Marketplace: SHA-256-verified download, unchecked zip extraction (Zip Slip) | already-does-this | low | small |
| UI | ComfyUI lifecycle: `git clone` HEAD, venv, `pip install torch`, spawn python | already-does-this | low | small |
| UI | ComfyUI job path: POST /prompt, graph patching, WS progress, size-stable polling | not-applicable | low | large |
| UI | `comfywebview` wry/tao sidecar + in-process WKWebView in the egui NSWindow | not-applicable | low | medium |
| UI | Twelve Labs Pegasus footage analysis (clean, tested, and never called) | lacks-it | medium | medium |
| UI | Screenplay LLM: provider trait + session handle, OpenAI/Gemini/**Mock** | **lacks-it** | **high** | medium |
| UI | Prompt engineering from `include_str!`'d JSON format specs | lacks-it | medium | small |
| UI | Enumerate real graphs → describe catalog to LLM → validate choice back onto graph | already-does-this | medium | small |
| UI | Workflow presets: graph introspected into a typed form, path-derived stable ids | **does-it-worse** | **high** | medium |
| UI | Storyboard workspace; in-flight jobs persisted; partial success `(added, skipped[])` | lacks-it | medium | medium |
| UI | Modal cloud backend shipped in the UI while README claims "local only" | **already-does-this** | **high** | small |
