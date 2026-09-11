//! `color-stack` against the staged passes it replaces.
//!
//! This is the only place in the workspace where both paths are still reachable: the preview's
//! mapper always fuses a run now, so a comparison there would be a test of one path against
//! itself. Here the pipeline takes whatever pass list it is handed, so the same grade can be
//! rendered staged and fused and the two put side by side.
//!
//! Two claims are under test, and they are different claims:
//!
//! 1. **Compatibility.** The fused pass reproduces the staged path's behaviour, including its
//!    clamping — which used to come from the 8-bit unorm target rather than from the shaders.
//! 2. **Precision.** The fused pass is *better*, because it does not quantise between stages.
//!    That is the whole reason for the change, and an equality test would hide it.
//!
//! Skips without a GPU; `BAY_REQUIRE_GPU=1` turns the skip into a failure.

use bay_effects::{
    ApplyEffectsOptions, EffectPass, EffectPipeline, MAX_COLOR_STACK_STAGES, UniformValue,
};
use bay_test_support::require_gpu;

/// A horizontal ramp, black to white, repeated down every row. One row would do; the extra
/// rows make a row-pitch mistake visible as a broken ramp rather than as noise.
fn ramp_rgba(width: u32, height: u32) -> Vec<u8> {
    let mut buf = Vec::with_capacity((width * height * 4) as usize);
    for _ in 0..height {
        for x in 0..width {
            let value = ((x * 255) / (width - 1).max(1)) as u8;
            buf.extend_from_slice(&[value, value, value, 255]);
        }
    }
    buf
}

fn scalar(shader: &str, amount: f32) -> EffectPass {
    EffectPass {
        shader: shader.to_string(),
        uniforms: [("u_amount".to_string(), UniformValue::Number(amount))].into(),
        lut: None,
    }
}

/// `[op, amount, …]` — the flat pair encoding `color-stack` reads.
fn stack(stages: &[f32]) -> EffectPass {
    EffectPass {
        shader: "color-stack".to_string(),
        uniforms: [(
            "u_stages".to_string(),
            UniformValue::Vector(stages.to_vec()),
        )]
        .into(),
        lut: None,
    }
}

/// Render `passes` over a black→white ramp and return the red channel of the first row.
fn run(passes: &[EffectPass], width: u32) -> Option<Vec<u8>> {
    let ctx = require_gpu()?;
    let height = 4;
    let pipeline = EffectPipeline::new(&ctx);
    let source = ctx
        .upload_rgba_texture(&ramp_rgba(width, height), width, height, "color-stack-test")
        .expect("a correctly sized ramp uploads");
    let out = pipeline
        .apply(
            &ctx,
            ApplyEffectsOptions {
                source: &source,
                width,
                height,
                passes,
            },
        )
        .expect("the passes render");
    let rgba = ctx
        .read_texture_rgba(&out, width, height)
        .expect("readback succeeds on a live device");
    Some(
        rgba.chunks_exact(4)
            .take(width as usize)
            .map(|p| p[0])
            .collect(),
    )
}

/// The compatibility claim. A grade that stays inside 0..1 must come out of the fused pass
/// where the staged path put it — within the one code that removing three roundings can move
/// a value, and no further.
#[test]
fn a_fused_run_lands_where_the_staged_one_did() {
    let width = 256;
    let staged = [
        scalar("brightness", 1.2),
        scalar("contrast", 1.15),
        scalar("saturation", 1.3),
    ];
    let fused = [stack(&[1.0, 1.2, 2.0, 1.15, 3.0, 1.3])];

    let Some(staged) = run(&staged, width) else {
        return;
    };
    let fused = run(&fused, width).expect("the GPU was there a moment ago");

    assert_eq!(staged.len(), fused.len());
    let worst = staged
        .iter()
        .zip(&fused)
        .map(|(a, b)| a.abs_diff(*b))
        .max()
        .expect("the ramp is not empty");
    assert!(
        worst <= 1,
        "fusing changed the grade by {worst} codes; at most 1 is attributable to the roundings it removes"
    );
}

