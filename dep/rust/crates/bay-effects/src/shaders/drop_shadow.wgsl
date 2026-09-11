// A layer drop shadow: a blurred, offset, tinted copy of this layer's own alpha,
// composited *under* the layer.
//
// One pass, not the separable two the gaussian blur uses. A separable shadow would need the
// unblurred layer to still exist when the second pass runs, and the effect chain hands each
// pass only the previous pass's output — so the sharp copy would already be gone. Sampling a
// 2-D kernel here keeps the original and the shadow in the same pass, at the cost of 49 taps
// instead of 2 x 61.
//
// This is not `TextShadow`. That one is rastered into the glyph bitmap by `bay-text` and is a
// typographic decoration; this applies to any visual element and every parameter is a plain
// scalar, so `effect.<id>.<param>` animation channels drive it with no extra plumbing.

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

// Half-width of the sample grid. 3 gives a 7x7 kernel.
const RADIUS: i32 = 3;

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let texel = vec2f(1.0, 1.0) / uniforms.resolution;
    let sigma = max(uniforms.scalars.x, 0.0001);
    let opacity = clamp(uniforms.scalars.y, 0.0, 1.0);
    let spread = uniforms.scalars.z;

    let source = textureSample(input_texture, input_sampler, input.tex_coord);

    // Walk back along the offset to find the alpha that casts this pixel's shadow.
    let shadow_uv = input.tex_coord - uniforms.direction * texel;

    // Spacing is tied to sigma so the kernel widens with the blur instead of sampling the
    // same 7x7 pixels harder. Beyond about 2 sigma the weights are below the eye's floor,
    // so the grid spans +/- 1.5 sigma and spends its taps where the falloff actually is.
    let spacing = sigma * 0.5;

    var accumulated = 0.0;
    var total_weight = 0.0;
    for (var y = -RADIUS; y <= RADIUS; y = y + 1) {
        for (var x = -RADIUS; x <= RADIUS; x = x + 1) {
            let step = vec2f(f32(x), f32(y)) * spacing;
            // Separable weights, evaluated per tap: the product of two 1-D gaussians is the
            // 2-D one, so the kernel stays a real gaussian rather than a box.
            let weight = exp(-(step.x * step.x + step.y * step.y) / (2.0 * sigma * sigma));
            let sample_uv = shadow_uv + step * texel;
            accumulated = accumulated + textureSample(input_texture, input_sampler, sample_uv).a * weight;
            total_weight = total_weight + weight;
        }
    }

    // `spread` thickens the shadow before the clamp, which is what a designer means by a
    // spread radius: more of the blur reaching full opacity, not a wider blur.
    let shadow_alpha = clamp(accumulated / total_weight * (1.0 + spread), 0.0, 1.0) * opacity;

    // Source over shadow, straight (non-premultiplied) alpha, matching the rest of the chain.
    let out_alpha = source.a + shadow_alpha * (1.0 - source.a);
    if (out_alpha <= 0.0) {
        return vec4f(0.0, 0.0, 0.0, 0.0);
    }
    let out_rgb =
        (source.rgb * source.a + uniforms.color.rgb * shadow_alpha * (1.0 - source.a)) / out_alpha;
    return vec4f(out_rgb, out_alpha);
}
