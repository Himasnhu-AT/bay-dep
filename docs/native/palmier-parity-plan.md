# vii — parity plan (Premiere-class native editor on GPUI)

Plan of record derived from the 9-agent capability audit against `palmier-io/palmier-pro`.
This is the document we execute from.

- **What is broken and why** → [palmier-gap-audit.md](palmier-gap-audit.md) (290 lines, per-domain tables with file:line evidence)
- **How the stack fits together and what is architecturally blocked** → [desktop-architecture.md](desktop-architecture.md)
- **What we build, in what order, with what acceptance criteria** → this document

---

## 1. Purpose and how to use this doc

The audit told us what is missing. This document tells us what to build, in what order, and how we
know each piece is done. It is written to be executed literally.

**How to use it**

| If you are… | Read |
|---|---|
| Starting a milestone | §4, that milestone's section — goal, items, deps, acceptance criteria, demo, risk |
| Building any UI | §5.1 (where it lives), §5.2 (how it responds), §5.3 (what it looks like) — in that order |
| Writing tests for a feature | §6, then §7's checklist |
| Deciding whether something is in scope | §3.5 cut list, then §3.6 resolved contradictions |
| Wondering why the order is what it is | §3.1 |

**Rules that do not bend** (from [desktop-architecture.md](desktop-architecture.md), restated because
every milestone below assumes them):

1. The UI never mutates the project. It dispatches an undoable `Command`, or a non-undoable `select`.
2. Pure logic lives in a testable module (`view_model.rs`, `snap.rs`, `overwrite.rs`, …), never in a
   GPUI view. A view translates events in and renders state out; nothing else.
3. Media decode/encode is the ffmpeg CLI as a spawned sidecar. We do not link ffmpeg.
4. Every feature ships with tests. GPU/ffmpeg tests skip cleanly when the capability is absent —
   *and*, on the macOS CI runner, a skip becomes a failure (§6.1).
5. Zero-copy GPU→GPUI is architecturally blocked (GPUI 0.2.2 renders on blade-graphics, not wgpu).
   The CPU readback stays. Do not spend a day on it.

Sections §4 and §5 are the spine. §3.6 exists because the PM, UX and QA design passes disagreed in
about a dozen places, and shipping a plan with unresolved contradictions in it is how you get two
half-built implementations of the same thing.

---

## 2. Where we stand

Honestly: the engine is good and the layer above it is a demo. `vii-core` has reversible
`ProjectPatch` undo with 23 tests and no UI dependency; `view_model.rs` is a pure, unit-tested
presentation mapping; the wgpu stack has a **complete, GPU-tested 17-mode WGSL blend shader** and a
**jump-flood SDF mask-feather pipeline that palmier has no equivalent of** — both of which are
unreachable dead code because `vii-preview` hardcodes `BlendMode::Normal` (lib.rs:346) and
`mask: None` (lib.rs:348). Our `MediaTime` (i64 ticks at 120 000/s) plus rational `Fps` is a better
time model than palmier's `Int` frames, our patch-based undo is cleaner than their whole-timeline
snapshot swap, and `dep/apps/web` gives us a second mature implementation to port from that palmier does
not have — including a bezier/tangent keyframe model **strictly richer** than palmier's three modes.
The blocking problem is not missing features: it is that **the data model cannot describe a video
editor**. `Transform` has one uniform `scale`, so every non-16:9 source is stretched *right now*.
Trims never write source in/out points. `AudioElement` has no trim and no animations. `VideoElement`
has no volume, so a video clip's audio is silent in preview and export. `Element` has no blend mode
and no crop. On top of that, three runtime pipelines are prototypes that must be rewritten rather
than extended — audio (decode-everything-then-mix-everything on the GPUI thread), video decode
(whole-clip RAM cache capped at 320×180/450 frames, so any clip over ~15 s is simply wrong), and
export (blocking, silent, fixed path, force-downscaled to 1280 px). Fix the model and those three
pipelines and a surprising amount of parity becomes wiring rather than invention.

---

## 3. Strategy

### 3.1 Sequencing rationale

Dependency order first, then payoff per unit of effort, with one override: **correctness bugs
outrank features**, because every feature built on a broken model gets rebuilt.

**M0 is new and is not on the audit's roadmap.** The audit ranks features; it does not rank the
substrate features are made of. Four things are invisible on any feature list and gate roughly
everything: CI that actually runs `cargo test`, a theme token layer, a failure-reporting surface, and
the pure geometry functions every timeline and viewer interaction is a function of. Skipping M0 means
five later features each hand-roll a worse text field, a worse number control, a worse error path and
their own hardcoded hexes — every one of those a rewrite. M0 also lands the menu bar and the status
bar, which are immediately visible and immediately make the app stop reading like a prototype.

**M1–M3 are the spine.** M1 is almost invisible to users and is scheduled first anyway, for two
concrete reasons: (a) roughly eight later items assume batched named transactions and an
apply/revert/commit triad exist — M8's `MoveElements`, M13's live canvas drag, M14's keyframe retime
and M7's Esc-cancel are impossible or produce N undo entries without it; (b) every milestone from M2
to M14 changes the data model, and `Project` has no version field today, so the *first* model change
silently breaks deserialization of every saved project. Shipping schema version + atomic write +
surfaced load errors before the first migration is the difference between a migration and a data-loss
incident. That is why the safety half of "real project files" is pulled into M1 while the package
format, Save As/Open and recents are deferred — those are ergonomics, not correctness. M1 also ships
`ScrubbableNumber`, the triad's first consumer, which fixes M1's morale problem: it is the difference
between "you can now set opacity to 37 %" and "trust me, the undo stack is better now."

M2 then M3 fix the two most visible lies, in dependency order: you cannot compute natural size or
trim headroom until ffprobe gives you duration and dimensions, so probing precedes the Transform and
trim fixes. **M3 deliberately bundles three model changes into ONE schema bump** — Transform w/h,
source trim, and the aspect-correct preview buffer. Three migrations of the same file across three
milestones is worse than one, and all three are the same "the model cannot describe a video editor"
problem.

**M4 breaks the model streak on purpose.** Blend modes and the masks crate are two places where
finished, GPU-tested code is unreachable behind a single hardcoded line each. It is the highest
value-per-line work anywhere in the audit, it demos in thirty seconds, and after three milestones of
migrations the team needs to see the picture change. It has no hard dependency beyond M1's schema
version, so it can slide earlier if morale demands.

**M5–M8 are the timeline, strictly ordered by substrate.** The ruler and frame-quantized playhead
(M5) establish the time↔pixel mapping that scroll and zoom (M6) transform, which the snap engine (M7)
needs in order to return a pixel x for its indicator, which cross-track drag and the overwrite planner
(M8) consume. Multi-select lands in M7 rather than M8 because snapping's multi-probe is *defined* over
every selected clip's start and end; snapping built against single selection gets rewritten
immediately. Track headers join M6 because the headers must move outside the scrolled region anyway.

**M9–M12 are the three pipeline rewrites plus their consumer.** Video decode (M9) and audio (M10–M11)
are independent of each other and of the timeline; they are scheduled after the timeline only because
the timeline is what a user hits in the first minute. Audio splits deliberately: M10 makes the mix
*correct* (video audio audible, gain, fades, limiter) against the existing crude transport; M11 makes
it *real-time*. Doing both as one XL milestone means debugging model semantics inside a real-time
callback. Export (M12) is last of the four because it must render through M9's decode path and mux
from M11's mix graph — and sharing one mix graph is the only thing that stops preview and export
envelopes from diverging.

**M13 and M14 are last within the wave** because they are the largest UI surfaces and benefit from
every primitive built before them (the scroll model from M6, the pure-planner pattern from M7/M8, the
coordinate work from M3). Both are gated on M1's triad and M3's transform model — a corner-resize
handle is meaningless while width and height are the same number.

Wave 2 is absorbed by folding, not by extra milestones: project presets → M3, media manifest/relink and
multi-file import → M2, track headers → M6, drag affordances and context menus → M8, waveform quality
→ M11, canvas zoom/pan/guides → M13, inspector IA and multi-select → M14b. Blend modes come out of
Wave 2 entirely into M4.

### 3.2 Architectural prerequisites — the live correctness bugs

These are not gaps. They are places where the app is wrong today, with the evidence.

| # | Bug (live today) | Evidence | Fixed in |
|---|---|---|---|
| 1 | Every source whose aspect differs from the canvas is **stretched**; no letterboxing, no natural size | `element.rs:83-89` is `{x,y,scale,rotation,opacity}`; `vii-preview/src/lib.rs:334-344` emits `width: scale*canvas_w, height: scale*canvas_h` | M3 |
| 2 | A trim **slides the clip without changing which frames play**; audio has no trim at all, so split-audio replays source 0 twice | `command.rs:68-72` sets start+duration only; `AudioElement` (`element.rs:157-165`) has no trim fields; renderer reads `trim_start` at `lib.rs:311` | M3 |
| 3 | Importing a 3-minute file produces a **4-second clip** | `import_media` hardcodes `MediaTime::from_ticks(TICKS_PER_SECOND * 4)` at `editor_view.rs:564`; `MediaAsset` is `{id,name,path}` | M2 |
| 4 | Imported assets are **invisible** — the media panel is a hardcoded 3-tuple array and never reads `editor.media()` | `editor_view.rs:979-981` | M2 |
| 5 | Any clip **longer than ~15 s or wider than 320 px does not render correctly** | `decode_video_clip` (`lib.rs:379-423`) pre-decodes whole clip at 320×180/30fps, `VIDEO_MAX_FRAMES = 450`; each frame re-uploads a fresh texture (`lib.rs:320-329`) | M9 |
| 6 | A **1080p project always exports 720p**, and every exported MP4 is **silent** | caller force-scales to max 1280 px (`editor_view.rs:664-666`); `export_video` opens no audio input | M12 |
| 7 | A video clip's **own audio never plays and never exports** | `VideoElement` has no volume/muted; `start_audio` only iterates `scene.tracks.audio` | M10 |
| 8 | **Keyframing a property makes its inspector control silently inert** (reproducible in two clicks) | `transform_row` (`editor_view.rs:1361-1384`) always executes `Command::SetTransform`, which writes the base value; `sampled_transform` overlays the channel on top | M14a |
| 9 | **Load failure is silent** — `if let Ok(project) = …` with no else branch; the user clicks Load and nothing happens | `editor_view.rs:843-848` | M1 |
| 10 | A crash mid-save **destroys the project** (bare `std::fs::write`, no temp+rename), and `Project` has **no version field** so the first model change breaks every saved file | `editor_view.rs:838-841`; `project.rs:9-16` | M1 |
| 11 | Missing media becomes a **silent 8×8 coloured box**, and export bakes it in | `upload_solid_placeholder` (`lib.rs:176-186`) is the fallback at L293-296, L328, L331 | M2 |
| 12 | **Zoom is a trap** — the lane has no scroll container, so anything past the viewport is unreachable | `editor_view.rs:1992-1999` `.relative().flex_1().overflow_hidden()` | M6 |
| 13 | The playhead **cannot be clicked or dragged anywhere** (2px div redrawn per lane, no hit target, lane div has no mouse handler) | `editor_view.rs:2001-2010` | M5 |
| 14 | Play **stalls for seconds**, the mix is **frozen at Play time**, scrubbing is **silent**, and A/V drift is **unbounded** (playhead on wall-clock `Instant`, rodio on the device clock) | `editor_view.rs:204-300`, `vii-audio/src/lib.rs:14-38`, `advance_playback` at `editor_view.rs:754-775` | M11 |
| 15 | Setting opacity to **37 % is impossible** — every numeric control is a fixed ±0.1 stepper | `nudge_row` L1253-1303, `stepper_row` L1307-1357 | M1 (component) / M14a (sweep) |
| 16 | `cargo test` **never runs in CI** — `.github/workflows/ci.yml` has one `web` job | — | M0 |

Two more prerequisites are structural rather than buggy, and are **explicitly not in this round**: the
declarative effect registry (gating item for all colour work — the 8-float uniform, the single-input
bind group and the linear pass chain must all lift together), and colour management (16-bit
intermediates, linear-light grading). Both are the immediate next round; see §3.5.

### 3.3 Correction to the brief — what GPUI 0.2.2 actually gives us

The framing in our own notes undersells GPUI, and three of the corrections materially change effort.
These were verified against `~/.cargo/registry/src/index.crates.io-*/gpui-0.2.2`.

| Claim in our notes | Reality in GPUI 0.2.2 | Consequence |
|---|---|---|
| "No scroll container we have used yet" | `.overflow_scroll()` / `.overflow_x_scroll()` / `.overflow_y_scroll()` (div.rs:1049-1062), `ScrollHandle` with a **public** `set_offset` (div.rs:3211), `.track_scroll()` (div.rs:1077), plus virtualized `uniform_list` and `list` | M6 gets substantially cheaper. Use the built-in for the media panel and inspector; **own** the offset for the timeline (§5.2) |
| "No built-in text input" | True — but `EntityInputHandler` + `ElementInputHandler` + `Window::handle_input` is the real IME-correct path, and gpui ships a **746-line worked example** at `examples/input.rs` with caret, selection, drag-select and word motion | Build one `TextField` (~250 lines adapted) in M0. Do **not** hand-roll a digits-only key buffer; it has 7 consumers and breaks on IME |
| "No native menu bar work done yet" | True for our app; `cx.set_menus(vec![Menu{..}])` with `MenuItem::action/separator/os_submenu` exists (app.rs:1840, `examples/set_menus.rs`) | Menu bar lands in M0, driven by the same table as the keymap |
| (not mentioned) | Drag & drop is first-class: `.on_drag(payload, |p,pos,_,cx| cx.new(...))` **renders the ghost for us**, `.on_drop()`, `.drag_over::<T>()`, `.can_drop()`; Finder drops arrive as `ExternalPaths` | We pass typed Rust payloads. We do **not** need palmier's `palmier-asset://<id>` string contract |
| (not mentioned) | `canvas(prepaint, paint)` with `window.paint_quad` / `paint_path` / `paint_image`; `anchored()` + `deferred()` for popovers/sheets; `.tooltip()`; `.group()`/`.group_hover()`; `linear_gradient()`; `pattern_slash()`; `shadow_2xs..2xl`; 24 cursor styles; `FontFeatures` (tabular numerals); `svg()` renders as a **mask tinted by `text_color`**; `observe_window_appearance()`; multi-window `cx.open_window` | Ruler ticks, waveforms and filmstrips are `canvas()`, not divs. `svg()` **is** our icon system. Light/dark following the OS is real |

