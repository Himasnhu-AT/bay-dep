// Three-way colour balance: lift, gamma, gain, per channel, with a master under each wheel.
//
// # The convention this implements, stated so it can be compared
//
// "Lift/gamma/gain" is not one formula. Someone will eventually put bay's wheels beside
// Resolve's, or Nuke's, and find they do not land in the same place — so here is exactly what
// these three do, in application order:
//
//   1. **lift** — `y = x + lift * (1 - x)`. An offset weighted towards the toe. Black maps to
//      `lift`; **white is a fixed point** and does not move. This is the Shake/Nuke `lift`,
//      not a flat `x + lift` offset: a flat offset would drag white with it, which is what
//      "offset" means and is a different control.
//   2. **gamma** — `y = pow(y, 1 / gamma)`. A power curve whose fixed points are **0 and 1**;
//      there is no separate pivot parameter, so the pivot is the range itself and the
//      midpoint is what moves. `gamma > 1` brightens the mids (0.5 → 0.5^(1/1.2) ≈ 0.561),
//      `gamma < 1` darkens them. Reciprocal rather than direct so that "turn gamma up" means
//      "make the mids brighter", which is the direction every grading UI uses.
//   3. **gain** — `y = y * gain`. A multiply. **Black is a fixed point**; white maps to `gain`.
//
// Neutral is therefore `lift = 0, gamma = 1, gain = 1` and that is an exact identity — no
// pivot arithmetic runs on a neutral wheel, so it is bit-exact rather than nearly so.
//
// The three are orthogonal at the ends of the range, which is what makes a wheel legible: with
// only one wheel off neutral, lift moves black and leaves white alone, gain moves white and
// leaves black alone, and gamma moves neither end.
//
// Each wheel's `.w` is its master — the slider under the wheel in every grading UI. It joins
// its wheel in that wheel's own units: added for lift, multiplied for gamma and gain, so a
// master at its own neutral (0, 1, 1) changes nothing.
//
// # Clamping
//
// **This pass clamps the low end only, and only where it must.** `pow` of a negative base is
// undefined in WGSL, and a negative lift takes the toe below zero legitimately — so the gamma
// stage floors its input at 0. Nothing floors it at 1: values above 1.0 travel through `pow`
// and the gain multiply intact and are clamped by the `Bgra8Unorm` target on write, exactly as
// `brightness.wgsl` relies on. What happens above 1.0 is a value-range decision that
// `docs/native/intermediate-format.md` defers to `P0-MED-02`; this shader does not settle it.
//
// # Why this is not a `color-stack` stage
//
// A stage in `color_stack.wgsl` carries one scalar. This pass carries twelve, so it cannot be
// folded into that program without widening every stage to hold parameters eleven-twelfths of
// them never use. The cost is real and worth naming: a lift/gamma/gain sitting between two
// scalar colour effects ends the run, so the frame takes one extra 8-bit round trip there.

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// A separate struct fronting the same bind group layout as `EffectUniforms`, the way
// `ColorStackUniforms` does: the layout declares a uniform buffer at binding 0 and says
// nothing about its size. Three wheels do not fit in the shared struct's `scalars: vec4f`,
// and widening that struct would make six shaders declare fields they never read.
struct LiftGammaGainUniforms {
    resolution: vec2f,
    // How much of the grade to apply: 0 leaves the source untouched, 1 is the full balance.
    // Named `u_amount` on the way in, matching `lut` — the one dial a person reaches for.
    strength: f32,
    _padding: f32,
    // rgb = the wheel, w = its master. Neutral: lift (0,0,0,0), gamma (1,1,1,1), gain (1,1,1,1).
    lift: vec4f,
    gamma: vec4f,
    gain: vec4f,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: LiftGammaGainUniforms;

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let source = textureSample(input_texture, input_sampler, input.tex_coord);

    let lift = uniforms.lift.rgb + vec3f(uniforms.lift.w);
    // Floored rather than trusted: a gamma of 0 is a division by zero and an infinite
    // exponent, and the number arrives from a uniform a person can type into.
    let gamma = max(uniforms.gamma.rgb * uniforms.gamma.w, vec3f(1.0e-3));
    let gain = uniforms.gain.rgb * uniforms.gain.w;

    // 1. Lift the toe, hold white.
    let lifted = source.rgb + lift * (vec3f(1.0) - source.rgb);
    // 2. Power on the mids. `max` at zero is the NaN guard described in the header — a
    //    negative lift is a legitimate setting and `pow` of a negative base is not.
    let curved = pow(max(lifted, vec3f(0.0)), vec3f(1.0) / gamma);
    // 3. Multiply the top, hold black.
    let graded = curved * gain;

    // No upper clamp: see the header. The unorm target owns that, as it does for brightness.
    let strength = clamp(uniforms.strength, 0.0, 1.0);
    return vec4f(mix(source.rgb, graded, strength), source.a);
}
