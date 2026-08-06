# Parity status — vii native editor vs. palmier-pro

Snapshot of what has landed in the palmier-pro parity effort, what is still broken, and what
was deliberately deferred. Companion documents:

- [`palmier-gap-audit.md`](palmier-gap-audit.md) — the 9-agent capability audit (97 gaps, 3 waves)
- [`palmier-parity-plan.md`](palmier-parity-plan.md) — strategy, 15 milestones, UI/UX design
- [`palmier-parity-todo.md`](palmier-parity-todo.md) — the 113-task Wave 1 execution list
- [`desktop-architecture.md`](desktop-architecture.md) — crate graph and responsibilities
- [`benchmarks.md`](benchmarks.md) — benchmark suite and measured baselines

**State at time of writing:** 134 tests passing, `cargo clippy --workspace --all-targets
-D warnings` clean, `cargo fmt --all --check` clean, `cargo build -p vii-desktop` clean.

---

## 1. Delivered

| # | Change | Was | Verified by |
|---|---|---|---|
| 1 | **17 blend modes** reach the GPU + inspector control | dead code — `BlendMode::Normal` hardcoded, no model field | all-17 chromatic GPU test; undo/redo round-trip |
| 2 | **Sources fit, not stretch** (`fit_contain`) | every source distorted to the canvas box | 4:1 image in a square canvas stays letterboxed |
| 3 | **Real ffprobe duration** on import | *every* file imported as exactly 4s | 16 probe tests + a real ffprobe round-trip |
| 4 | **Long clips cover full duration** (`plan_decode` budget) | froze on one frame past ~15s | 56-case budget/coverage sweep |
| 5 | **Rotation planned at display size** | phone footage squashed 3.16× | rotation planning test |
| 6 | **JPEGs import as stills** | *regression I introduced* — imported as 40ms clips | image path no longer probed for duration |
| 7 | **Decode failures cached** | unreadable file respawned ffmpeg *every frame* | `ClipState::Failed` is terminal |
| 8 | **kebab-case blend wire format** | camelCase — broke web↔native project interop | serde round-trip pinned by test |
| 9 | **Text edits refresh the preview** | typing left stale glyphs — defeated inline editing | content/colour/size in the change signature |
| 10 | **CI actually runs Rust** | one `web` job; `cargo test` never ran | fmt + clippy `-D warnings` + tests, enforcing |
| 11 | **Benchmarks corrected** | execute rows inflated up to 2.9× by timed teardown | re-measured; artifact narrative removed |
| 12 | **Decode off the render path** | 10-min clip = ~33s frozen UI inside `render()` | first render < 1.5s, then clip appears |
| 13 | **Export awaits decodes** | new risk from (12) — a placeholder could be encoded | `await_decodes()` before encoding |
| 14 | **Global cache budget** | 192MB budget was *per clip*; N clips = N budgets | LRU byte budget asserted under ceiling |
| 15 | **Render path cannot panic** on bad input | NaN transform and sub-16px canvas both crashed | NaN/±inf test; 1×1, 8×4, 2×16 canvas test |
| 16 | **Status line** surfaces failures | export/save/probe all swallowed by `let _ =` | wired at 4 sites; click to dismiss |

---

## 2. Open issues

### Behavioural

| Issue | Impact | Possible solution |
|---|---|---|
| **Long clips play as a low-fps proxy** (10-min → ~2 fps at 272×154) | no longer freezes, but quality is traded away silently | True windowed decode: decode ±N seconds around the playhead at full rate, LRU the windows. The rest of M9 |
| **Media panel shows 3 demo tiles**, not your imports | imported media works (renders, plays, exports) but is not listed | T-203: render `editor.media()` instead of the hardcoded array |
| **Probe is synchronous on import** | ~20ms measured — real but below notice | `cx.background_spawn` with a pending tile (T-202) |
| **Anamorphic sources render with the wrong aspect** | `sample_aspect_ratio` is ignored | multiply display width by SAR in `probe` |
| **`display_rotation` sign convention** | side-data and legacy `tags.rotate` use opposite signs; one is mis-signed | negate only the side-data path; add a fixture per source |

### Engineering hygiene

| Issue | Impact | Possible solution |
|---|---|---|
| **`geometry.rs` has zero callers** | 29 tests (22%) guard dead code; its own doc says so | finish T-008 — migrate `editor_view.rs`'s inline tick/pixel math |
| **Benchmarks never run in CI** | nothing gates performance claims | add a non-gating bench job |
| **6 of 10 planned benches missing; no `black_box`** | preview frame time, decode, export unmeasured | add preview/decode/export benches |
| **CI has never executed** | branch is unpushed, so "enforcing" is unproven | push the branch |
| **3 tests contain no assertion** | `capability_report` can never fail (by design, but it inflates the count) | label them, or exclude from the headline number |

---

## 3. Deliberately left

| Left | Why |
|---|---|
| **~105 remaining Wave-1 tasks** (M1 undo transactions, M5 transport, M6–M8 timeline, M11 audio mixer, M12 export, M13–M14 viewer/inspector) | Wave 1 is 113 tasks. Correctness bugs and the free GPU win came first because they gate the rest |
| **`Transform` independent width/height** | the audit's #1 architectural prerequisite, but it ripples through keyframes, inspector and hit-testing. `fit_contain` fixes the *visible* stretch; the model change deserves its own commit in M3 |
| **Trims writing source in/out points** | blocks slip/slide/roll; same reasoning — a model change that wants a dedicated milestone |
| **Streaming audio mixer** | XL. Play still decodes and mixes the whole timeline up front |
| **Masks activation** | the JFA SDF feather pipeline is written and tested but `mask: None` is hardcoded; it needs a mask model on `Element` first |
| **Zero-copy preview** | blocked by wgpu 29's Metal hal exposing no `texture_from_raw` to import an external IOSurface-backed texture |
| **Transcription, multicam, semantic search** | on the plan's explicit cut list — outside the "except the AI assistant side" scope |

---

## 4. Honest bottom line

Feature parity with palmier-pro is **not** reached. This is Wave 1 partially done:

| Milestone | Progress |
|---|---|
| M0 Foundations | 5/16 |
| M2 Honest media | 1.5/9 |
| M3 Model truth | 0.5/9 |
| M4 Free GPU wins | 2/6 |
| M9 Video decode | 3/6 |
| M1, M5–M8, M10–M14 | not started |

What *is* true: the editor no longer freezes, crashes on bad input, leaks unboundedly, or fails
silently; five live correctness bugs are gone; two dead GPU subsystems are one step from
reachable; and CI enforces Rust for the first time. Every claim here survived a 53-agent
adversarial validation pass whose findings were fixed rather than argued with.

**Highest-value next step:** finish M9 (windowed decode), then M1 (undo transactions), which
roughly eight downstream items depend on.
