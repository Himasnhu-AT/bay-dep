// Apply a 3D lookup table: a whole grade in one sample.

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

struct EffectUniforms {
    resolution: vec2f,
    direction: vec2f,
    scalars: vec4f,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;
@group(2) @binding(0) var lut_texture: texture_3d<f32>;
@group(2) @binding(1) var lut_sampler: sampler;

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    // scalars.x = how much of the grade to apply (0 = untouched, 1 = full).
    // scalars.y = the cube's edge length, needed to land on texel centres.
    let amount = clamp(uniforms.scalars.x, 0.0, 1.0);
    let size = max(uniforms.scalars.y, 2.0);
    let color = textureSample(input_texture, input_sampler, input.tex_coord);

    // A LUT entry sits at the CENTRE of its texel, not at its edge. Sampling with the raw
    // 0..1 colour would read half a texel short at both ends, which shows up as crushed
    // blacks and clipped highlights — the two places a grade is judged.
    let scale = (size - 1.0) / size;
    let offset = 1.0 / (2.0 * size);
    let coord = clamp(color.rgb, vec3f(0.0), vec3f(1.0)) * scale + offset;

    let graded = textureSample(lut_texture, lut_sampler, coord).rgb;
    // Alpha is never graded: a LUT describes colour, and running it through one would make
    // every soft edge in the frame a different shape.
    return vec4f(mix(color.rgb, graded, amount), color.a);
}
