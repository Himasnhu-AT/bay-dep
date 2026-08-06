# vii — palmier parity execution checklist

Derived from `docs/native/palmier-gap-audit.md` (the 9-agent audit) plus the PM milestone plan,
the IA/interaction/visual design outputs and the QA strategy. This is the list we execute, in
order, top to bottom.

All paths are repo-relative to `/Users/himanshu/codes/synthai/vii`.

---

## How to work this list

1. **One task at a time.** Do not start T-0N+1 before T-0N is checked off. Tasks are ordered so
   that dependencies always come first; where a task can be reordered safely it says so.
2. **Every task ends with `cargo test --workspace` green and exactly one commit.** The commit
   message names the task id, e.g. `feat(core): batched undo transactions (T-101)`.
3. **Mark `[x]` only when the "Done when" line is literally true** — not when the code compiles.
   If you cannot satisfy "Done when", split the task and record the split here rather than
   loosening the criterion.
4. **Golden regeneration is always its own commit.** `CAPTURE_GOLDEN=1` runs never share a commit
   with the change that caused them, so the reviewer sees the golden diff isolated.
5. **The engine rule holds everywhere.** The UI never mutates the project; it dispatches an
   undoable `Command` (or a non-undoable select). Pure logic lives in a testable module, never in
   a GPUI view. If a task tempts you to put a planner inside a `cx.listener`, you have the wrong
   seam — go back to the reducer.
6. **GPU/ffmpeg-dependent tests skip gracefully when the capability is absent** (existing
   convention), but on a runner with `VII_REQUIRE_GPU=1` / `VII_REQUIRE_FFMPEG=1` a skip is a
   hard failure. That gate is T-002; do not write capability tests before it exists.
7. **When a task says "port from `dep/apps/web`", read the TypeScript, port the *logic*, and write the
   Rust tests from scratch.** `dep/apps/web`'s ripple (373 lines) and snapping (93 lines) have no
   tests. Porting is a logic shortcut, never a testing shortcut.

---

## Progress

| Milestone | Name | Tasks | Status |
|---|---|---|---|
| **M0** | Foundations: CI, tokens, geometry, feedback, shell primitives | 16 | ◐ in progress (5/16) — T-001 CI, T-002 capability gating, T-008 geometry (module landed, call sites not yet migrated), benchmarks, and a minimal T-009 status line (toolbar message on export/save/probe failure; no toast stack yet) |
| **M1** | Undo transactions + a save that cannot lose your work | 8 | ☐ not started |
| **M2** | Honest media: real metadata, real library, named offline files | 9 | ◐ in progress (1.5/9) — T-201 probe parser done; import uses the real probed duration, but MediaAsset does not yet carry metadata and probing is still synchronous |
| **M3** | Model truth: aspect-correct transforms, real source trims, presets | 9 | ◐ in progress (0.5/9) — sources are no longer stretched (fit_contain at render time), but Transform still has one uniform `scale` and trims still do not write source in/out |
| **M4** | Free GPU wins: 17 blend modes, soft edges, colour cards | 6 | ◐ in progress (2/6) — 17 blend modes wired end-to-end + inspector control; masks crate still dead (`mask: None`) |
| **M5** | A transport you can actually drive | 6 | ☐ not started |
| **M6** | A timeline you can navigate, with real track headers | 8 | ☐ not started |
| **M7** | Multi-select, link groups and snapping | 6 | ☐ not started |
| **M8** | Clips stop overlapping: cross-track drag and overwrite | 6 | ☐ not started |
| **M9** | Video decode that survives a real clip | 6 | ◐ in progress (3/6) — plan_decode covers a clip's full duration within a memory budget at the source **display** aspect; decode now runs on a worker thread (placeholder while pending, export awaits), failures are terminal, and a global LRU byte budget bounds the cache. Still whole-clip in RAM: a long clip is a low-fps proxy, and windowed/streaming decode is not started |
| **M10** | Audio that is actually a mix | 5 | ☐ not started |
| **M11** | Streaming audio mixer and real waveforms | 9 | ☐ not started |
| **M12** | An export you can trust | 7 | ☐ not started |
| **M13** | A viewer you can edit in | 6 | ☐ not started |
| **M14** | An inspector that tells the truth | 6 | ☐ not started |
| | **Wave 1 total** | **113** | |
| **W2** | Wave 2 backbone (next round, coarser tasks) | 13 | ☐ not started |

Update the status column as milestones close: `☐ not started` → `◐ in progress (n/N)` → `☑ done`.

---

## Contradictions between the design outputs, and how they are resolved here

The four design outputs disagree in nine places. Each is decided once, below, and the rest of this
document follows the decision.

| # | Conflict | Decision | Why |
|---|---|---|---|
| 1 | Brief says GPUI 0.2.2 has **no scroll container, no text input, no menu bar**. IA and visual-system both read the vendored crate and found `.overflow_scroll()` + `ScrollHandle::set_offset` + `uniform_list`, `EntityInputHandler`/`ElementInputHandler` (+ a 746-line `examples/input.rs`), `cx.set_menus`, `on_drag`/`on_drop`, `canvas()`, `anchored()`/`deferred()`, `svg()`, `.tooltip()`, `pattern_slash()`. | **Trust the source reads**, but gate on T-003, which re-verifies every claimed API against the vendored crate and records the result. Anything that fails verification falls back to the brief's assumption and the dependent task is re-scoped. | The claims are specific and file/line-cited. But they change effort estimates on ~8 tasks, so a 1-hour verification pass is cheap insurance. Pinch-to-magnify genuinely does not exist — record it as a known gap. |
| 2 | Timeline scrolling: use GPUI's scroller, or own the offset? | **Own `scroll_x`/`scroll_y` for the timeline; use `.overflow_y_scroll()` for the media panel and inspector.** | Cursor-anchored zoom, scroll-to-playhead, edge auto-scroll and three-region sync all need to write the offset in the frame they read it. Where we gain nothing from owning it, take GPUI's inertia for free. |
| 3 | Snapping: PM says "port from `dep/apps/web`". QA and the interaction agent say `dep/apps/web`'s snapping is thin (29-line resolve, 15-line threshold, no hysteresis, no multi-probe, no tests). | **Take the `SnapPoint { time, kind, element_id, track_id }` shape and the source-registry idea from `dep/apps/web`; write the algorithm fresh** using palmier's documented sticky multiplier (2.5×), per-target-kind thresholds and multi-probe. Write all tests from scratch. | Porting a thinner implementation and then rewriting it is strictly worse than writing the real one once. |
| 4 | Keyframe lane location: audit says palmier docks a KeyframesPanel next to the inspector; IA argues for the timeline. | **Timeline.** The inspector keeps only the per-row `‹ ◇ ›` stamp/nav control. | A keyframe lane needs a time axis. Putting one in a 320px inspector means a second ruler, a second px↔ticks mapping, a second zoom and a second scroll offset — two sources of truth for "where is time". |
| 5 | PM's plan starts at M1; IA says a Tier 0/Tier 1 substrate (tokens, notifications, command table, geometry, TextField, overlay layer) must exist before any Wave 1 UI; QA says CI must exist before any test. | **Insert M0.** It is invisible to users and it is not optional: without it, five features each hand-roll a worse text field, a worse error path and their own hex literals. | Named blockers, not preference. IA: "sequencing them first converts three XL items into L items." |
| 6 | `ScrubbableNumber` is in PM's M14; IA and visual-system both say it is the *first consumer* of M1's apply/commit triad and a prerequisite for text, colour and audio work. | **Build it in M1 (T-108), not M14.** M14 then only consumes it. | It halves M14, the biggest bundle in the plan, and every inspector task after M3 wants it. |
| 7 | `link_group` (linked A/V) is table-stakes per the cross-cutting critic and the interaction agent, and must land *before* multi-select/cross-track/ripple. It appears in no PM milestone. | **Add T-703 in M7**, before M8. Ship the model field, `LinkElements`/`UnlinkElements`, and selection-time expansion. Defer the detach-audio UI. | Expansion at selection time makes move/trim/delete/ripple link-correct for free. Retrofitting it after M8 means reworking M8. Honest note: our model is less exposed than palmier's, because M10 gives `VideoElement` its own audio, so a video import stays one element. |
| 8 | Interaction agent designs three modal tools (V/C/T), ripple-insert on Cmd-drag, and crop mode. PM's cut list defers tools, slip/slide/roll, ripple and crop to the next round. | **Parked for Wave 2.** M8 ships overwrite-only drops — **do not bind Cmd-drag to ripple-insert yet.** The keymap table (T-010) *reserves* V/C/T and the ripple chords so they cannot be taken by something else. | Keeps M8 finishable. The reservation costs nothing and prevents a keymap break later. |
| 9 | PM cut list: "theme.rs stays 28 hardcoded dark hexes and there is no light mode". Visual-system: the token layer must land before the ruler / numeric field / keyframe lane. | **The token *roles* layer lands in M0. `Theme::light()` ships as a stub returning dark.** | The cut is about light mode, not about tokens. Restructuring at 11 constants and one 2000-line view is an afternoon; after Waves 1–2 it is a multi-week sweep. |

---

# M0 — Foundations

Nothing here is user-visible except the menu bar and the toasts, and it is still first. Sixteen
tasks. Do not skip any of them; every one is named as a blocker by at least two of the four design
outputs.

### [ ] T-001 — Add a Rust job to CI

