//! `lift-gamma-gain` on a real GPU: is a neutral wheel an identity, and does each wheel move
//! the part of the range its name claims?
//!
//! The second question is the one that earns the file. A transposed term in a grading shader —
//! gain where gamma should be, blue where red should be — produces a picture that is wrong and
//! *plausible*, and it survives eyeballing for a long time. So each wheel is checked at the two
//! ends of the range and at the middle, and the two it should not move are checked as hard as
//! the one it should.
//!
//! The convention under test is stated in the shader header. In short: lift is an offset that
//! lifts the toe and holds white, gamma is a power whose fixed points are 0 and 1, gain is a
//! multiply that holds black.
//!
//! Skips without a GPU; `BAY_REQUIRE_GPU=1` turns the skip into a failure.

use bay_effects::{ApplyEffectsOptions, EffectPass, EffectPipeline, UniformValue};
use bay_test_support::require_gpu;

const WIDTH: u32 = 256;
const HEIGHT: u32 = 4;

/// A horizontal black→white ramp, grey in every channel, repeated down four rows. At this
/// width `source[i] == i`, which makes every expectation below arithmetic on the index.
fn ramp_rgba() -> Vec<u8> {
    let mut buf = Vec::with_capacity((WIDTH * HEIGHT * 4) as usize);
    for _ in 0..HEIGHT {
        for x in 0..WIDTH {
            let value = ((x * 255) / (WIDTH - 1)) as u8;
            buf.extend_from_slice(&[value, value, value, 255]);
        }
    }
    buf
}

/// A ramp whose three channels differ, so a channel that leaks into another is visible.
/// Red ramps up, green sits at mid, blue ramps down.
fn split_ramp_rgba() -> Vec<u8> {
    let mut buf = Vec::with_capacity((WIDTH * HEIGHT * 4) as usize);
    for _ in 0..HEIGHT {
        for x in 0..WIDTH {
            let up = ((x * 255) / (WIDTH - 1)) as u8;
            buf.extend_from_slice(&[up, 128, 255 - up, 255]);
        }
    }
    buf
}

/// `(r, g, b, master)` per wheel, plus the strength. Neutral is `lift 0`, `gamma 1`, `gain 1`.
fn wheels(lift: [f32; 4], gamma: [f32; 4], gain: [f32; 4], amount: f32) -> EffectPass {
    EffectPass {
        shader: "lift-gamma-gain".to_string(),
        uniforms: [
            ("u_lift".to_string(), UniformValue::Vector(lift.to_vec())),
            ("u_gamma".to_string(), UniformValue::Vector(gamma.to_vec())),
            ("u_gain".to_string(), UniformValue::Vector(gain.to_vec())),
            ("u_amount".to_string(), UniformValue::Number(amount)),
        ]
        .into(),
        lut: None,
    }
}

const NEUTRAL_LIFT: [f32; 4] = [0.0, 0.0, 0.0, 0.0];
const NEUTRAL_GAMMA: [f32; 4] = [1.0, 1.0, 1.0, 1.0];
const NEUTRAL_GAIN: [f32; 4] = [1.0, 1.0, 1.0, 1.0];

/// Render `passes` over `source` and return the whole RGBA readback.
fn render(source_pixels: &[u8], passes: &[EffectPass]) -> Option<Vec<u8>> {
    let ctx = require_gpu()?;
    let pipeline = EffectPipeline::new(&ctx);
    let source = ctx
        .upload_rgba_texture(source_pixels, WIDTH, HEIGHT, "lift-gamma-gain-test")
        .expect("a correctly sized ramp uploads");
    let out = pipeline
        .apply(
            &ctx,
            ApplyEffectsOptions {
                source: &source,
                width: WIDTH,
                height: HEIGHT,
                passes,
            },
        )
        .expect("the passes render");
    ctx.read_texture_rgba(&out, WIDTH, HEIGHT)
}

/// The red channel of the first row.
fn red_row(rgba: &[u8]) -> Vec<u8> {
    rgba.chunks_exact(4)
        .take(WIDTH as usize)
        .map(|texel| texel[0])
        .collect()
}

/// The three channels at one column of the first row.
fn texel(rgba: &[u8], column: usize) -> [u8; 3] {
    let base = column * 4;
    [rgba[base], rgba[base + 1], rgba[base + 2]]
}

const BLACK: usize = 0;
const MID: usize = 128;
const WHITE: usize = 255;

fn near(actual: u8, expected: u8, what: &str) {
    assert!(
        actual.abs_diff(expected) <= 2,
        "{what}: expected ~{expected}, got {actual}"
    );
}

