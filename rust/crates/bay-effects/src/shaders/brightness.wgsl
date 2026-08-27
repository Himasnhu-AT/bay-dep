struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

struct EffectUniforms {
    resolution: vec2f,
    direction: vec2f,
    scalars: vec4f,
    color: vec4f,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    // scalars.x = brightness multiplier (1.0 = unchanged, <1 darker, >1 brighter).
    let amount = uniforms.scalars.x;
    let color = textureSample(input_texture, input_sampler, input.tex_coord);
    // Scale colour, preserve alpha.
    return vec4f(color.rgb * amount, color.a);
}