- **Files:** `.github/workflows/ci.yml`
- **Do:**
  - Add `rust-mac` (`macos-latest`): `brew install ffmpeg`, then `cargo fmt --check`,
    `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, with
    `VII_REQUIRE_GPU=1` and `VII_REQUIRE_FFMPEG=1` in `env`.
  - Add `rust-linux` (`ubuntu-latest`): `cargo test --workspace` with **no** `VII_REQUIRE_*`, to
    prove the skip path stays green.
  - Leave the existing `web` job untouched.
- **Tests:** the whole existing 66-test suite must pass on both runners.
- **Done when:** a PR shows three CI jobs and `cargo test --workspace` output appears in the log.
  Today `cargo test` is never invoked in CI at all.

### [ ] T-002 — Capability gating: turn silent skips into failures where a capability is required

- **Files:** new `rust/crates/gpu/src/test_support.rs` (or a small shared `rust/crates/test-support`
  crate), used from `rust/crates/compositor/tests/native_gpu.rs`,
  `rust/crates/vii-preview/tests/render.rs`, `rust/crates/vii-audio/tests/*.rs`
- **Do:**
  - Add `require_gpu() -> Option<GpuContext>` and `require_ffmpeg() -> bool`: if the capability is
    missing **and** `VII_REQUIRE_GPU` / `VII_REQUIRE_FFMPEG` is set, `panic!` with the reason;
    otherwise `eprintln!("skipping: …")` and return `None`.
  - Replace every existing `let Some(ctx) = try_context() else { … return }` with the helper.
  - Add `#[test] fn capability_report()` in `compositor`, `vii-preview` and `vii-audio`
    printing adapter name + backend and `ffmpeg -version`.
- **Tests:** the helper itself; plus every migrated test still passes locally.
- **Done when:** running the suite with `VII_REQUIRE_GPU=1` on a machine with the GPU disabled
  fails loudly instead of printing nine skip lines and exiting 0.

### [ ] T-003 — Verify the GPUI 0.2.2 capability surface and record it

- **Files:** new `docs/native/gpui-0.2.2-capabilities.md`
- **Do:**
  - Against the vendored crate (`~/.cargo/registry/src/*/gpui-0.2.2`), confirm or refute each API:
    `.overflow_scroll()/.overflow_x_scroll()/.overflow_y_scroll()`, `ScrollHandle::set_offset`,
    `uniform_list`, `list`, `EntityInputHandler` + `ElementInputHandler` + `Window::handle_input`,
    `cx.set_menus` + `MenuItem`, `.on_drag/.on_drop/.drag_over/.can_drop` + `ExternalPaths`,
    `canvas(prepaint, paint)` + `paint_quad`/`paint_path`/`paint_image`/`paint_svg`,
    `anchored()`/`deferred()`, `.tooltip()`, `.group()/.group_hover()`, `cursor_*` family,
    `window.set_cursor_style`, `pattern_slash`, `linear_gradient`, `shadow_*`, `FontFeatures`,
    `observe_window_appearance`, `TitlebarOptions`, `cx.open_window` (multi-window),
    `on_modifiers_changed`, `KeyBindingContextPredicate::Not`.
  - Record file:line for each. Record the confirmed **absences**: pinch/magnify gesture, custom
    cursor bitmaps, letter-spacing on `TextStyle`, any accessibility layer, any component library.
  - For each refuted API, list the tasks in this document it invalidates.
- **Tests:** none (documentation task).
- **Done when:** the doc exists, every row is confirmed/refuted with a file:line, and any refuted
  row has a follow-up note written into the affected task here.

### [ ] T-004 — Theme token layer

- **Files:** new `rust/crates/vii-ui/src/theme/{mod.rs, palette.rs, tokens.rs, clip.rs}`,
  replacing `rust/crates/vii-ui/src/theme.rs`
- **Do:**
  - `struct Colors` with the ~40 semantic roles from the visual system (surfaces `bg_app`/
    `bg_panel`/`bg_sunken`/`bg_raised`/`bg_elevated`; borders subtle/default/strong; text
    primary/secondary/muted/disabled/on_accent; `accent` **and** `accent_fill` as separate tokens;
    `focus_ring`; danger/warning/success/info + `*_fill`; overlay_hover/overlay_active/scrim/hatch
    as **alpha** layers, not opaque variants). Store `gpui::Hsla`, never `u32`.
  - `impl Global for Theme`; extension trait `ActiveTheme { fn theme(&self) -> &Theme }` on
    `gpui::App` so `cx.theme()` works from any render fn.
  - `Theme::dark()` with the verified dark values; `Theme::light()` **as a stub returning dark**
    (see contradiction #9). `bg_viewer` and `bg_timeline` are constant across both appearances.
  - `ClipPalette::for_kind(ClipKind) -> ClipColors` deriving body/selected/waveform from one seed
    rail hue by formula. Delete `element_color(kind_label: &str)`; key off a `ClipKind` enum.
  - Delete `hex_to_rgb`'s silent grey fallback; return `Result`.
- **Tests:** `rust/crates/vii-ui/src/theme/tests.rs` —
  (a) `contrast()`: a declared table of (fg, bg, min_ratio) triples, ≥4.5:1 for text roles and
  ≥3:1 for focus/indicator roles, asserted for both appearances;
  (b) `role_parity()`: `dark()` and `light()` produce structurally identical role sets;
  (c) clip-palette derivation keeps label contrast ≥4.5:1 for any seed clamped to L∈[0.50,0.70],
  S∈[0.10,0.80].
- **Done when:** `cargo test -p vii-ui theme` passes and `theme.rs` no longer exists.

### [ ] T-005 — Migrate `editor_view.rs` to tokens and lock it with a lint test

- **Files:** `rust/crates/vii-ui/src/editor_view.rs`, new
  `rust/crates/vii-ui/tests/no_raw_style_literals.rs`
- **Do:**
  - Mechanical sweep: every `rgb(0x…)` / `rgba(0x…)` becomes `cx.theme()` role lookup. Bind
    `let t = cx.theme().clone();` at the top of each render fn rather than holding a borrow.
  - Radius sweep: `rounded_none` for lanes/ruler, `rounded_xs` (2px) for clips/badges,
    `rounded_sm` (4px) for buttons/inputs/tabs, `rounded_md` (6px) for popovers/dialogs. The
    current `rounded_md` on 24px buttons and on clips is wrong at both sizes.
  - Restrict spacing to the 9-step subset (0, 0p5, 1, 1p5, 2, 3, 4, 6, 8).
- **Tests:** `no_raw_style_literals.rs` — `include_str!` each view module and assert zero
  occurrences of `rgb(0x`, `rgba(0x`, `hsla(` outside `theme/` and `ui/`; same test bans the
  forbidden spacing steps (`_5 _7 _9 _10 _11 _12`).
- **Done when:** the lint test passes and the app renders visually unchanged.
- **Sequencing note:** land this as its own commit at a clean point — it is a large mechanical diff
  and will conflict with any in-flight UI branch.

### [ ] T-006 — `ui/` primitive layer

- **Files:** new `rust/crates/vii-ui/src/ui/{mod.rs, button.rs, row.rs, panel.rs, badge.rs, tooltip.rs, segmented.rs, toggle.rs}`
- **Do:**
  - `button` variants: primary (`accent_fill` + white, at most one per dialog), secondary
    (`bg_raised` + border), **ghost** (transparent, the default for toolbars), danger, toggle-on
    (`accent_subtle` + `accent` border). Heights 20/24/28. Disabled controls get `text_disabled`,
    `cursor_not_allowed` and **no `.on_click` attached at all**.
  - `icon_button`: 24×24 ghost around a 14px icon, **always** carrying `.tooltip()` with
    `"Label ⌘K"` — the shortcut string comes from the T-010 table, never a literal.
  - `row` (24px, `.group("row")` so a hover-revealed reset works), `panel_header` (28px),
    `badge`, `segmented` (22px pill in a `bg_sunken` trough, `shadow_2xs` thumb), `toggle`.
  - `hit_pad(n)` helper: wraps a visual in a transparent larger interactive div. Hit targets are
    declared independently of visual size.
- **Tests:** none directly renderable; the lint test from T-005 must now show `editor_view.rs`
  calling `.bg()`/`.border_color()`/`.text_color()` **zero** times.
- **Done when:** the toolbar, media tiles and inspector rows are built from `ui/` primitives and
  the T-005 lint passes at zero.

### [ ] T-007 — Icons: embedded Lucide SVGs

- **Files:** new `rust/crates/vii-ui/assets/icons/*.svg`, new
  `rust/crates/vii-ui/src/ui/icon.rs`, `rust/crates/vii-ui/src/lib.rs`
- **Do:**
  - Add a `rust-embed`-backed `AssetSource`, wired with `Application::new().with_assets(...)`.
  - Bundle the Lucide set we need, rewritten to `stroke-width="1.75"`. Hand-draw the ~12
    NLE-specific glyphs on the same 24-grid: razor-at-playhead, slip, slide, roll, ripple-delete,
    close-gap, sync-lock, snap-magnet, keyframe diamond/square/circle, link-clips.
  - `enum Icon { … }` with `fn path(self) -> SharedString` so no call site types a filename.
  - Delete the emoji/fullwidth glyphs currently in the UI (`"＋ Scene"`, the `"H"`/`"M"` letter
    toggles).
- **Tests:** `icon_assets_resolve()` — every `Icon` variant loads from the embedded `AssetSource`.
  (`paint_svg` only `.log_err()`s a miss, so a typo is otherwise invisible at runtime.)
- **Done when:** the toolbar renders icons via `svg().path(Icon::X.path()).text_color(...)` and the
  resolve test passes.

### [ ] T-008 — `geometry.rs`: the one owner of px ↔ ticks ↔ frames

- **Files:** new `rust/crates/vii-ui/src/geometry.rs` (GPUI-free), used from
  `rust/crates/vii-ui/src/editor_view.rs`
- **Do:**
  - `ticks_to_px`, `px_to_ticks`, `quantize_to_frame(MediaTime, Fps)`, `frame_of`,
    `visible_window(scroll, pps, width) -> Range<MediaTime>`, `tick_ladder(pps) -> (major, minor, labels)`,
    `format_timecode(MediaTime, Fps) -> String` (HH:MM:SS:FF, drop-frame aware),
    `zoom_at(scroll, pps, cursor_x, factor, min, max) -> (scroll, pps)`,
    `fit_rect(viewport, canvas_aspect, zoom, pan) -> Rect<f32>`,
    `track_y_offsets(&[TrackRow]) -> Vec<f32>` (prefix sum), `clamp_scroll`.
  - Every conversion takes the scroll offset explicitly. There is no zero-scroll variant.
  - Add a `TrackedBounds` helper: `Rc<Cell<Bounds<Pixels>>>` written by an absolutely-positioned,
    zero-layout-impact `canvas()` child, so views can learn their laid-out window-space bounds.
- **Tests:** inline `#[cfg(test)] mod tests` — round-trip `px_to_ticks(ticks_to_px(t)) == t`;
  tick ladder produces ≥80px between labelled ticks across pps 8..400; `format_timecode` against
  the standard NTSC vectors including 30000/1001; `zoom_at` keeps the time under the cursor fixed
  (8 cases); `fit_rect` letterboxes 9:16 in 16:9 and pillarboxes 16:9 in 9:16;
  `quantize_to_frame` is lossless at 24/25/30/60 and 30000/1001 (4004 ticks/frame).
- **Done when:** no arithmetic converting pixels to time exists anywhere in `editor_view.rs`.

### [ ] T-009 — Notifications: status bar + toast stack

- **Files:** new `rust/crates/vii-ui/src/notifications.rs`,
  `rust/crates/vii-ui/src/editor_view.rs`
- **Do:**
  - `Notifications { toasts: Vec<Toast>, jobs: Vec<Job> }` on `EditorView`, one `fn notify(&mut self, Toast)`
    entry point, one `fn job(&mut self, Job)`.
  - 24px status bar: left = transient hint / current refusal reason; right = one row per active
    background job (label, determinate progress, cancel) + a bell badge with an unread error count.
  - Toast stack via `deferred(anchored().position(bottom_right).child(stack))`: max 3 visible +
    "N more"; info auto-dismisses at 6s (`cx.spawn` + `Timer::after`); errors are sticky with ✕ and
    an optional action button (`Relink…`, `Show in Finder`, `Retry`).
  - Rule, written into the module doc: a toast is for something the user must know that they did
    not just cause. Successful saves get a status-bar flash, not a toast.
- **Tests:** pure `notifications.rs` unit tests — cap at 3 visible with an overflow count, expiry
  ordering under a fake clock, error toasts never auto-dismiss.
- **Done when:** a manually-injected error toast renders above the viewer and the docks, and a
  fake 5-second job renders a determinate bar in the status bar with a working cancel.

### [ ] T-010 — One command table driving keymap, menus, tooltips and help

- **Files:** new `rust/crates/vii-ui/src/actions.rs`, `rust/crates/vii-ui/src/lib.rs`,
  `rust/crates/vii-ui/src/editor_view.rs` (replaces `key_bindings()`)
- **Do:**
  - `pub const ACTIONS: &[ActionDef]` with `{ id, label, group, chord, key_context, description }`.
    One loop produces `Vec<KeyBinding>`; the same slice renders the shortcuts help grid and feeds
    `icon_button`'s tooltip.
  - Bind letter and Cmd-letter actions with the predicate `"Editor && !TextEntry"`. Delete the
    root `key_context(if editing_text { "TextEdit" } else { "Editor" })` swap; every text-entry
    element declares `key_context("TextEntry")` on itself.
  - Enter the full map from the interaction design: transport (Space, K/L/J, arrows ±1 **frame**,
    Shift+arrows ±1s, up/down edit points, Home/End, I/O, Shift-I/O, Opt-X, Shift-Cmd-L), selection
    (Cmd-A, Shift-Cmd-A, A, Shift-A), edit (Cmd-K split, Shift-Cmd-K, Backspace lift,
    Shift-Backspace ripple delete, Cmd-C/X/V/D, Cmd-Z/Shift-Cmd-Z, Opt-arrows nudge, Q/W, Cmd-L),
    view (=/-, Shift-Z, S snapping, Shift-C crop). **Reserve** V/C/T (tools) and the ripple chords
    with a `parked: true` flag so nothing else claims them.
  - Two deliberate breaks, both recorded in the doc's "changed" section: `s` stops being Split and
    becomes Toggle Snapping (Split moves to Cmd-K); arrows step one **frame**, not one second.
  - Reserve for the menu bar and do **not** bind as `KeyBinding`s: ⌘N ⌘O ⌘S ⇧⌘S ⌘I ⌘E ⌘, ⌘W ⌘Q.
- **Tests:** `rust/crates/vii-ui/tests/actions.rs` — no duplicate chord within a `key_context`;
  every action has a non-empty label and group; the table serializes to
  `dep/fixtures/golden/native/keybindings/default.json` and matches (drift guard, mirroring the
  existing `dep/fixtures/golden/keybindings/default.json` on the web side).
- **Done when:** `key_bindings()` is gone, the table is the only source, and the golden exists.

### [ ] T-011 — Native macOS menu bar

- **Files:** `rust/crates/vii-ui/src/lib.rs`, `rust/desktop/src/main.rs`
- **Do:**
  - `cx.set_menus(vec![Menu{..}])` at app start for: vii / File / Edit / Clip / Sequence / View /
    Window / Help, built from `ACTIONS`' `menu_path`.
  - Register a `cx.on_action` bridge forwarding App-level menu dispatch to the focused window's
    `EditorView` — without it, menu items silently do nothing while the same keystroke works.
  - Disabled state follows action availability: do not register `on_action` for Undo when
    `can_undo()` is false.
- **Tests:** `actions.rs` gains an assertion that every `menu_path` resolves to a declared menu and
  that no two items in one menu share a title.
- **Done when:** ⌘Z from the Edit menu undoes, and Undo greys out on an empty history.
- **Sequencing note:** this must land **before** the command bar cleanup that deletes the
  Undo/Redo/Copy/Paste/Save/Load toolbar buttons, or users are stranded.

### [ ] T-012 — `TextField`: the one real text input

- **Files:** new `rust/crates/vii-ui/src/ui/text_field.rs`
- **Do:**
  - Adapt gpui's `examples/input.rs` (~250 lines of ours): `EntityInputHandler` on the entity plus
    `window.handle_input(&focus_handle, ElementInputHandler::new(bounds, entity), cx)` during
    paint, plus a small custom `Element` shaping the run and painting caret/selection quads.
  - Single-line and multi-line modes; caret; selection; mouse drag-select; double-click word
    select; ⌘A/⌘C/⌘V/⌘X; home/end; option-arrow word motion; placeholder.
  - Callbacks: `on_change` (live), `on_commit` (Enter/blur), `on_cancel` (Esc). Each field owns a
    `FocusHandle` and declares `key_context("TextEntry")`.
  - Generalise `editing_text: Option<(ElementRef, String)>` into one `text_entry: Option<TextEntry>`
    enum covering clip text, numeric click-to-type, rename and search — one focus owner, one
    commit path. Delete `handle_text_key` (editor_view.rs:175-200).
- **Tests:** pure buffer/selection tests where possible (insert, delete, word motion, select-all,
  clamp); IME correctness is verified manually and recorded in T-003's doc.
- **Done when:** typing `v` inside a focused `TextField` inserts a character and does **not** fire
  any editor action, and the `"TextEdit"` root-context hack is gone.
- **Note:** first consumer is the media search box (T-208). Ship it behind that so it has a
  demoable user on day one.

### [ ] T-013 — Extract `scene_to_frame.rs` (GPU-free scene → `FrameDescriptor`)

- **Files:** new `rust/crates/vii-preview/src/scene_to_frame.rs`,
  `rust/crates/vii-preview/src/lib.rs`
- **Do:**
  - Split descriptor building away from texture upload and decode: `fn scene_to_frame(&Scene, playhead, &ProjectSettings, &MediaIndex) -> FrameDescriptor`,
    where `FrameDescriptor` is a `Serialize` list of layers (id, kind, rect, opacity, blend, mask
    flag, ordered effect passes with resolved params, z-index) plus the canvas and background.
  - No GPU, no ffmpeg, no decode in this module.
  - `PreviewRenderer::render` becomes: build descriptor → resolve textures → composite.
- **Tests:** the existing 7 tests in `rust/crates/vii-preview/tests/render.rs` must be green
  before and after, unchanged.
- **Done when:** `scene_to_frame` is callable with no `GpuContext` and no ffmpeg binary present.
- **Sequencing note:** its own commit. Every descriptor golden in M3/M4 depends on it.

### [ ] T-014 — Golden harness: descriptor goldens + the two-part pixel metric

- **Files:** new `rust/crates/vii-preview/tests/golden_descriptor.rs`, new
  `rust/crates/vii-preview/tests/golden_frames.rs`, new
  `rust/crates/vii-preview/src/test_golden.rs`, `dep/fixtures/golden/native/`
- **Do:**
  - **Tier C (default, no GPU):** serialize `FrameDescriptor` to
    `dep/fixtures/golden/native/descriptor/<case>.json`, assert byte-equality. Seed 6–8 curated scenes
    (a stacked overlay, a text clip, a non-16:9 source, an effect chain, an animated element at
    three playhead positions).
  - **Tier B (GPU only, ~10–15 cases):** 160×90 PNGs at `dep/fixtures/golden/native/frames/<case>.png`,
    compared by **both** metrics: (i) localized — pixels with max channel delta > 8 must be ≤0.2%
    of pixels; (ii) global — MAE ≤ 1.5/255 **and** 64-bin luma-histogram L1 ≤ 0.01. On failure
    write `target/frame-diffs/<case>.{actual,expected,diff}.png` and print the paths.
  - Each pixel golden gets a sidecar `<case>.json` recording `{adapter, backend, driver, wgpu_version, canvas, playhead_ticks}`;
    on an unrecognised adapter, log-and-skip rather than fail.
  - Regeneration: `CAPTURE_GOLDEN=1 cargo test -p vii-preview --test golden_frames`, matching
    the convention already in `dep/fixtures/golden/README.md`.
  - Thresholds live as named `const`s in one module with a comment stating what each buys; changing
    one must be its own commit.
- **Tests:** the harness's own tests (a synthetically perturbed frame trips the localized metric; a
  uniform +2 gain trips the global metric).
- **Done when:** both golden suites run, Tier C passes on a GPU-less machine, and a deliberately
  broken blend mode fails Tier B with a written diff PNG.

### [ ] T-015 — `assert_timeline_valid` + the proptest scaffolding

- **Files:** new `rust/crates/vii-core/src/invariants.rs`, new
  `rust/crates/vii-core/tests/invariants.rs`; split
  `rust/crates/vii-core/tests/editor.rs` (592 lines, 23 tests) into
  `editor.rs` + `transactions.rs` + `invariants.rs`
- **Do:**
  - `assert_timeline_valid(&Scene)`: no overlapping elements within a track; every duration > 0;
    `trim_start < trim_end` and both inside the media's source bounds (skip until M3 lands trims);
    every `start >= 0`; no duplicate element ids across tracks; keyframe times within
    `[0, duration]`.
  - Add `proptest` as a dev-dependency of `vii-core`. Build a **state-aware** generator: each
    command is constructed from live state (a real element ref, a real track, a start inside the
    timeline), never from thin air.
  - Harness floor: assert ≥60% of generated commands returned `true` from `execute`, so a
    degenerate generator fails loudly instead of passing vacuously.
- **Tests:** `invariants.rs` — 1..50 random commands, `assert_timeline_valid` after each. (The
  undo/redo round-trip half lands in T-107, once transactions exist.)
- **Done when:** the proptest runs at the default 64 cases in under 2s and the generator floor
  assertion is in place.

### [ ] T-016 — The interaction reducer seam

- **Files:** new `rust/crates/vii-ui/src/interaction/mod.rs` (no `use gpui` anywhere),
  `rust/crates/vii-ui/src/editor_view.rs`
- **Do:**
  - `enum PointerEvent { Down{x,y,mods}, Move{x,y,mods}, Up{x,y,mods}, Key(Key), Cancel }` and
    `enum Outcome { None, Preview(PreviewState), Commit(Vec<Command>), Cancelled }`, with
    `fn handle(&mut self, ev, geom: &TimelineGeometry, editor: &Editor) -> Outcome`.
  - `TimelineGeometry` is a plain **value** the view constructs each frame and passes in — never a
    reference or `WeakEntity` back into the view.
  - One `fn apply_outcome(&mut self, Outcome, cx)` (~15 lines) in the view is the only place a
    gesture touches GPUI; every `on_mouse_*`/`on_key_down` handler becomes translate-then-match.
- **Tests:** new `rust/crates/vii-ui/tests/no_logic_in_views.rs` — grep `editor_view.rs` for a
  deny-list (`fn .*_headroom`, `snap`, `ripple`, `overwrite`, `.clamp(` on tick math) and assert
  zero hits; grep `interaction/` for `use gpui` and assert zero hits.
- **Done when:** the seam compiles with a trivial no-op reducer and the two grep tests pass. First
  real reducer is the ruler scrub in T-502.

---

# M1 — Undo transactions + a save that cannot lose your work

Almost no user-visible surface. Eight later milestones assume both halves exist, and every one of
M2–M14 changes the model — which is exactly what the schema version protects.

### [ ] T-101 — `Editor::transaction(name, |tx| …)` → exactly one history entry

- **Files:** `rust/crates/vii-core/src/editor.rs` (execute/apply_lowered ~L129-138),
  `rust/crates/vii-core/src/command.rs`
- **Do:**
  - Add a `Transaction` handle that collects N `ProjectPatch`es into one `Lowered.forward` and one
    reversed `backward`.
  - `Editor::transaction(name: &str, f: impl FnOnce(&mut Transaction))` pushes exactly one entry.
  - Patches must be reverted in **reverse** order; assert that explicitly in the undo path.
- **Tests:** `rust/crates/vii-core/tests/transactions.rs` — a 3-element move inside one
  transaction yields `history.len() == 1`, and one `undo()` restores all three positions.
- **Done when:** the 3-element test passes and the existing 23 core tests are unchanged.

### [ ] T-102 — Human-readable history labels

- **Files:** `rust/crates/vii-core/src/editor.rs`, `rust/crates/vii-core/src/command.rs`
  (`CommandKind` L152-178), `rust/crates/vii-ui/src/view_model.rs`
- **Do:**
  - History entries carry a `label: String` alongside `CommandKind`. Every existing `Command` gets
    a default label; `transaction()` takes its label from the caller.
  - `view_model` exposes `undo_label: Option<String>` / `redo_label`.
  - The Edit menu (T-011) reads `"Undo {label}"`.
- **Tests:** `transactions.rs` — a transaction named `"Move 3 clips"` produces
  `undo_label == Some("Move 3 clips")`.
- **Done when:** the menu reads "Undo Move 3 clips", not "Undo MoveElement".

### [ ] T-103 — `apply` / `revert` / `commit` triad, wired into EventBus coalescing

- **Files:** `rust/crates/vii-core/src/editor.rs`, `rust/crates/vii-core/src/event.rs`
- **Do:**
  - `apply(patches)` mutates with **no** history entry; `revert()` restores the exact pre-apply
    state; `commit(name)` records one labelled entry from the accumulated applies.
  - Route transient applies through the **existing** EventBus begin/mark/commit coalescing — one
    `Document` event per apply, never one per patch. Do not build a second path around it.
- **Tests:** `transactions.rs` — 100 transient applies produce 0 history entries and 100 Document
  events (not 100×N); `apply/apply/revert` restores a fixture project to byte-equal
  `serde_json::to_string` and leaves history empty; `apply/apply/commit` yields one entry.
- **Done when:** all three assertions pass.
- **Risk:** if this emits a Document event per patch, every mouse-move re-renders the preview.

### [ ] T-104 — `Project.schema_version` + a versioned decode chain

- **Files:** `rust/crates/vii-project/src/project.rs`, new
  `rust/crates/vii-project/src/migrate.rs`
- **Do:**
  - Add `schema_version: u32` to `Project` (currently `ProjectMetadata {id, name}` only, project.rs:9-16).
  - `decode(json) -> Result<Project, LoadError>` walking vN→vN+1, mirroring the web app's v0..v31
    chain. A file with **no** version field is treated as v0 and still loads. A file with a version
    **newer** than current returns `LoadError::UnsupportedVersion` — never a partial parse.
- **Tests:** `rust/crates/vii-project/tests/model.rs` — legacy no-version fixture loads; a
  `schemaVersion: 9999` fixture returns `UnsupportedVersion`; round-trip
  `Project → serde_json → Project` equality on a rich fixture.
- **Done when:** both fixture tests pass.

### [ ] T-105 — Atomic save + a surfaced load error

- **Files:** `rust/crates/vii-project/src/lib.rs` (or a new `io.rs`),
  `rust/crates/vii-ui/src/editor_view.rs` (project_path L101, Save/Load L838-849)
- **Do:**
  - Save writes `<path>.tmp` then `rename`s. Replace the bare `std::fs::write`.
  - Load surfaces failures through T-009's notification path: an error card naming the path and the
    parse error, plus a sticky toast with a `Show in Finder` action.
  - Delete the swallowing `if let Ok(project) = serde_json::from_str::<Project>(&json)` with no
    else branch.
- **Tests:** `vii-project` — a save whose rename is forced to fail leaves the original file
  byte-identical; a malformed-JSON load returns a typed error carrying the path.
- **Done when:** `grep -n 'if let Ok(project) = serde_json::from_str' rust/crates/vii-ui/src/editor_view.rs`
  returns nothing, and hand-corrupting `~/vii-project.json` then pressing Load shows an error card.

### [ ] T-106 — The golden project seed and per-version migration goldens

- **Files:** new `rust/crates/vii-project/tests/golden_migrations.rs`,
  `dep/fixtures/golden/native/projects/v<N>.json`
- **Do:**
  - Build one **rich** seed exercising every element kind, every effect, every animation channel,
    every blend mode and every settings field currently in the model.
  - `CAPTURE_GOLDEN=1` writes `v<current>.json`. The test loads **every** committed `vN`, migrates
    to current, and asserts a structural summary: element count, per-element start/duration/trim,
    and sampled transform at three playhead positions.
  - Guard against a thin seed: assert every `Element` variant, every registered effect and at least
    one animated channel per animatable property appear in the seed, failing with
    `"add the new field to the golden seed"`.
- **Tests:** the above, in `golden_migrations.rs`.
- **Done when:** `v0.json` and `v1.json` exist and the seed-coverage assertion is live.
- **Rule from here on:** every task that adds a model field also extends the seed, in the same commit.

### [ ] T-107 — proptest undo/redo round-trip

- **Files:** `rust/crates/vii-core/tests/invariants.rs`
- **Do:**
  - Extend T-015's generator: execute 1..50 commands (weighted toward destructive ones), snapshot
    `serde_json::to_string(&state)` before and after.
  - Undo all → assert byte-equal to the initial snapshot. Redo all → assert byte-equal to the
    post-execute snapshot. `assert_timeline_valid` after every step.
- **Tests:** the above.
- **Done when:** the round-trip passes at 64 cases and a deliberately broken patch reversal (swap
  the revert order) makes it fail with a shrunk ≤3-command repro.

### [ ] T-108 — `ScrubbableNumber`, the first consumer of apply/commit

- **Files:** new `rust/crates/vii-ui/src/ui/scrubbable_number.rs`
- **Do:**
  - At rest it looks like **text**: transparent, no border, value right-aligned in 13px mono with
    the unit suffix in `text_muted`. Hover: `bg_sunken` + 1px border + a 1px accent underline +
    `cursor_ew_resize`. Drag: 2px underline, a floating value chip via `anchored()`.
  - Drag-to-scrub accumulating **delta** from `on_mouse_move` in screen space (never the cursor's
    absolute position — GPUI cannot warp the cursor). Shift = ×10, Cmd = ×0.1.
  - Click without drag (below a 3px threshold) swaps in the shared `TextField` with the text
    preselected; unit-suffix stripping and range clamping on commit; invalid input shows a 1px
    danger border and commits nothing.
  - `display_multiplier` (store 0..1, show 0..100%), `value_suffix`, `display_text_override` (for
    `−∞ dB`), `—` for mixed selections.
  - Live drag calls `editor.apply(...)`; release calls `editor.commit(name)` — **one** undo entry
    per gesture. This is why it lands here and not in M14.
- **Tests:** `rust/crates/vii-ui/src/interaction/scrub_field.rs` reducer tests — modifier
  precision (1×/10×/0.1×), the 3px click/drag threshold, unit stripping, clamping, mixed-state
  rendering, and that a 200-move drag emits exactly one `Outcome::Commit`.
- **Done when:** a test-harness field can be dragged from 100 to 37 and back, and one `undo()`
  restores the original value.

---

# M2 — Honest media: real metadata, a real library, named offline files

Depends on M1. Every ffprobe/ffmpeg test must skip cleanly when the binary is absent (T-002).

### [ ] T-201 — `parse_ffprobe_json` + `MediaMetadata` (pure)

- **Files:** new `rust/crates/vii-preview/src/probe.rs`,
  `dep/fixtures/golden/native/ffprobe/*.json`
- **Do:**
  - `parse_ffprobe_json(&str) -> Result<MediaMetadata, ProbeError>` with
    `{ duration, width, height, fps: Fps (rational), has_audio, rotation }`.
  - Commit fixtures: mp4 with audio, mp4 without audio, mov with a rotation matrix, VFR, mp3, png,
    and a corrupt/empty file. Record the producing ffmpeg version in each fixture.
  - Tolerate missing optional fields **explicitly**, with a test per "field absent" case — do not
    lean on serde defaults to paper over it.
  - **Rotation is out of scope for rendering this milestone but must be recorded on the asset**, or
    M3's natural-size work will be wrong for phone footage.
- **Tests:** `rust/crates/vii-preview/tests/probe.rs` — one test per fixture; no ffmpeg needed.
- **Done when:** all seven fixtures parse to the expected struct and the corrupt one returns a
  typed error.

### [ ] T-202 — `MediaAsset` carries probed metadata, probed off-thread

- **Files:** `rust/crates/vii-project/src/project.rs` (MediaAsset L21-25),
  `rust/crates/vii-ui/src/editor_view.rs` (import_media ~L529-570)
- **Do:**
  - `MediaAsset` gains `duration`, `width`, `height`, `fps: Fps`, `has_audio`, `rotation`,
    `probe_state: Pending | Ready | Failed(String)`.
  - Probing runs on `cx.background_spawn` (one `ffprobe` call per file), pushing back via
    `cx.update`. The tile shows a pending state until it returns.
  - Extend the T-106 golden seed with the new fields.
- **Tests:** gated integration test — probe a 0.5s generated fixture and assert the parsed
  duration/dimensions; skips without ffmpeg.
- **Done when:** importing a file shows a pending tile that resolves to real duration and
  dimensions, and the GPUI thread never blocks on ffprobe.

### [ ] T-203 — The media panel renders `editor.media()`

- **Files:** `rust/crates/vii-ui/src/editor_view.rs` (media_panel ~L976, hardcoded array
  L979-981), `rust/crates/vii-ui/src/view_model.rs`
- **Do:**
  - `view_model` gains a media-list projection: `(id, name, duration_string, kind, offline, probe_state)`.
  - The panel renders it as a virtualized `uniform_list` where each **row** is a flex row of N
    tiles; `fn columns(dock_w: f32) -> usize` is a pure fn in `view_model.rs`. Compute the column
    count **before** building the list, never inside the render closure.
  - Tile: 96×54 thumbnail slot + 2-line ellipsized name + duration badge + kind glyph. Footer with
    item count and `[+ Add]`.
- **Tests:** `view_model.rs` inline tests — the media projection (name, duration string, kind,
  offline flag) and `columns()` at several dock widths.
- **Done when:** the hardcoded 3-tuple array is gone and imported assets appear in the panel.

### [ ] T-204 — Adding media to the timeline uses the real duration

- **Files:** `rust/crates/vii-ui/src/editor_view.rs` (L564, element creation L594 / L1010)
- **Do:**
  - Replace `MediaTime::from_ticks(TICKS_PER_SECOND * 4)` with the asset's probed duration.
  - `trim_end` = source duration; `trim_start` = 0.
  - Images and generated elements take an explicit no-source branch with a default duration.
- **Tests:** gated — adding a generated 3-minute fixture creates an element with
  `duration == source duration` and `trim_end == source duration`.
- **Done when:** the `TICKS_PER_SECOND * 4` hardcode no longer exists in the crate.

### [ ] T-205 — `MediaSource::External | Project` + existence-checked resolution

- **Files:** `rust/crates/vii-project/src/project.rs` (`media_path` L41)
- **Do:**
  - `enum MediaSource { External(PathBuf), Project(RelativePath) }` on `MediaAsset`; migrate
    existing absolute paths to `External` (schema bump, extend the T-106 seed).
  - `resolve(id) -> Result<PathBuf, MissingMedia>` does an existence check. Keep `expected_path(id)`
    separate from `resolve(id)`, as palmier does.
  - `missing_asset_ids(&Project) -> Vec<String>`.
- **Tests:** `vii-project` — resolution of a present file, a typed `MissingMedia` for an absent
  one, and migration of a v(N-1) fixture full of absolute paths.
- **Done when:** `media_path()`'s plain id lookup is gone.

### [ ] T-206 — Offline media is named on screen, not a coloured box

- **Files:** `rust/crates/vii-preview/src/lib.rs` (`upload_solid_placeholder` L176-186, call
  sites L293-296, L328, L331), `rust/crates/vii-ui/src/editor_view.rs`
- **Do:**
  - `PreviewRenderer::render` returns the set of unresolved media ids alongside `PreviewFrame`.
  - The viewer draws a `Media offline — <expected path>` card with a `Relink…` action button
    (T-009 toast/card surface).
  - Offline clips in the timeline render per the visual spec: body replaced by `pattern_slash` in
    `danger` over `bg_sunken`, a filled danger triangle badge, filename in `danger` text.
  - `upload_solid_placeholder` is no longer reachable for a missing file.
- **Tests:** `vii-preview` — a descriptor golden for a scene with one missing asset asserts the
  offline id set; a unit test that the placeholder path is only reachable for genuinely unsupported
  element kinds.
- **Done when:** moving a file on disk and reopening shows the path on the viewer, not a colour.

### [ ] T-207 — Relink

- **Files:** `rust/crates/vii-ui/src/editor_view.rs`,
  `rust/crates/vii-core/src/command.rs`
- **Do:**
  - `Command::RelinkMedia { asset_id, new_path }` (reversible).
  - `Relink…` opens `rfd::pick_file()`, re-points the asset, then scans the chosen folder for other
    missing assets by filename and offers to relink them **in one transaction** (T-101).
- **Tests:** `vii-core` — relinking one asset in a fixture with three missing assets found in
  the same folder produces exactly one history entry and clears all three from
  `missing_asset_ids()`.
- **Done when:** the demo works: quit, move a file, reopen, Relink…, everything resolves.

### [ ] T-208 — Multi-file import + name filter (first `TextField` consumer)

- **Files:** `rust/crates/vii-ui/src/editor_view.rs` (import_media L529)
- **Do:**
  - `rfd::pick_files()` imports N files from one dialog, probed concurrently behind a bounded
    semaphore (do **not** spawn one ffprobe per asset unbounded).
  - A case-insensitive substring filter box over name+path, built on `TextField` (T-012).
  - Sort dropdown: Name / Duration / Date added / Kind, via `anchored()` + `deferred()`.
- **Tests:** `view_model.rs` — filter and sort are pure functions over the media projection, tested
  without a window.
- **Done when:** one dialog imports five files and typing in the box filters the grid live.

### [ ] T-209 — Media manifest + self-contained project export

- **Files:** `rust/crates/vii-project/src/project.rs`,
  `rust/crates/vii-ui/src/editor_view.rs`
- **Do:**
  - Persist the manifest (versioned entries: id, name, source kind, probed metadata) as part of the
    project.
  - "Collect media": copy every resolvable `External` source into `<project>/media/`, dedupe by
    content hash, rewrite to `Project(relative)`, stage into a `.partial` directory then rename.
    Progress via T-009's job surface.
- **Tests:** `vii-project` — collect on a fixture with two assets pointing at the same file
  produces one copied file and two `Project` sources; a failed copy leaves no partial directory.
- **Done when:** a collected project opens correctly after being moved to another directory.

---

# M3 — Model truth: aspect-correct transforms, real source trims, project presets

**One schema bump covers T-301 through T-307.** Three migrations of the same file in three
milestones is worse than one. This is closer to two sittings than one; do not also try to add
slip/slide here.

### [ ] T-301 — `Transform { x, y, width, height, rotation, opacity }`

- **Files:** `rust/crates/vii-project/src/element.rs` (Transform L83-89),
  `rust/crates/vii-preview/src/lib.rs` (L334-344),
  `rust/crates/vii-core/src/command.rs` (SetTransform L78-81)
- **Do:**
  - Replace the uniform `scale` with independent `width`/`height`, normalized to the canvas.
  - Layer rects derive from `MediaAsset`'s probed natural size (M2) so a source whose aspect
    differs from the canvas letterboxes/pillarboxes instead of stretching.
  - `Command::SetTransform` gains width/height; no `scale * canvas_w` remains in `vii-preview`.
- **Tests:** descriptor goldens (T-014) for a 16:9 source, a 9:16 source and a square PNG in a 16:9
  project.
- **Done when:** `grep -n 'scale \* canvas' rust/crates/vii-preview/src/lib.rs` returns nothing.

### [ ] T-302 — The migration: legacy `scale` → width/height, `"scale"` channel → `"width"` + `"height"`

- **Files:** `rust/crates/vii-project/src/migrate.rs`,
  `rust/crates/vii-project/tests/golden_migrations.rs`
- **Do:**
  - One version step migrates both: the base transform, **and** every animation channel keyed
    `"scale"` splits into `"width"` + `"height"` channels with the same key times.
  - Derive width/height from the source's natural size where known; fall back to canvas-fit.
- **Tests:** `golden_migrations.rs` — a pre-migration fixture keeps its layer rect unchanged for a
  16:9 source and gets a **corrected** rect for a non-16:9 one; a keyframed `scale` channel
  migrates to two channels sampling to the same geometry at three playhead positions.
- **Done when:** both assertions pass and the v(N-1) golden is committed.
- **Risk:** this is a versioned, fixture-tested migration, not a serde default. Do not shortcut it.

### [ ] T-303 — `element_bounds()` as a pure function

- **Files:** `rust/crates/vii-ui/src/view_model.rs`
- **Do:**
  - `element_bounds(element, canvas, natural_size) -> Rect` including the rotated case, returning
    the un-rotated rect plus the rotation so callers can un-rotate a point into clip-local space.
- **Tests:** inline — axis-aligned, rotated 30°, off-centre, non-unit-aspect source.
- **Done when:** the timeline, the inspector and (later) the viewer all read this one function.

### [ ] T-304 — `ProjectPatch::SetElementTrim` and a `TrimElement` that trims

- **Files:** `rust/crates/vii-core/src/command.rs` (TrimElement L68-72, lowering L663-683),
  `rust/crates/vii-project/src/element.rs` (VideoElement L105-119)
- **Do:**
  - Add `ProjectPatch::SetElementTrim { trim_start, trim_end }` (self-inverting).
  - `Command::TrimElement` lowers to start + duration + **trim**.
- **Tests:** `vii-core/tests/editor.rs` — a left-edge trim of 2s advances `trim_start` by
  exactly 2s and leaves `trim_end` alone; undo restores all three fields.
- **Done when:** a left trim changes which source frames play, not just where the clip sits.

### [ ] T-305 — `AudioElement` gains trim; `SplitElement` writes both halves

- **Files:** `rust/crates/vii-project/src/element.rs` (AudioElement L157-165),
  `rust/crates/vii-core/src/command.rs`
- **Do:**
  - Add `trim_start`/`trim_end` to `AudioElement` (currently the only element with none).
  - `SplitElement` writes both halves' trims for video **and** audio.
  - Delete `editor_view.rs`'s derive-`src_start_secs`-from-the-playhead hack.
- **Tests:** `editor.rs` — split-then-concat reproduces the original source span for both video and
  audio; a split audio clip's two halves have contiguous, non-overlapping source ranges.
- **Done when:** splitting an audio clip yields two halves that play consecutive audio.

### [ ] T-306 — Trims clamp to media headroom

- **Files:** new `rust/crates/vii-core/src/timeline/headroom.rs`,
  `rust/crates/vii-core/src/command.rs`
- **Do:**
  - `source_headroom(element, &MediaAsset) -> (left, right)` using `MediaAsset.duration` (M2).
  - Text, colour cards and generated elements take an explicit **no-source** branch and trim
    freely — not a zero-headroom default.
  - `TrimElement` clamps and reports the clamp reason (fed to T-009's status bar later).
- **Tests:** `vii-core` — clamping at both edges; a text element trims past any bound; a
  clamped trim returns the limit reason.
- **Done when:** dragging a clip's edge past the end of its source stops at the source end.

### [ ] T-307 — `TrimElement` rebases animation channels

- **Files:** `rust/crates/vii-project/src/element.rs` (AnimationChannel L29-68),
  `rust/crates/vii-core/src/command.rs`
- **Do:**
  - On trim, shift key times so keys keep their **source-relative** position; synthesize a boundary
    key at offset 0 when the new left edge falls between two keys (palmier's `rebased(by:fallback:)`).
- **Tests:** `vii-core` — a left trim with two keys leaves both sampling the same values at the
  same source frames; a left trim past the first key synthesizes a boundary key.
- **Done when:** trimming an animated clip no longer desyncs its animation.

### [ ] T-308 — Aspect presets, a `W:H` parser, and `SetProjectSettings`

- **Files:** new `rust/crates/vii-project/src/aspect.rs`,
  `rust/crates/vii-core/src/command.rs`, `rust/crates/vii-ui/src/view_model.rs`
- **Do:**
  - `AspectPreset` list: 16:9, 9:16, 1:1, 4:3, 2.4:1, with exact pixel sizes.
  - `parse_aspect("W:H") -> Result<CanvasSize, AspectError>`: even dimensions, clamp 2..8192,
    preserve the short edge, gcd-reduced label, typed errors.
  - `Command::SetProjectSettings { canvas, fps }` — reversible, so canvas/fps changes join undo.
- **Tests:** `rust/crates/vii-project/tests/model.rs` — the parser across valid, odd-dimension,
  too-small, too-large and malformed inputs; gcd label reduction; preset round-trip.
- **Done when:** switching the project to 9:16 is undoable.

### [ ] T-309 — Preview render size follows the canvas aspect

- **Files:** `rust/crates/vii-ui/src/editor_view.rs` (PREVIEW_RENDER_W/H L20-21, preview div
  L1084-1085), `rust/crates/vii-preview/src/lib.rs`
- **Do:**
  - Render-target dimensions derive from `settings.canvas` aspect and the viewer's content rect
    (`fit_rect`, T-008), quantized **up** to the next multiple of 64 and capped at the project
    canvas size, so a panel resize does not recreate wgpu textures every frame.
  - Never quantize down; use a fixed high-quality filter for the small downscale to the content rect.
  - Extend the existing `preview_sig` hash to include the quantized render size.
- **Tests:** pure quantization tests in `geometry.rs`; a descriptor golden for a 9:16 project.
- **Done when:** `PREVIEW_RENDER_W`/`PREVIEW_RENDER_H` no longer exist and a 9:16 project shows a
  tall viewer.

---

# M4 — Free GPU wins: 17 blend modes, soft edges, colour cards

Scheduled here on purpose: the highest value-per-line work in the audit, gated behind one hardcoded
line each. Demoable in thirty seconds after three model milestones.

### [ ] T-401 — `Element.blend_mode` + `Command::SetBlendMode`

- **Files:** `rust/crates/vii-project/src/element.rs`,
  `rust/crates/vii-core/src/command.rs`,
  `rust/crates/vii-preview/src/lib.rs` (L346),
  `rust/crates/compositor/src/blend_mode.rs`
- **Do:**
  - Add `blend_mode` to `Element`, covering all 17 `compositor::BlendMode` variants. Extend the
    T-106 golden seed.
  - `vii-preview` passes it through; the hardcoded `BlendMode::Normal` at lib.rs:346 is gone.
- **Tests:** descriptor golden — a scene with each of the 17 modes serializes the right variant.
- **Done when:** the hardcode is gone.

### [ ] T-402 — Correct opacity semantics for non-Normal blends

- **Files:** `rust/crates/compositor/src/compositor.rs`, the layer WGSL
- **Do:**
  - For non-Normal modes, opacity fades the blend **result** against the backdrop (palmier's
    `FrameRenderer` semantics), rather than being baked into layer alpha before blending. Normal
    keeps today's behaviour exactly.
- **Tests:** `rust/crates/compositor/tests/native_gpu.rs` (GPU-gated) — Multiply at 50% opacity
  equals a 50% mix of backdrop and multiplied result within ±1; Normal is byte-unchanged against
  its existing assertion.
- **Done when:** both assertions pass and a Tier-B pixel golden exists for
  `blend/multiply_over_gradient`.

### [ ] T-403 — Activate the masks crate: edge rounding and softness

- **Files:** `rust/crates/vii-project/src/element.rs`,
  `rust/crates/vii-preview/src/lib.rs` (`mask: None` L348),
  `rust/crates/masks/src/{sdf.rs, feather.rs}`,
  `rust/crates/compositor/src/compositor.rs` (render_layer L439-478)
- **Do:**
  - Add `edge_rounding` and `edge_softness` (0..1) to `Element`. Extend the golden seed.
  - When either is non-zero, emit a `LayerMaskDescriptor` so the existing JFA feather path runs.
    Gate the whole mask path behind a non-zero check so the common path is byte-identical.
- **Tests:** GPU-gated — a softened edge produces a monotone alpha ramp across the boundary; a
  zero-softness layer produces exactly the pre-change output.
- **Done when:** the `mask: None` line is conditional and the ramp test passes.

### [ ] T-404 — Colour-card / matte elements

- **Files:** `rust/crates/vii-project/src/element.rs`,
  `rust/crates/vii-core/src/command.rs`, `rust/crates/vii-preview/src/lib.rs`
- **Do:**
  - A colour-card element created with a hex colour and an aspect preset (this is what palmier's
    `Matte.swift` actually is — a colour generator, **not** a track matte).
  - It participates in blending, opacity and edge softness like any other layer.
- **Tests:** descriptor golden for a colour card blended Multiply under a video layer.
- **Done when:** adding a dark-blue colour card and setting it Multiply visibly darkens the clip
  below.

### [ ] T-405 — Inspector controls: blend dropdown + two edge sliders

- **Files:** `rust/crates/vii-ui/src/editor_view.rs`,
  `rust/crates/vii-ui/src/view_model.rs`
- **Do:**
  - A blend-mode dropdown (`anchored()` + `deferred()` popover) and two edge sliders built on
    `ScrubbableNumber` (T-108). All three dispatch undoable commands.
- **Tests:** `view_model.rs` — the blend/edge projection for a selected element.
- **Done when:** picking Screen from the dropdown composites, and one `undo()` reverts it.

### [ ] T-406 — Perf gate: three softened layers

- **Files:** new `rust/crates/bench/` (`vii-bench` binary), `baselines/`
- **Do:**
  - Add the `vii-bench` binary with a `preview` suite reporting **GPU submit and CPU readback as
    separate numbers** (p50/p95 over 120 frames) at 640×360 / 1280×720 / 1920×1080 with
    {1,4,16} layers and {0,1,4} effect passes.
  - Capture the canonical dev-Mac baseline to
    `rust/crates/bench/baselines/<os>-<cpu>-<gpu>-<backend>.json` **on the current HEAD, before
    M3/M4 land**, if it has not been captured already.
  - Measure with three softened layers.
- **Tests:** not a `cargo test`; benches never run in CI.
- **Done when:** the baseline JSON is committed and the 1080p/4-layer/4-effect case is recorded
  against the absolute 16.6 ms (60 fps) budget.

---

# M5 — A transport you can actually drive

Depends on M1 and M3.

### [ ] T-501 — The ruler

- **Files:** `rust/crates/vii-ui/src/editor_view.rs` (timeline L1749-1806),
  `rust/crates/vii-ui/src/geometry.rs`
- **Do:**
  - A 26px ruler band above the lanes, scrolling in X with content (not in Y).
  - Ticks and monospaced timecode labels drawn in **one `canvas()`** via `window.paint_quad` and a
    shaped text run — not ~40 throwaway divs per frame.
  - Cull ticks to the visible window (`visible_window`, T-008) or a 10-minute timeline at 400px/s
    builds tens of thousands of marks.
- **Tests:** `tick_ladder` and `format_timecode` are already covered by T-008; add a culling test
  asserting the emitted tick count is bounded by viewport width / min spacing.
- **Done when:** the ruler renders a correct adaptive ladder at pps 8, 60 and 400.

### [ ] T-502 — One overlay playhead + ruler scrub (first real reducer)

- **Files:** `rust/crates/vii-ui/src/editor_view.rs` (lane+playhead L1992-2010), new
  `rust/crates/vii-ui/src/interaction/scrub.rs`
- **Do:**
  - Replace the per-lane 2px div with **one** absolutely-positioned overlay spanning the ruler and
    all lanes: a 2px line, an 11px invisible grab strip, a 12px triangular head in the ruler,
    `cursor_col_resize`.
  - Ruler mouse-**down** seeks immediately (do not wait for mouse-up) and enters scrub; drag
    scrubs; playback pauses on scrub start and does **not** auto-resume on release.
  - Implement it as a `interaction/scrub.rs` reducer per T-016; the view only translates events.
- **Tests:** `interaction/scrub.rs` reducer tests — Down seeks; Move updates; Up commits an exact
  re-seek; a scrub that started during playback leaves playback paused.
- **Done when:** clicking the middle of the ruler jumps the playhead and the picture.

### [ ] T-503 — Frame quantization at every seek entry point

- **Files:** `rust/crates/vii-ui/src/editor_view.rs` (advance_playback L755-775, arrow keys
  L2069-2076), `rust/crates/vii-core/src/editor.rs`
- **Do:**
  - Every playhead write goes through `quantize_to_frame(t, settings.fps)` (T-008). This is a new
    invariant — enforce it at **every** entry point (ruler, transport, keys, scrub bar, seek API),
    not just the ruler.
  - Arrow keys step ±1 **frame**; Shift+arrow ±1 second; Home/End jump to start/end. (This is one
    of the two deliberate keymap breaks; T-010 already records it.)
- **Tests:** `vii-core` — a seek to an arbitrary tick lands on a frame boundary at 30fps and at
  30000/1001; four right-arrows advance exactly four frames.
- **Done when:** the frame counter advances by exactly one per arrow press.

### [ ] T-504 — Timecode readout

- **Files:** `rust/crates/vii-ui/src/editor_view.rs` (transport L1756)
- **Do:**
  - Replace `format!("{:.2}s / {:.2}s")` with `format_timecode` current / total, in the mono face
    with tabular figures so digits do not jitter during playback.
- **Tests:** covered by T-008's `format_timecode` vectors.
- **Done when:** the transport reads `00:00:04:12 / 00:01:30:00`.

### [ ] T-505 — Viewer scrub bar

- **Files:** `rust/crates/vii-ui/src/editor_view.rs`
- **Do:**
  - A 14px scrub bar under the viewer mapping x → time across the **full** project duration (its
    own trivial mapping fn, not the timeline's zoomed mapping).
  - It mirrors the timeline playhead and seeks. Rule: only the timeline ruler scrolls the timeline;
    a viewer scrub seek scrolls the timeline only if the playhead leaves the visible range.
- **Tests:** the mapping fn, pure, in `geometry.rs`.
- **Done when:** dragging the scrub bar moves the timeline playhead and the picture together.

### [ ] T-506 — Scrub quality tier

- **Files:** `rust/crates/vii-preview/src/lib.rs`, `rust/crates/vii-ui/src/editor_view.rs`
- **Do:**
  - A `quality: Full | Scrub` flag **threaded into** `PreviewRenderer::render` — not a forked
    render path. `Scrub` halves the render width and skips non-essential effect passes.
  - Engage on scrub/playback start; hold ~120ms after release before re-rendering full quality, so
    it cannot flicker.
  - Key the frame/texture cache by `(media, frame, quality)` so half-res frames cannot evict
    full-res ones.
- **Tests:** pure tier-selection tests; **plus an assertion that the export path never selects a
  reduced tier**.
- **Done when:** scrubbing a 1080p project is visibly smoother and full quality returns within one
  frame of mouse-up.

---

# M6 — A timeline you can navigate, with real track headers

Depends on M5. Highest overrun risk in the plan — the scroll container is a new pattern and must be
reusable (the keyframe lane in M14 consumes it).

### [ ] T-601 — Own the timeline scroll offset

- **Files:** `rust/crates/vii-ui/src/editor_view.rs` (track_row L1938-2011)
- **Do:**
  - Add `scroll_x: f32`, `scroll_y: f32` to `EditorView` alongside `pixels_per_second`.
  - The lane area becomes an `overflow_hidden` viewport containing an absolutely-positioned content
    div at `.left(px(-scroll_x)).top(px(-scroll_y))`; the ruler translates by `-scroll_x` only; the
    header column by `-scroll_y` only. One source of truth, three views.
  - Content width = `duration_seconds * pps + tail_padding`; clamp `scroll_x` to
    `0..=(content_w - viewport_w).max(0)` with `clamp_scroll` (T-008).
  - Viewport width comes from the `TrackedBounds` `canvas()` probe (T-008).
- **Tests:** `geometry.rs` — `clamp_scroll` at both bounds and with content narrower than viewport;
  the reducer's drag-delta formula uses `(px_to_ticks(x) + scroll_now) - (px_to_ticks(x0) + scroll_at_start)`.
- **Done when:** at MAX_ZOOM every clip on a 10-minute timeline is reachable. Today they are not.
- **Live bug this fixes:** `finish_drag` (editor_view.rs:465) computes `delta_px` with **no scroll
  term**, so the moment auto-scroll exists a drag that scrolls commits the wrong delta.

### [ ] T-602 — Scrollbars, culling and edge auto-scroll

- **Files:** `rust/crates/vii-ui/src/editor_view.rs`
- **Do:**
  - Draw our own 6px horizontal and vertical scrollbars as two handler-free divs.
  - Cull clip blocks outside `visible_window` before building divs.
  - Auto-scroll during any drag: within 40px of a viewport edge, pan proportional to overshoot up
    to 1200 px/s, pumped by `window.request_animation_frame()` while a drag is live (reuse the
    `advance_playback` pattern).
- **Tests:** culling — a 5000-clip fixture emits a bounded number of blocks; the auto-scroll rate
  function is pure and tested at 0/20/40px overshoot.
- **Done when:** dragging a clip to the right edge scrolls the timeline smoothly.

### [ ] T-603 — Cursor-anchored zoom

- **Files:** `rust/crates/vii-ui/src/editor_view.rs`
- **Do:**
  - Wire `zoom_at` (T-008) to: Opt+wheel (factor `exp(delta.y * 0.0025)`, **`delta.y` only** — a
    diagonal trackpad gesture must not zoom erratically), the +/− buttons and `=`/`-` (anchored on
    the **playhead**, not the cursor), and a zoom slider. `Shift-Z` / Fit sets pps so the full
    duration fits. Cmd+wheel pans.
  - Normalize `ScrollDelta::Lines` → pixels in **one** place, or wheel scrolling feels wrong on one
    of mouse/trackpad.
  - Auto-scroll to bring the playhead to the 1/3 point on any seek landing outside the visible
    range.
  - Record in T-003's doc that **pinch-to-magnify is not available** in GPUI 0.2.2.
- **Tests:** covered by `zoom_at`'s 8 cases; add a clamp test that min pps keeps a 3-hour timeline
  above sub-pixel arithmetic.
- **Done when:** Opt+scrolling over a clip at 04:00 keeps that clip under the cursor.

### [ ] T-604 — Split `track_row` into a pinned header column + a lane

- **Files:** `rust/crates/vii-ui/src/editor_view.rs` (track_row L1938-1991)
- **Do:**
  - A 168px header column **outside** the horizontally-scrolled region, `overflow_hidden` with an
    inner content div at `.top(px(-scroll_y))` — the same translate trick as the lanes, so the two
    stay in lockstep by construction.
  - The lane component takes only the lane; header and lane are no longer one flex row.
- **Tests:** none directly; the layout is verified by T-605's offsets test.
- **Done when:** scrolling to the end of a 10-minute timeline leaves the headers pinned.

### [ ] T-605 — `Track` gains height, solo, sync_locked

- **Files:** `rust/crates/vii-project/src/track.rs` (Track L18-27),
  `rust/crates/vii-core/src/command.rs` (SetTrackHidden/Muted pattern L874-912)
- **Do:**
  - Add `height: f32` (min 28, max 200, default 44), `solo: bool`, `sync_locked: bool`, each with
    its own reversible `ProjectPatch`. Extend the T-106 golden seed.
  - Sync-lock is **stored now** even though ripple (Wave 2) consumes it later.
  - Lane layout becomes a prefix sum: use `track_y_offsets` (T-008) for hit-testing, drop targeting
    **and** rendering, so the three cannot drift.
- **Tests:** `vii-core` — each patch round-trips; `track_y_offsets` over mixed heights.
- **Done when:** `LANE_HEIGHT` is no longer a constant used for positioning.

### [ ] T-606 — Header controls and add/remove track

- **Files:** `rust/crates/vii-ui/src/editor_view.rs`
- **Do:**
  - Per track: a 3px kind-coloured strip, an editable name (`TextField`), and
    `[👁 visible][🔇 mute or 🔊 solo][🔗 sync-lock][⋮ menu]` as three-state icon buttons (off =
    `text_muted`, on = `text_primary`, actively suppressing = `warning` on `warning`-subtle).
  - `[+]` buttons at the top and bottom of the column dispatch the **existing**
    `Command::AddTrack`/`RemoveTrack` — today nothing in `vii-ui` ever dispatches them.
  - A 3px thicker divider between the video zone and the audio zone.
- **Tests:** none new; existing AddTrack/RemoveTrack core tests cover the commands.
- **Done when:** you can add an overlay track and solo the audio track from the app.

### [ ] T-607 — Per-track height resize

- **Files:** `rust/crates/vii-ui/src/editor_view.rs`
- **Do:**
  - A 5px `cursor_row_resize` handle on the header's bottom edge; drag applies live via
    `editor.apply(...)` and commits **one** entry on release via `editor.commit("Resize track")`
    (T-103).
- **Tests:** reducer test — a 40-move resize drag emits one `Outcome::Commit`.
- **Done when:** dragging a header's bottom edge makes its lane taller and one `undo()` restores it.

### [ ] T-608 — Decide and record track ordering

- **Files:** new section in `docs/native/desktop-architecture.md`
- **Do:**
  - Decide whether `Tracks { overlay, main, audio }` gains explicit ordering.
  - Recommended answer, per the IA design: **zone-scoped reorder only** — video tracks reorder
    among video tracks, audio among audio, enforced by `.can_drop()` so the OS never shows an
    accept cursor for an illegal move. Do not fight the model.
  - Ship drag-reorder only if the answer is yes; otherwise defer explicitly **with the reason
    recorded**.
- **Tests:** none (decision doc). If reorder ships, add a `can_drop` rejection test.
- **Done when:** the decision is written down with its reason.

---

# M7 — Multi-select, link groups and snapping

Depends on M1, M5, M6.

### [ ] T-701 — Multi-select interactions

- **Files:** `rust/crates/vii-ui/src/editor_view.rs` (begin_drag L500-520), new
  `rust/crates/vii-core/src/selection_ops.rs`
- **Do:**
  - Click replaces; **Shift-click and Cmd-click both toggle** (Shift matches Premiere/Resolve/FCP
    muscle memory; accepting Cmd as an alias costs one line and satisfies the platform reflex).
    Opt-click selects the single clip ignoring its link group.
  - A drag starting on empty lane background is a marquee: plain replaces, Shift unions, hit rule
    is **INTERSECT**. The marquee anchor is stored in **timeline space (ticks, track index)**, not
    pixels, so auto-scroll cannot distort the rect.
  - Clicking empty lane background clears the selection and explicitly does **not** move the
    playhead.
  - Hit order, decided explicitly: clip body → trim handles → lane background. Verify with clips
    flush against the lane edges.
  - `begin_drag` no longer unconditionally calls `editor.select(vec![reference])`; dragging inside
    an existing multi-selection preserves it.
- **Tests:** `selection_ops.rs` — `marquee_hits` (intersect semantics, partial overlap, empty
  rect), `toggle`, `select_forward`.
- **Done when:** shift-clicking three clips and marquee-selecting four more yields a 7-clip
  selection, and the lane div has a mouse handler (today it has none).

### [ ] T-702 — Kill every `selection().first()` call site

- **Files:** `rust/crates/vii-ui/src/editor_view.rs` (delete_selected L522, split_selected
  L685, add_keyframe L700, apply_preset L350, Duplicate L907),
  `rust/crates/vii-ui/src/view_model.rs` (build L150)
- **Do:**
  - Sweep all six sites to operate over the whole selection, each as **one** transaction (T-101).
  - `EditorViewModel::build` stops taking `selection().first()`.
- **Tests:** `vii-core` — deleting a 3-clip selection produces one history entry and one
  `undo()` restores all three; splitting a 2-clip selection splits both.
- **Done when:** `grep -rn 'selection().first()' rust/crates/vii-ui/src` returns nothing.
- **Why now:** every one of these silently operates on one clip out of N the moment multi-select
  ships. Sweep them in the same milestone or multi-select is a lie.

### [ ] T-703 — Link groups

- **Files:** `rust/crates/vii-project/src/element.rs` (all four element structs, via the
  existing `with_inner!` macro), `rust/crates/vii-core/src/command.rs`,
  `rust/crates/vii-core/src/selection_ops.rs`
- **Do:**
  - `link_group: Option<String>` on Video/Image/Text/Audio, `#[serde(default)]`. Extend the T-106
    seed.
  - `Command::LinkElements { references, group_id }` and `UnlinkElements { references }`, bound to
    Cmd-L.
  - **Expand the selection to the link group at selection time**, storing the expanded set in
    `SelectionState.elements`. Never at operation time — that way move, trim, delete, copy, nudge
    and (later) ripple are all link-correct for free. Expansion never crosses scenes and skips
    elements on locked tracks.
  - Timeline: a chain glyph in the clip's top-left; linked partners of the selection get a
    **dashed** 50%-accent border so you see what will move *before* you drag.
- **Tests:** `selection_ops.rs` — `expand_link_groups` (single, pair, three-way, cross-scene
  rejection, locked-track skip); Opt-click yields the un-expanded single.
- **Done when:** selecting one half of a linked pair highlights both and moving them keeps sync.
- **Honest note:** our exposure is lower than palmier's — M10 gives `VideoElement` its own audio, so
  importing a video with sound stays **one** element. The model field and expansion still land now
  because retrofitting them after M8 means reworking M8.

### [ ] T-704 — `vii-core/src/snap.rs`

- **Files:** new `rust/crates/vii-core/src/timeline/snap.rs`; read
  `dep/apps/web/src/timeline/snapping/{types,build,resolve,threshold}.ts` for the data shape only
- **Do:**
  - Take `SnapPoint { time, kind, element_id, track_id }` and the source-registry idea from
    `dep/apps/web`. Write the algorithm fresh (see contradiction #3).
  - Targets: every non-dragged clip start and end, the playhead, timeline zero, and (later)
    in/out bounds and markers.
  - **Multi-probe:** every selected clip's start AND end is a probe simultaneously; the winning
    snap is the smallest |delta| across all probes and the whole selection moves by that one delta.
  - Base threshold 10px converted to ticks at the current zoom; the playhead gets 1.5×.
  - **Sticky hysteresis:** once snapped, stay snapped until the *raw* unsnapped position is ≥2.5×
    the threshold away. Hysteresis state lives in the drag, not recomputed per frame.
  - Collect targets **once at drag start** into a sorted `Vec` and binary-search per frame — they
    cannot change during a drag.
  - Returns `{ snapped_time, indicator_px, target_kind }`.
- **Tests:** `rust/crates/vii-core/tests/planner_snap.rs` — no-target passthrough; single
  target inside/outside threshold; multi-probe picks the smallest delta across 3 clips × 2 edges;
  sticky holds at 2.4× and releases at 2.6×; playhead's wider threshold wins a tie; threshold
  scales correctly at pps 8 and 400.
- **Done when:** all of the above pass and the module has no `use gpui`.

### [ ] T-705 — Snap indicator and the single drag-overlay layer

- **Files:** `rust/crates/vii-ui/src/editor_view.rs`
- **Do:**
  - **One** handler-free, absolutely-positioned overlay div above the entire lane stack carries
    *all* transient drag feedback: the snap indicator (1px full-height line in a dedicated `SNAP`
    theme role — never the playhead accent — with a 6px cap glyph identifying the target kind), the
    marquee rect, and later ghosts and insertion lines. Give it no `.id()` so it never captures hits.
  - Never per-lane: each lane is `overflow_hidden`, so a full-height indicator is impossible from
    inside one.
  - Snapping applies to move, trim-left and trim-right. `S` toggles snapping globally and
    persists; **holding `S` during a drag temporarily inverts** it (raw `on_key_down`/`on_key_up`
    with a shared `held_keys` set on the view).
- **Tests:** none new (the math is T-704); manually verify no flicker at threshold boundaries.
- **Done when:** dragging a group shows a full-height indicator at the snap target that releases
  cleanly when you keep pulling.

### [ ] T-706 — Drag threshold and Esc-cancel

- **Files:** `rust/crates/vii-ui/src/interaction/timeline_drag.rs`
- **Do:**
  - 4px movement threshold before a move commits; below it, mouse-up is a pure selection change and
    commits nothing. (Today any click with 1px of hand tremor commits a `MoveElement` and pollutes
    history.)
  - Esc during a drag reverts via `revert()` (T-103), drops the drag state, commits nothing and
    keeps the selection. Esc precedence ladder, first match wins: drag in flight → cancel;
    tool ≠ pointer → back to pointer (Wave 2); selection non-empty → clear.
  - Esc is a `KeyBinding` in the `"Editor && !TextEntry"` context, not a raw key handler.
- **Tests:** reducer tests — a 3px drag emits `Outcome::None` on Up; a 40px drag then Cancel emits
  `Outcome::Cancelled` and leaves history empty.
- **Done when:** Esc mid-drag returns everything exactly where it was and `undo()` does not undo
  something else.

---

# M8 — Clips stop overlapping: cross-track drag and overwrite

Depends on M7. The largest UI milestone and the one where a bug silently destroys footage.
**Write and pass the overwrite planner tests before wiring any drag UI to it.**

### [ ] T-801 — `Command::MoveElements` (the first real consumer of M1)

- **Files:** `rust/crates/vii-core/src/command.rs` (AddElement/MoveElement L552-602)
- **Do:**
  - `Command::MoveElements { moves: Vec<(ElementRef, track_id, MediaTime)> }`, lowering to
    remove+insert patches inside **one** labelled transaction. `Lowered.forward: Vec<ProjectPatch>`
    already supports many patches per entry; only the wrapper is missing.
  - This is what makes cross-track possible at all — `ElementRef` embeds the track id, so
    `MoveElement` can never relocate a clip.
- **Tests:** `vii-core/tests/editor.rs` — a 3-clip cross-track move is one history entry;
  `undo()` restores all three tracks and starts; `assert_timeline_valid` after each.
- **Done when:** the 3-clip test passes.

### [ ] T-802 — `overwrite.rs` pure planner

- **Files:** new `rust/crates/vii-core/src/timeline/overwrite.rs`, new
  `rust/crates/vii-core/tests/planner_overwrite.rs`
- **Do:**
  - `compute_overwrite(track, incoming_range) -> Vec<OverwriteAction>` where
    `OverwriteAction ∈ { Remove(ref), TrimEnd(ref, t), TrimStart(ref, t), Split(ref, t) }`.
  - The planner **returns actions, it does not mutate.** A failing test then dumps a readable
    action list rather than two whole `Project` structs.
- **Tests:** `planner_overwrite.rs` — full-cover, left-overlap, right-overlap, interior-split,
  exact-abutment (no action), zero-length incoming (no action). `assert_timeline_valid` on the
  applied result of every case.
- **Done when:** all six cases pass. **Do not start T-803 before this is green.**

### [ ] T-803 — Wire overwrite into add, move and widening trim

- **Files:** `rust/crates/vii-core/src/command.rs`
- **Do:**
  - Run the planner on `AddElement`, `MoveElements` **and** a trim that widens a clip into a
    neighbour. Apply the actions inside the same transaction as the triggering edit.
- **Tests:** `planner_overwrite.rs` — after any overwrite, no two elements on one track overlap
  (project invariant check); one `undo()` restores every affected clip.
- **Done when:** dropping a clip half over an existing one trims the existing one at the boundary.

### [ ] T-804 — `TrackDropTarget` resolution with kind clamping

- **Files:** `rust/crates/vii-ui/src/interaction/timeline_drag.rs`,
  `rust/crates/vii-project/src/track.rs`
- **Do:**
  - Cursor Y → `TrackDropTarget::{ ExistingTrack(ix), NewTrackAt(ix) }`, where the inter-track
    insertion zone is the outer 6px of each lane boundary. Use `track_y_offsets` (T-605) — do not
    recompute.
  - `plan_move()` **clamps** the proposed track delta backwards until every mover lands on a
    type-compatible lane. Audio never lands on a video lane. The whole selection moves by one
    shared delta.
  - **Always render *why* a drag stopped** — a red edge on the offending lane plus a status-bar
    notice (T-009). Never silently clamp.
- **Tests:** reducer tests — a mixed A/V selection clamps to the nearest legal delta; an audio-only
  selection cannot enter the video zone; the refusal reason is populated.
- **Done when:** dragging audio onto a video track lands it somewhere legal with a stated reason.

### [ ] T-805 — Ghosts and insertion lines

- **Files:** `rust/crates/vii-ui/src/editor_view.rs` (the T-705 overlay layer)
- **Do:**
  - A ghost renders for **every** moving clip at its prospective position with correct duration and
    trim; source clips stay in place at 55% opacity.
  - A 2px accent insertion line for new-track drops; a lane tint for existing-track drops.
  - A badge near the cursor showing the delta and the new start as timecode.
  - For media-panel → timeline drags use GPUI's `.on_drag(payload, |…| cx.new(…))` with a typed
    `MediaDrag { asset_ids, source_range }` payload — GPUI renders and positions the ghost for us.
    **Do not** copy palmier's `palmier-asset://<id>` string URI scheme; that exists only because
    AppKit pasteboards are stringly-typed.
  - Finder drops arrive as `ExternalPaths` and are accepted at the **window root** so a drop
    anywhere imports, with the media panel highlighting as the preferred target.
- **Tests:** none directly; drop-time computation goes through the same `px_to_ticks(x, scroll_x, pps)`
  as every other timeline interaction, already tested.
- **Done when:** dragging a clip to another track shows a ghost and an insertion line that follow
  the cursor.
- **Watch:** drop coordinates arrive in **window** space; subtract the lane's captured bounds
  (`TrackedBounds`), never a constant left offset, or the drop lands wrong after a dock resize.

### [ ] T-806 — Context menus

- **Files:** `rust/crates/vii-ui/src/editor_view.rs`
- **Do:**
  - `context_menu: Option<(Point<Pixels>, MenuKind)>` set on `on_mouse_down(MouseButton::Right)`;
    rendered at the root as `deferred(anchored().position(pos).snap_to_window().child(menu))`;
    dismissed by `on_mouse_down_out`, Escape, and any dispatched command.
  - Clip menu: Split / Duplicate / Copy / Paste / Delete / Link-Unlink / Select Audio Only /
    Reveal Source. Lane menu: Paste Here / Add Track. Ruler menu: Mark In / Mark Out / Clear.
  - Labels and shortcut hints come from the T-010 table, never literals.
- **Tests:** `actions.rs` — every menu item id resolves to a declared action.
- **Done when:** right-clicking a clip opens a menu whose labels match the key bindings.
- **Parked here:** ripple-insert on Cmd-drag and its green-gap preview. M8 ships **overwrite only**
  (contradiction #8).

---

# M9 — Video decode that survives a real clip

Depends on M3 and M5. Independent of M6–M8; can run in parallel if two people are working.

### [ ] T-901 — `decode/window.rs`: the pure cache and eviction policy

- **Files:** new `rust/crates/vii-preview/src/decode/window.rs`
- **Do:**
  - A `FrameSource` trait (`fn frame(&mut self, index: u64) -> Option<Frame>`) so the policy is
    testable against a fake that just returns its index.
  - A bounded ring buffer around the playhead with an explicit memory cap and an eviction rule.
- **Tests:** `rust/crates/vii-preview/tests/decode_window.rs` — which ranges get fetched, which
  get evicted, and that resident memory stays under the cap across a **random walk of 10,000
  seeks**. No ffmpeg involved.
- **Done when:** the 10,000-seek stress test runs in milliseconds and never exceeds the cap.

### [ ] T-902 — Keyframe-aligned seek + forward decode to the exact frame

- **Files:** `rust/crates/vii-preview/src/lib.rs` (decode_video_clip L379-423)
- **Do:**
  - Replace whole-clip pre-decode with `-ss` to the nearest preceding keyframe plus a forward
    decode to the exact requested frame, filling the T-901 window.
- **Tests:** covered by T-906.
- **Done when:** seeking to 07:30 of a 10-minute clip returns a frame without decoding 07:30 of
  video into RAM.

### [ ] T-903 — Decode resolution follows the preview render size

- **Files:** `rust/crates/vii-preview/src/lib.rs`
- **Do:**
  - Delete `VIDEO_MAX_FRAMES = 450` and the hardcoded 320×180/30fps.
  - Decode at the render size established in T-309, respecting the T-506 quality tier.
- **Tests:** a resolution-selection unit test across canvas sizes and tiers.
- **Done when:** both hardcodes are gone from the crate.

### [ ] T-904 — One GPU texture per element, re-uploaded

- **Files:** `rust/crates/vii-preview/src/lib.rs` (texture upload L320-329)
- **Do:**
  - Create the texture once per element and re-upload into it; delete the per-frame
    `create_texture`.
- **Tests:** add `renderer.video_texture_count()` (mirroring the existing `text_cache_len()` idiom)
  and assert it stays constant across 100 rendered frames of the same clip.
- **Done when:** the texture-count assertion passes.

### [ ] T-905 — Decode off the GPUI thread

- **Files:** `rust/crates/vii-preview/src/lib.rs`,
  `rust/crates/vii-ui/src/editor_view.rs` (preview_signature L373-425)
- **Do:**
  - Run decode on `cx.background_spawn`; while the window refills, the viewer holds the **previous
    frame** rather than flashing a placeholder.
- **Tests:** the window policy already covers correctness; add a test that a miss returns
  `Pending` rather than a placeholder.
- **Done when:** scrubbing never flashes a coloured box.

### [ ] T-906 — The self-identifying-frame test

- **Files:** new `rust/crates/vii-preview/tests/decode_ffmpeg.rs`
- **Do:**
  - Generate a 60s/30fps fixture in the temp dir (never committed) whose every frame encodes its
    own index as a **colour triplet in base 16 across R/G/B** — 4096 distinguishable frames with
    wide per-channel margins, so codec quantisation cannot confuse neighbours.
  - Assert `frame_at(t)` returns the correct index at t = 0, 0.5, 14.9, **15.1** (past today's
    450-frame cliff), 30, 45, 59.9; then backwards seeks 45 → 5 → 50; then window-boundary times;
    then repeated seeks to the same t returning identical bytes. Compare with ±3 tolerance.
  - Run the whole matrix with `-hwaccel auto` **on and off**.
- **Tests:** the above; skips cleanly without ffmpeg.
- **Done when:** all positions pass with hwaccel off. **If hardware decode cannot be made
  frame-exact after seek, fall back to software decode for scrubbing, keep hwaccel for linear
  playback, and record that finding in `docs/native/`.**

---

# M10 — Audio that is actually a mix

Depends on M1 and M3. Makes the mix **correct** against the existing crude transport; M11 makes it
real-time. Doing them as one XL milestone means debugging model semantics inside a real-time
callback.

### [ ] T-1001 — Video-clip audio is audible

- **Files:** `rust/crates/vii-project/src/element.rs` (VideoElement L105-119),
  `rust/crates/vii-ui/src/editor_view.rs` (start_audio L204-300),
  `rust/crates/vii-audio/src/lib.rs`
- **Do:**
  - `VideoElement` gains `volume: f32` and `muted: bool`. Extend the T-106 seed.
  - The mixer walks **video tracks too** — `start_audio` currently only iterates
    `scene.tracks.audio` matching `Element::Audio(..)`, so a video clip's audio is silent in both
    preview and export.
- **Tests:** `rust/crates/vii-audio/tests/mix.rs` — a scene with one video clip carrying audio
  and no audio-track clips produces non-silent output.
- **Done when:** dropping a video that has sound makes sound.

### [ ] T-1002 — Gain is settable, undoable and keyframable

- **Files:** `rust/crates/vii-project/src/element.rs` (AudioElement L157-165),
  `rust/crates/vii-core/src/command.rs`
- **Do:**
  - `AudioElement` gains `animations` (it is uniquely missing it today, so volume cannot be
    keyframed by construction).
  - `Command::SetVolume`, `SetMuted`, `SetFades` — all reversible. Today gain is not settable at all.
  - Land the **sampling API** here: `sample_gain(element, at: MediaTime) -> f32`, on the same clock
    the mixer will run on, even though M11 replaces the transport underneath it.
- **Tests:** `vii-core` — each command round-trips through undo; `sample_gain` at keyframe
  boundaries.
- **Done when:** pulling a clip to −6 dB in the inspector is one undoable edit.

### [ ] T-1003 — Fades

- **Files:** `rust/crates/vii-project/src/element.rs`,
  `rust/crates/vii-audio/src/lib.rs`
- **Do:**
  - Per-clip `fade_in` / `fade_out`, applied **equal-power** in the mixer.
  - A short default fade at every clip boundary so cuts stop clicking.
- **Tests:** `rust/crates/vii-audio/tests/mix.rs` — a 0.5s fade-in reaches exactly −6 dB at its
  midpoint and 0.0 at frame 0, asserted at sample resolution.
- **Done when:** a hard cut no longer clicks.

### [ ] T-1004 — Track volume/solo, master gain, one mix path

- **Files:** `rust/crates/vii-project/src/track.rs`,
  `rust/crates/vii-project/src/project.rs`, `rust/crates/vii-audio/src/lib.rs`
- **Do:**
  - `Track` gains `volume`; `solo` already landed in T-605. `Project` gains a master gain.
  - **ONE** pure mix path composes clip gain × fade × track gain × solo/mute × master, in that
    order. No second code path anywhere.
- **Tests:** `mix.rs` — gain composes in the stated order; solo on one track mutes the others;
  master scales everything once.
- **Done when:** there is exactly one function computing a sample's final gain.

### [ ] T-1005 — A −1 dBFS master limiter

- **Files:** `rust/crates/vii-audio/src/lib.rs` (hard clamp L90-93); port from
  `dep/apps/web/src/media/audio-mastering.ts`
- **Do:**
  - Replace the hard ±1 clamp with the ported limiter plus `clampDb` / `dBToLinear` helpers.
- **Tests:** `mix.rs` — over synthetic buffers, no output sample exceeds the −1 dBFS ceiling;
  `clamp_db`/`db_to_linear` round-trip; two overlapping loud clips do not clip audibly.
- **Done when:** all three assertions pass, with no audio device present.

---

# M11 — Streaming audio mixer and real waveforms

Depends on M10. **Highest-risk milestone in the plan.** The audio callback is a real-time context:
no allocation, no blocking locks. Use a lock-free ring fed by a decode/mix thread.

### [ ] T-1101 — `graph.rs`: the pure pull mixer

- **Files:** new `rust/crates/vii-audio/src/graph.rs`
- **Do:**
  - `graph.fill(&mut [f32], start_frame: u64)` computes samples for an **arbitrary** frame range
    from (clips, per-clip gain automation, fades, track gain/mute/solo, master limiter), with no
    device, no thread, and **no interior state that survives across calls**.
- **Tests:** `rust/crates/vii-audio/tests/graph.rs` — deterministic output for a fixture
  timeline.
- **Done when:** `fill()` is callable from a plain unit test with no device.

### [ ] T-1102 — Block-size invariance, the null test, and the real-time budget

- **Files:** `rust/crates/vii-audio/tests/graph.rs`, new
  `rust/crates/vii-audio/benches/fill.rs`
- **Do:**
  - **Block-size invariance:** filling `[0, 480_000)` as one call is byte-identical to 938 calls of
    512 frames. This is *the* test for a streaming-audio rewrite — every streaming mixer that ever
    shipped a bug shipped it at a block boundary.
  - **Null test:** mixing a signal against its own inverse yields silence to < 1e-6.
  - **Envelope composition:** gain composes as clip × fade × track × master in that order.
  - Criterion bench with a hard **p99 ≤ 0.5 ms** for a 512-frame block at 48 kHz with 8 clips;
    ideally also assert no allocation inside `fill()` via a test-binary `GlobalAlloc` shim.
- **Tests:** the above.
- **Done when:** invariance and null both pass and the bench is under budget.

### [ ] T-1103 — One streaming decode entry point

- **Files:** `rust/crates/vii-audio/src/lib.rs` (decode_pcm L14-38)
- **Do:**
  - **ONE** streaming decode entry point in `vii-audio` serving playback, waveforms and future
    analysis. The PCM cache becomes a bounded LRU of **windows**, not an unbounded map.
  - No whole-timeline `Vec<f32>` is ever allocated again.
- **Tests:** LRU eviction and window boundaries, against a fake source.
- **Done when:** `grep -rn 'Command::new("ffmpeg")' rust/crates/` shows no third copy anywhere in
  the workspace beyond the preview decode and export paths.

### [ ] T-1104 — A rodio/cpal `Source` pulling chunks on demand

- **Files:** `rust/crates/vii-audio/src/lib.rs`,
  `rust/crates/vii-ui/src/editor_view.rs` (start_audio L204-300, toggle_play L739-752)
- **Do:**
  - Implement the raw `Source` trait pulling mixed chunks with ~2s lookahead, fed by a decode/mix
    thread through a lock-free ring. Delete the decode-everything-then-mix-everything path.
- **Tests:** a bench (skipped without a device) asserting play latency on a 10-minute timeline is
  under ~200ms and **does not scale with timeline length**.
- **Done when:** the first press of Play on a 10-minute timeline is instant.

### [ ] T-1105 — The playhead runs on the audio clock

- **Files:** `rust/crates/vii-ui/src/editor_view.rs` (advance_playback L755-775),
  new `rust/crates/vii-audio/src/sync.rs`
- **Do:**
  - The playhead advances from **samples consumed by the device**, not `Instant` deltas.
    `Transport` takes an injected clock source so it is testable.
- **Tests:** `sync.rs` — after simulating ten minutes of consumed samples, the playhead equals the
  expected `MediaTime` within one frame.
- **Done when:** a 5-minute playback test asserts drift under one frame.

### [ ] T-1106 — Edits are audible while playing

- **Files:** `rust/crates/vii-audio/src/graph.rs`
- **Do:**
  - The mix graph reads the **live** project each chunk, so a volume/mute/move edit during playback
    becomes audible within one lookahead window without stop/start.
- **Tests:** `graph.rs` — changing a clip's gain between two `fill()` calls changes the second
  call's output.
- **Done when:** dragging a gain field during playback is audible.

### [ ] T-1107 — Zoom-aware, dB-companded waveform peaks, off-thread

- **Files:** `rust/crates/vii-audio/src/lib.rs` (waveform_peaks L100-137),
  `rust/crates/vii-ui/src/editor_view.rs` (ensure_waveforms L306-326, hardcoded 48 at L323)
- **Do:**
  - Peaks/second adapts with zoom and **caps** for long media, replacing the hardcoded 48.
  - dB-companded against a −50 dB floor (linear peaks make dialogue look flat).
  - Computed off the UI thread — today the ffmpeg decode runs synchronously in the render path.
- **Tests:** `rust/crates/vii-audio/tests/peaks.rs` — bucket count adapts and caps; dB
  companding maps a −50 dB sample to 0 and full scale to 1.
- **Done when:** zooming into an audio clip reveals new detail instead of stretching 48 bars.

### [ ] T-1108 — Waveform disk cache

- **Files:** `rust/crates/vii-audio/src/lib.rs`
- **Do:**
  - Persist peaks to a disk cache keyed by **path + size + mtime**, so relaunch does not re-decode.
  - Bounded size with LRU eviction; expose the cache size (a Clear Cache button lands in Wave 2's
    settings pane).
- **Tests:** cache hit/miss on a changed mtime; eviction under the size cap.
- **Done when:** the second launch with the same media does not spawn ffmpeg for waveforms.

### [ ] T-1109 — Waveforms render through `canvas()`, not one div per peak

- **Files:** `rust/crates/vii-ui/src/editor_view.rs` (L1888-1893)
- **Do:**
  - Two-pass in **one** `canvas()` per clip: an RMS band at 55% alpha, then a peak envelope line at
    100% (`window.paint_path` with a `PathBuilder`), centred on a 1px zero line. Clipped columns
    (|x| ≥ 0.999) paint in `danger`.
  - Cache the raster keyed by media + trim + height + a **bucketed** pps (powers of ~1.5), reusing
    the nearest bucket with scaling, so a pps change does not thrash.
- **Tests:** the bucketing function is pure and tested.
- **Done when:** the per-peak `div` loop is gone. At zoom-aware bucket counts it would be thousands
  of elements per clip.

---

# M12 — An export you can trust

Depends on M3, M9, M11. Sharing **one** mix graph between preview and export is what keeps
envelopes from diverging; resist writing a second export-only mixer even though it looks easier.

### [ ] T-1201 — `export/options.rs`: `ExportOptions → argv` (pure)

- **Files:** new `rust/crates/vii-preview/src/export/options.rs`
- **Do:**
  - `ExportOptions { resolution, codec, quality_or_bitrate, range, audio: bool }` defaulting to the
    project resolution, lowering to `Vec<String>` — including pix_fmt, the second audio input with
    `-map` / `-c:a aac` / `-shortest`, and the staged `.partial` output path.
- **Tests:** `rust/crates/vii-preview/tests/export_options.rs` — one test per preset. Highest
  leverage in the whole export domain: "exports at 720p" and "exported MP4 is silent" are both
  argv bugs caught here in microseconds with no encoder involved.
- **Done when:** every preset's argv is asserted.

### [ ] T-1202 — Real destination, real resolution

- **Files:** `rust/crates/vii-ui/src/editor_view.rs` (paths L105-112, export button L654-681,
  1280 clamp L664-666)
- **Do:**
  - `rfd::save_file()` picks the destination. Delete the `~/vii-export.mp4` and `~/vii-frame.png`
    constants — today every export clobbers the same two files.
  - Delete the max-1280px clamp, so a 1080p project exports 1920×1080.
- **Tests:** gated integration — export 0.5s at 64×36, `ffprobe` the output, assert exact
  dimensions.
- **Done when:** both constants and the clamp are gone.

### [ ] T-1203 — Audio muxed from the same mix graph

- **Files:** `rust/crates/vii-preview/src/lib.rs` (export_video L191-246),
  `rust/crates/vii-audio/src/graph.rs`
- **Do:**
  - Fill the M11 graph for the export range into a temp WAV, pass it as a second ffmpeg input.
- **Tests:** `graph.rs` — the same graph filled for `[t0,t1)` produces **byte-identical** output
  whether pulled by the rodio source or by the export WAV writer, on a fixture timeline.
- **Done when:** the parity test passes and an exported MP4 has two streams.

### [ ] T-1204 — Off-thread job with progress and cancel

- **Files:** `rust/crates/vii-preview/src/lib.rs`,
  `rust/crates/vii-ui/src/editor_view.rs`, `rust/crates/vii-core/src/event.rs`
- **Do:**
  - `cx.background_spawn` the encode; parse ffmpeg's `-progress pipe:1` and publish on the
    EventBus; render a determinate bar with a working Cancel in the status bar (T-009).
  - The UI stays interactive — you can scrub during export.
  - `ExportJob` is a state machine: Queued → Running → {Done, Cancelled, Failed}, no other edges.
- **Tests:** the state machine, run without spawning anything; a gated cancel test and a gated
  progress-monotonicity test.
- **Done when:** you can scrub the timeline while a progress bar runs.

### [ ] T-1205 — Atomic staging and surfaced errors

- **Files:** `rust/crates/vii-preview/src/lib.rs`,
  `rust/crates/vii-ui/src/editor_view.rs`
- **Do:**
  - Write to `<dest>.partial` and rename on success. Cancel or failure leaves **no** file at the
    destination and does not touch a pre-existing file of the same name.
  - Errors surface with the tail of ffmpeg's stderr through T-009. Delete
    `let _ = renderer.export_video(...)`.
- **Tests:** gated — cancel halfway leaves no destination file and an existing same-named file
  byte-identical.
- **Done when:** the discard is gone and a forced ffmpeg failure shows its stderr tail.

### [ ] T-1206 — Offline media blocks or warns

- **Files:** `rust/crates/vii-ui/src/editor_view.rs`
- **Do:**
  - Before starting, check `missing_asset_ids()` (T-205). Block or warn with a **named list** rather
    than baking placeholders into the output.
- **Tests:** `vii-core` — the offline list is populated for a fixture with a missing asset.
- **Done when:** exporting a project with a missing file names the file instead of exporting a
  coloured box.

### [ ] T-1207 — Export integration test

- **Files:** `rust/crates/vii-preview/tests/export_ffmpeg.rs`
- **Do:**
  - Encode 0.5s at 64×36 from a fixture timeline with audio; run `ffprobe` on the output and assert
    `{ width, height, nb_streams == 2, video codec, audio codec, duration within one frame }`.
  - Assert on the ffprobe result, never on output bytes — encoder output is not reproducible across
    ffmpeg versions and a byte-golden would be a permanent flake.
- **Tests:** the above; skips cleanly without ffmpeg.
- **Done when:** it passes on the macOS runner with `VII_REQUIRE_FFMPEG=1`.

---

# M13 — A viewer you can edit in

Depends on M1, M3, M5. Coordinate mapping is where this goes wrong — keep every step inside the
pure function.

### [ ] T-1301 — The content rect **is** the img rect

- **Files:** `rust/crates/vii-ui/src/editor_view.rs` (preview L1076-1163),
  `rust/crates/vii-ui/src/geometry.rs`
- **Do:**
  - Size and absolutely position the `img()` to **exactly** `fit_rect(viewport, canvas_aspect, zoom, pan)`
    (T-008) inside the viewport div. Never `size_full()` with GPUI doing its own object-fit — that
    is how "GPUI's fit and my fit disagree" bugs happen.
  - Capture the viewport's window-space bounds with the `TrackedBounds` `canvas()` probe.
  - **Ignore all pointer events while the bounds cell is `Bounds::default()`** (first frame, before
    layout). Do not clamp, do not guess.
- **Tests:** `fit_rect` is already covered; add a test that a zoomed+panned rect stays inside the
  viewport at the clamp bounds.
- **Done when:** the picture is aspect-correct at every panel size and the two nested letterboxes
  are gone.

### [ ] T-1302 — `hit_test` (pure)

- **Files:** `rust/crates/vii-ui/src/view_model.rs` (or a sibling pure module); port
  `dep/apps/web/src/preview/{hit-test.ts, element-bounds.ts, preview-coords.ts}`
- **Do:**
  - Chain: window pt → −viewport.origin → −fit_rect.origin → ÷ fit_rect.size → × canvas → clip-local
    (translate by −centre, rotate by −θ) → `|x| ≤ w/2 && |y| ≤ h/2`.
  - Order: text clips first, then tracks in reverse **draw** order. **Our topmost element is the
    LAST overlay element — the reverse of palmier's rule** (vii-preview draws main first, then
    overlay lanes). Encode that in the function and its tests.
  - Skip hidden tracks and opacity ≤ 0.01.
  - Port `screenPixelsToLogicalThreshold` — handle hit slop must be constant in **screen** px, so
    it has to be divided back through the scale.
  - The compositor *render* resolution never enters this chain, only the project canvas aspect, so
    the T-506 scrub tier cannot break hit testing.
- **Tests:** `view_model.rs` inline — round-trip `screen_to_canvas(canvas_to_screen(p)) == p` within
  0.5px over random p, zoom ∈ [0.1, 8.0], pan, canvas aspect and panel size; z-order resolution
  with three stacked overlay elements; a rotated, off-centre, non-unit-aspect clip.
- **Done when:** the round-trip property passes at 256 random cases.

### [ ] T-1303 — Click to select, drag to move

- **Files:** new `rust/crates/vii-ui/src/interaction/canvas_drag.rs`,
  `rust/crates/vii-ui/src/editor_view.rs`
- **Do:**
  - Click selects the hit element (expanded to its link group, T-703); clicking empty canvas
    clears. Drag moves in normalized canvas units.
  - The whole gesture applies live via `editor.apply(...)` and commits **one** named entry on
    mouse-up — not one entry per mouse-move.
  - Throttle viewer drags to the animation frame and use the scrub quality tier (T-506) during
    them; with CPU readback each live drag frame is a full render plus readback.
- **Tests:** reducer tests — a 60-move drag emits one `Outcome::Commit`; Esc reverts to the
  pre-drag transform and leaves history empty.
- **Done when:** clicking a clip in the preview selects it (today clicking does nothing).

### [ ] T-1304 — Transform handles

- **Files:** `rust/crates/vii-ui/src/editor_view.rs`,
  `rust/crates/vii-ui/src/interaction/canvas_drag.rs`
- **Do:**
  - 4 corner + 4 edge handles as absolutely-positioned divs with their own `.id()` and
    `on_mouse_down`, so GPUI's innermost-first dispatch gives handle-over-body priority for free.
    **8px visible square inside a 16px invisible hitbox** — 10px is too small on a Retina trackpad.
  - Shift preserves aspect (captured at drag start); Opt resizes about the centre. A rotation
    handle 22px above top-centre; Shift snaps to 15°.
  - **Text clips resize font scale, not the box.**
- **Tests:** reducer tests — shift-locked corner resize preserves the start aspect exactly; opt
  resize keeps the centre fixed; a text clip's resize writes font scale.
- **Done when:** shift-dragging a corner holds the aspect.
- **Blocked by:** T-301. Corner resize is meaningless while width and height are the same number.

### [ ] T-1305 — Canvas zoom, pan and fit

- **Files:** `rust/crates/vii-ui/src/editor_view.rs`
- **Do:**
  - Cmd/Opt+wheel zooms to the cursor using the **same** pure `zoom_at` as the timeline, applied per
    axis, clamped 0.1..8.0 — do not let the viewer grow a second, divergent copy of the math.
  - Space-drag or middle-drag pans; 25/50/75/Fit/100/150/200% presets plus a live zoom badge; a
    canvas border strokes below 100%.
- **Tests:** covered by `zoom_at`; add a clamp test at both ends.
- **Done when:** Cmd+scrolling to 200% on a detail keeps the point under the pointer fixed.

### [ ] T-1306 — Canvas snapping guides

- **Files:** `rust/crates/vii-ui/src/interaction/canvas_drag.rs`; port
  `dep/apps/web/src/preview/preview-snap.ts`
- **Do:**
  - Snap to canvas edges and centre with full-height / full-width guide lines in **magenta**
    `#ff4dd2` (the Figma convention; distinct from the red playhead and every clip hue). Same sticky
    rule as the timeline. **Skipped when the clip is rotated.**
  - Optional, ranked last and honestly flagged: title-safe 80% / action-safe 90% / rule-of-thirds
    toggles in the viewer's top-right, off by default. These are a **Premiere** gap, not a palmier
    gap — the audit found palmier has no safe-area overlay at all.
- **Tests:** snapping math is pure and tested (edges, centre, sticky release, rotated skip).
- **Done when:** dragging a clip across the middle shows a centre guide.

---

# M14 — An inspector that tells the truth

Depends on M1 (including `ScrubbableNumber`, T-108), M3, M5. If it must be split, the clean seam is
between T-1401..T-1403 (correctness + fields) and T-1404..T-1406 (lane + IA).

### [ ] T-1401 — `write_property`: edits at the playhead write a key

- **Files:** `rust/crates/vii-ui/src/editor_view.rs` (transform_row L1361-1384),
  `rust/crates/vii-core/src/command.rs`
- **Do:**
  - Every inspector write routes through one `write_property` that **upserts a key at the playhead
    when that property's channel is active**, and sets the base value otherwise.
  - Today `transform_row` unconditionally executes `Command::SetTransform`, which overwrites a base
    value that `sampled_transform` then ignores — so once a property is animated, its stepper is
    silently inert.
- **Tests:** `vii-core` regression test reproducing the two-click bug: keyframe opacity, step
  opacity, assert `sampled_transform` **changes**. It does not today.
- **Done when:** the regression test passes.

### [ ] T-1402 — Keyframe stamp and navigation

- **Files:** `rust/crates/vii-project/src/element.rs` (AnimationChannel L29-68),
  `rust/crates/vii-ui/src/editor_view.rs` (kf_button L1209-1224)
- **Do:**
  - `AnimationChannel::has_key_at / prev_key / next_key`.
  - A `‹ ◇ ›` per-row control with four states: dim ◇ (not animated, click starts animating),
    hollow ◇ (animated, no key here, click adds), filled ◆ (key at playhead, click removes),
    filled white (key selected). Disabled with the tooltip "Move playhead inside the clip" when the
    playhead is outside the element.
  - Clicking ◇ also reveals that property's lane (T-1405) and scrolls it into view.
- **Tests:** `vii-project` — `has_key_at` / `prev_key` / `next_key` at boundaries, empty
  channels and exact matches.
- **Done when:** the diamond state is correct as you step the playhead across keys.

### [ ] T-1403 — Replace every stepper with `ScrubbableNumber`

- **Files:** `rust/crates/vii-ui/src/editor_view.rs` (nudge_row L1253-1303, stepper_row
  L1307-1357, effect amount L1572-1616)
- **Do:**
  - Swap all three ± pairs for `ScrubbableNumber` (T-108), wired through `write_property` (T-1401).
  - Canonical row shape: `[label] [field(s)] [◇ ‹ ›] [↺ reset]`, with ↺ revealed on row hover via
    `.group()/.group_hover()` and ⌥-click on the label also resetting (Premiere convention).
- **Tests:** covered by T-108's reducer tests; add one asserting `display_multiplier` renders 0.37
  as `37 %` and parses `37` back to 0.37.
- **Done when:** setting opacity to exactly 37% is possible. It is impossible today at 0.1 steps.

### [ ] T-1404 — Keyframe easing

- **Files:** `rust/crates/vii-project/src/element.rs` (Keyframe, `sample` L38-68); port
  `dep/apps/web/src/animation/{types.ts, bezier.ts, interpolation.ts}` and carry its solver tests over
- **Do:**
  - `Keyframe` gains an `easing` field. `AnimationChannel::sample` supports `linear | hold | bezier`
    with `CurveHandle { dt, dv }`. Extend the T-106 seed and add a migration step defaulting
    existing keys to linear.
  - Port our own web model rather than palmier's three modes — it is strictly richer.
- **Tests:** `vii-project` — the ported bezier solver tests; hold holds; linear is unchanged
  against the existing fixtures.
- **Done when:** a Hold key produces a step, not a ramp.

### [ ] T-1405 — The keyframe lane, in the timeline

- **Files:** `rust/crates/vii-ui/src/editor_view.rs`,
  `rust/crates/vii-ui/src/view_model.rs` (ElementInfo.animated_count),
  `rust/crates/vii-core/src/command.rs` (RemoveKeyframe L113)
- **Do:**
  - Animated properties render as expandable 18px sub-lanes under their clip's track, sharing the
    timeline's ruler, `scroll_x`, zoom and snap engine (contradiction #4). Expansion state is
    per-track UI state, not project state. Default to the selected clip's track only; add a
    "collapse all keyframes" control.
  - Diamonds drawn with `canvas()` + `paint_path` (dozens-to-hundreds of marks, no ids needed);
    shape encodes easing — diamond = bezier, square = hold, circle = linear.
  - Hit-tested within 7px by a pure `fn key_at(x, keys, pps, scroll_x, tolerance_px) -> Option<usize>`.
    Below 6px spacing, collapse a run into a single tick with a hover count.
  - Drag-to-retime with snapping and a dashed guide, applying live and committing **one** entry.
    Add `Command::MoveKeyframe`; finally dispatch the existing `Command::RemoveKeyframe` from the
    UI. Right-click menu: Linear / Ease / Hold / Delete.
  - Keyframe lanes must **not** be droppable targets for clip drags — `.can_drop()` rejects.
  - `EditorViewModel::build` surfaces per-property key times (it exposes only `animated_count`
    today).
- **Tests:** `key_at` (hit, miss, tie at exactly 7px, collapsed run); a reducer test that a
  retime drag emits one `Outcome::Commit`.
- **Done when:** the literal string `"◇ keyframe (N animated):"` is gone and a mis-added key is
  removable without undo.

### [ ] T-1406 — `SelectionSummary` and inspector IA

- **Files:** `rust/crates/vii-ui/src/view_model.rs`,
  `rust/crates/vii-ui/src/editor_view.rs` (inspector L1386+)
- **Do:**
  - Replace `selected: Option<ElementInfo>` with `selection: SelectionSummary` where every field is
    `Field<T> = Uniform(T) | Mixed | Absent`. `Mixed` renders `—` and writing it applies to **all**
    selected; `Absent` hides the row. Build it by folding over the selection in a **fixed order** or
    Mixed detection becomes order-dependent and flaky.
  - Tabs, content-driven: Clip / Motion / Style (text only) / Effects / Audio (only when the
    selection actually has audio, including video clips with an audio stream), plus a **Project** tab
    when nothing is selected. Inapplicable tabs are **hidden, not disabled**. Tab order is fixed;
    never change the active tab if the current one is still applicable.
  - Collapsible groups with a section-level ↺ and a per-row ↺.
  - Body is `div().flex_1().overflow_y_scroll()` — here GPUI's built-in scroller is exactly right.
- **Tests:** `view_model.rs` — `Field<T>` folding (uniform, mixed, absent, order-independence);
  `applicable_tabs(&SelectionSummary)`; the auto-focus rule (single text → Clip, single audio →
  Audio).
- **Done when:** selecting two clips with different rotations shows `—` and typing a value sets
  both.
- **Watch:** drag-to-scrub inside a scrollable panel fights the scroller — claim the drag on
  mouse-down and set a flag the panel's scroll handler checks.

---

# Wave 2 — the next round

Expand these into full task lists when Wave 1 closes. Ordered as the PM plan states: the effect
registry first because it unblocks the most, text last-ish because GPUI gives us no text input for
free (now mitigated by T-012). Three items here (W2-07, W2-11, W2-13) come from the audit's
cross-cutting critic rather than a domain table — they are table-stakes and had no owner.

### [ ] W2-01 — Declarative effect registry + richer params + multi-input pass graph

- **Files:** `rust/crates/effects/src/pipeline.rs` (EffectUniformBuffer L53-58, bind layout L68+,
  apply_with_encoder L218-296), `rust/crates/vii-preview/src/lib.rs` (effect_groups L24-64),
  `rust/crates/vii-project/src/element.rs` (Effect L12-18),
  `rust/crates/vii-ui/src/view_model.rs` (L170)
- **Do:** one descriptor table (id, category, param specs with key/label/range/default/unit, a
  `linearizes` flag, an optional resource key, `canonical_order`); lift the fixed 8-float uniform;
  bind more than one input texture; allow non-linear pass graphs; add a string param variant and
  per-param animation channels; thread the clip-relative playhead into `effect_groups()`.
- **Tests:** registry table tests (unique ids, `min ≤ default ≤ max`, total canonical order, every
  shader id resolves); `resolve(params, at_offset)` sampling and clamping.
- **First commit of this item:** capture Tier-B per-effect goldens for the **four current effects**
  at min/default/max, **before** the refactor. Without a before-picture the refactor is unreviewable.
- **Done when:** adding an effect touches one table, not four files.

### [ ] W2-02 — Basic colour-correction set

- **Files:** `rust/crates/effects/src/shaders/`, `rust/crates/effects/src/pipeline.rs`
- **Do:** exposure (linear light — today's `brightness.wgsl` is a straight RGB multiply, not EV),
  temperature 2000–11000K + tint, luma-masked highlights/shadows, blacks/whites remap, vibrance.
  Present as always-visible sliders grouped Tone / White Balance / Presence with a section reset —
  not "+ Bright" add-an-effect buttons.
- **Tests:** per-effect pixel goldens at three param values; a banding test (a near-black gradient
  through a 5-effect chain must retain > N distinct luma levels).
- **Blocked by:** W2-01.

### [ ] W2-03 — Ripple edits + sync-lock + refusal

- **Files:** new `rust/crates/vii-core/src/timeline/ripple.rs`,
  `rust/crates/vii-core/src/command.rs` (RemoveElement L575-590); port
  `dep/apps/web/src/ripple/{diff,shift,apply}.ts`
- **Do:** `compute_shifts`, `compute_shifts_for_ranges`, `compute_push`, `merge_ranges`, and a
  `validate(...) -> Result<Plan, RippleRefusal>` pass. Ripple delete (Shift-Backspace), ripple trim,
  ripple insert (Cmd-drag, with the green gap band + downstream shift preview and
  `on_modifiers_changed` so it flips with the mouse stationary), close gap. `sync_locked` already
  landed in T-605.
- **Tests:** planner cases + a refusal test naming the blocking track and frame. **A ripple that
  cannot be satisfied refuses; it never partially applies.**
- **Blocked by:** T-304/T-305 (source trim), T-801, T-101.

### [ ] W2-04 — Tool modes (V/C/T), slip/slide/roll, in/out ranges

- **Files:** new `rust/crates/vii-ui/src/tools.rs`, `rust/crates/vii-core/src/state.rs`,
  new `rust/crates/vii-core/src/plan/{slip,slide,roll}.rs`
- **Do:** exactly three modal tools, **spring-loaded** (press to enter; release within 250ms with no
  mouse-down while held = latch; otherwise revert to pointer; Esc always returns to pointer; revert
  on window blur). Communicate mode with a toolbar chip + a 4% lane tint + a live razor blade line
  — `CursorStyle` is a closed enum with no custom bitmaps, so a razor cursor is impossible.
  T = body drag slip, Opt+body slide, shared-edge drag roll. In/out range on `EditorState` as
  non-undoable session state, with Shift+drag on the ruler and re-draggable 8px edges.
- **Tests:** the tool state machine with an injected clock; headroom clamped across the **whole
  link group** to the tightest; explicit no-source branch for image/text (infinite headroom).
- **Blocked by:** T-304/T-305. Until trims are written, slip is not merely unimplemented — it is
  unrepresentable.
- **Note:** ship the two-up viewer thumbnail preview later; v1 slip feedback is numeric only.

### [ ] W2-05 — Real text: style model, font picker, colour picker, multi-line, alignment

- **Files:** `rust/crates/vii-project/src/element.rs` (TextElement),
  `rust/crates/vii-text/src/lib.rs`, `rust/crates/vii-preview/src/lib.rs`
  (`ensure_text_texture`); port `dep/apps/web/src/text/{typography,background,primitives,layout}.ts`
- **Do:** font family/size/scale, tracking, line spacing, case, traits, RGBA colour (hardcoded
  `"#ffffff"` at creation today, never changeable), alignment, shadow, two-pass stroke outline,
  background (padding, radius, offset). `FontSystem::db()` enumerates families cheaply. Colour
  picker is a build-from-scratch popover.
- **Tests:** raster goldens per style; **widen the text texture cache key to hash the whole style**
  or styled text renders stale.
- **Blocked by:** T-012, T-108.

### [ ] W2-06 — Crop

- **Files:** `rust/crates/vii-project/src/element.rs`, `rust/crates/compositor/src/frame.rs`,
  `rust/crates/vii-preview/src/lib.rs`, `rust/crates/vii-ui/src/editor_view.rs`
- **Do:** a `Crop` struct + UV inset in the compositor quad + hit-test participation. **Crop is a
  separate viewer MODE (Shift-C), not more handles on the same rect** — transform handles hide, the
  outside dims to 45%, rule-of-thirds guides appear, inside-drag pans the crop window at fixed
  visible size, Esc exits.
- **Tests:** UV inset goldens; the first slice is **non-rotated and non-keyframed**; add the
  counter-rotated drag delta only after the simple case is tested.
- **Blocked by:** T-301, M13.

### [ ] W2-07 — Clip filmstrips + the shared disk-cache / concurrency-gate substrate

- **Files:** `rust/crates/vii-ui/src/editor_view.rs`, new shared cache module
- **Do:** the cross-cutting critic calls filmstrips "probably the most visible single difference
  between our timeline and a real NLE". Draw them in the same `canvas()` as the waveform, at
  **source aspect** (not stretched), under a 40% scrim so the label strip stays legible; head+tail
  only when fewer than 3 thumbnails fit. Build the substrate **first**: bounded concurrency,
  mtime+size keying, a size cap, LRU eviction and a Clear Cache control. T-1108's waveform cache is
  its first tenant; transcripts, beat maps and LUT previews are later ones.
- **Tests:** the `clip_layout(w, h, kind, flags) -> ClipLayout` tier function at w = 13/14/43/44/119/120
  and h = 27/28/47/48; cache eviction under the cap.
- **Note:** re-rastering on every pps change thrashes — bucket pps to powers of ~1.5.

### [ ] W2-08 — Stylize/detail set + chroma key with eyedropper

- **Files:** `rust/crates/effects/src/shaders/`, `rust/crates/effects/src/pipeline.rs`
- **Do:** vignette, film grain (needs the timeline frame in the uniform), glow and clarity/dehaze
  (both **multi-input composites** our linear pass chain cannot express today), sharpen, noise
  reduction, motion blur, invert; chroma key with a live eyedropper that pauses playback,
  temporarily disables the existing key, overlays a crosshair, averages a 9×9 patch and commits as
  one "Sample Key Color" undo step. The eyedropper is nearly free — we already hold the composited
  BGRA buffer CPU-side.
- **Blocked by:** W2-01, T-103.

### [ ] W2-09 — App shell: project package, Save As / Open / recents, home launcher, settings window

- **Files:** `rust/crates/vii-ui/src/lib.rs` (run L19-39), `rust/desktop/src/main.rs`,
  `rust/crates/vii-project/src/project.rs`
- **Do:** the ergonomics half deferred out of M1 — a `.vii` directory package (project.json +
  media.json + thumbnail + media/), Save As / Open / Open Recent wired to the menu bar built in
  T-011, a project registry with register-on-open and update-URL-when-moved. Home launcher as a
  **separate window** (~900×600, recent/samples/new). Settings as a **separate window** (⌘,) with
  General / Appearance / Timeline / Media & Cache / Export defaults / Shortcuts panes — a window,
  not a sheet, because you want to change a timeline colour while looking at the timeline.
- **Decide before opening the second window:** audio output, the preview renderer and the ffmpeg
  concurrency gate must move into App-level `Global`s, or two windows fight over the device and the
  GPU queue.

### [ ] W2-10 — Scrub audio, level meters, playback rate

- **Files:** `rust/crates/vii-audio/src/{lib.rs, meter.rs}`,
  `rust/crates/vii-ui/src/editor_view.rs`
- **Do:** the three natural consumers of M11's mixer. Scrub grains (2400 frames, 144-frame edge
  fades, reversed for backward scrubs). `meter.rs` as a pure decaying state machine (−60 dB floor,
  24 dB/s level decay, 18 dB/s peak decay, 1.5s hold, sticky clip latch), at the right end of the
  transport bar. J/K/L shuttle with tap-based rate stepping (1/2/4/8×).
- **Tests:** meter ballistics by feeding synthetic blocks and asserting the decay curve at known
  times.
- **Honest scoping:** reverse playback depends entirely on the decode window cache — ffmpeg cannot
  decode backwards — and will stutter outside it. Say so in the UI. Do not ship rates > 1× with
  audio until the playhead runs on the audio clock (T-1105).

### [ ] W2-11 — Clip speed / retiming

- **Files:** `rust/crates/vii-project/src/element.rs`, `rust/crates/vii-core/src/command.rs`,
  `rust/crates/vii-audio/src/graph.rs`, `rust/crates/vii-preview/src/lib.rs`
- **Do:** flagged **table-stakes by the audit's cross-cutting critic and owned by no domain**.
  It is a model change, not a UI change: timeline duration, source-frame mapping, split math, audio
  resampling and export all route through it, and it gates freeze-frame and reverse.
- **Sequencing warning:** retrofitting `speed` *after* ripple, trim and the audio mixer are built
  means touching every one of those paths a second time. Schedule it **first or second** in Wave 2,
  not last.

### [ ] W2-12 — Drag affordances for ripple: gap band, insert indicator, per-track badges

- **Files:** `rust/crates/vii-ui/src/editor_view.rs` (the T-705 overlay layer)
- **Do:** the ripple half of the drag feedback deliberately parked out of M8 — a green gap band on
  every affected sync-locked track, an insert indicator line, downstream clips visibly shifted, a
  count badge, plus the red diagonal hatch for overwrite. Disclosure after the fact: a transient
  gutter notice ("Ripple insert — +3.20s on 3 tracks"), a matching **named** undo label, one Cmd+Z.
- **Blocked by:** W2-03.

### [ ] W2-13 — Structured logging and crash/error reporting

- **Files:** workspace-wide
- **Do:** the third leg of the cross-cutting critic's "every failure in our app is silent" finding.
  T-009 gives us the surface; this gives us the diagnostic — a structured log with a rotating file
  sink, plus a crash/hang report path. Cheapest to establish before fifteen new subsystems each
  invent their own.

---

# Parked / explicitly not doing

These are decisions, not backlog. Each has a reason; revisit only if the reason changes.

| Item | Status | Why |
|---|---|---|
| **Zero-copy GPU→GPUI preview** | **Never, at GPUI 0.2.2** | Architecturally blocked: GPUI renders on blade-graphics, not wgpu (recorded finding, `docs/native/desktop-architecture.md`). The CPU readback in `PreviewRenderer::render` stays. Do not spend a day on it — the actual leverage is render-size adaptivity (T-309) and the scrub tier (T-506), both already scheduled. |
| **Transcription, speaker identity, transcript-driven editing** | **Not building** | The one item the audit flags as adjacent to the excluded AI surface. Cost is entirely in acquiring word-level timings. Everything downstream (caption chunking, word-level cutting, per-word text animation) works off an imported SRT — build those first if we ever want them. Apple's SpeechAnalyzer is unreachable from Rust without an ObjC bridge; whisper.cpp means adopting an ML runtime for one feature. |
| **Semantic media search over visual embeddings** | **Not building** | Largest single item in the audit and a marketing surface, not table stakes: needs a model downloader, frame sampler, embedding store, tokenizer and index coordinator. We take the free 10% — plain case-insensitive name search, in T-208 — and defer the embedding half indefinitely. |
| **Multicam** | **Not building** | Requires ripple, overwrite, slip and audio sync to all exist first, and by the audit's own reading its real value is the refusal guards rather than the switching. Nobody evaluating a v1 NLE is blocked by it. |
| **On-device ML audio (Silero VAD, beat detection, speech denoise)** | **Not building** | No ML runtime exists anywhere in the Rust workspace and we are not adopting one (ONNX vs candle) for three speculative features. If beat-snapping becomes interesting, a pure-Rust spectral-flux onset detector plus tempo autocorrelation gets most of the value with zero new dependency. The two runtime-independent ideas — the wet-twin-plus-crossfade trick and a disk-persisted analysis cache — we already get from T-1108 and W2-07. |
| **FCPXML / XMEML interchange export** | **Not now** | ~1600 lines of format work in palmier, gated on per-clip fps and source timecode our `Element` model does not have. Revisit only when a real user asks to round-trip into Premiere or Resolve; until then an mp4 that is actually correct and has sound (M12) is worth far more. |
| **Nested sequences and the nest flattener** | **Not now** | Our `Scene` model already provides the multiple-named-timelines half. The expensive part is the flattener (trim remapping, fade truncation, keyframe rebasing, id namespacing, depth cap, multiplicative audio gain). Nobody abandons an editor in the first ten minutes over its absence. |
| **Source monitor / preview tabs with an independent playhead** | **Not now — flagged honestly** | Source+program monitors are the core Premiere loop, so this is more central to the stated north star than its wave placement suggests. Deferred rather than cut because it doubles preview state (a second playhead, a second decode session) exactly while we are rewriting decode (M9) and audio (M11). **Revisit immediately after both stabilise.** |
| **Full colour management (Rgba16Float intermediates, linear-light grading, export colour tags)** | **Not now** | Banding only bites once curves, wheels and LUTs exist to compound it. Doing 16-bit intermediates before the effect registry means redoing the pass plumbing twice. Belongs immediately after W2-01. |
| **Tone curves, hue curves, colour wheels, 3D LUT (.cube)** | **Not now** | The full grading suite. All four share plumbing that does not exist until W2-01, and the real cost is UI (curve editors, a colour-wheel pad) with no analogue in our GPUI code. |
| **Mask-shape drawing (bezier / roto masks)** | **Not building** | T-403 activates the masks crate for edge rounding and softness only, which is where the already-written JFA pipeline pays off. A shape-drawing tool is an editor of its own, and palmier does not have one either — so it is not a parity gap. |
| **Colour scopes as a parity claim** | **Not building (as parity)** | Palmier ships **no** scopes UI at all. Their `ColorScopes` is a numeric struct whose main consumer is their AI tool executor, which is out of scope. If we build a histogram/waveform panel later it is because human colourists need one to grade against — and it should ship with the curve editor, where it belongs. |
| **Media panel folders** | **Not now** | Folders need a `MediaFolder` model that must go through Command/ProjectPatch to be undoable, for a library that today has no user with more than a handful of assets. T-208 ships the two slices that matter (multi-file import, name filter) and stops there. |
| **Text animation presets and the caption preset gallery** | **Not now** | Both gated on a rich text style model this plan does not schedule (W2-05 at the earliest). Entrance presets are implementable on existing transform channels later; per-word presets need `WordTiming`, which only a transcript provides — and transcription is cut above. |
| **First-run onboarding, what's-new overlay, in-app update channel (Sparkle)** | **Not now** | A single window opening the last project is fine for this round. Onboarding depends on the home launcher (W2-09), and an update channel is a build-pipeline project (signing, notarization, appcast) rather than an editor feature. |
| **Light mode** | **Not now (roles layer ships, `Theme::light()` is a stub)** | See contradiction #9. The token *roles* land in T-004 because every UI task depends on them; the tuned light palette does not, and shipping a half-tuned light theme is worse than shipping none. |
| **Localization / i18n** | **Not now — flagged as a growing debt** | The classic retrofit trap: cost is proportional to UI string count, and this plan multiplies our string count by ~10. Introducing a string-catalog convention now would be nearly free. Recorded here honestly rather than silently dropped; if it is ever going to happen, it should happen before W2-05. |
| **Product analytics / telemetry** | **Not now** | Named in the audit brief and owned by no domain. Worth the shape palmier chose (compile-time trait so dev builds carry no SDK, closed event enum, opt-out in a Privacy pane) if we ever do it. |
| **HDR / 10-bit export** | **Not now — but know it while formats are still soft** | An 8-bit RGBA readback path forecloses HDR at the **compositor** level, not just the encoder level. iPhone HDR is the most common source for our likely users. Record the constraint in `docs/native/desktop-architecture.md` while the wgpu render-target formats are still being touched. |
| **Accessibility layer** | **Not now, narrow version only** | GPUI's accessibility story is far weaker than SwiftUI's and palmier's own coverage is partial. The actionable version is narrow and already built into T-006: **every icon-only button carries a `.tooltip()` with a text label**, enforced by the component rather than by an audit sweep later. |

---

## Ground rules that outlive this document

- **Definition of done, per task.** Its pure module exists and is unit-tested; any `Command` it adds
  is in the reversibility table *and* the proptest generator's weighted list; any model field it
  adds is in the T-106 golden seed; any gesture it adds is a reducer with an event-sequence test;
  any ffmpeg invocation it adds has an argv test; if it changes the render path, its descriptor
  golden is updated in an isolated commit.
- **Test budget.** Wave 1 takes the suite from 66 to roughly 200 tests: ~45 in `vii-core`,
  ~30 in `vii-project`, ~25 in `vii-ui`, ~20 in `vii-preview`, ~15 in `vii-audio`,
  plus ~15 Tier-B pixel goldens and ~5 gated capability tests. If Wave 1 lands with 90, that gap is
  visible rather than arguable.
- **Suite speed.** `cargo test --workspace` excluding the capability tiers stays under 30 seconds on
  the dev Mac. Proptest defaults to 64 cases; raise it via env in a nightly run, never per-PR. If
  the suite gets slow, that is itself a bug worth fixing — a slow suite gets skipped locally.
- **Benchmarks.** Criterion for pure CPU work (its `--save-baseline`/`--baseline` *is* the
  regression machinery). `vii-bench` for wall-clock pipeline numbers, run once at the start and once
  at the end of each milestone group, results committed to `rust/crates/bench/baselines/`. Baselines
  are **keyed per machine**; a laptop and a CI runner will never agree. Thresholds: pure benches warn
  at >1.10×, fail at >1.25×; wall-clock benches warn at >1.20×, fail at >1.40× **and** only after
  three consecutive runs. **Also flag unexplained speedups over 1.25×** on frame-time and export — a
  sudden speedup usually means a case degenerated. Absolute budgets independent of any baseline:
  1080p/4-layer/4-effect preview < 16.6 ms, 512-frame audio block fill < 0.5 ms p99, timeline
  layout+hit-test for 1000 clips < 2 ms, undo/redo of a 500-element transaction < 5 ms.