/// A wheel at rest must not change a single byte. Not "within a code" — a colourist toggles a
/// node on and off to see what it did, and a neutral node that moves the picture at all makes
/// that comparison lie.
#[test]
fn a_neutral_wheel_set_is_a_bit_exact_identity() {
    let source = split_ramp_rgba();
    let Some(out) = render(
        &source,
        &[wheels(NEUTRAL_LIFT, NEUTRAL_GAMMA, NEUTRAL_GAIN, 1.0)],
    ) else {
        return;
    };
    assert_eq!(
        out, source,
        "a neutral lift/gamma/gain changed the frame — the identity is not exact"
    );
}

/// The test that catches a transposed term. Each wheel alone, checked at black, mid and white.
///
/// * **lift 0.25** — black rises to 0.25, white does not move, mid rises by 0.25 of what is
///   left above it: 0.502 + 0.25·0.498 = 0.626.
/// * **gamma 2.0** — both ends are fixed points, and the mid goes to 0.502^(1/2) = 0.709.
/// * **gain 0.5** — black is a fixed point, white halves, and so does the mid.
///
/// A shader that swapped gamma and gain would put white at 128 in the gamma case and at 255 in
/// the gain case: both assertions below would fail, in opposite directions.
#[test]
fn each_wheel_moves_the_part_of_the_range_it_claims() {
    let source = ramp_rgba();

    let Some(lifted) = render(
        &source,
        &[wheels(
            [0.25, 0.25, 0.25, 0.0],
            NEUTRAL_GAMMA,
            NEUTRAL_GAIN,
            1.0,
        )],
    ) else {
        return;
    };
    let lifted = red_row(&lifted);
    near(lifted[BLACK], 64, "lift 0.25 should raise black to 0.25");
    near(lifted[MID], 160, "lift 0.25 should raise the mid to 0.626");
    assert_eq!(
        lifted[WHITE], 255,
        "lift holds white — a lift that moved it is an offset, which is a different control"
    );

    let curved = red_row(
        &render(
            &source,
            &[wheels(
                NEUTRAL_LIFT,
                [2.0, 2.0, 2.0, 1.0],
                NEUTRAL_GAIN,
                1.0,
            )],
        )
        .expect("the GPU was there a moment ago"),
    );
    assert_eq!(curved[BLACK], 0, "gamma holds black");
    near(curved[MID], 181, "gamma 2.0 should put the mid at 0.709");
    assert_eq!(
        curved[WHITE], 255,
        "gamma holds white — both ends of the range are fixed points"
    );

    let gained = red_row(
        &render(
            &source,
            &[wheels(
                NEUTRAL_LIFT,
                NEUTRAL_GAMMA,
                [0.5, 0.5, 0.5, 1.0],
                1.0,
            )],
        )
        .expect("the GPU was there a moment ago"),
    );
    assert_eq!(
        gained[BLACK], 0,
        "gain holds black — a gain that moved it is a lift"
    );
    near(gained[MID], 64, "gain 0.5 should halve the mid");
    near(gained[WHITE], 128, "gain 0.5 should halve white");
}

/// The other transposition: a wheel's red term reaching the green or blue channel. Each wheel
/// is driven hard on red alone over a ramp whose three channels differ, and the two channels
/// that should not move are required to be byte-identical to the source.
#[test]
fn a_wheel_touches_only_the_channel_it_is_indexed_by() {
    let source = split_ramp_rgba();
    let cases = [
        ("lift", [0.5, 0.0, 0.0, 0.0], NEUTRAL_GAMMA, NEUTRAL_GAIN),
        ("gamma", NEUTRAL_LIFT, [2.5, 1.0, 1.0, 1.0], NEUTRAL_GAIN),
        ("gain", NEUTRAL_LIFT, NEUTRAL_GAMMA, [0.4, 1.0, 1.0, 1.0]),
    ];
    let mut ran = false;
    for (name, lift, gamma, gain) in cases {
        let Some(out) = render(&source, &[wheels(lift, gamma, gain, 1.0)]) else {
            return;
        };
        ran = true;
        for column in [BLACK, MID, WHITE] {
            let got = texel(&out, column);
            let want = texel(&source, column);
            assert_eq!(
                (got[1], got[2]),
                (want[1], want[2]),
                "the {name} wheel's red term leaked into green or blue at column {column}"
            );
        }
        // And red did move, or the assertion above is satisfied by a shader that does nothing.
        assert_ne!(
            texel(&out, MID)[0],
            texel(&source, MID)[0],
            "the {name} wheel's red term changed nothing at all"
        );
    }
    assert!(ran, "a GPU was available at the top of the loop");
}

