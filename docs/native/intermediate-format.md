# The intermediate render-target format

**Decision: bay keeps 8-bit intermediates. Deferred, not rejected — with a named trigger.**

Recorded 2026-08-27, before the scopes module (M7) and the Color page (M8), because changing
the intermediate format changes every composited pixel and must not be folded into either.

The question: should effect-pass render targets move from `Bgra8Unorm` / `Rgba8Unorm`
(`rust/crates/bay-gpu/src/context.rs:172-176`) to `Rgba16Float`?

---

## The answer

**No, not now.** Do the pass-collapse instead (below). Revisit when a source or a delivery
path carries more than 8 bits — see *The trigger*.

## Why not

**1. Every source is 8-bit at upload, so a wider intermediate has nothing extra to carry.**
`GpuContext::upload_rgba_texture` takes `&[u8]` (`context.rs:822`). Video decodes to RGBA8
(`bay-preview/src/lib.rs:2245`), images RGBA8 (`:1528`), text and shape rasters RGBA8
(`:1315`, `:1355`). A 16-bit buffer cannot recover information that was never uploaded.

**2. The precision it *would* buy is invisible.** A four-effect grade
(brightness → contrast → saturation → LUT) makes six value-altering 8-bit writes: the layer
pass, four effect passes, and the blend. The `copy_texture` at
`bay-compositor/src/compositor.rs:500` is an exact 8→8 copy and adds nothing. Six roundings at
±1/510 accumulate to ≈0.0048 — under 1.3 codes.

**3. The artefact people actually see is stretch banding, and the format does not fix it.**
A contrast of 2.0 maps 0.25–0.75 onto 0–1: 128 input codes populate 256 output codes, leaving
every other code empty. A γ=0.45 shadow lift spreads 26 input codes across 92 output codes —
steps ~3.5 codes wide. Those 26 values were all the *source* ever had. Widening prevents the
second stretch compounding the first; it does nothing about the first.

**4. It would silently change output, because the hardware clamp is load-bearing today.**
`brightness.wgsl:23` returns `color.rgb * amount` **unclamped**; the unorm target clamps it in
hardware. `contrast.wgsl:24` and `saturation.wgsl:25` clamp explicitly, `gaussian_blur.wgsl:34`
and `layer.wgsl:95` do not, `lut.wgsl:39` passes >1 through when `amount < 1`, and
`blend.wgsl:141` clamps. In `Rgba16Float` those stop agreeing: `brightness(2.0)` then
`contrast(0.5)` on a 0.6 pixel renders **0.75 today** and **0.85 wide** — and differently again
if the effects are reordered, because the clamping passes act as gates.

**5. There is no linear/sRGB handling to widen into.** The format is `Bgra8Unorm`, not
`Bgra8UnormSrgb`. Every shader — blur weights, `saturation.wgsl:23`'s Rec. 709 luma, all
seventeen blend modes — treats gamma-encoded values as linear. Half-float concentrates its
precision near zero, which is exactly where gamma encoding has already spent its codes.
Widening without settling linear-vs-gamma pays the cost and collects a fraction of the benefit.

