# Adding transitions

## What exists today

**One transition, and it is a fade.** `transition_add(fromId, toId, duration)` validates that two
clips are on the same lane and overlap, then issues a single `Command::SetFades` putting a
`fade_in` on the **incoming** clip. The outgoing clip plays on at full underneath. That is the
whole implementation — `bay-agent/src/plan.rs`, the `"transition_add"` arm.

There is **no transition model**. No `Transition` type, no `kind` field, nothing on `Element`
that says "a dissolve happens here". A dissolve is an emergent property of one clip's fade
overlapping another clip. This matters: it is why there is nothing to extend, and why the first
question for any new transition is *which of three routes does it belong to*.

Note the deliberate asymmetry. Fading **both** clips dips the middle of the dissolve through the
background, which reads as a flash. Only the incoming clip fades. Any new transition has to
answer the same question — what is visible in the middle of it.

---

## The three routes

Most transitions people ask for do **not** need engine work. Sort the request before writing any
Rust.

| Route | Transitions | Engine change? |
|---|---|---|
| **A — mask** | wipe (linear, in any direction), iris, barn door, circle in/out, reveal | **No.** Masks exist and their fields animate |
| **B — seam move pair** | slide, push, whip pan, zoom through, shunt | **No.** The registry already has `MoveKind::Seam` |
| **C — two-input pass** | luma/gradient wipe, displacement morph, glitch dissolve, dip-to-colour | **Yes.** Needs a compositor pass that samples both clips |

Route C is the only one that is real work, and it is a small fraction of the list.

---

## Route A — a wipe is an animated mask

`Element.mask` is an `Option<Mask>` with a `MaskShape` (`Ellipse` or `Rect`), position, size and
feather. Five of its fields are animatable, keyed as nested paths:

```
mask.x   mask.y   mask.width   mask.height   mask.feather
```

`bay-agent::plan` accepts these on `animate` — see the `nested_mask` branch, which checks the
element actually *has* a mask before allowing the key, so a mask channel on an unmasked element
is refused rather than stored and never read.

**A left-to-right wipe onto the incoming clip:**

```jsonc
// 1. give the incoming clip a rect mask covering nothing, anchored left
mask_set  { "elementId": "b", "shape": "rect", "x": 0.0, "y": 0.5,
            "width": 0.0, "height": 1.0, "feather": 0.01 }
// 2. open it across the overlap
animate   { "elementId": "b", "property": "mask.width",
            "keys": [{ "at": 0.0, "value": 0.0 }, { "at": 0.5, "value": 1.0 }],
            "easing": "power-out" }
```

An **iris** is the same with `shape: "ellipse"` and both `mask.width` and `mask.height`. A **barn
door** is two clips each with a rect mask opening from opposite edges.

**Feather is the whole difference between a wipe and a tear.** A hard-edged wipe at 30 fps
aliases badly on any diagonal content. Start at `0.01` and raise it, don't leave it at zero.

### What to build here

If wipes are wanted often, add `transition_add` a `kind` argument and let the planner emit the
mask + keys, exactly as it emits `SetFades` today. That keeps the caller from hand-rolling four
calls and getting the anchor wrong. The work is in **one function in `plan.rs`** and nothing else.

---

## Route B — a slide is a matched pair of seam moves

The move registry already has a `MoveKind::Seam`, and five moves in it: `z-out` / `z-in`,
`whip-out` / `whip-in`, and `shunt`. These are *designed to be used in pairs* — one on the
outgoing clip, one on the incoming — with the velocities matched so the cut lands invisibly.

```jsonc
apply_move { "elementId": "a", "move": "whip-out", "at": 4.5, "direction": "left" }
apply_move { "elementId": "b", "move": "whip-in",  "at": 0.0, "direction": "left" }
```

**`apply_move`'s `at` is relative to the ELEMENT's start, not the timeline's.** This is the single
most common mistake in every build script in this repo. An element starting at 4.5 s takes
`at: 4.5` at timeline 9.0 s, silently.

### What to build here

Adding a new seam transition means **adding a `Move` to `MOVES` in `bay-project/src/moves.rs`**,
as data — channels, key values, per-key curves, duration, directions. Read the module header
before you do: the registry exists because durations and curves typed in from a document get
copied back wrongly, so a move carries its own timing and the caller names the move.

Three invariants the tests enforce, so a new entry must satisfy them:

1. **The lead is geometric** — `x`, `y`, `scale`, `scaleX`, `scaleY`, `rotation`, `tiltX`,
   `tiltY`. Never `opacity`. Opacity may ride along and must finish before the geometry does.
2. **The lead clears `amplitude_floor(kind, property)`.** A move below it is invisible, and
   satisfying a channel-share rule with a 4 px nudge is exactly what the floor exists to stop.