/// A master is its wheel applied to all three channels at once, in that wheel's own units:
/// added for lift, multiplied for gamma and gain. Byte-exact, because the two spellings feed
/// the same arithmetic — `gain.rgb * gain.w` is one multiply either way round.
#[test]
fn a_master_is_the_same_arithmetic_as_the_three_channels_together() {
    let source = split_ramp_rgba();
    let Some(spelled_out) = render(
        &source,
        &[wheels(
            [0.06, 0.06, 0.06, 0.0],
            [1.2, 1.2, 1.2, 1.0],
            [0.8, 0.8, 0.8, 1.0],
            1.0,
        )],
    ) else {
        return;
    };
    let by_master = render(
        &source,
        &[wheels(
            [0.0, 0.0, 0.0, 0.06],
            [1.0, 1.0, 1.0, 1.2],
            [1.0, 1.0, 1.0, 0.8],
            1.0,
        )],
    )
    .expect("the GPU was there a moment ago");
    assert_eq!(
        spelled_out, by_master,
        "a master did not reproduce the same setting written into all three channels"
    );
}

/// Gain alone, with the other two wheels at rest, is exactly `brightness` — the same multiply,
/// with the same reliance on the `Bgra8Unorm` target to clamp above 1.0.
///
/// This is the clamp assertion. `brightness.wgsl` has never clamped; it is the shader that
/// established that the target owns the top of the range, and
/// `docs/native/intermediate-format.md` records that as a deferred decision rather than a
/// settled one. A `lift-gamma-gain` that clamped internally would diverge here — at gain 2.0
/// most of the ramp is driven past 1.0, so an internal clamp and the hardware one are only the
/// same answer by accident, and only until something is composited on top.
#[test]
fn gain_alone_is_brightness_including_where_the_clamp_comes_from() {
    let source = ramp_rgba();
    let brightness = EffectPass {
        shader: "brightness".to_string(),
        uniforms: [("u_amount".to_string(), UniformValue::Number(2.0))].into(),
        lut: None,
    };
    let Some(reference) = render(&source, &[brightness]) else {
        return;
    };
    let graded = render(
        &source,
        &[wheels(
            NEUTRAL_LIFT,
            NEUTRAL_GAMMA,
            [2.0, 2.0, 2.0, 1.0],
            1.0,
        )],
    )
    .expect("the GPU was there a moment ago");
    assert_eq!(
        graded, reference,
        "gain 2.0 diverged from brightness 2.0 — either the multiply or the clamp differs"
    );
    // The top half of the ramp is above 1.0 and comes back clamped, not wrapped.
    assert_eq!(
        red_row(&graded)[WHITE],
        255,
        "white through gain 2.0 should clamp at 255"
    );
}

/// Strength is the dial that makes a grade adjustable after the fact, the way `lut`'s amount
/// is. At 0 the wheels are inert however hard they are driven; at 0.5 the result sits between.
///
/// Two settings, because the two halves are different claims. The *inert* half is checked with
/// wheels pushed past the range, since that is where an accidental clamp or an early exit
/// would show. The *halfway* half is checked with a grade deliberately kept inside 0..1: the
/// mix happens before the target's clamp, so with a clipping grade the half-strength result is
/// **not** the midpoint of the two clamped endpoints — it is the midpoint of the unclamped
/// ones, then clamped, which is a different and correct number. Asserting the midpoint of what
/// comes back only means anything while nothing clips.
#[test]
fn strength_dials_the_whole_grade_back() {
    let source = split_ramp_rgba();
    let wild = (
        [0.4, 0.0, -0.2, 0.05],
        [1.8, 0.7, 1.1, 1.0],
        [1.3, 0.9, 0.6, 1.0],
    );

    let Some(off) = render(&source, &[wheels(wild.0, wild.1, wild.2, 0.0)]) else {
        return;
    };
    assert_eq!(
        off, source,
        "strength 0 must leave the source untouched, however far the wheels are pushed"
    );

    // In-range on every channel at every column: the largest result is white through gain 0.85.
    let contained = (
        [0.10, 0.0, -0.05, 0.02],
        [1.4, 0.8, 1.1, 1.0],
        [0.85, 0.95, 0.7, 1.0],
    );
    let full = render(
        &source,
        &[wheels(contained.0, contained.1, contained.2, 1.0)],
    )
    .expect("the GPU was there a moment ago");
    let half = render(
        &source,
        &[wheels(contained.0, contained.1, contained.2, 0.5)],
    )
    .expect("the GPU was there a moment ago");
    for column in [BLACK, MID, WHITE] {
        for channel in 0..3 {
            let (a, b, m) = (
                texel(&source, column)[channel] as i32,
                texel(&full, column)[channel] as i32,
                texel(&half, column)[channel] as i32,
            );
            if a == b {
                continue;
            }
            let midpoint = (a + b) / 2;
            assert!(
                (m - midpoint).abs() <= 2,
                "strength 0.5 at column {column} channel {channel}: {a} → {b} should pass \
                 through ~{midpoint}, got {m}"
            );
        }
    }
}