Points 4 and 5 are colour-management decisions. The repo already has tasks that own them:
**`P0-MED-02`** ([`phase-0.md`](phase-0.md), "decide 8-bit vs 10-bit/HDR handling into the
Bgra8 compositor path") and **`P4-HW-02`** ([`phase-4.md`](phase-4.md)).
[`plan.md`](plan.md) lists it as risk #8 by name.

## Do this instead

**Collapse consecutive scalar effects into one pass. Size: S–M.**

`bay-preview/src/lib.rs:31-95` emits one pass group per effect. But `brightness`, `contrast`,
`saturation` and `lut` are pure per-pixel functions with no neighbourhood dependency — they
compose exactly into one shader. Only `blur` (separable) and `drop-shadow` (2-D kernel) must
stay separate.

Four passes become one. That removes three quantisation steps *and* three full-screen draws
*and* three per-frame texture allocations (`bay-effects/src/pipeline.rs:327` allocates fresh
every pass, every frame, unpooled). Where the format flip trades a real slowdown and 2× memory
for an invisible gain, this improves precision, speed and memory together. It touches
`bay-effects` and one mapper in `bay-preview`.

**It does change output bytes** — removing a rounding step changes the final code wherever the
intermediate rounded across a boundary the exact value does not, so thousands of pixels shift
by one code and `stable_hash` changes. That costs nothing: no test asserts pixel bytes (the ten
`render.rs` assertions are *length* checks; every GPU test is relational), and the persisted
`content_hash` is guarded by an AND with ICGS, per §4. The pass-collapse is byte-changing and
migration-free at the same time; those are not in tension.

## The trigger

Revisit when **a source or a delivery path carries more than 8 bits**:

1. **Decode produces >8-bit** — 10-bit HEVC or ProRes arriving as P010 instead of being
   flattened to RGBA8 at `bay-preview/src/lib.rs:2245`. Only then does the 8-bit intermediate
   lose information at the *first* pass, which is the sole place widening ever helps.
2. **Export delivers >8-bit.** Already half-true and worth fixing on its own merits:
   `ExportSettings::ProRes` asks ffmpeg for `yuv422p10le`
   (`bay-preview/src/lib.rs:1202-1203`) while the frame pipe is `-pix_fmt rgba`, 8-bit
   (`:1683-1684`). bay ships a 10-bit ProRes container carrying 8-bit content. Fixing that
   end-to-end needs the wide intermediate *and* a wide readback *and* a wide pipe — the format
   flip alone would not do it.
3. **A grading operator that legitimately exceeds 0..1** — exposure in stops ahead of a tone
   curve, or a log workflow. That is when point 4 above stops being cosmetic.

**Scopes (M7) do not trigger it.** Scopes read `PreviewFrame.bgra`
(`bay-preview/src/lib.rs:575`), which is 8-bit at the readback whatever the intermediates hold.
[`pages.md`](pages.md) already records this: scopes are a CPU reduction over a readback that
already happens.

## What it would cost, if the trigger fires

**Size: L** for the format alone; **XL** with the linear/sRGB decision it implies.

`Rgba16Float` itself is unproblematic: `wgpu-types-29.0.1/src/texture/format.rs:987` grants it
`RENDER_ATTACHMENT`, and `:1097` puts it in the `Float { filterable: true }` arm, so
`FILTERABLE` and `BLENDABLE` are guaranteed with no device feature, on Metal and on the GL
fallback. (Moot for blending anyway — every pipeline sets `blend: None` and blends in
`blend.wgsl`.) The work is everything around it.

**Nine hardcoded 4-byte assumptions**, all `bay-gpu/src/context.rs`: `:672`, `:832`, `:848`,
`:888`, `:890`, `:947-952`, `:1025`, `:1119-1127`, `:1172-1189`. The sharpest is
`upload_rgba_texture` (`:822`), which builds its texture via `create_render_texture` and writes
8-bit bytes into it — a global flip breaks every source layer at once (text, shapes, images,
video, masks).

**Two traps not visible from the format constant:**
- `TexturePool` keys on `(width, height)` only (`bay-compositor/src/texture_pool.rs:5, 27`).
  Any *partial* migration hands out textures of the wrong format. The format must enter the key
  before anyone attempts a mixed-format design.
- The JFA mask shaders pack integer seed coordinates into 8-bit unorm channels —
  `jfa_init.wgsl` `encode_seed` writes `x_hi/255.0`, `jfa_distance.wgsl` `decode_seed` reads
  `floor(encoded.r * 255.0 + 0.5) * 256.0`. That is data-in-colour with a hard dependency on an
  8-bit unorm target. It must be audited, not carried along.

**Memory doubles.** Twelve intermediates for a 3-layer scene with a 4-effect stack:
~100 → ~200 MB at 1080p, ~398 → ~796 MB at 4K. A masked layer adds four more full-size
textures per mask (`bay-masks/src/sdf.rs:167-168` × two JFA runs) plus
`feather.rs:197`, all unpooled. The preview LRU budgets are **not** affected —
`VIDEO_MEMORY_BUDGET` (`bay-preview/src/lib.rs:599`) and `GLOBAL_VIDEO_MEMORY_BUDGET` (`:1055`)
bound CPU-RAM decoded 8-bit source frames, not GPU intermediates.

**Dead constant to remove first:** `bay-gpu/src/lib.rs:8` defines `GPU_TEXTURE_FORMAT` and
nothing in the workspace reads it.

### Tests that would need attention

**There are no golden images anywhere in the workspace.** Every GPU test asserts relationally
(`blue > 200 && red < 60`, `strong < faint`, "some texel differs from the corner"), so nothing
needs a regenerated baseline. Two sites need *rewritten* assertions, both structural:

| File:line | Test | Why |
|---|---|---|
| `bay-compositor/tests/native_gpu.rs:38` | `native_rgba_upload_readback_is_identity` | asserts `read_back == source` byte-for-byte at `w*h*4`; a 16-bit texture returns 8 bytes/texel |
| `bay-preview/tests/render.rs:29, 100, 136, 193, 298, 773, 965, 1016, 1037, 4071` | the `assert_eq!(frame.bgra.len(), w*h*4)` family | survive only while `PreviewFrame.bgra` stays 8-bit — which it must, since GPUI's `RenderImage` (`bay-ui/src/editor_view.rs:927`) and ffmpeg's `-pix_fmt rgba` both want 8-bit |

Explicitly **not** at risk, contrary to the initial framing: the LUT render proofs
(`render.rs:2767` `a_lut_actually_grades_the_frame`, `:2851`
`a_missing_lut_file_leaves_the_frame_standing`) are a red↔blue swap and an `is_some()` — both
nowhere near their thresholds. `frame_check`'s gates (`frame_check.rs:758`, `:767`) threshold
over a 4.5:1 luminance-contrast ink mask (`:878`); sub-code shifts cannot move them.

**No migration is needed — the persisted hash degrades safely.** `frame_check.rs:669` hashes
`frame.bgra` into `CriticObligation { content_hash, baseline_icgs }`, persisted in project
files (`bay-project/src/plan.rs:68-70`). The workspace has exactly **one** reader,
`bay_agent::trust::refresh_obligations` (`bay-agent/src/trust.rs:357-381`), and it guards on an
**AND**:

```rust
content_hash != &obligation.content_hash && signature != &obligation.baseline_icgs
```

Two properties follow, and both matter:

1. **A hash mismatch alone does nothing.** The ICGS must differ too. `icgs`
   (`frame_check.rs:955-965`) is `[cluster_count, pairwise centroid distances × 1024 as u16]`
   over clusters from the 4.5:1 luminance-contrast mask (`:878`). A sub-code pixel shift moves
   no cluster count and no centroid by the ~0.23px (at the 240px sample height) that would
   change a u16 distance. Robust, though not *provably* invariant — a boundary pixel crossing
   the 4.5:1 threshold is possible in principle; it is thousands of pixels short of moving a
   centroid a quantisation step.
2. **The direction is "close", not "alarm".** An obligation is an outstanding demand to revise
   a panel; a mismatch marks it *satisfied*. `require_trust_ready` (`:383-404`) refuses render
   while obligations are **open**. So a stale hash cannot produce a spurious "this panel
   changed" — the failure mode, if the AND ever both-fired, would be quietly closing an
   unaddressed obligation. The ICGS half is what prevents that, and it is the half that a
   render-precision change cannot move.

This applies equally to the format flip and to the pass-collapse below. Neither needs a
migration.