3. **The lead delivers ≥ 4 *core* frames** at 30 fps. Core, not nominal: an `expo-out` spends
   68 % of its duration in a tail the eye cannot resolve, so a 10-frame `expo-out` is a cut with
   an afterglow. `CORE_SPANS` does the conversion and is not an agent-facing number.

A new pair also wants an entry in the seam vocabulary so `check`'s `broken-continuity` recognises
it as a carry rather than reporting the seam as a hard replacement.

---

## Route C — a two-input transition needs a compositor pass

This is the only route that touches the render path, and it is worth understanding why before
starting.

**The compositor draws each layer as an independent inverse-mapped fullscreen fragment pass**
(`bay-compositor/src/shaders/layer.wgsl`). Each pass knows about exactly one source texture. A
luma wipe, a displacement morph or a dip-to-colour needs a fragment that samples **both** clips
and mixes them by a per-pixel function — which no existing pass can do.

### The files, in order

1. **`bay-project/src/element.rs`** — a `Transition` type and a field to hang it on. This is the
   first time the model has one, so decide where it lives: on the incoming element (matching how
   fades work today) is the smaller change; a `Vec<Transition>` on the `Scene` is the more honest
   model but ripples into every serialisation test.
   **The wire format is kebab-case and pinned by serde round-trip tests** — it is the web↔native
   interop contract. Add the field as `#[serde(default, skip_serializing_if = "Option::is_none")]`
   so every project written before it still loads.

2. **`bay-compositor/src/frame.rs`** — a descriptor carrying two texture ids and the mix
   parameter. New fields need `#[serde(default)]` for the same reason.

3. **`bay-compositor/src/shaders/`** — the new WGSL. Follow `layer.wgsl`: uniforms in one
   `#[repr(C)] Pod` struct sized to a multiple of 16 bytes, and check the offsets by hand.
   (`layer.wgsl` fits in 64 bytes; `tilt` reuses what used to be tail padding.)

4. **`bay-compositor/src/compositor.rs`** — the pipeline, bind groups and uniform upload.

5. **`bay-preview/src/lib.rs`** — build the descriptor from the model. **Sanitise here.**
   `sanitise_transform` is where NaN and out-of-range values are made harmless; the render path
   cannot panic on bad input and that is tested with NaN, ±inf and 1×1 canvases.

6. **`bay-mcp/src/tools.rs`** — the schema and the argument parsing. Read the next section before
   adding an argument.

### The trap this codebase punishes hardest

**An argument that is accepted and then dropped.** `visual()` and `transform_framed()` build
transforms with `..Transform::default()`, so a new field is accepted by the JSON schema, ignored
by the builder, and reported as success. That has now happened three times — gradients, tilt, and
two values that were silently clamped (`strokeWidth: 0.9` drew a slab, `radius: 10` drew a
lozenge). Each cost a render to notice.

`bay-mcp/tests/tools.rs` exists to hold this class. **Any new transition argument gets a line
there**, asserting on the stored element, not on the tool's reply.

---

## Rules that apply to all three routes

- **A control must do what it says.** The panel palettes come from `bay-core::blocks`, which only
  names effects the compositor compiles. A transition offered in a schema and rendered by nothing
  is a dead control discovered after an export comes back unchanged.
- **Never put the logic in the UI crate.** If `bay --mcp` or a test can't reach it, it is in the
  wrong crate. A transition is engine logic; the timeline view only draws it.
- **`check` has to agree.** `transition_add` exists partly so `check` stops calling a dissolve an
  `overlap`. A new transition kind that leaves two clips overlapping will be reported as a defect
  unless `check` learns to recognise it. Grep for `overlap` in `bay-core/src/check.rs`.
- **The vocabulary and the checks must hold one number, not two.** This has bitten three times:
  `make-room` travelled 0.0198 against `no-response`'s 0.02 threshold; the same move travelled
  0.0278 against `frozen`'s 0.03. Each side was correct alone and nothing compared them. If a
  transition introduces a threshold, read it from the registry rather than restating it, and pin
  the two together in a test.
- **Everything lands on a frame.** `off-grid` reports start and duration values that do not fall
  on the frame grid, and a transition computed from arithmetic will produce them. Round to
  `1/fps`.

---

## Suggested order

1. **`kind` on `transition_add`, with `wipe` and `iris` via Route A.** No render work, immediate
   payoff, and it establishes the argument shape the other routes will reuse.
2. **One seam pair via Route B** — `slide-out`/`slide-in` — to exercise adding to the registry.
3. **Route C only when a specific transition demands it.** Dip-to-colour is the cheapest genuine
   two-input case and the best first one, because the "colour" input is a constant rather than a
   second texture, so it proves the plumbing without the second bind group.

Before claiming any of it works, run `./test.sh` — clippy is `-D warnings`, and a skipped
GPU/ffmpeg test is not a pass.