Genuinely missing, recorded as known gaps: **pinch-to-magnify** (only `ScrollWheelEvent` with
modifiers — palmier's `magnify()` has no equivalent), **any accessibility layer**, **letter-spacing**
in `TextStyle`, **cursor repositioning** (so a scrub drag cannot warp the pointer), and **any
component library at all** — every widget in §5 is ours to write.

### 3.4 Port-from-dep/apps/web policy

`dep/apps/web` is a real asset, but "port it" is a *logic* shortcut, not a *testing* shortcut. Two of the
named targets are thinner than the audit implies. Honest verdicts:

| Target | Location | Verdict |
|---|---|---|
| Bezier/tangent keyframe model | `dep/apps/web/src/animation/{types,bezier}.ts` | **Port, with tests.** `linear \| hold \| bezier` with `CurveHandle{dt,dv}`, TangentMode, extrapolation modes — strictly richer than palmier's three modes. Solver tests come across |
| Preview hit-test + element bounds | `dep/apps/web/src/preview/{hit-test,element-bounds}.ts` | **Port.** `pointInRotatedRect` is a ~20-line direct translation. **Invert the z-order rule** — our topmost is the *last* overlay element |
| Preview coordinate mapping | `dep/apps/web/src/preview/preview-coords.ts` | **Port.** `screenPixelsToLogicalThreshold` is the piece people forget: handle hit slop must be constant in *screen* px |
| Canvas snapping guides | `dep/apps/web/src/preview/preview-snap.ts` (539 lines) | **Port** |
| Audio mastering (dB scale, −1 dBFS limiter) | `dep/apps/web/src/media/audio-mastering.ts` | **Port.** `clampDb`, `dBToLinear`, `VOLUME_DB_MIN/MAX`, the limiter. Replaces the hard ±1 clamp at `vii-audio/src/lib.rs:90-93` |
| Audio scheduling model | `dep/apps/web/src/media/audio-manager.ts` | **Port the design** (chunks against the audio clock, 2 s lookahead), not the code — the runtime is cpal/rodio's `Source` trait |
| SRT/ASS subtitles | `dep/apps/web/src/subtitles/` | **Port when captions land** — not this round |
| Ripple range math | `dep/apps/web/src/ripple/{diff,shift,apply}.ts` (373 lines) | **Port the range math when ripple lands (next round).** It has **no tests**; palmier's real added value is the validate-then-refuse pass, which dep/apps/web lacks entirely |
| Snapping | `dep/apps/web/src/timeline/snapping` (93 lines) | **Do NOT port the algorithm.** `resolve.ts` is 29 lines of nearest-point search, `threshold.ts` is 15; no hysteresis, no multi-probe, no tests. **Take the `SnapPoint{time, kind, element_id, track_id}` shape and the source-registry idea; write the algorithm fresh in Rust** against palmier's documented behaviour (sticky 2.5× multiplier, per-target-kind thresholds, multi-probe). Budget the tests as new work |

### 3.5 Cut list — what we are explicitly not building

Everything here was considered and declined. Do not re-litigate without a user asking.

| Item | Wave/effort | Decision and reason |
|---|---|---|
| Transcription, speaker identity, transcript-driven editing | W3 XL | **Not building.** The one item the audit flags as adjacent to the excluded AI surface. All value downstream of a transcript works off an imported SRT — build those first if ever. Apple's SpeechAnalyzer is unreachable from Rust without an ObjC bridge; whisper.cpp means adopting an ML runtime for one feature |
| Semantic media search (visual embeddings) | W3 XL | **Not building.** Largest single item in the audit; a marketing surface, not table stakes. We take the free 10 % — plain case-insensitive name search, folded into M2 — and defer the embedding half indefinitely |
| Multicam | W3 XL | **Not building.** Requires ripple, overwrite, slip and audio sync to exist first, and its real value is the refusal guards rather than the switching |
| On-device ML audio (VAD, beat detection, denoise) | W3 XL | **Not building.** There is no ML runtime in the Rust workspace and we are not adopting one for three speculative features. If beat-snapping ever matters, a pure-Rust spectral-flux onset detector + tempo autocorrelation gets most of the value with zero new dependency. The two runtime-independent ideas — the wet-twin-plus-crossfade trick and a disk-persisted analysis cache — we already get from M11's waveform disk cache |
| FCPXML / XMEML interchange | W3 XL | **Not now.** ~1600 lines of format work in palmier, gated on per-clip fps and source timecode our Element model lacks. Revisit when a real user asks to round-trip into Premiere or Resolve. An mp4 that is correct and has sound (M12) is worth far more |
| Nested sequences + flattener | W3 L | **Not now.** Our Scene model already provides the multiple-named-timelines half. The expensive part is the flattener (trim remapping, fade truncation, keyframe rebasing, id namespacing, depth cap, multiplicative audio gain), and nobody abandons an editor in ten minutes over its absence |
| Source monitor / preview tabs | W3 L | **Not now — flagged honestly.** Source+program monitors are the core Premiere loop, so this is more central to the north star than its wave placement suggests. Deferred because it doubles preview state (second playhead, second decode session) exactly while we rewrite decode (M9) and audio (M11). Revisit immediately after both stabilise |
| Zero-copy GPU→GPUI preview | — | **Not building, ever, at GPUI 0.2.2.** Blocked: GPUI renders on blade-graphics. The leverage is render-size adaptivity (M3) and the scrub quality tier (M5), both scheduled |
| Full colour management (Rgba16Float, linear-light, export tags) | W2 L | **Not now, deliberately.** Banding only bites once curves/wheels/LUTs exist to compound it, and 16-bit intermediates before the effect registry means redoing the pass plumbing twice. It belongs immediately *after* the registry |
| Mask-shape drawing (bezier/roto) | — | **Not building.** M4 activates the masks crate for edge rounding and softness, which is where the written JFA pipeline pays off. A shape tool is an editor of its own, and palmier has none either — not a parity gap |
| Home launcher, first-run onboarding, what's-new, settings window with themes | W2/W3 | **Not now.** One window opening the last project is fine this round. **But the theme *token layer* is NOT cut** — see §3.6/#9: roles land in M0, `Theme::light()` ships as a stub returning dark, and the Appearance UI is what's deferred |
| Colour scopes as a parity claim | W3 M | **Not building** — and the justification matters: palmier ships **no** scopes UI. Their `ColorScopes` is a numeric struct whose main consumer is their AI tool executor, which is out of scope. Build a histogram/parade panel later because colourists need one, not to close a gap — and ship it with the curve editor, where it belongs |
| Media panel folders | W2 | **Not now.** Folders need a `MediaFolder` model routed through Command/ProjectPatch to be undoable, for a library with a handful of assets. M2 ships multi-file import and name filter and stops |
| Text animation presets, caption preset gallery | W3 | **Not now.** Both gated on a rich text style model this plan does not schedule; per-word presets need `WordTiming`, which only a transcript provides |
| Tool modes (V/C/T), slip/slide/roll, in/out ranges | W2 L | **Not this round** — but §5.2 carries the full design (spring-loaded modes, the trim family under one mode, the cursor limitation) so it can be built without re-deciding. **Hard-blocked on M3's source trim: until trims write `trim_start`/`trim_end`, slip is not unimplemented, it is unrepresentable** |
| Ripple edits + sync-lock | W2 L | **Not this round.** M6 stores `Track.sync_locked` anyway so ripple has its flag when it lands. M8 reserves the Cmd modifier for ripple-insert and ships overwrite-as-default |

**Not cut, just not this round — the honest boundary.** The declarative effect registry + richer
param/pass model, the basic colour-correction set, ripple edits with sync-lock, tool modes /
slip / slide / roll / in-out ranges, the real text style model with font and colour pickers, crop, the
stylize set with chroma key, and the project package + Save As/Open/recents left over from M1. These
are the Wave 2 backbone and the next round **in that order** — the effect registry first because it
unblocks the most, text last because it is expensive and depends on M0's `TextField` proving out.

### 3.6 Resolved contradictions

The PM, UX and QA passes disagreed. These are the calls, with reasons. Where a call overrides the
audit or an earlier design output, it says so.

| # | Conflict | Call | Why |
|---|---|---|---|
| 1 | Does GPUI have a scroll container? (brief: no / IA: yes, verified) | **Yes it does.** Use `overflow_y_scroll` + `uniform_list` for the media panel and inspector; **own `scroll_x`/`scroll_y` in view state for the timeline** | Cursor-anchored zoom, scroll-to-playhead and edge auto-scroll all need to *write* the offset in the frame they *read* it, across three synchronized regions. Fighting a scroller that mutates its own offset in prepaint is strictly more code. Where we gain nothing from ownership, take the built-in and get native inertia free. **M6 gets cheaper than the PM plan assumed** |
| 2 | Text input: digits-only key state machine (PM M14) vs a real `TextField` (IA) | **Build one real `TextField` in M0**, adapted from `gpui/examples/input.rs` | Seven consumers across M0–M14 (media search, project rename, clip rename, numeric type-in, text content, folder naming, `W:H` parser). The `EntityInputHandler` path is IME-correct; a key buffer never will be. It also deletes the `key_context("TextEdit")` hack that currently disables **every** shortcut while typing |
| 3 | Snapping: port from dep/apps/web (PM M7) vs write fresh (interaction + QA) | **Write the algorithm fresh in Rust.** Take dep/apps/web's `SnapPoint` shape and source-registry idea only | dep/apps/web's `resolve.ts` is 29 lines of nearest-point search with no hysteresis, no multi-probe and **no tests**. The audit slightly oversold it. The behaviours we actually want (sticky 2.5×, per-kind thresholds, multi-probe over every selected clip's start *and* end) come from palmier |
| 4 | Where does the keyframe lane live? (inspector, per palmier / timeline, per IA) | **Timeline**, as expandable sub-lanes under the clip's track. The inspector keeps only the per-row stamp + `‹ ›` nav | A keyframe lane needs a time axis. Putting one in a 320 px inspector means a *second* ruler, a second px↔ticks mapping, a second zoom and a second scroll offset — two sources of truth for "where is time" in an app whose whole job is time. It also inherits the snap engine free. **Consequence: M14b gains a dependency on M6** |
| 5 | GPUI drag API vs hand-rolled mouse drags | **Both, split by gesture.** GPUI `on_drag`/`on_drop`/`can_drop` for cross-surface drags (media tile → lane, Finder → window, track header reorder). Hand-rolled root `on_mouse_move`/`on_mouse_up` for in-timeline clip gestures | Cross-surface drags get free ghost rendering, free hit-testing across panels and free type checking. In-timeline gestures need Esc-cancel, a 4 px threshold, live plan preview and edge auto-scroll — GPUI's drag owns the pointer and offers no cancel hook. **Verify early**: a GPUI drag that must also auto-scroll needs a `request_animation_frame` pump alongside it |
| 6 | Failure surface: timeline gutter notices (interaction) vs status bar + toasts (IA) | **One `Notifications` model, two surfaces**: a 24 px status bar (persistent jobs, current hint) and a bottom-right toast stack (transient + sticky errors). Drop the gutter variant | A third surface fragments the code and the user's attention. Drag-time *refusals* still render inline (red edge on the offending lane + badge) because they are spatial; everything else is a toast or a status row. The status bar is also where export progress must live for "export while you keep editing" to be possible |
| 7 | Are link groups (`link_group` on Element) table stakes? (interaction: yes, build before cross-track drag) | **No, and deferred** — with a tripwire | Palmier splits A/V into two clips on import; **our model does not**. M10 gives `VideoElement` its own `volume`/`muted` and makes the mixer walk video tracks, so one element carries its own audio. Link groups only become necessary when we add "Detach Audio" — **and when we do, `link_group` must land before it, not after** |
| 8 | Tool modes (V/C/T) and slip/slide/roll | **Designed in §5.2, not scheduled in M0–M14** | The trim family is genuinely blocked on M3's source trim, and the PM's 14 milestones are already the honest boundary. The design is recorded so the next round does not re-decide it |
| 9 | Theme: "stays 28 hardcoded dark hexes" (PM cut list) vs "restructure now" (visual system) | **Split the item.** The **token layer** (semantic roles, `Theme` as a `Global`, `Hsla` not `u32`) lands in **M0**. `Theme::light()` ships as a stub returning dark. The Appearance settings pane is cut | Right now it is 10 constants and one 2000-line view — an afternoon. After M0–M14 it is the same constants scattered across a viewer with overlays, a five-tab inspector, a timeline with filmstrips and keyframe lanes, and a toast stack — a multi-day sweep. The three named M5/M14 items each invent ~10 new visual patterns; they are the deadline |
| 10 | Trim handle size: 7 px widened to 9 px (interaction) vs 4 px visual / `min(10, w*0.3)` hit (visual) | **4 px visual, `min(10.0, width*0.3)` hit** | The fixed size is both too small to grab reliably and too large — on a 20 px clip the current 7 px handles eat 14 of its 20 pixels. The formula guarantees the move-body always keeps ≥40 % of the clip and stays inside the lane's `overflow_hidden` |
| 11 | Ruler height 24 (interaction) vs 26 (IA + visual); two top bars (visual density) vs one 44 px command bar (IA) | **Ruler 26 px. One 44 px command bar** replacing today's 50 px toolbar + 40 px scene row | Reclaims 46 px of vertical — a whole track row on a 900 px window. Scene tabs move onto the timeline panel where they belong (scenes *are* timelines) |
| 12 | Marquee/playhead hit sizes and selection colour | Marquee **intersect** (not contain), with live highlight of would-be-selected clips. Playhead **13 px** grab strip. Selection = **2 px white @92 % inset outline** | White is the only value that reads over all six clip hues (19.6:1 on the lane, ≥9:1 on every body, measured); the current pale blue `#8fb0ff` is nearly invisible on an azure video clip. Inset so selection never changes clip width |
| 13 | Frame quantization: always (PM M5) vs on-commit only (interaction) | **Both, by gesture kind.** Playhead/seek/step quantize **always** (a playhead position is discrete). Clip move/trim drags quantize **on commit** | Quantizing a drag live makes it feel notchy at low zoom. Our 120 000-tick base divides evenly for 24/25/30/60 *and* 30000/1001 (exactly 4004 ticks/frame), so commit-time quantization is lossless |
| 14 | M14 size (four roadmap items, ~3 sittings) | **Split at the stated seam: M14a** (keyframe correctness + `ScrubbableNumber` sweep) / **M14b** (keyframe lane + easing + inspector IA + multi-select) | The PM pass named this seam itself. M14b is where the M6 dependency lands |

---

## 4. Milestones

Legend for dependencies: a milestone may start when every listed dependency is **merged**, not
merely started.

| ID | Name | Depends on | Shape |
|---|---|---|---|
| M0 | Foundations: CI, tokens, notifications, command table, geometry | — | S/M, invisible-but-visible |
| M1 | Undo transactions + a save that cannot lose your work | M0 | S |
| M2 | Honest media: real metadata, a real library, named offline files | M1 | M |
| M3 | Model truth: aspect-correct transforms, real source trims, project presets | M1, M2 | L (one schema bump) |
| M4 | Free GPU wins: 17 blend modes, soft edges, colour cards | M1, M2 | S |
| M5 | A transport you can actually drive | M0, M1, M3 | M |
| M6 | A timeline you can navigate, with real track headers | M5 | M |
| M7 | Multi-select and snapping | M1, M5, M6 | M |
| M8 | Clips stop overlapping: cross-track drag and overwrite | M7 | L |
| M9 | Video decode that survives a real clip | M3, M5 | L |
| M10 | Audio that is actually a mix | M1, M3 | M |
| M11 | Streaming audio mixer and real waveforms | M10 | XL |
| M12 | An export you can trust | M3, M9, M11 | L |
| M13 | A viewer you can edit in | M1, M3, M5 | L |
| M14a | An inspector that tells the truth (part 1) | M1, M3, M5 | M |
| M14b | Keyframe lane, easing, inspector IA | M6, M14a | L |

---

### M0 — Foundations: CI, tokens, notifications, command table, geometry

**Goal.** `cargo test` runs on every push; every colour in the app comes from a named role; every
failure has somewhere to go; every shortcut comes from one table that also builds the menu bar; and
the px↔time↔frame math exists once, pure and tested.

**Included**
- Rust CI job (§6.1) with capability gating.
- `theme/` module: `palette.rs`, `tokens.rs`, `clip.rs` (§5.3). `Theme::light()` is a stub returning dark.
- `Notifications` + status bar + toast stack (§5.1).
- `vii-ui/src/actions.rs`: `pub const ACTIONS: &[ActionDef]` producing `Vec<KeyBinding>`, the
  `cx.set_menus` menu tree, the shortcuts help grid, and every `.tooltip()`.
- `vii-ui/src/geometry.rs` (GPUI-free): `ticks_to_px`, `px_to_ticks`, `quantize_to_frame`,
  `frame_of`, `visible_window`, `tick_ladder`, `zoom_at`, `format_timecode`, `content_rect`.
- `ui/` primitive layer: `TextField` (adapted from `gpui/examples/input.rs`), `button`, `icon_button`,
  `row`, `panel_header`, `badge`, `tooltip`, `segmented`, `toggle`, and the `deferred()` overlay layer
  (toasts, sheets, popovers, context menus).
- Mechanical migration of `editor_view.rs` onto tokens and `ui/` primitives.

**Acceptance criteria**
- `.github/workflows/ci.yml` gains `rust-mac` (with `VII_REQUIRE_GPU=1`, `VII_REQUIRE_FFMPEG=1`) and
  `rust-linux` jobs running `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`
  and `cargo test --workspace`. A deliberately-broken `GpuContext::new()` fails `rust-mac` instead of
  silently skipping 9 tests.
- `Theme` implements `gpui::Global`; `cx.theme()` works from every render fn via an `ActiveTheme`
  extension trait on `App`. `element_color(kind_label: &str)` is gone, replaced by
  `ClipPalette::for_kind(ClipKind)`. `hex_to_rgb`'s silent grey fallback returns `Result`.
- A `no_raw_color_literals` test asserts zero occurrences of `rgb(0x`, `rgba(0x` or `hsla(` outside
  `theme/` and `ui/`, and zero use of the forbidden spacing steps.
- A `contrast()` test asserts ~40 declared (fg, bg, min_ratio) triples for both appearances.
- One `TextField` entity: caret, selection, mouse drag-select, double-click word select,
  Cmd+A/C/V/X, home/end, option-arrow word motion, placeholder, `on_change`/`on_commit`/`on_cancel`.
  It is used by the media search box on day one. `key_context("TextEdit")` at `editor_view.rs:71-72`
  is deleted; the root is always `key_context("Editor")` and every text surface declares
  `key_context("TextEntry")`.
- `cx.set_menus` renders vii / File / Edit / Clip / Sequence / View / Window / Help. A test asserts no
  duplicate chord within a `key_context`, that every `ActionDef` has a label and group, and that the
  table serializes to `dep/fixtures/golden/native/keybindings/default.json` (mirror of the existing web-side golden).
- Every fallible or long-running op has a `notify()` path. Toasts: max 3 visible, info auto-dismiss at
  6 s, errors sticky with an action button. Status bar shows one row per background job with a
  working cancel.
- `geometry.rs` imports zero GPUI and has its own `#[cfg(test)] mod tests` — no window, no GPU, no skip guard.

**Demo.** Open the app: there is a real macOS menu bar, and File > Save shows ⌘S. Hover any toolbar
button: a tooltip names it and its shortcut. Type in the media search box: a caret blinks, you can
select with the mouse and paste with ⌘V, and pressing `v` inserts a `v` instead of doing something to
the timeline. Press Help > Keyboard Shortcuts: the grid is generated from the same table that bound
the keys.

**Risk.** Roughly two weeks with little feature-shaped output, which is politically hard. Mitigate by
landing the **menu bar and the status bar first** — both are instantly visible — and by shipping
`TextField` behind the media search box so it has a demoable consumer on day one. Second risk: the
token migration is a large mechanical diff that will conflict with any in-flight UI branch; land it as
its own commit at the wave boundary, never interleaved.

---

### M1 — Undo transactions + a save that cannot lose your work

**Goal.** A user can make a multi-clip edit and undo it in one step, cannot lose a project to a
mid-save crash or a silently-failed load, and can finally type an exact number into the inspector.

**Included**
- Batched named undo transactions + the apply/revert/commit primitive.
- Real project files — safety half only (schema version, atomic write, surfaced errors). Package
  format, Save As/Open, recents deferred (§3.5).
- `ScrubbableNumber` component + its first consumer (opacity). *(Added to the PM plan — see §3.1.)*

**Depends on.** M0.

**Acceptance criteria**
- `Editor::transaction(name, |tx| …)` collects N `ProjectPatch`es into exactly **one** history entry.
  Test: a 3-element move yields `history.len() == 1` and one undo restores all three positions.
- History entries carry a human-readable label; the undo affordance reads "Undo Move 3 clips", not a
  `CommandKind`.
- `apply()` / `revert()` / `commit()` exist: `apply` mutates without recording; `revert` restores the
  exact pre-apply state (round-trip equality on a fixture project); `commit` records one labelled
  entry. Test: 100 transient applies produce **0** history entries.
- Transient applies route **through** the existing EventBus begin/mark/commit coalescing — one
  Document event per apply, never one per patch.
- `Project` gains `schema_version`. Loading a newer version fails with a typed `LoadError`, not a
  partial parse. A legacy file with no version field still loads. Fixture test for both.
- Save writes `<path>.tmp` then renames. A test that forces the rename to fail leaves the original
  byte-identical.
- Load failure renders an error card naming the path and the parse error.
  `grep -n 'if let Ok(project) = serde_json::from_str' editor_view.rs` returns nothing.
- `ScrubbableNumber` exists as a `ui/` component: drag-to-scrub with `cursor_ew_resize`, shift = 10×,
  cmd = 0.1×, click-to-type (swapping in `TextField`), unit-suffix stripping, range clamping. Live
  drag calls `apply()`, release calls `commit(name)` — one undo entry per gesture. The Opacity row
  uses it; setting opacity to exactly 37 % is possible.

**Demo.** Select three clips, press Delete, press ⌘Z once — all three come back together, and the Edit
menu says "Undo Delete 3 clips". Drag on the Opacity field: it scrubs continuously and produces one
undo entry, not sixty. Click it, type 37, Enter. Then hand-edit `~/vii-project.json` into invalid JSON
and press Load: an error card names the file and the parse error instead of the button doing nothing.

**Risk.** The triad must not emit a Document event per transient frame or every mouse-move re-renders
the preview. Wire it **into** the EventBus coalescing, not around it. Second: `ScrubbableNumber`'s drag
cannot warp the pointer (GPUI has no cursor-repositioning API), so accumulate delta in screen space,
ignore absolute position, and restore the cursor visually at mouse-up — verify the feel early, this is
the one control where a bad implementation is immediately obvious. Third: resist skipping this
milestone for its lack of surface — eight later milestones assume both halves exist.

---

### M2 — Honest media: real metadata, a real library, named offline files

**Goal.** Importing real footage produces a clip of the right length, imported assets stay visible and
re-addable, and a moved file is named on screen instead of becoming a coloured box.

**Included.** Media probing + real media library · missing-media visibility · media manifest with
relative paths and relink · multi-file import + name search (the two cheap slices of the media panel).

**Depends on.** M1.

**Acceptance criteria**
- `MediaAsset` carries `duration`, `width`, `height`, `fps` (rational), `has_audio` and `rotation`,
  probed by **one** ffprobe call. Probing runs off the GPUI thread; the tile shows a pending state
  until it returns. Rotation is recorded even though it is out of scope to *apply* — dropping it
  silently would make M3's natural-size work wrong for phone footage.
- `parse_ffprobe_json(&str) -> MediaMetadata` is pure, tested against committed fixtures under
  `dep/fixtures/golden/native/ffprobe/` covering: mp4 with audio, mp4 without audio, mov with a rotation
  matrix, VFR, mp3, png, and a corrupt/empty file. Each fixture records the producing ffmpeg version.
- Adding a 3-minute file creates a 3-minute element with `trim_end == source duration`. The
  `MediaTime::from_ticks(TICKS_PER_SECOND * 4)` hardcode at `editor_view.rs:564` is gone.
- `media_panel()` renders `editor.media()`; the hardcoded array at `editor_view.rs:979-981` is gone. A
  `view_model` unit test covers the media-list projection (name, duration string, kind, offline flag).
  `fn columns(dock_w: f32) -> usize` is pure and tested, and drives grid layout, arrow-key navigation
  and marquee hit-testing.
- `MediaSource` is `External(absolute) | Project(relative)`. Media resolution does an existence check
  and returns a typed `MissingMedia` error instead of a plain id lookup.
- `PreviewRenderer::render` returns the set of unresolved media ids alongside `PreviewFrame`; the
  viewer draws a "Media offline — `<expected path>`" card. `upload_solid_placeholder` is no longer
  reachable for a missing file.
- A Relink… action re-points one asset and offers to relink other missing assets found in the same folder.
- `rfd::pick_files()` imports N files from one dialog; a case-insensitive name filter box filters the panel.
- Every ffprobe/ffmpeg-dependent test skips cleanly when the binary is absent, and **fails** on the
  macOS runner where `VII_REQUIRE_FFMPEG=1`.

**Demo.** Import a 3-minute mp4 and a square PNG in one dialog: both appear as tiles with real duration
and dimensions. Click the mp4 — a 3-minute clip lands on the timeline. Quit, move the mp4 to the
Desktop, reopen: the tile is marked offline, the viewer says "Media offline — /old/path.mp4", and
Relink… restores it.

**Risk.** ffprobe output varies by container (fps as a rational string, rotation metadata, missing
streams). Parse into a typed struct with fixture tests and tolerate absent optional fields
*explicitly*, with a test per "field absent" case — do not let serde defaults paper over it. Second:
thumbnail generation for a large import saturates the ffmpeg sidecar; gate it behind a bounded
concurrency semaphore from day one.

---

### M3 — Model truth: aspect-correct transforms, real source trims, project presets

**Goal.** Every source renders at its true aspect, a trim actually changes which frames play, and the
project canvas can be set to a real preset.

**Included.** Transform independent w/h + natural size · source trim (video **and** audio) ·
aspect-driven preview render size · project settings presets and `W:H` parser.
**One schema bump covers all of it.**

**Depends on.** M1, M2.

**Acceptance criteria**
- `Transform { x, y, width, height, rotation, opacity }`, normalized to the canvas. No
  `scale * canvas_w` remains in `vii-preview` (lib.rs:334-344).
- ONE migration handles both changes: legacy `scale` → w/h derived from natural size, **and** the
  legacy animation channel key `"scale"` → `"width"` + `"height"`. A fixture test loads a
  pre-migration project and asserts the layer rect is unchanged for a 16:9 source and corrected for a
  non-16:9 one, and that a keyframed `scale` channel samples to the same rendered geometry at three
  playhead positions.
- `element_bounds(element, canvas, natural_size)` is pure and unit-tested in `view_model.rs`,
  including the rotated case. `fit_contain(natural, canvas)` lives in `vii-project/src/transform.rs`.
- `ProjectPatch::SetElementTrim` exists; `Command::TrimElement` lowers to start + duration + trim. A
  left-edge trim of 2 s advances `trim_start` by exactly 2 s.
- `AudioElement` gains `trim_start`/`trim_end`; `SplitElement` writes both halves' trims. Test:
  split-then-concat reproduces the original source span for **both** video and audio.
- Trims clamp to the media headroom from `MediaAsset.duration` (M2). Text and generated elements take
  an explicit **no-source branch** and trim freely — not a zero-headroom default.
- `TrimElement` rebases animation channels so keys keep their source-relative position (test: left
  trim with two keys).
- An `AspectPreset` list (16:9, 9:16, 1:1, 4:3, 2.4:1) plus a validated `W:H` parser lives in
  `vii-project/src/aspect.rs` as pure logic: even dimensions, 2..8192 clamp, gcd-reduced label,
  typed errors, unit tests. A reversible `SetProjectSettings` command applies it.
- The preview render target derives from `settings.canvas` aspect; `PREVIEW_RENDER_W/H`
  (`editor_view.rs:20-21`) are gone. Render size quantizes **up** to the next multiple of 64 and caps
  at the project canvas size, so a resize drag does not recreate wgpu textures every frame.
- **`vii-preview/src/scene_to_frame.rs` is extracted** (Scene + playhead → `FrameDescriptor`, no
  GPU, no decode) as its own commit, with the existing 7 `tests/render.rs` tests green before and
  after. Descriptor goldens (§6.3, Tier C) begin here.

**Demo.** In a 16:9 project drop a 9:16 phone clip and a square PNG — both letterbox/pillarbox at true
aspect instead of stretching. Drag a video clip's left edge 2 s right: the first visible frame is 2 s
further into the source. Split an audio clip: the halves play consecutive audio, not the same audio
twice. Switch the project to 9:16: the viewer becomes tall and the clips reflow.

**Risk.** This is the first real schema migration and it changes how every existing project looks. It
must be a versioned, fixture-tested migration, not a serde default. Bundling trim into the same bump is
deliberate — one migration instead of two — which makes this closer to two sittings than one. Do not
also try to add slip/slide here. The `scene_to_frame` extraction is the one piece with real refactor
risk (it currently interleaves descriptor building with texture upload and decode); sequence it first
and alone.

---

### M4 — Free GPU wins: 17 blend modes, soft edges, colour cards

**Goal.** Users get 17 blend modes and per-clip edge rounding/feathering — GPU code that is already
written, tested and merely unreachable.

**Included.** Blend modes · masks-crate activation (edge-shape slice only) · solid-colour matte/colour-card clips.

**Depends on.** M1, M2. *(Can slide earlier than M3 if morale demands — it has no dependency on the
Transform change.)*

**Acceptance criteria**
- `Element` gains `blend_mode` covering all 17 `compositor::BlendMode` variants, plus
  `Command::SetBlendMode`. `vii-preview` passes it through; the hardcoded `BlendMode::Normal` at
  `lib.rs:346` is gone.
- For non-Normal modes, opacity fades the **blend result** against the backdrop rather than being
  baked into layer alpha (palmier's `FrameRenderer` semantics). A GPU test asserts Multiply at 50 %
  opacity equals a 50 % mix of backdrop and multiplied result; Normal keeps today's behaviour. Ship
  this **with** blend modes so we never ship the subtly-wrong version first.
- `Element` gains `edge_rounding` and `edge_softness` (0..1). When either is non-zero,
  `vii-preview` emits a `LayerMaskDescriptor` and the JFA feather path in `masks/` actually runs;
  the `mask: None` at `lib.rs:348` becomes conditional. A GPU test asserts a softened edge produces a
  monotone alpha ramp.
- A colour-card element can be created with a hex colour and an aspect preset, and participates in
  blending like any other layer. *(Naming correction from the audit: palmier's `Matte.swift` is a
  colour generator, not a track matte.)*
- Inspector gains a blend-mode dropdown and two edge sliders, all undoable.
- All GPU tests skip when no wgpu adapter is available; **the four current effects' pixel goldens are
  captured in this milestone** (§6.3) so the future registry refactor has a before-picture.

**Demo.** Stack a clip on the overlay track over a background clip and pick Screen from the dropdown —
it composites. Drop opacity to 50 %: it fades against the backdrop instead of going flat. Slide Edge
softness up: the top clip's border feathers via the SDF path. Add a colour card, set it dark blue,
blend it Multiply.

**Risk.** One JFA feather pass per softened layer per frame. Gate the whole mask path behind a
non-zero-softness check so the common path is untouched, and measure preview frame time with three
softened layers before calling it done.

---

### M5 — A transport you can actually drive

**Goal.** A user can click and drag the playhead anywhere, step frame by frame, and read real timecode.

**Included.** Ruler · draggable playhead · click-to-seek · frame-accurate transport · timecode ·
scrub quality tier · transport bar moved under the viewer (§5.1).

**Depends on.** M0 (geometry), M1, M3.

**Acceptance criteria**
- A 26 px ruler with an adaptive tick ladder targeting ~80 px between labelled ticks, chosen from a
  fixed ladder (1f, 5f, 10f, 1s, 2s, 5s, 10s, 30s, 1m, 5m, 10m). `tick_ladder(px_per_second)` is pure
  and unit-tested, returning major/minor spacings and labels.
- Mouse-**down** anywhere in the ruler seeks immediately (not on mouse-up); drag scrubs live; playback
  pauses on scrub start and does **not** silently resume on release.
- The playhead is **ONE** absolutely-positioned overlay spanning the ruler and the whole lane stack —
  a 2 px line, a 13 px grab strip, a 12 px triangular head in the ruler. It is no longer a 2 px div
  redrawn per lane (which also desynchronizes when lanes have different origins).
- All playhead positions quantize to frames via `settings.fps`. Arrow keys step **±1 frame** (not ±1
  second as at `editor_view.rs:2069-2076`); Shift+arrow steps ±1 second; Home/End jump to start/end.
  `quantize(MediaTime, Fps)` is pure, in `vii-project`.
- The transport reads HH:MM:SS:FF. `format_timecode(MediaTime, Fps)` is pure and unit-tested including
  non-integer fps (30000/1001) against the standard NTSC vectors.
- The transport bar moves out of the timeline toolbar into a 34 px bar under the viewer, with a 14 px
  scrub bar beneath it that mirrors the timeline playhead and seeks over the **full** project duration.
- While scrubbing, the preview renders at half size and skips effect passes; full quality resumes
  within one frame of mouse-up (hold the tier ~120 ms after release to avoid flicker). This is a flag
  threaded into `PreviewRenderer`, not a forked render path. A test asserts the **export** path can
  never select a reduced tier.

**Demo.** Click the middle of the ruler — playhead and picture jump there. Drag it back and forth: the
image follows smoothly and the timecode reads `00:00:04:12`. Press right-arrow four times: exactly
four frames advance.

**Risk.** The scrub quality tier must not thrash the texture cache — key cached frames by
`(media, frame, quality)` or half-res frames evict full-res ones and scrubbing gets *slower*. Second:
the tick ladder must be driven by rational `Fps`, not a float, or 30000/1001 labels drift visibly over
a long timeline.

---

### M6 — A timeline you can navigate, with real track headers

**Goal.** A user can zoom and scroll a long timeline without losing clips off-screen, and can add,
solo, sync-lock and resize tracks.

**Included.** Timeline scroll model · cursor-anchored zoom · pinned track headers · track sync-lock,
solo, height resize, add/remove.

**Depends on.** M5.

**Acceptance criteria**
- The timeline owns `scroll_x: f32`, `scroll_y: f32`, `pixels_per_second: f32` in view state. The lane
  area is an `overflow_hidden` viewport containing an absolutely-positioned content div at
  `.left(px(-scroll_x)).top(px(-scroll_y))`; the ruler translates by `-scroll_x` only; the pinned
  header column by `-scroll_y` only. **One source of truth, three views.** Viewport size comes from a
  `canvas()` prepaint probe stashed in view state. Content width = `duration * pps + tail_padding`;
  `scroll_x` clamps to `0..=(content_w - viewport_w).max(0)`. At `MAX_ZOOM` every clip on a 10-minute
  timeline is reachable.
- Wheel semantics are ours: plain = vertical, Shift = horizontal, **Opt = cursor-anchored zoom**,
  Cmd = fast horizontal pan. `ScrollDelta::Lines` vs `Pixels` is normalized in exactly one place.
- `zoom_at(scroll, pps, cursor_x, factor, min, max) -> (scroll, pps)` is pure with ~8 unit tests and
  drives wheel, the +/− buttons, `=`/`-` (playhead-anchored) and the zoom slider. Clamped 8..400 px/s.
  Fit (`Shift-Z`) sets pps so the full duration fits.
- **Pinch-to-magnify is recorded as a known gap** — GPUI 0.2.2 exposes only `ScrollWheelEvent`.
- Track headers render in a pinned 168 px column **outside** the horizontally-scrolled region.
  `track_row` splits into a header component and a lane component instead of one flex row.
- `Track` gains `height`, `solo` and `sync_locked`. The header shows a 3 px type-coloured strip, an
  editable name, and `[visible][mute or solo][sync-lock][menu]`. Sync-lock is stored now even though
  ripple consumes it later.
- Add/remove track buttons dispatch the existing `Command::AddTrack`/`RemoveTrack` — today nothing in
  `vii-ui` ever dispatches them.
- Per-track height resizes by dragging the header's bottom edge (5 px `cursor_row_resize` handle,
  min 28 / max 200), committed as **one** undo entry via M1's triad.
- `fn track_y_offsets(&[TrackRow]) -> Vec<f32>` is a pure prefix-sum used by hit-testing, drop
  targeting **and** rendering — never recomputed per call site.
- **Decision recorded in `docs/native`** on track reorder. Default call: **zone-scoped reorder only** —
  video tracks reorder among video, audio among audio, with a 3 px thicker divider between the zones —
  because our model is `Tracks { overlay, main, audio }` and nobody drags an audio track above video.
  If a different call is made, record it with the reason instead.

**Demo.** Zoom to 400 px/s with Opt+scroll over a clip at 04:00 — that clip stays under the cursor.
Scroll to the end of a 10-minute timeline; the headers stay pinned on the left. Add a second overlay
track, solo the audio track, and drag a header's bottom edge to make its lane taller.

**Risk.** Owning the scroll means losing GPUI's rubber-banding and momentum in the timeline; the
timeline will feel slightly less Mac-native than the media panel. That is the accepted price for
control, and the media panel keeps the built-in scroller precisely so the contrast is deliberate.
Second: `finish_drag` (`editor_view.rs:465`) computes `delta_px = pointer_x - pointer_start_x` **with
no scroll term** — the moment auto-scroll exists, a drag that scrolls the view commits the wrong
delta. Correct it in this milestone:
`delta_ticks = (px_to_ticks(x_now) + scroll_now) - (px_to_ticks(x_start) + scroll_at_start)`.

---

### M7 — Multi-select and snapping

**Goal.** A user can select several clips at once and drag them so their edges snap cleanly to
neighbours and the playhead.

**Included.** Multi-clip selection (marquee, shift/cmd-click) · the snap engine · the snap indicator ·
snapping toggle · drag threshold and Esc-cancel.

**Depends on.** M1, M5, M6.

**Acceptance criteria**
- Click replaces; Shift-click **or** Cmd-click toggles; a marquee on empty lane space selects by
  **intersection** (with would-be-selected clips highlighted live, before mouse-up); clicking empty
  space clears the selection and does **not** move the playhead. The lane div gains a mouse handler —
  today it has none. Marquee anchor is stored in timeline space (ticks, track index), not pixels, so
  auto-scroll cannot distort the rect.
- `begin_drag` no longer unconditionally calls `editor.select(vec![reference])`; dragging inside an
  existing multi-selection preserves it.
- **Every remaining `selection().first()` call site is swept** in this milestone —
  `delete_selected` (L522), `split_selected` (L685), `add_keyframe` (L700), `apply_preset` (L350),
  Duplicate (L907) and `EditorViewModel::build` (view_model.rs:150). Without the sweep, multi-select
  is a lie.
- `vii-core/src/timeline/snap.rs` is pure and unit-tested: collects non-dragged clip starts/ends
  plus the playhead plus timeline zero **once at drag start** into a sorted `Vec` (binary-searched per
  frame); multi-probes every selected clip's start **and** end simultaneously; per-target-kind
  thresholds (playhead 1.5×); sticky until the **raw** cursor moves 2.5× the threshold away, with the
  hysteresis state living in the drag; returns `{ snapped_time, indicator_px, target_kind }`.
- Written fresh in Rust (§3.6/#3), taking dep/apps/web's `SnapPoint` shape and cross-checked against
  palmier's sticky multiplier and multi-probe behaviour. Tests are new work.
- A snap indicator renders during move, trim-left and trim-right drags as a **1 px full-timeline-height
  line in a dedicated `snap_guide` role (white)** — never the playhead accent — with a 6 px cap glyph
  identifying the target kind. It lives in **one** handler-free overlay div above the lane stack, never
  per-lane.
- `S` toggles snapping (persisted); **holding** `S` during a drag temporarily inverts it.
- A 4 px drag threshold before a move commits. Esc during a drag reverts via M1's `revert()` and leaves
  no history entry. Esc precedence: drag in flight → cancel drag; else selection non-empty → clear.

**Demo.** Shift-click three clips and drag them right — the group's leading edge sticks to the next
clip's start with a visible indicator; keep pulling and it releases cleanly. Marquee-select four more.
Press Esc mid-drag: everything returns exactly where it was, and ⌘Z does not undo something else.

**Risk.** Marquee handlers on the lane background must not swallow clip mouse-downs. Decide the hit
order explicitly (clip body → trim handles → lane background — GPUI dispatches innermost-first, so
this falls out if the lane handler is on the lane div and clips are children) and verify with clips
flush against the lane edges. Second: the snap indicator's colour must be clearly distinguishable from
the playhead red — that is why it is a named role, not another literal.

---

### M8 — Clips stop overlapping: cross-track drag and overwrite

**Goal.** A user can drag clips between tracks and drop them over existing clips, with the underlying
clips trimmed or split instead of invisibly overlapping.

**Included.** `MoveElements` · the overwrite planner · track drop targets · ghosts, drop indicators,
context menus, Esc-cancel.

**Depends on.** M7.

**Acceptance criteria**
- `Command::MoveElements { moves: Vec<(ElementRef, track_id, MediaTime)> }` exists and applies as ONE
  labelled transaction — the first real consumer of M1.
- `vii-core/src/timeline/overwrite.rs` is a **pure planner returning `Vec<OverwriteAction>`**
  (Remove / TrimEnd / TrimStart / Split), unit-tested over full-cover, left-overlap, right-overlap and
  interior-split cases, and it runs on add, move **and** widening trim. **Write and pass the planner
  tests before wiring any drag UI to it.**
- After any overwrite, no two elements on one track overlap — asserted by `assert_timeline_valid`
  (§6.4) run after each planner case.
- Cursor Y resolves to a `TrackDropTarget::{ExistingTrack(ix), NewTrackAt(ix)}` using
  `track_y_offsets` from M6; the inter-track insertion zone is the outer 6 px of each lane boundary.
  Incompatible kinds (audio onto a video track) are **clamped backwards until every mover lands
  legally**, never silently dropped — and the refusal is rendered (red edge on the offending lane +
  a toast), never silent.
- During a move, source clips stay in place at 55 % opacity (origin ghost) while a solid snapped
  preview follows the pointer with a badge showing delta and new start as timecode. A 2 px insertion
  line renders for new-track drops. All of it lives in the **single** overlay div from M7.
- Media-panel → timeline drags use GPUI's `on_drag`/`on_drop`/`can_drop` with a typed
  `MediaDrag { asset_ids, source_range }` payload; Finder drops arrive as `ExternalPaths` accepted at
  the **window root** so a drop anywhere imports. Drop time goes through the same `px_to_time` as every
  other timeline interaction, then through the snap engine.
- A right-click context menu (`anchored()` + `deferred()`, dismissed by `on_mouse_down_out` and Esc)
  with Split / Duplicate / Copy / Paste / Delete, whose labels match the key bindings from M0's table.
- **Overwrite is the default drop.** The Cmd modifier is **reserved** for ripple-insert and is inert
  this round (ripple is next round, §3.5). After a drop, a toast names what happened and the undo entry
  label matches ("Undo Overwrite").

**Demo.** Drag a clip from the main track down to an overlay track — a ghost and an insertion line
follow the cursor. Drop it half over an existing clip: the existing clip is trimmed at the boundary
rather than hidden underneath, and a toast says "Overwrite — 1 clip trimmed". One ⌘Z restores both
clips exactly.

**Risk.** The largest UI milestone here and the one where a bug silently destroys footage. Planner
tests first, UI second. Second: drop coordinates arrive in window space — subtract the lane's own
origin from the `canvas()`-probed bounds rather than assuming a constant left offset, or the drop lands
wrong the moment a dock is resized.

---

### M9 — Video decode that survives a real clip

**Goal.** Clips longer than 15 seconds or wider than 320 px finally render correctly, at preview
resolution, with flat memory.

**Depends on.** M3, M5.

**Acceptance criteria**
- `VIDEO_MAX_FRAMES = 450` and the hardcoded 320×180/30fps decode are gone; decode resolution follows
  the preview render size established in M3.
- Decoding is a keyframe-aligned seek (`-ss`) plus forward decode to the exact frame, into a **bounded
  ring buffer** around the playhead.
- `vii-preview/src/decode/window.rs` (cache/eviction policy) is **pure over a `FrameSource`
  trait** and tested against a fake that returns its own index: which ranges get fetched, which get
  evicted, and that memory stays bounded under a random walk of 10 000 seeks — no ffmpeg involved.
- Frame-exactness is verified against a **self-identifying test clip** generated in a temp dir (never
  committed): each frame encodes its own index as a colour triplet in base 16 across R/G/B (4096
  distinguishable frames with wide per-channel margins; compare with ±3 tolerance for codec
  quantisation). Assert the correct frame at t = 0, 0.5, 14.9, **15.1** (past today's cliff), 30, 45,
  59.9; then backward seeks 45 → 5 → 50; then window-boundary times; then repeated seeks to the same t
  returning identical bytes. Run with `-hwaccel auto` both on and off.
- One GPU texture per element is created once and re-uploaded — the per-frame `create_texture` at
  `vii-preview/src/lib.rs:320-329` is gone. `renderer.video_texture_count()` stays constant across
  100 rendered frames of the same clip (mirroring the existing `text_cache_len()` accessor idiom).
- Decode runs off the GPUI thread; while the window refills the viewer holds the previous frame rather
  than flashing a placeholder.
- A test asserts resident frame memory stays under a stated cap while the playhead sweeps a long clip.

**Demo.** Drop a 10-minute 1080p clip. Scrub to 07:30 — the correct frame appears at full preview
resolution (today it is wrong past ~15 s). Play from there for 30 seconds with no stall, and watch
memory stay flat instead of climbing.

**Risk.** Seek accuracy with `-hwaccel auto` on long-GOP sources is the whole risk. If hardware decode
cannot be made frame-exact after seek, **fall back to software decode for scrubbing and keep hwaccel
for linear playback — and record that finding in `docs/native`.**

---

### M10 — Audio that is actually a mix

**Goal.** A video clip's own audio is audible, and every clip and track has a working gain, mute, solo
and fade.

**Depends on.** M1, M3.

**Acceptance criteria**
- `VideoElement` gains `volume` and `muted`; the mixer walks video tracks too, so a video clip's audio
  plays in **both** preview and export. `start_audio` no longer only iterates `scene.tracks.audio`.
- `AudioElement` gains `animations`, so volume is keyframable like any other property.
  `Command::SetVolume` / `SetMuted` / `SetFades` exist and are undoable — today gain is not settable at all.
- Per-clip `fade_in`/`fade_out` (equal-power) applied in the mixer, plus a short default fade at every
  clip boundary so cuts stop clicking.
- `Track` gains `volume` and `solo`; `Project` gains a master gain. **ONE** pure mix path composes
  clip gain × fade × track gain × solo/mute × master — no second code path.
- A −1 dBFS master limiter ported from `dep/apps/web/src/media/audio-mastering.ts` replaces the hard ±1
  clamp at `vii-audio/src/lib.rs:90-93`. Unit tests over synthetic buffers assert no output sample
  exceeds the ceiling and that `clampDb`/`dBToLinear` round-trip.
- Keyframed gain is sampled on the **same clock the mixer runs on**. Land that sampling API here even
  though M11 replaces the transport underneath it.
- All of the above is tested **without an audio device present**.

**Demo.** Drop a video that has sound — you hear it (today it is silent). Pull it to −6 dB in the
inspector, mute a music clip, add a 6-frame fade-in: the cut stops clicking. Play two loud clips
together: the limiter holds them instead of clipping audibly.

**Risk.** If automation is sampled on a different clock than the mixer, gain lags the audio by a
buffer and it will be blamed on M11 later.

---

### M11 — Streaming audio mixer and real waveforms

**Goal.** Play starts instantly on any timeline, edits are audible while playing, the playhead stays
locked to what you hear, and waveforms reveal detail as you zoom.

**Depends on.** M10.

**Acceptance criteria**
- The mix core is a **pure pull function** — `graph.fill(&mut [f32], start_frame: u64)` — computing
  samples for an arbitrary frame range from (clips, gain automation, fades, track gain/mute/solo,
  master limiter) with no device, no thread, and no interior state surviving across calls.
- A rodio/cpal `Source` pulls mixed chunks on demand with ~2 s lookahead, fed by a decode/mix thread
  through a **lock-free ring**. No whole-timeline `Vec<f32>` is ever allocated; the PCM cache is a
  bounded LRU of windows, not an unbounded map.
- **Block-size invariance**: filling `[0, 480_000)` in one call is byte-identical to 938 calls of 512
  frames. This is *the* test for a streaming mixer — every streaming-mixer bug that ever shipped shipped
  at a block boundary.
- **Null test**: mixing a signal against its own inverse yields silence to < 1e-6.
- **Preview == export**: the same graph filled for `[t0,t1)` is byte-identical whether pulled by the
  rodio source or by the export WAV writer.
- Play latency on a 10-minute timeline is under ~200 ms and does not scale with timeline length (bench
  that skips without a device). Today the first press stalls for seconds per media.
- The mix graph reads the **live** project each chunk: a volume/mute/move edit during playback becomes
  audible within one lookahead window without stop/start.
- The playhead advances from **samples consumed by the device**, not `Instant` deltas. `Transport`
  takes an injected clock; a simulated 5-minute playback asserts drift under one frame.
- ONE streaming decode entry point in `vii-audio` serves playback, waveforms and future analysis —
  no third `Command::new("ffmpeg")` copy anywhere in the workspace.
- Waveforms are zoom-aware (peaks/second adapts and caps for long media, replacing the hardcoded 48 at
  `editor_view.rs:323`), dB-companded against a −50 dB floor, computed off the UI thread, and persisted
  to a disk cache keyed by path+size+mtime so relaunch does not re-decode. They render in **one
  `canvas()` per clip** (RMS band at 55 % alpha + peak envelope line), not one div per peak.
- No allocation and no blocking lock in the callback path — asserted, not hoped: a 512-frame block at
  48 kHz with 8 clips has a **hard p99 budget of 0.5 ms**.

**Demo.** Press Play on a 10-minute timeline: sound starts immediately instead of stalling. While it
plays, pull a clip's gain down — you hear the change. Let it run five minutes: the playhead is still on
the frame you are hearing. Zoom into an audio clip: the waveform reveals new detail instead of
stretching 48 bars.

**Risk.** Highest-risk milestone in the plan. The audio callback is a real-time context. Scrub audio
grains, level meters and playback rate are deliberately **not** here — they are the natural follow-on
once this lands and must not be allowed to expand it.

---

### M12 — An export you can trust

**Goal.** A user can choose where to export, at what quality, with audio, watch progress, cancel, and
never end up with a truncated file.

**Depends on.** M3, M9, M11.

**Acceptance criteria**
- `rfd::save_file()` picks the destination; the `~/vii-export.mp4` and `~/vii-frame.png` constants
  (`editor_view.rs:105-112`) are gone, so exports stop clobbering each other.
- `ExportOptions { resolution, codec, quality/bitrate, range }` exists with the project resolution as
  default. The max-1280 px clamp at `editor_view.rs:664-666` is gone — a 1080p project exports
  1920×1080, asserted by ffprobing the output.
- **`export/options.rs` is pure**: `ExportOptions -> Vec<String>` argv, unit-tested for every preset
  (codec, bitrate/CRF, resolution, pix_fmt, the second audio input with `-map`/`-c:a aac`/`-shortest`,
  and the staged `.partial` path). This catches "exports at 720p" and "exported MP4 is silent" in
  microseconds with no encoder involved — the highest-leverage test in the export domain.
- Audio is muxed from the **same mix graph as M11** (temp WAV as a second input). A test asserts the
  preview mix and the export mix agree sample-for-sample on a fixture timeline.
- The job runs on `cx.background_spawn` publishing progress on the EventBus (parsed from ffmpeg's
  `-progress pipe:1`); the UI stays interactive (you can scrub during export) and the **status bar**
  shows a determinate progress bar with a working Cancel. `ExportJob` has a state-machine test:
  Queued → Running → {Done, Cancelled, Failed}, no other edges, run without spawning anything.
- Output writes to `<dest>.partial` and renames on success. Cancel or failure leaves no file at the
  destination and does not touch a pre-existing file of the same name.
- Errors surface with the tail of ffmpeg's stderr; the `let _ = renderer.export_video(...)` discard is gone.
- Offline media (M2) blocks or warns with a named list rather than baking placeholders into the output.
- The real integration test encodes 0.5 s at 64×36 and ffprobes it: `nb_streams == 2`, exact
  dimensions, video and audio codecs, duration within one frame. **Assert on ffprobe output, never on
  bytes** — encoder output is not reproducible across ffmpeg versions.

**Demo.** File > Export, pick `~/Desktop/cut.mp4`, choose 1080p H.264 — a progress bar runs in the
status bar while you keep scrubbing the timeline, and the result plays at 1920×1080 **with sound**.
Export again and hit Cancel halfway: no `cut.mp4` appears and the earlier file is untouched.

**Risk.** Sharing one mix graph between preview and export is what keeps envelopes from diverging.
Resist writing a second export-only mixer even though it looks easier.

---

### M13 — A viewer you can edit in

**Goal.** A user can click a clip in the preview to select it, drag to move it, drag handles to resize
it, and zoom/pan the canvas.

**Included.** Hit-test · move · 8 resize handles + rotation · canvas zoom/pan/fit · canvas snapping guides.

**Depends on.** M1, M3, M5.

**Acceptance criteria**
- `content_rect(viewport, canvas_w, canvas_h, zoom, pan) -> Bounds<f32>` is pure and is the foundation
  of the entire viewer — the `img()` size, hit-test mapping, handle positions, guide positions and
  snap pixels all derive from it. The `img()` is **absolutely positioned at exactly that rect**, never
  `size_full()` with GPUI doing its own object-fit, so our fit and GPUI's fit cannot disagree.
- Viewport window-space bounds come from a `canvas()` prepaint probe into an `Rc<Cell<Bounds<Pixels>>>`.
  **Pointer events are ignored while the cell is `Bounds::default()`** (first frame, pre-layout) — do
  not clamp, do not guess.
- `hit_test(point, frame_state)` is pure in `view_model.rs` with unit tests: aspect-fit content rect,
  text clips first, then tracks in reverse **draw** order (our topmost is the **last** overlay element —
  the reverse of palmier, and easy to get backwards), skipping hidden tracks and opacity ≤ 0.01,
  un-rotating the point into clip-local space.
- Full chain, all inside pure functions: window pt → −viewport.origin → −fit_rect.origin → ÷fit_rect.size
  → ×canvas → clip-local (translate −centre, rotate −θ) → `|x| ≤ w/2 && |y| ≤ h/2`. Compositor **render**
  resolution never enters this chain — only project canvas aspect — so the scrub tier cannot break hit
  testing. A unit test covers the round trip `screen → canvas → clip-local → back` within 0.5 px for a
  rotated, off-centre, non-unit-aspect clip over random points, zoom ∈ [0.1, 8.0] and pan.
- Click selects; drag moves; four corner and four edge handles resize (8 px visible, **16 px invisible
  hitbox**, hit-tested in **screen** space so slop is constant under zoom, while the math runs in canvas
  space); Shift preserves aspect; Opt resizes about the centre; a rotation handle sits 22 px above
  top-centre with Shift snapping to 15°. Text clips resize **font scale**, not the box.
- The whole gesture applies live via `apply()` and commits as ONE named undo entry via `commit()` —
  not one entry per mouse-move. Esc reverts to the pre-drag transform.
- Cmd+scroll zooms to the cursor using the **same pure `zoom_at`** as the timeline (clamped 0.1..8.0);
  space-drag or middle-drag pans; 25/50/75/Fit/100/150/200 % presets plus a zoom badge; a canvas border
  strokes below 100 %.
- Drag snapping to canvas edges and centre with full-height/full-width guides in **magenta `#ff4dd2`**
  (the Figma convention, and distinct from both the red playhead and every clip hue), ported from
  `dep/apps/web/src/preview/preview-snap.ts`, skipped when the clip is rotated.
- Viewer drags are throttled to the animation frame and use the scrub quality tier — with CPU readback,
  every live drag frame is a full render plus readback.

**Demo.** Click a clip in the preview — it gets a selection rect with handles (today clicking does
nothing). Drag it left; a magenta centre guide appears as it crosses the middle. Shift-drag a corner:
the aspect holds. Cmd+scroll to 200 % on a detail and space-drag to pan around it.

**Risk.** Coordinate mapping is where this goes wrong. Keep every step inside the pure function, and do
not let the viewer's zoom/pan transform leak into the hit test as a second, divergent copy of the math.
Second: crop is **next round**, and when it lands it must be a separate viewer **mode** (Shift-C), not
more handles on the same rect — eight transform handles plus four crop handles on one rectangle is the
canonical way to make a viewer unusable.

---

### M14a — An inspector that tells the truth (part 1)

**Goal.** An edit on an animated property writes a keyframe instead of silently doing nothing, and
every numeric value can be dragged or typed.

**Depends on.** M1, M3, M5.

**Acceptance criteria**
- Every inspector write routes through a `write_property` that **upserts a key at the playhead when
  that property's channel is active** and sets the base value otherwise. A regression test reproduces
  the two-click bug: keyframe opacity, step opacity, assert `sampled_transform` changes (today it does not).
- `AnimationChannel` gains `has_key_at` / `prev_key` / `next_key`. A `‹ ◇ ›` control stamps and removes
  keys and navigates between them, disabled with "Move playhead inside the clip" when the playhead is
  outside the element. The diamond is **stateful**: filled = key at playhead, hollow-accent = animated
  but no key here, dim = not animated. This is what makes the bug *visible* instead of silent.
- The `ScrubbableNumber` from M1 is swept across the whole inspector: every `nudge_row`, `stepper_row`
  and effect-amount ± pair is replaced. It gains `display_multiplier` (store 0..1, show 0..100 %),
  `value_suffix`, `display_text_override` (for "−∞ dB"), `on_change` live / `on_commit` once.
- One canonical row shape: `[label] [field(s)] [◇ stamp + ‹ ›] [↺ reset]`, where reset appears on row
  hover via `.group()`/`.group_hover()` and Opt-click on the label also resets.

**Demo.** Select a clip and drag on Opacity — it scrubs continuously; hold Cmd for fine control. Click
it, type 37, Enter: opacity is 37 %. Stamp a keyframe, move the playhead, drag opacity down — the
canvas dims (today the stepper is silently inert) and the diamond fills.

**Risk.** Drag-to-scrub inside a scrollable panel fights the scroller. Claim the drag on mouse-down and
set a flag the panel's scroll handler checks, or a horizontal scrub in a vertically-scrolling panel
also scrolls.

---

### M14b — Keyframe lane, easing, inspector information architecture

**Goal.** A user can see and edit keyframes on a lane with real easing, and the inspector organizes
itself around what is actually selected.

**Depends on.** M6 (timeline geometry and scroll — see §3.6/#4), M14a.

**Acceptance criteria**
- **Keyframe lanes live in the timeline**, as 18 px expandable sub-lanes under the clip's track,
  sharing the timeline's ruler, `scroll_x`, zoom and snap engine by construction. The track header
  shows one row per animated property with a colour swatch and a visibility toggle. Expansion state is
  per-track **UI** state, never project state.
- Diamonds are drawn with `canvas()` + `paint_path` (dozens to hundreds of marks with no need for ids,
  tooltips or drag payloads — divs would be wasteful). `key_at(x, keys, pps, scroll_x, tolerance_px)`
  is pure and unit-tested with a 7 px tolerance. Below 6 px spacing a run collapses to a single tick
  with a hover count — that threshold lives in the same pure module.
- Drag-to-retime is one undo entry via apply/commit and snaps via M7's engine. Right-click menu:
  Linear / Ease / Hold / Delete. `Command::MoveKeyframe` exists and `RemoveKeyframe` (command.rs:113)
  is finally dispatched from the UI.
- **Shape encodes interpolation** in the lane — diamond = bezier/smooth, square = hold/step,
  circle = linear (the Premiere/AE convention). Ship three static SVGs; do **not** rotate a square,
  because `svg().with_transformation()` does not rotate the hitbox.
- `Keyframe` gains an easing field; `AnimationChannel::sample` supports `linear | hold | bezier` with
  `CurveHandle{dt,dv}`, ported from `dep/apps/web/src/animation` with its solver tests carried over.
- `view_model` exposes a `SelectionSummary` where every field is `Field<T> = Uniform(T) | Mixed | Absent`
  instead of `ElementInfo` built from `selection().first()`. `Mixed` renders "—" and writing it applies
  to **all** selected; `Absent` hides the row. The fold is order-independent and unit-tested.
- The inspector becomes five content-driven tabs — Clip / Motion / Style / Effects / Audio — plus a
  Project tab when nothing is selected. `applicable_tabs(&SelectionSummary) -> Vec<Tab>` is pure and
  tested; inapplicable tabs are **hidden, not disabled**; tab order is fixed and the active tab never
  changes while it remains applicable. Groups are collapsible with per-row and per-section reset.

**Demo.** Expand a clip's keyframe rows in the track header: two lanes appear under it with diamonds on
the same time axis as the clips. Drag a diamond — it snaps to the playhead. Right-click it → Hold: it
becomes a square and the motion steps. Select two clips: Rotation reads "—" and typing sets both.

**Risk.** Vertical space — three properties expanded on two tracks makes the timeline tall fast. Cap
expansion to the selected clip's track by default, keep lane height at 18 px, and add a "collapse all
keyframes" control. Second: keyframe lanes must reject clip drops (`.can_drop()` returns false).

---

## 5. UI/UX design

### 5.1 Information architecture

Today's five fixed slabs (toolbar / scene tabs / 200 px media / 512×288 preview / 260 px inspector /
3 lanes) become: a fixed command bar, three resizable docks around a **fluid** viewer, a resizable
timeline, and a status bar.

**Six regions.**

| Region | Behaviour | Size |
|---|---|---|
| Command bar | Fixed | h 44 |
| Left dock (tabbed: Media / Effects / Titles) | Resizable, collapsible, ⌘1 | 200–480, default 260 |
| Viewer | **Fluid in both axes — the only region with no fixed dimension** | min 360×240 |
| Right dock (inspector tabs) | Resizable, collapsible, ⌘3 | 280–460, default 320 |
| Timeline | Resizable, collapsible, ⌘2 | min 160, default 300, max 60 % of window height |
| Status bar | Fixed | h 24 |

Making the viewer the only fluid region is the single change that makes the app feel like an editor: on
a big display you get a big picture and the panels stay at the width their content needs. Dock widths
and collapse state persist to `settings.json` **per app**, not per project, and are clamped against the
actual window width on every render (not just on drag) so a persisted layout cannot strand a dock
wider than the window.

```
== macOS menu bar (real NSMenu via cx.set_menus) ==
   vii  File  Edit  Clip  Sequence  View  Window  Help
+------------------------------------------------------------------------------------------+
| COMMAND BAR   h 44 fixed                                                                 |
| [home] | Project Name (o unsaved) | [V][C][T] | split dup del |          [Export...] [gear]|
+--------------+-----------------------------------------------+---------------------------+
| LEFT DOCK    |  VIEWER                                       | RIGHT DOCK                |
| 200-480(260) |  FLUID both axes, min 360x240                 | 280-460 (320)             |
| Cmd-1        |                                               | Cmd-3                     |
| +----------+ |        +---------------------------+          | Clip Motion Style Fx Audio|
| |Media|Fx|T| |        |    aspect-fit canvas      |          | ------------------------- |
| +----------+ |        +---------------------------+          | v TRANSFORM          [rst]|
|  search:     |  |< << play >> >|  00:00:12:04  Fit 100%      |   Position 1920 1080 <> [r]|
|  [tile][tile]|  |-------------o------------------|           |   Opacity  100%      <> [r]|
+--------------+-----------------------------------------------+---------------------------+
| ============= splitter 4px, cursor_row_resize ========================================== |
| TIMELINE  min 160 / default 300 / max 60%   Cmd-2                                        |
| [Scene 1][Scene 2][+] | snap | ---o--- zoom | fit |                                      |
| +------------+------------------------------------------------------------------------+ |
| |  headers   | ruler + lanes + ONE overlay layer                                       | |
| +------------+------------------------------------------------------------------------+ |
+------------------------------------------------------------------------------------------+
| STATUS BAR h 24   ! 2 media offline   -   Exporting 43% [====    ] X          bell 3      |
+------------------------------------------------------------------------------------------+
```

**Four IA calls worth defending, all of which differ from palmier.**

1. **The keyframe lane goes in the timeline, not the inspector.** One time axis, one scroll offset,
   one zoom, one snap engine. (§3.6/#4.)
2. **The timeline does not use `overflow_scroll`.** We own `scroll_x`/`scroll_y`. The media panel and
   inspector *do* use the built-in, where trackpad inertia is worth more than control. (§3.6/#1.)
3. **The transport bar lives under the viewer**, not in the timeline toolbar. Transport is about the
   picture; every professional NLE puts it under the picture. The timeline toolbar keeps only
   timeline-scoped state (sequence tabs, snap, zoom).
4. **The scene tab bar stops being a top-level row** and becomes a sequence tab strip on the timeline
   panel — scenes *are* timelines, and this is where nested sequences would open their tabs.

**Command bar.** One 44 px row: `[home] [project name, click-to-rename, dirty dot] | [tool segmented
control] | [split, duplicate, delete] | …spacer… | [Export…] [gear]`. Undo/redo/copy/paste/save/load
buttons are **deleted** — they live in the menu bar and keymap only. *Sequencing note: the menu bar
(M0) must land before this cleanup, or users are stranded.* Tool mode is transient UI state and never
touches undo.

**Status bar + toasts.** One `Notifications { toasts: Vec<Toast>, jobs: Vec<Job> }` in `EditorView`
with one `fn notify(&mut self, Toast)` entry point. Status bar: left = transient hint or current
refusal reason; right = one row per background job (export + cancel, waveform extraction, thumbnail
generation, media probe) plus a bell badge with an unread error count. Toasts render in
`deferred(anchored(bottom_right))` so they paint above the viewer, docks and any sheet. Rule: **a toast
is for something the user must know about that they did not just cause.** A successful save gets a
status-bar flash, not a toast.

**Left dock — media panel.**

```
+------------------------------+
| >Media | Effects | Titles    |  28
+------------------------------+
| search: b-roll         Name v|  30   <- TextField entity
+------------------------------+
| < All Media / B-roll         |  22   <- breadcrumb (drop target)
+------------------------------+
| +----+ +----+ +----+         |
| |####| |####| |~~~~|         |  tile 96x54
| |0:34| |0:12| |1:02|         |  duration badge
| +----+ +----+ +----+         |
| A_wide  B_cu   music         |
| .mp4    .mp4   .wav          |
| +----+ +----+                |
| | !! | |####|                |  !! offline -> Relink...
| +----+ +----+                |
+------------------------------+
| 12 items - 1.2 GB   [+ Add]  |  26
+------------------------------+
  drag tile --> GPUI on_drag renders the ghost --> drop on a lane
```

Grid via `uniform_list("media", row_count, …)` where each **row** is a flex row of N tiles —
`uniform_list` needs uniform heights, and a row of tiles is uniform even though the grid is not. This
gives virtualization free for a 2000-asset library. **Recompute `columns(dock_w)` before building the
list, never inside the render closure**, or a dock resize mid-frame drops items.

**Drag payloads.** Typed Rust structs, not a string URI scheme: `MediaDrag { asset_ids, source_range }`
and `TrackDrag { track_id }`. Palmier's `palmier-asset://<id>` scheme exists only because AppKit
pasteboards are stringly-typed; copying it would be cargo-culting a workaround for a problem we do not
have. Drop targets in priority order: lane → inter-track gutter → left dock → window root. Finder
drops are accepted at the **window root** so a drop anywhere imports, with the media panel highlighting
as the preferred target.

**Right dock — inspector.**

```
+- RIGHT DOCK -----------------------------+
| Clip | Motion | Style | Effects | Audio  |  30
+------------------------------------------+
| v TRANSFORM                        [rst] |  group header + section reset
|   Position    1920.0    1080.0  <> [rst] |
|   Size         100 %  [lk]  100 %  <>    |  [lk] = aspect link
|   Rotation       0.0                <>   |
|   Anchor        0.50    0.50             |
|   Opacity       100 %          (*) <> [r]|  (*) filled = key AT playhead
| v CROP                             [rst] |
|   L 0   T 0   R 0   B 0   [Crop mode ^C] |
| > FLIP                                   |  collapsed
+------------------------------------------+

 multi-selection with differing rotations:
|   Rotation         -            <>  [rst]|  typing/dragging applies to ALL
```

Tabs over one long scroll, deliberately: at 320 px wide and a 900 px window, eight collapsible groups
in one column means constant scrolling. Tabs that do not apply are **hidden, not disabled** — the
difference between "this is what this clip has" and "most of this app is broken".

**Sheets vs windows.** Export is a **sheet** (transient, project-scoped, must not block — moving
progress to the status bar after dismissal is what makes "export while you keep editing" possible).
Settings would be a **window** (you often change a timeline colour while looking at the timeline).
Home would be a **window** (two open projects should be two windows). Only the export sheet is in
scope this round.

> Multi-window means state that is currently implicitly global (audio output, preview renderer, ffmpeg
> concurrency gate) must move into an `App`-level `Global`. **Decide that before opening a second
> window, not after.**

**Build order (this is the part that gets skipped and must not be).**

| Tier | Contents | Gates |
|---|---|---|
| 0 | Theme tokens · Notifications/status bar · command table + menu bar · `geometry.rs` (`content_rect`, `zoom_at`, `time_at_px`, `track_y_offsets`, `columns`, `quantize`) | everything |
| 1 | `TextField` · `ScrubbableNumber` (needs Tier 0 + M1's triad) · Panel/Group/Row primitives · the `deferred()` overlay layer | every feature below |
| 2 | Dock splitters + collapse + persistence · command bar consolidation · sequence tabs moved to the timeline | the shell |
| 3 | timeline scroll/zoom/ruler/playhead → headers → clip visuals → snapping overlay; media panel; inspector tabs; viewer handles; keyframe lanes | — |

Nothing in Tier 3 starts before its Tier 1 dependency exists. All the pure geometry lives in
`view_model.rs` or GPUI-free sibling modules, so views stay thin — that is the rule that keeps
`editor_view.rs` from growing from 2100 lines to 8000.

### 5.2 Interaction and input model

**Timeline geometry.** `scroll_ticks`/`scroll_x` and `pixels_per_second` live on the view; every lane
renders inside `.relative().overflow_hidden()` with blocks at `left = ticks_to_px(start) - scroll_x`.
Blocks outside `visible_window(scroll, pps, width)` are culled **before** building divs — a 10-minute
timeline at 400 px/s would otherwise build tens of thousands of elements. Zoom is exponential and
cursor-anchored:

```rust
// vii-ui/src/geometry.rs — pure, ~8 unit tests, drives wheel + buttons + keys + slider + canvas
pub fn zoom_at(scroll: f32, pps: f32, cursor_x: f32, factor: f32, min: f32, max: f32) -> (f32, f32) {
    let t = (scroll + cursor_x) / pps;
    let pps2 = (pps * factor).clamp(min, max);
    (((t * pps2) - cursor_x).max(0.0), pps2)
}
```

Auto-scroll during any drag: within 40 px of a viewport edge, pan proportional to overshoot up to
1200 px/s, driven by `window.request_animation_frame()` while the drag is live (the same pump
`advance_playback` already uses).

**Coordinate mapping (viewer).** One pure `fit_rect(viewport, canvas_aspect, zoom, pan) -> Rect`; the
`img()` is sized and positioned to exactly that rect. Viewport bounds are captured by a zero-layout
`canvas()` probe into an `Rc<Cell<Bounds<Pixels>>>`; pointer events are ignored while it is
`Bounds::default()`. Keep the whole chain in logical `Pixels` and never mix in the readback buffer's
device dimensions.

**Selection.** Click = replace. Shift-click **or** Cmd-click = toggle. Opt-click = ignore link groups
(when those exist). Drag on empty lane = marquee, **intersect** semantics, plain replaces / Shift
unions, anchor stored in ticks+track-index. Background click clears the selection and **does not seek**
— conflating deselect with seek is the single most-complained-about behaviour in editors that do it,
and Premiere agrees. Shift = toggle rather than the macOS Cmd = toggle convention is deliberate: a
timeline has no meaningful linear range of clips, and Premiere/Resolve/FCP all use Shift for add.
Accepting Cmd-click as an alias costs one line.

**Drag mechanics.** 4 px threshold separates a click from a drag (today any click with 1 px of hand
tremor commits a `MoveElement` and pollutes the undo stack). During a move, origin ghosts at 55 %
opacity stay in place while a solid snapped preview follows the pointer with a timecode badge. All
planning is pure, in `vii-core/src/plan/` — `plan_move`, `plan_trim` (and later `plan_slip`,
`plan_slide`, `plan_roll`) — each returning intended `(ref, track, start, trim_start, duration)` tuples
plus a `Vec<Refusal>`. **The view renders the plan; mouse-up commits the same plan.** Preview and
result cannot diverge, which is the classic NLE bug. Always render *why* a drag stopped — a red edge on
the offending lane plus a toast — never silently clamp.

**Esc precedence ladder** (first match wins): drag in flight → cancel, commit nothing · tool ≠ pointer
→ back to pointer · selection non-empty → clear.

**One overlay layer.** The snap indicator, ghosts, insertion line, marquee and (later) razor line and
ripple gap band all render in a **single** handler-free absolutely-positioned div above the lane stack.
Never per-lane: each lane is `overflow_hidden`, so a full-height indicator is impossible from inside
one, and per-lane indicators can disagree with each other.

**Key contexts.** Delete the root context swap at `editor_view.rs:2038`. The root always declares
`key_context("Editor")`; every text-entry surface declares `key_context("TextEntry")` on its own
element; every letter-key and Cmd-letter action binds with the predicate `"Editor && !TextEntry"`.
Verified: gpui-0.2.2's `KeyBindingContextPredicate::Not` scans the **entire** context chain, so
`!TextEntry` correctly means "no TextEntry anywhere in the focus chain" even for an input nested deep
inside the Editor root. This is the only design that survives adding a real text input, scrubbable
numeric fields and inline rename — and it fixes today's limitation that ⌘Z is impossible while typing.

**Tool modes — designed, not scheduled** (§3.6/#8). Exactly three: V pointer, C razor, T trim (body =
slip, Opt+body = slide, edge = roll). Spring-loaded: pressing the key enters immediately; released
within 250 ms with no mouse-down = latch, otherwise revert on key-up; Esc always returns to pointer;
revert on window blur (the key-up never arrives). Modal tools are worth it **only** where the gesture
is genuinely ambiguous — razor (click = select or cut, and every disambiguating modifier is taken) and
the trim family (on the same pixels, a body drag means move-or-slip and an edge drag means
trim-or-roll; four modifiers on one gesture is unlearnable). Nothing else qualifies. **Honest
constraint: gpui-0.2.2's `CursorStyle` is a closed enum with no custom bitmap**, so a razor-blade
cursor is impossible — mode is communicated by a toolbar chip, a 4 % lane tint, and for razor a live
1 px blade line at the snapped frame. Design around that rather than pretending.

**Ripple vs overwrite — reserved** (§3.5). Overwrite is the default drop; **Cmd** switches to
ripple-insert when ripple lands, sampled at mouse-**up** with a live preview flipped by
`.on_modifiers_changed()` so it changes with the mouse stationary. Overwrite previews as a red hatch
over the doomed regions; ripple as a green gap band with downstream clips visibly shifted. Disclosure
after the fact is three-layered: a toast, a **matching named undo label**, and one ⌘Z per gesture.

**The keyboard map.** One table in `vii-ui/src/actions.rs` produces `Vec<KeyBinding>`, the NSMenu
tree, the shortcuts help grid and every tooltip. Rows marked *(next round)* are in the table for the
help grid but the action is unregistered until its milestone lands.

| Group | Chord | Action | Lands |
|---|---|---|---|
| Transport | `space` | Play / pause | exists |
| | `k` | Stop | next round |
| | `l` / `j` | Shuttle fwd / back (1/2/4/8×, tap to step rate) | next round |
| | `left` / `right` | Step **±1 frame** (breaking change — was ±1 second) | M5 |
| | `shift-left` / `shift-right` | Step ±1 second | M5 |
| | `up` / `down` | Previous / next edit point | M5 |
| | `home` / `end` | Start / end | M5 |
| | `i` / `o` | Mark in / out | next round |
| | `shift-i` / `shift-o` | Go to in / out | next round |
| | `alt-x` | Clear in/out | next round |
| | `shift-cmd-l` | Loop | next round |
| Tools | `v` / `c` / `t` | Pointer / razor / trim (spring-loaded) | next round |
| | `escape` | Cancel drag → pointer → clear selection | M7 |
| Selection | `cmd-a` / `shift-cmd-a` | Select all / deselect all | M7 |
| | `a` / `shift-a` | Select forward this track / all tracks | M7 |
| Edit | `cmd-k` | **Split at playhead** (moved from `s`) | M0 |
| | `shift-cmd-k` | Split all tracks | next round |
| | `backspace` / `delete` | Lift (delete, leave gap) | exists |
| | `shift-backspace` / `shift-delete` | Ripple delete | next round |
| | `cmd-c` / `cmd-x` / `cmd-v` | Copy / cut / paste | exists (cut new) |
| | `cmd-d` | Duplicate | M0 |
| | `cmd-z` / `shift-cmd-z` | Undo / redo | exists |
| | `alt-left` / `alt-right` | Nudge ±1 frame | M5 |
| | `shift-alt-left` / `shift-alt-right` | Nudge ±1 second | M5 |
| | `q` / `w` | Trim previous / next edit to playhead | next round |
| | `cmd-l` | Link / unlink | next round |
| View | `=` / `-` | Zoom in / out (playhead-anchored) | M6 |
| | `shift-z` | Zoom to fit | M6 |
| | `s` | **Toggle snapping** (breaking change — was Split); hold to invert | M7 |
| | `alt-wheel` | Zoom at cursor | M6 |
| | `cmd-wheel` / `shift-wheel` | Pan | M6 |
| | `shift-c` | Crop mode | next round |
| | `cmd-1` / `cmd-2` / `cmd-3` | Toggle left dock / timeline / right dock | M0 |
| Menu-owned | `cmd-n` `cmd-o` `cmd-s` `shift-cmd-s` `cmd-i` `cmd-e` `cmd-,` `cmd-w` `cmd-q` | Reserved for NSMenu — **do not also bind as KeyBindings** | M0 |

**Conflict check against today's 10 bindings** (`editor_view.rs:70-86`): ⌘Z, ⇧⌘Z, Backspace, Delete,
Space, ⌘C, ⌘V keep their meaning. **Two break, both correct:** `s` stops being Split and becomes Toggle
Snapping (S for snapping is universal across Premiere/Resolve/Vegas, and snapping is toggled far more
often than split; Split moves to ⌘K, which is Premiere's Add Edit and what users' hands already do);
`left`/`right` stop seeking ±1 **second** and step ±1 **frame**. No new binding collides. ⌘-click
(toggle select) vs ⌘-drag (ripple insert, later) is unambiguous — one is a click, one is a drag — and
both are documented in the shortcuts sheet, which has a "changed" section.

### 5.3 Visual system

**Five rules.** They exist specifically to counter what GPUI's constraints push you toward — without
them, the lazy path is "flat dark boxes with a blue accent everywhere", which is the generic IDE theme.

1. **Neutral chrome, coloured data.** Every surface is S ≤ 6 %. All saturation belongs to
   content-bearing things: clip rails, waveforms, keyframes, the playhead, meters, the accent. A panel
   background with visible hue is a bug. (Today's `#16161d` / `#2d3a66` purple-blue cast is exactly
   what makes a UI read as a hobby dark theme — and next to the viewer it biases colour judgement.)
2. **One accent, spent carefully.** Accent means "the app is pointing at the interactive or animated
   thing". Budget: ≤2 accent-coloured things visible per panel at rest. Buttons are **not** accent by
   default — only the single primary action in a dialog. A toolbar of blue buttons is the #1
   generic-dark-theme tell.
3. **Hairlines over boxes.** Panels are separated by a 1 px `border_subtle` and a lightness step, not
   by rounded cards with gaps. The inspector is rows on one surface with 1 px separators.
4. **Fixed-height chrome on a 4 px grid; media surfaces are theme-invariant dark.** Nothing in the
   chrome is sized by its content.
5. **Motion only explains state change, and only ≤120 ms.** Allowed: segmented thumb slide, popover
   fade, snap-indicator flash, drop indicator, meter ballistics. **Forbidden:** hover transitions on
   buttons (they lag under fast mouse movement in a dense UI and read as cheap) and *any* animation on
   the timeline during playback or drag.

Corollary: hierarchy comes from size + weight + text **role**, never from bolding body text.

**The opinionated call: media surfaces are theme-invariant.** The viewer pit (`#1b1b1b`, pure neutral)
and the **entire timeline panel** — headers, ruler, lanes, clips, waveforms — stay dark and identical
in both appearances. Light theme flips only chrome: command bar, media panel, inspector, dialogs,
menus. Three reasons converge: (a) a bright or hue-tinted surround shifts your judgement of exposure
and white balance in the frame, which is not negotiable in a colour tool; (b) **measured** — light-tint
clip bodies against a light lane come out at 1.01–1.10:1 contrast, i.e. invisible, and fixing that
needs a second full clip palette; (c) the settings pane exposes per-clip-kind colour pickers, and one
palette means the user picks a colour once, not once per theme. Figma and Premiere do the same. Escape
hatch if it becomes a real complaint: a third appearance ("Light — all surfaces"), built on demand only.

**Dark tokens** (every fg/bg pair below was run through a WCAG contrast script).

| Role | Hex | Notes |
|---|---|---|
| `bg_sunken` | `#0b0b0e` | lanes, input troughs, list wells |
| `bg_app` | `#0e0e11` | behind panels |
| `bg_panel` | `#15151a` | media / inspector / toolbars |
| `bg_raised` | `#1e1e24` | secondary buttons, input fill on hover |
| `bg_elevated` | `#26262e` | popovers, menus, dialogs, tooltips |
| `border_subtle` / `border_default` / `border_strong` | `#202027` / `#2e2e37` / `#4a4a56` | |
| `text_primary` | `#eceef2` | 15.7:1 on panel |
| `text_secondary` | `#a9adb8` | 8.1:1 |
| `text_muted` | `#8b90a0` | 5.7 panel / 4.7 elevated |
| `text_disabled` | `#565a66` | 2.6:1 — **deliberately fails AA**, see rule below |
| `text_on_accent` | `#ffffff` | |
| `accent` | `#4c8dff` | 5.69:1 — text, icons, indicators |
| `accent_fill` | `#2f6fe0` | white on it = 4.7:1 — **filled buttons only** |
| `accent_subtle` | accent @ 18 % | |
| `focus_ring` | `#7db3ff` | 8.5:1 |
| `danger` / `danger_fill` | `#ff6b5e` / `#c8382c` | |
| `warning` / `success` / `info` | `#f0a92e` / `#45c88a` / `#5fb8e8` | all ≥6.5:1 on panel |
| `overlay_hover` / `overlay_active` | white @ 6 % / 10 % | **alpha, not opaque variants** |
| `scrim` / `hatch` | black @ 55 % / white @ 9 % | |

The alpha state-layer decision is what holds the token count at ~40 instead of ~120 — one
`overlay_hover` composes correctly over panel, raised, elevated, a clip body and a filmstrip. Splitting
`accent`/`accent_fill` is forced by measurement: white on `#4c8dff` is 3.2:1 and fails.

> **`text_disabled` rule.** It is 2.6:1 and fails AA on purpose. Therefore a disabled control must also
> be non-interactive (no `.on_click`, `cursor_not_allowed`) and must **never** be the only way a user
> learns something is unavailable — a tooltip explains why.

**Light tokens** (chrome only; `Theme::light()` ships as a stub returning dark this round).

| Role | Hex |
|---|---|
| `bg_sunken` / `bg_app` / `bg_panel` / `bg_raised` / `bg_elevated` | `#e6e8ec` / `#f1f2f5` / `#fafbfc` / `#eceef2` / `#ffffff` |
| `border_subtle` / `default` / `strong` | `#e3e4e9` / `#d0d2d9` / `#a8abb5` |
| `text_primary` / `secondary` / `muted` / `disabled` | `#15171c` (17.3:1) / `#4d5260` (7.5) / `#656b79` (5.2) / `#a5a9b3` |
| `accent` / `accent_fill` / `focus_ring` | `#1a5fd0` (5.6 as text) / `#1f6feb` (white = 4.63) / `#1f6feb` |
| `danger` / `danger_fill` | `#c2291f` / `#c8332a` |
| `warning` (text / fill) / `success` / `info` | `#8a5a00` / `#d98a04` / `#12724a` / `#0f6f9e` |
| `overlay_hover` / `overlay_active` / `hatch` | black @ 5 % / 8 % / 10 % |

Semantic colours must be **darkened**, not reused: `#f0a92e` warning is 1.9:1 on white and unreadable.
That is the most common light-theme failure and the reason roles are per-appearance tables rather than
one palette with a computed inversion.

**Theme-invariant + content colours.**

| Role | Hex | Notes |
|---|---|---|
| `bg_viewer` | `#1b1b1b` | pure neutral, both themes |
| `bg_timeline` | dark | both themes |
| `playhead` | `#ff4d4a` | 6.0:1 on lane, ≥3.3:1 on every clip body. **Red is reserved** — no clip kind may use the red band |
| `snap_guide` | `#ffffff` | 1 px full-lane-height, flashed 120 ms |
| `canvas_guide` | `#ff4dd2` | magenta — the Figma convention; distinct from playhead and every clip hue |
| clip rail: Video / Image / Text / Audio / Shape / Nested | `#4c9be8` / `#a277e8` / `#e8b14c` / `#3fc98d` / `#8a93a6` / `#e060a8` | hue-separated ≥55° |

Each clip kind is a **seed rail colour**; body, selected-body and waveform are **derived**, not
authored: `body = (h, s*0.55, 0.22)`, `body_selected = (h, s*0.58, 0.28)`,
`waveform = (h, s*0.92, l*1.10) @ 85 %`. Verified: every rail is 5.9–10.1:1 against the lane and
3.9–5.6:1 against its own body; `text_primary` is 9.3–11.3:1 on every body. Deriving is what makes the
settings colour picker shippable — the user picks one hue and label contrast survives it (clamp the
seed to L ∈ [0.50, 0.70], S ∈ [0.10, 0.80]). **Colour is never the sole carrier of clip kind**: kind is
also an icon at ≥64 px width, the rail's position, and the track zone.

**Type.** Five sizes, three weights. `xs 10/14` (ruler minor ticks, badges), `sm 11/15` (clip labels,
section headers, tooltips), `md 13/18` (**default** — buttons, inspector, menus, rows), `lg 15/20`
(dialog titles), `xl 19/24` (headings). Weights 400 / 500 (active tab, primary button, selected row) /
600 (dialog titles, section headers). UI face = system (`.SystemUIFont`); **MONO** = SF Mono →
Menlo for **all** of: timecode, ruler, scrubbable values, durations, dB readouts, resolution/fps chips,
hex fields. 13 px base, not GPUI's 16 px `text_base` — macOS system UI is 13pt and 16 px reads as a web
app. Monospaced numbers are not decoration: during playback a proportional timecode reflows every frame
and the digits visibly jitter, which is the most amateur-looking thing a video editor can do.

> GPUI 0.2.2 has **no letter-spacing** (`TextStyle` has no such field), so uppercase section headers
> cannot be tracked out — compensate with weight 600 and a hairline rule beneath. Tabular figures *are*
> available via `FontFeatures(vec![("tnum", 1)])`. Define the scale as explicit `rems()` and call
> `.text_size(t.text.md)`, never `.text_sm()` — the built-ins map to 12/14/16 and miss 10/11/13.

**Spacing, radius, elevation.** Use GPUI's own helpers, restricted to a 9-step subset: 0, 2, 4, 6, 8,
12, 16, 24, 32 (`_5 _7 _9 _10 _11 _12+` are banned by the source-grep test). Two semantic aliases only:
`gutter` = 12, `row_gap` = 4. Radius: `none` for lanes/ruler/full-bleed, `xs` (2) for clips/badges,
`sm` (4) for buttons/inputs/tabs, `md` (6) for popovers/menus/dialogs, `full` for slider thumbs.
Today's `.rounded_md()` (6 px) on 24 px buttons and on timeline clips is the generic-web-app look, and
on a 20 px clip it eats the entire silhouette — **radius must shrink as density rises**. Elevation:
exactly three levels — e0 none (panels, buttons, clips, rows), e1 `shadow_sm` (popover, menu, tooltip,
segmented thumb), e2 `shadow_lg` (modal, drag ghost, floating value chip). Shadowing panels and buttons
is *the* tell of a generic dark IDE theme; a shadow means exactly one thing — "this floats above the
app and will go away".

**Density and hit targets.** Hit targets are declared **independently** of visual size via a
`hit_pad(n)` helper.

| Element | Height | | Element | Visual | Hit |
|---|---|---|---|---|---|
| Command bar | 44 | | Trim handle | 4 px | `min(10, width*0.3)`, `cursor_ew_resize` |
| Panel header | 28 | | Playhead | 2 px | 13 px, `cursor_col_resize` |
| Inspector / list row | 24 | | Panel splitter | 1 px | 8 px |
| Control (sm / md / lg) | 20 / 24 / 28 | | Track-height grip | 1 px | 8 px, `cursor_row_resize` |
| Ruler | 26 | | Keyframe diamond | 9 px | 16 px |
| Track lane | default 44 (min 28, max 200) | | Icon button | 14 px icon | 24×24 |
| Keyframe sub-lane | 18 | | Viewer handle | 8 px | 16 px, screen-space |

24 px rows, defended: after M14b the inspector has 40+ rows. At Figma's 32 px that is 1280 px of
scroll; at 24 px it is 960. The 44 pt guideline is a *touch* guideline; the empirical failure threshold
for a mouse is ~16 px, so 24 is a comfortable 1.5×. `window.set_rem_size(px(14/16/18))` gives a free
UI-scale lever for chrome — **but timeline geometry stays raw px**, or lane heights change when someone
bumps UI scale and clips no longer line up with the ruler.

**Clip rendering — the tier model.** A pure `clip_layout(w, h, kind, flags) -> ClipLayout` in
`vii-ui/src/timeline/clip_layout.rs` decides which layers draw.

```
T0 w<14        T1 14-43       T2 44-119            T3 w>=120
+-+            +----+         +-----------+        +----------------------+
| | solid rail |____| rail    |___________| rail   |______________________| rail 3px
| | hue        |####| body    |> interview| icon   |> interview_02  0:04:12| hdr strip
| |            |####|         |_.-^-._.-^_| wave   |######################| filmstrip
+-+            +----+         +-----------+        |_.-^-._.-^-._.-^-._.-^| waveform
                                                   +----------------------+
```

At <14 px a dark body reads as a **gap** in the timeline, not a clip — inverting to the saturated rail
is the single highest-impact rule here and keeps a 3-frame cut visible. Height tiers: `h < 28` → label
only; 28–47 → single row, media wins over label for audio/video; `h ≥ 48` → 16 px label header strip
over the media. The label **never sits on the media** — it sits in a header strip filled with the body
colour at 90 % alpha. Tier boundaries pop as you zoom; that is accepted and preferred over a crossfade
(Premiere pops too) — **do not animate the transition**.

**Clip state encoding.** Selected = 2 px `#ffffff` @92 % **inset** outline + rail brightened to
`l*1.15` (inset so selection never changes layout or clip width). Muted/hidden = body at 45 % opacity +
`pattern_slash(hatch)` overlay, and a muted audio clip draws its waveform in `text_muted`, not its kind
hue. **Offline media** = body replaced by `pattern_slash(danger)` over `bg_sunken` + a filled danger
triangle + the filename in danger text (this is M2's visual spec — do not reinvent it later).
Speed-changed = dashed rail + a mono `1.5x` badge. Has keyframes = a 1 px accent ribbon along the
bottom edge, expanding into the M14b lane. Effects present = a filled accent dot.

> Red now does three jobs — playhead, danger, offline. Contained by context: the playhead is a vertical
> line, danger appears only on buttons and dialog text, offline only as a hatch inside a clip. They
> never occupy the same visual slot. Flagged honestly rather than adding a fourth hue.

**Waveforms and filmstrips.** Two-pass in **one** `canvas()` per clip: an RMS band at 55 % alpha plus a
peak envelope line at 100 %, centred on a 1 px zero line, dB-companded, with clipped columns
(`|x| ≥ 0.999`) painted in `danger`. The RMS-band-plus-peak-line pair is what separates a professional
waveform from a bar chart — it shows loudness and transients simultaneously, which is what you cut on.
Filmstrip thumbnails render at **source** aspect (the same bug class as the Transform issue) under a
40 % black wash. Any repeated visual primitive over ~30 instances is a `canvas()` + `paint_quad`, never
divs — today's one-div-per-waveform-peak (`editor_view.rs:1888-1893`) is O(peaks × clips) and will not
survive a real timeline.

**Icons.** Lucide SVGs bundled via a `rust-embed`-backed `AssetSource`, rendered as
`svg().path("icons/scissors.svg").size(px(14.)).text_color(t.c.text_secondary)` — GPUI paints the file
as a **mask tinted by `text_color`**, so every icon inherits the token colour free, including hover and
disabled, with no font loading. Rewrite bundled copies to `stroke-width="1.75"` (Lucide's native 2 px
on a 24 px artboard reads heavy at 14 px). Hand-draw ~12 NLE-specific glyphs on the same grid:
razor-at-playhead, slip, slide, roll, ripple-delete, close-gap, sync-lock, snap-magnet, keyframe
diamond/square/circle, link-clips. **No icon font. No emoji** — delete the current fullwidth-plus and
the `"H"`/`"M"` letter toggles. Define `enum Icon` with `fn path(self) -> SharedString` so no call site
types a filename, and a test asserts every variant resolves (GPUI's `paint_svg` only `.log_err()`s a
miss and draws nothing).

**Proposed `theme.rs` → `theme/` API.**

```rust
// theme/mod.rs
pub struct Theme { pub c: Colors, pub text: TypeScale, pub clip: ClipPalette }
impl gpui::Global for Theme {}

pub struct Colors {          // ~40 semantic roles, all gpui::Hsla (never u32/Rgba)
    pub bg_app: Hsla, pub bg_panel: Hsla, pub bg_sunken: Hsla,
    pub bg_raised: Hsla, pub bg_elevated: Hsla,
    pub bg_viewer: Hsla, pub bg_timeline: Hsla,          // theme-invariant
    pub border_subtle: Hsla, pub border_default: Hsla, pub border_strong: Hsla,
    pub text_primary: Hsla, pub text_secondary: Hsla,
    pub text_muted: Hsla, pub text_disabled: Hsla, pub text_on_accent: Hsla,
    pub accent: Hsla, pub accent_fill: Hsla, pub accent_subtle: Hsla, pub focus_ring: Hsla,
    pub danger: Hsla, pub danger_fill: Hsla,
    pub warning: Hsla, pub success: Hsla, pub info: Hsla,
    pub overlay_hover: Hsla, pub overlay_active: Hsla, pub scrim: Hsla, pub hatch: Hsla,
    pub playhead: Hsla, pub snap_guide: Hsla, pub canvas_guide: Hsla, pub ruler_tick: Hsla,
}

pub struct ClipPalette { /* one seed rail Hsla per kind */ }
impl ClipPalette {
    pub fn for_kind(&self, kind: ClipKind) -> ClipColors;   // rail/body/body_selected/waveform, derived
}

impl Theme {
    pub fn dark() -> Self;
    pub fn light() -> Self;                 // stub returning dark() this round
    pub fn for_appearance(a: Appearance) -> Self;
    pub fn with_overrides(self, o: &ThemeOverrides) -> Self;
    pub fn describe(&self) -> String;       // golden-file dump of every role as hex
}

pub trait ActiveTheme { fn theme(&self) -> &Theme; }
impl ActiveTheme for gpui::App { fn theme(&self) -> &Theme { self.global::<Theme>() } }
// Context<V>: Deref<Target = App>, so `cx.theme()` works in every render fn with zero signature churn.
```

Call sites become `let t = cx.theme();` then `.bg(t.c.bg_panel)` — `Hsla: Into<Fill>`, so no `rgb()`
wrapper anywhere. Convention: bind the theme (a ~640-byte plain-data struct) at the top of each render
fn rather than holding a borrow across a `&mut self` use, or borrow-check fights `cx.listener` closures.
`element_color(kind_label: &str)` is deleted — string-keyed colour is a bug generator and blocks i18n.

---

## 6. Test and benchmark strategy

### 6.1 CI first — before writing a single new test

Today there are 66 Rust tests across 7 integration files and 6 inline `mod tests`, **zero benchmarks,
and `cargo test` is never invoked in CI** (`.github/workflows/ci.yml` has one `web` job). Worse, all 66
are ungated and the existing skip idiom is silent-green: if `GpuContext::new()` started failing
tomorrow, 9 GPU tests would pass with a line of stderr nobody reads.

```yaml
jobs:
  web:                                  # existing, unchanged
  rust-mac:                             # the real gate
    runs-on: macos-latest
    env: { VII_REQUIRE_GPU: 1, VII_REQUIRE_FFMPEG: 1 }
    steps: [ brew install ffmpeg, cargo fmt --check,
             cargo clippy --workspace --all-targets -- -D warnings,
             cargo test --workspace ]
  rust-linux:                           # proves the skip path stays green
    runs-on: ubuntu-latest              # no VII_REQUIRE_* -> GPU/ffmpeg tests skip
    steps: [ cargo test --workspace ]
```

`VII_REQUIRE_GPU` / `VII_REQUIRE_FFMPEG` turn a would-be skip into a `panic!` instead of an
`eprintln!` + `return`. "Skip because this runner has no GPU" and "skip because we broke GPU init" must
not look identical. Each capability-dependent crate gains a `capability_report()` test printing adapter
name/backend and `ffmpeg -version`, so every CI log states what actually ran. Benchmarks never run in CI.

> macOS GitHub runners expose a software/Paravirtual Metal adapter. Fine for correctness (unorm8
> results are spec-defined within our tolerances) but potentially different in edge AA. Therefore
> Tier-B pixel goldens carry an adapter allowlist in their sidecar and log-and-skip on an unrecognised
> adapter; Tier-C descriptor goldens (no GPU) always run.

### 6.2 The five tiers

Written into `AGENTS.md` so it is enforceable in review.

| Tier | What | Where |
|---|---|---|
| T1 | Pure unit | `#[cfg(test)] mod tests` inline (existing style: `view_model.rs`, `effects/src/pipeline.rs`) |
| T2 | Pure integration / cross-module | `crates/<c>/tests/<topic>.rs` (existing style: `vii-core/tests/editor.rs`) |
| T3 | Golden / snapshot | `crates/<c>/tests/golden_<topic>.rs`, data in `dep/fixtures/golden/native/<topic>/`, regenerated with `CAPTURE_GOLDEN=1` |
| T4 | Capability (real GPU / real ffmpeg) | `crates/<c>/tests/<topic>_gpu.rs` or `_ffmpeg.rs`, gated skip helper |
| T5 | Benchmarks | `crates/<c>/benches/` (criterion) and `rust/crates/bench` (`vii-bench`) — never in CI |

The boundary that matters is T2↔T4: the failure mode of this roadmap is logic quietly migrating
somewhere that needs a GPU or an ffmpeg binary to exercise, at which point it stops being tested on
every machine. Naming the file `_gpu.rs`/`_ffmpeg.rs` makes that migration visible in a PR diff. Split
`vii-core/tests/editor.rs` (592 lines, 23 tests) into `editor.rs`, `transactions.rs`,
`invariants.rs`, `planner_snap.rs`, `planner_overwrite.rs` as those land. A cheap meta-test
(`vii-ui/tests/no_logic_in_views.rs`) greps `editor_view.rs` for a deny-list of tokens that mean
policy leaked into the view (`snap`, `ripple`, `overwrite`, `_headroom`, `.clamp(` on tick math) —
crude, but it fails loudly the first time someone inlines a planner into a `cx.listener`.

### 6.3 Compositor correctness — the three-tier frame-assertion ladder

Exact pixel equality across adapters is a promise we cannot keep (unorm8 rounding, rasterization fill
rules, edge AA legitimately differ), so a strict golden becomes a test everyone learns to regenerate
without reading — worse than no test.

| Tier | What | GPU? | Use for |
|---|---|---|---|
| **A** | Invariant assertions, no golden file | yes | "an opaque Normal full-frame layer reproduces its source colour within ±1"; "pixels outside the content rect equal the background exactly"; "a 9:16 project in a 16:9 buffer has exactly N letterbox columns". Self-describing, never regenerated. **The majority.** |
| **C** | `FrameDescriptor` JSON goldens | **no** | **The default for scene-level correctness.** Serialize `scene_to_frame()` output for curated scenes to `dep/fixtures/golden/native/descriptor/<case>.json`, assert byte-equality. Catches wrong layer w/h, `blend_mode` still Normal, `mask: None` when a mask was set, missing/reordered effect passes, wrong z-order, missing letterbox, wrong keyframe sample. Runs on every machine, readable in a PR diff, zero flake by construction |
| **B** | Perceptual pixel goldens, 160×90 PNG | yes | Small and curated (~10–15 cases + ~3 per effect). Only for what pixels alone can prove: the shader itself, blend maths, feather falloff, colour space |

**Tier B metric — both must pass.** (i) *localized*: count pixels whose max channel delta > 8; fail if
that exceeds 0.2 % of pixels. (ii) *global*: mean absolute channel error ≤ 1.5/255 **and** 64-bin
luma-histogram L1 distance ≤ 0.01. The localized check catches geometric and per-region changes while
tolerating vendor noise; the global check catches a small uniform gamma/gain shift that would otherwise
slip under the per-pixel threshold everywhere at once. Neither failure mode has an escape hatch. On
failure, write `target/frame-diffs/<case>.{actual,expected,diff}.png` (diff = amplified abs delta in
red) and print the paths. Each golden carries a sidecar recording
`{adapter, backend, driver, wgpu_version, canvas, playhead_ticks}`.

```
assert_frame_matches_golden("blend/multiply_over_gradient", &frame)
  |
  +- localized:  pixels with max|dCh| > 8  ->  132 / 14400 = 0.92%   FAIL (>0.20%)
  +- global:     MAE 0.41/255  OK      luma-hist L1 0.004  OK
  +- wrote target/frame-diffs/blend__multiply_over_gradient.{actual,expected,diff}.png
  +- golden captured on: Apple M-series / Metal / wgpu 29.0.1 (adapter matches)
```

`image` is already a dependency of `vii-preview`, and the CPU readback that blade-vs-wgpu forces on
us is here an **asset**: `PreviewFrame{width, height, bgra}` is already a CPU buffer, so golden capture
is a `Vec<u8>` away.

Two anti-rot rules, both non-negotiable: **the tolerance constants live as named `const` in one helper
module with a comment stating what each buys, and any change to them is its own commit**; and **a
`CAPTURE_GOLDEN` run must be a separate commit from the code change**, so the reviewer sees the golden
diff isolated from the diff that caused it.

### 6.4 Per-area testing approach

| Area | Approach |
|---|---|
| **Project model / schema** (highest consequence, currently unguarded) | `migrate.rs` chain (`decode(json) -> Result<Project, LoadError>` walking vN→vN+1), mirroring the web app's v0..v31 chain. (1) **Migration goldens**: `dep/fixtures/golden/native/projects/v<N>.json` per version, captured from a *rich* seed; a test loads every committed vN, migrates to current, and asserts a structural summary (element count, per-element start/duration/trim, sampled transform at 3 playhead positions). The capture test **asserts the seed is rich** — every `Element` variant, every registered effect, ≥1 animated channel per animatable property — failing with "add the new field to the golden seed". (2) Round-trip equality + "unknown future version → `LoadError::UnsupportedVersion`, not a silent no-op". (3) Atomic write: an interrupted save leaves the original byte-identical |
| **Undo / transactions** | `assert_timeline_valid(&Scene)`: no overlaps within a track, every duration > 0, `trim_start < trim_end` and within source bounds, `start >= 0`, no duplicate ids, keyframe times within `[0, duration]` — asserted after **every** command in every timeline test. Plus a **proptest** harness: 1..50 random commands weighted toward destructive ones (ripple delete, overwrite move, cross-track drag, split, multi-select move), built from *live* state (real refs, real tracks, in-range starts); execute all, validate after each; undo all and assert the serialized state is byte-equal to the initial snapshot; redo all and assert equality with the post-execute snapshot. `EditorState` already derives `Serialize + Clone` and `serde_json` is already a dev-dep, so snapshot-by-serialization is free. Take proptest specifically for **shrinking** — a failing 47-command sequence with no shrinker is an unreadable artifact. The harness asserts a floor (≥60 % of generated commands returned `true` from `execute`) so a degenerate generator fails loudly instead of vacuously |
| **Interactions GPUI cannot test** | Every gesture is a pure reducer in `vii-ui/src/interaction/`: `enum PointerEvent { Down/Move/Up/Key/Cancel }`, `enum Outcome { None, Preview(PreviewState), Commit(Vec<Command>), Cancelled }`, `fn handle(&mut self, ev, geom: &TimelineGeometry, editor: &Editor) -> Outcome`. The view does exactly two things: translate the GPUI event, and match the `Outcome`. Tests drive whole gestures as event sequences against a real `Editor` and assert both the commands and the intermediate preview — no window, no GPU. `interaction/` contains **no `use gpui`**, enforced by the same grep meta-test. `TimelineGeometry` is a plain **value** constructed per frame and passed in — never a reference back into the view; if that slips and the reducer holds a `WeakEntity`, the seam is dead |
| **Audio** | Block-size invariance · null test · envelope correctness at sample resolution (a 0.5 s fade-in is exactly −6 dB at midpoint, gain composes clip × fade × track × master in that order) · preview == export byte-identical · injected-clock transport drift · meter ballistics as a pure state machine (−60 dB floor, 24 dB/s level decay, 18 dB/s peak decay, 1.5 s hold, sticky clip latch). Real-time constraint asserted, not hoped: a 512-frame block at 48 kHz with 8 clips has a hard p99 budget of 0.5 ms |
| **Video decode** | Self-identifying frames (§M9) for correctness; a pure `FrameSource` fake for cache/eviction policy under 10 000 seeks; `video_texture_count()` constant across 100 frames |
| **Export / probe** | **Test the argv, not the encoder.** `ExportOptions -> Vec<String>` and `parse_ffprobe_json` are pure with fixture coverage; one gated integration test encodes 0.5 s at 64×36 and ffprobes it; `ExportJob` state machine tested without spawning anything |
| **Effects** | Registry table tests (unique ids, `min <= default <= max`, total canonical order, every shader id resolves); param resolution at keyframe boundaries with clamping; ~3 pixel goldens per effect at min/default/max. **Capture the four current effects' goldens in M4, before any registry refactor** — that is literally the first commit of that item when it lands |
| **Keyboard / actions** | No duplicate chord within a `key_context`; every action has label + group; every action referenced by a view exists in the table; the table serializes to a golden |
| **Views** | Untestable and staying that way. The answer is that no logic lives in them |

### 6.5 Highest-risk regressions and the test that owns each

Ranked by "how long would it take us to notice".

| # | Risk | Owning test |
|---|---|---|
| 1 | Transform w/h breaks saved projects and every `"scale"` animation channel | Migration golden chain + descriptor golden per element kind + explicit keyed-`scale` migration test sampling geometry at 3 playhead positions |
| 2 | Streaming-audio rewrite introduces block-boundary artefacts or A/V drift | Block-size invariance + null test + injected-clock transport test |
| 3 | Windowed decode returns wrong frames near seeks or window edges | Self-identifying-frame test at t = 15.1 / 45 / backwards seeks |
| 4 | Batched transactions drop or mis-order patches; undo corrupts the project | Proptest undo-all/redo-all round-trip with byte-equal snapshots |
| 5 | Overwrite corrupts the timeline (overlaps, negative durations, lost clips) | `assert_timeline_valid` after every command inside the proptest harness |
| 6 | Effect-registry refactor silently changes how existing effects look | Per-effect pixel goldens **captured before the refactor** |
| 7 | Export silently regresses to silent audio or the wrong resolution | Argv unit tests + ffprobe assertion (`nb_streams == 2`, exact dimensions) |
| 8 | Render-size adaptivity + canvas zoom desyncs hit-test mapping | Pure round-trip property `screen_to_canvas(canvas_to_screen(p)) == p` within 0.5 px over random p, zoom ∈ [0.1, 8.0], pan, aspect, panel size |
| 9 | Per-frame cost creeps past 60 fps as masks and effects land | `vii-bench` 1080p/4-layer/4-effect case against its absolute 16.6 ms budget, run at every milestone boundary |

Risks 1, 4 and 7 are the silent-corruption class — a project fails to open, an undo eats an edit, an
export ships silent — and their common property is that nothing in the app tells you. Risk 3 is
**already broken in main**, which is why its test doubles as M9's acceptance criterion. Risk 9 is the
slow one: no single change breaks the frame budget, which is exactly why it needs a number checked at
boundaries rather than a judgement call.

### 6.6 Benchmarks

Two harnesses, split by what each can honestly measure.

**(A) criterion, in-crate `benches/`, for pure CPU work.** Low noise, and its built-in
`--save-baseline` / `--baseline` *is* the regression machinery — do not rebuild it.

| Bench | Parameters | Measures |
|---|---|---|
| `snap::resolve` | N ∈ {10, 100, 1000, 10000} targets | binary-search snap resolution per mouse-move |
| `overwrite::compute` | N ∈ {10, 100, 1000} clips | the planner that runs on every drag frame |
| `TimelineGeometry` layout + hit-test | N ∈ {1, 10, 100, 1000, 5000} clips | the per-frame timeline cost |
| `Command::lower` + `execute` + `undo` + `redo` | single element; 500-element `MoveElements` | transaction overhead |
| `EditorViewModel::build` | N clips | the pure mapping cost per render |
| `graph.fill()` | 512-frame block, K ∈ {1, 8, 32} clips | **real-time path — hard p99 budget 0.5 ms** |
| `AnimationChannel::sample` | K ∈ {2, 50, 500} keys | per-layer per-frame sampling |
| `scene_to_frame` | N layers | descriptor build |
| `mix_stereo` | — | mixed-seconds per second |
| waveform bucketing | — | import-time cost |

**(B) `vii-bench`, a new binary at `rust/crates/bench`, for wall-clock pipeline numbers criterion
cannot model.** "Export a 10 s timeline" takes seconds per iteration and the answer you want is one
number (fps), not a distribution over 100 warmed-up samples. Emits machine-readable JSON with full
hardware provenance.

```
$ cargo run -p vii-bench --release -- --suite preview

machine: darwin-25.5.0 / <cpu> / <gpu adapter> / Metal / wgpu 29.0.1
git: <sha>  harness: v1

preview frame time (p50 / p95, ms)          submit    readback    total
  640x360    1 layer   0 fx                   0.41       1.10       1.51 / 1.9
  1280x720   4 layers  1 fx                   1.72       4.83       6.55 / 8.1
  1920x1080  4 layers  4 fx                   3.90      10.42      14.32 / 19.6   <- budget 16.6
  1920x1080 16 layers  4 fx                   9.11      10.40      19.51 / 27.3   BUDGET EXCEEDED

decode  sequential 30fps clip .............. 412 frames/s
decode  seek-heavy (random 1s jumps) ....... 47 frames/s
export  1080p h264 10s ..................... 22.4 fps  (0.45x realtime)
project open / save (500 clips) ............ 84 ms / 61 ms
cold start to first rendered frame ......... 1.24 s
peak RSS, 10-min timeline playback ......... 412 MB

wrote baselines/darwin-<cpu>-<gpu>-metal.json
```

**Splitting GPU submit from CPU readback is the single most important measurement decision here.**
Blade-vs-wgpu makes readback a permanent tax, and the roadmap's only stated perf levers — render-size
adaptivity (M3) and the scrub tier (M5) — work *entirely* by shrinking readback. One blended number
tells you nothing about whether an optimisation helped, or when readback stops being the bottleneck.

**Baselines and thresholds.** Keyed **per machine**, at
`rust/crates/bench/baselines/<os>-<cpu>-<gpu>-<backend>.json`, each record carrying
`{git_sha, harness_version, timestamp, milestone, results}`. Never a single global baseline — a laptop
and a CI runner will never agree and pretending otherwise makes the numbers meaningless. **Capture the
dev Mac once now, on current HEAD, before M1 lands**, so we have a real before-picture of the prototype
pipelines.

| Class | Warn | Fail | Notes |
|---|---|---|---|
| Pure / criterion | >1.10× | >1.25× | criterion noise on these is well under 5 %, so 10 % is real signal |
| Wall-clock pipeline | >1.20× | >1.40× **after 3 consecutive runs** | thermal throttling on a laptop routinely swings 15 %; treating that as failure trains people to ignore the bench |
| Any | — | **flag unexplained improvements >1.25×** on frame-time and export | a sudden speedup usually means a case degenerated (a layer stopped drawing, a decode returned early) |

Absolute budgets, independent of any baseline: 1080p / 4-layer / 4-effect preview **< 16.6 ms** total;
512-frame audio block fill **< 0.5 ms** p99; timeline layout + hit-test for 1000 clips **< 2 ms**;
undo/redo of a 500-element transaction **< 5 ms**. Ratios tell you whether you regressed; absolutes
tell you whether you are good enough.

**Cadence, not automation.** `vii-bench` runs once at the start of a milestone and once at the end,
results committed. **A milestone is not done until that second run exists.** When no baseline matches
the machine, print "no baseline for this machine — recording a new one" rather than failing.

### 6.7 Test budget

Stated so a shortfall is visible rather than arguable. M0–M14b takes the suite from **66 to roughly
200** tests: ~45 in `vii-core` (transactions, planners, invariants, proptest), ~30 in
`vii-project` (migrations, transform math, aspect parser), ~25 in `vii-ui` (geometry, hit-test,
reducers, action table), ~20 in `vii-preview` (scene_to_frame + descriptor goldens, decode window
policy, export argv, probe parsing), ~15 in `vii-audio` (graph, block invariance, meter), plus ~15
Tier-B pixel goldens and ~5 gated capability tests.

Budget explicitly for the fact that **dep/apps/web's ripple (373 lines) and snapping (93 lines) have no
tests** — "port from dep/apps/web" is a logic shortcut, never a testing one.

Keep it fast: GPU and ffmpeg tiers are a small minority by design; proptest defaults to 64 cases (raise
via env in a nightly run, not per-PR); `cargo test --workspace` excluding T4 should stay **under 30
seconds** on the dev Mac. If it does not, that is itself a bug worth fixing.

---

## 7. Definition of done

Every parity task must satisfy all of these. This is a checklist, not a vibe — it exists because the
marginal test feels optional when forty items are queued.

**Code**
- [ ] The pure module exists, is named per §3 / the milestone, and contains **no `use gpui`** if it
      lives in `interaction/`, `geometry.rs`, `snap.rs`, `overwrite.rs` or `view_model.rs`.
- [ ] No editing policy leaked into a GPUI view. `editor_view.rs` translates events in and renders
      state out; `no_logic_in_views.rs` still passes.
- [ ] The UI dispatches a `Command` (or `apply`/`commit`), never mutates the project.
- [ ] Zero raw colour literals outside `theme/` and `ui/`; zero forbidden spacing steps
      (`no_raw_color_literals` passes).
- [ ] Any repeated visual primitive over ~30 instances is a `canvas()`, not N divs.

**Tests**
- [ ] The pure module has unit tests.
- [ ] Any **new Command** appears in the table-driven reversibility test **and** in the proptest
      generator's weighted list.
- [ ] Any **new model field** appears in the golden project seed (the capture test enforces it).
- [ ] Any **new gesture** is a reducer with an event-sequence test asserting both emitted commands and
      intermediate preview state.
- [ ] Any **new ffmpeg invocation** has an argv test.
- [ ] Any **change to the render path** updates its descriptor golden **in an isolated commit**.
- [ ] Any **new keybinding** is in `ACTIONS` (so it reaches the menu, the help grid and the tooltip)
      and the keybinding golden is updated.
- [ ] GPU/ffmpeg tests skip cleanly locally **and fail** on `rust-mac` where `VII_REQUIRE_*` is set.
- [ ] `assert_timeline_valid` runs after every command in any test that touches the timeline.

**Product**
- [ ] Every failure path calls `notify()` — no silent `let _ =`, no `if let Ok(..)` without an else.
- [ ] Every icon-only control has a `.tooltip()` carrying its label and shortcut from `ACTIONS`.
- [ ] Every disabled control is also non-interactive and explains itself.
- [ ] The demo click-path in the milestone section actually works, start to finish, on a clean project.

**Performance**
- [ ] `vii-bench` has been run at the milestone boundary and the result is committed to
      `rust/crates/bench/baselines/`.
- [ ] No absolute budget in §6.6 is exceeded, and no unexplained >1.25× improvement is unaccounted for.

**Docs**
- [ ] Any architectural finding (e.g. "hwaccel cannot be made frame-exact after seek") is recorded in
      `docs/native`, not just in a commit message.
- [ ] Any deviation from this plan is written down **here**, with the reason, before it is built.
