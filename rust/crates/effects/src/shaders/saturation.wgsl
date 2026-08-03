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

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    // scalars.x = saturation amount (1.0 = unchanged, 0.0 = greyscale, >1 more vivid).
    let amount = uniforms.scalars.x;
    let color = textureSample(input_texture, input_sampler, input.tex_coord);
    // Rec. 709 luma; mix towards/away from grey, preserve alpha.
    let luma = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));
    let adjusted = mix(vec3f(luma), color.rgb, amount);
    return vec4f(clamp(adjusted, vec3f(0.0), vec3f(1.0)), color.a);
}