/// The compatibility claim at the top end, where it is load-bearing.
///
/// `brightness.wgsl` never clamped — it relied on the unorm target to do it. A fused pass has
/// no such target between its stages, so it has to clamp itself, and this is the case that
/// catches it if it stops: `brightness(2.0)` drives most of the ramp past 1.0, and
/// `contrast(0.5)` then pulls it back. Without a clamp between them the tail of the ramp comes
/// back at 0.85 rather than 0.75 — a difference of 26 codes, nowhere near the tolerance above.
#[test]
fn fusing_preserves_the_clamp_the_unorm_target_used_to_provide() {
    let width = 256;
    let staged = [scalar("brightness", 2.0), scalar("contrast", 0.5)];
    let fused = [stack(&[1.0, 2.0, 2.0, 0.5])];

    let Some(staged) = run(&staged, width) else {
        return;
    };
    let fused = run(&fused, width).expect("the GPU was there a moment ago");

    let worst = staged
        .iter()
        .zip(&fused)
        .map(|(a, b)| a.abs_diff(*b))
        .max()
        .expect("the ramp is not empty");
    assert!(
        worst <= 1,
        "an over-1.0 stack diverged by {worst} codes — the per-stage clamp is gone"
    );
    // And the value it clamps *to* is the one the staged path produced: 1.0 through contrast
    // 0.5 about mid-grey is 0.75, or 191.
    let brightest = *fused.last().expect("the ramp is not empty");
    assert!(
        brightest.abs_diff(191) <= 1,
        "white through brightness 2.0 then contrast 0.5 should land at ~191, got {brightest}"
    );
}

/// The precision claim, which is the reason the change is worth making.
///
/// Squeeze the ramp and stretch it back. Each staged pass rounds to 1/255 on the way out, so
/// the squeeze throws away levels the stretch cannot recover and the histogram comes back with
/// gaps. The fused pass keeps the intermediate in float, so more of the ramp survives.
///
/// Measured on Metal at the time of writing: the staged path returns **64** distinct levels of
/// the 256 it started with, the fused path returns **256**. That 4× is not a rounding
/// curiosity — it is exactly the banding a grade puts into a sky, and it is the entire return
/// on this change. Asserted as an inequality rather than as those two numbers because the
/// margin is what matters and a GPU is entitled to round differently.
#[test]
fn fusing_keeps_levels_the_staged_path_threw_away() {
    let width = 256;
    // Contrast 0.25 about mid-grey compresses the ramp into the middle quarter — at 8 bits
    // that is ~64 surviving levels — and contrast 4.0 stretches it back out.
    let staged = [scalar("contrast", 0.25), scalar("contrast", 4.0)];
    let fused = [stack(&[2.0, 0.25, 2.0, 4.0])];

    let Some(staged) = run(&staged, width) else {
        return;
    };
    let fused = run(&fused, width).expect("the GPU was there a moment ago");

    let distinct = |row: &[u8]| {
        let mut seen = row.to_vec();
        seen.sort_unstable();
        seen.dedup();
        seen.len()
    };
    let staged_levels = distinct(&staged);
    let fused_levels = distinct(&fused);
    assert!(
        fused_levels > staged_levels,
        "fusing should recover levels the intermediate rounding destroyed: staged kept \
         {staged_levels}, fused kept {fused_levels}"
    );
}

/// Order is the user's list order, and a stage program has to honour it. These two stacks hold
/// the same operations and differ only in sequence; on a mid-grey input they land 64 codes
/// apart, so an implementation that sorted or commuted its stages could not pass both.
#[test]
fn a_stage_program_applies_its_stages_in_order() {
    let width = 256;
    let Some(contrast_first) = run(&[stack(&[2.0, 2.0, 1.0, 0.5])], width) else {
        return;
    };
    let brightness_first =
        run(&[stack(&[1.0, 0.5, 2.0, 2.0])], width).expect("the GPU was there a moment ago");

    // The ramp's midpoint is ~0.5. contrast(2.0) leaves it at 0.5, then brightness(0.5) → 0.25.
    // The other order: brightness(0.5) → 0.25, then contrast(2.0) → 0.0.
    let mid = width as usize / 2;
    assert!(
        contrast_first[mid].abs_diff(64) <= 2,
        "contrast then brightness should put mid-grey near 64, got {}",
        contrast_first[mid]
    );
    assert!(
        brightness_first[mid] <= 2,
        "brightness then contrast should crush mid-grey to black, got {}",
        brightness_first[mid]
    );
}

/// A run at exactly the limit still renders. One past it is the mapper's job to split, and is
/// refused here rather than silently truncated — see the unit tests in `pipeline.rs`.
#[test]
fn a_run_at_the_stage_limit_renders() {
    let mut stages = Vec::new();
    for _ in 0..MAX_COLOR_STACK_STAGES {
        // Eight identities: the interesting property is that the pass executes, not what it
        // computes. Contrast 1.0 is exactly the identity.
        stages.extend_from_slice(&[2.0, 1.0]);
    }
    let width = 64;
    let Some(out) = run(&[stack(&stages)], width) else {
        return;
    };
    let source: Vec<u8> = ramp_rgba(width, 1).chunks_exact(4).map(|p| p[0]).collect();
    assert_eq!(
        out, source,
        "eight identity stages should leave the ramp exactly as it was"
    );
}
