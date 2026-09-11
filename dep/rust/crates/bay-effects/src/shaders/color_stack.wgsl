// A run of consecutive per-pixel colour operations, applied in one pass.
//
// `brightness`, `contrast`, `saturation` and `lut` are all pure functions of a single texel —
// none of them reads a neighbour — so a run of them composes exactly. Running them as four
// passes cost four full-screen draws, four render targets, and, because every target was an
// 8-bit unorm, three quantisations of an intermediate nobody ever looked at.
//
// The stage program arrives as a uniform array rather than as specialised shader variants
// because effect order is the *user's* list order: `saturation → brightness` is a different
// picture from `brightness → saturation`, and a shader with a fixed stage order could not
// express both. `stage_count` and every op code come from a uniform, so the loop and its
// branches are uniform control flow across the whole draw.
//
// **The per-stage clamp is not a style choice — it is the compatibility contract.** Each of
// these effects used to write into a `Bgra8Unorm` target, and a unorm target clamps to 0..1 in
// hardware on every write. `contrast` and `saturation` also clamp in their own source;
// `brightness` never did, and relied entirely on that hardware clamp. Clamping after each stage
// here reproduces the staged path's behaviour exactly, including for stacks that push above 1.
// What it does *not* reproduce is the quantisation to 1/255, which is the whole point.

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// Kept in lockstep with `MAX_COLOR_STACK_STAGES` in pipeline.rs, which pins the two together
// with a test — a run longer than this splits into a second pass rather than silently losing
// its tail.
const MAX_COLOR_STACK_STAGES: u32 = 8u;

struct ColorStackUniforms {
    resolution: vec2f,
    stage_count: u32,
    // Edge length of the cube bound at group(2). Meaningless unless a `lut` stage is present;
    // an identity cube is bound when none is, so the binding is always satisfied.
    lut_size: f32,
    // Per stage: (op code, amount, unused, unused). `vec4f` because a uniform array's element
    // stride is 16 bytes regardless, so packing tighter would buy nothing.
    stages: array<vec4f, MAX_COLOR_STACK_STAGES>,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: ColorStackUniforms;
@group(2) @binding(0) var lut_texture: texture_3d<f32>;
@group(2) @binding(1) var lut_sampler: sampler;

const OP_BRIGHTNESS: u32 = 1u;
const OP_CONTRAST: u32 = 2u;
const OP_SATURATION: u32 = 3u;
const OP_LUT: u32 = 4u;

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let source = textureSample(input_texture, input_sampler, input.tex_coord);
    var rgb = source.rgb;

    for (var index = 0u; index < uniforms.stage_count; index = index + 1u) {
        let stage = uniforms.stages[index];
        let op = u32(stage.x);
        let amount = stage.y;

        if (op == OP_BRIGHTNESS) {
            // Matches brightness.wgsl: scale colour, leave alpha.
            rgb = rgb * amount;
        } else if (op == OP_CONTRAST) {
            // Matches contrast.wgsl: pivot around mid-grey.
            rgb = (rgb - vec3f(0.5)) * amount + vec3f(0.5);
        } else if (op == OP_SATURATION) {
            // Matches saturation.wgsl: Rec. 709 luma, mix towards or away from grey.
            let luma = dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
            rgb = mix(vec3f(luma), rgb, amount);
        } else if (op == OP_LUT) {
            // Matches lut.wgsl, including the half-texel inset. A LUT entry sits at the CENTRE
            // of its texel; sampling with the raw 0..1 colour reads half a texel short at both
            // ends, which shows up as crushed blacks and clipped highlights.
            let strength = clamp(amount, 0.0, 1.0);
            let size = max(uniforms.lut_size, 2.0);
            let scale = (size - 1.0) / size;
            let offset = 1.0 / (2.0 * size);
            let coord = clamp(rgb, vec3f(0.0), vec3f(1.0)) * scale + offset;
            // `textureSampleLevel` rather than `textureSample`: the cube has no mips, so the
            // two are equivalent here, and the explicit level carries no implicit-derivative
            // requirement — which keeps this legal inside the loop no matter how a backend's
            // uniformity analysis treats a uniform-bounded branch.
            let graded = textureSampleLevel(lut_texture, lut_sampler, coord, 0.0).rgb;
            rgb = mix(rgb, graded, strength);
        }

        // The 8-bit unorm target each staged pass used to write into. See the header.
        rgb = clamp(rgb, vec3f(0.0), vec3f(1.0));
    }

    // Alpha is never touched by any of these ops, in either path.
    return vec4f(rgb, source.a);
}
