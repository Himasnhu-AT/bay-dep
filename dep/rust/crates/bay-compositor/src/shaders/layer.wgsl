struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

struct LayerUniforms {
    resolution: vec2f,
    center: vec2f,
    size: vec2f,
    rotation_radians: f32,
    opacity: f32,
    flip_x: f32,
    flip_y: f32,
    crop_offset: vec2f,
    crop_size: vec2f,
    // Tilt about the layer's own horizontal (x) and vertical (y) axes, in radians. A card
    // standing up out of the screen rather than lying flat on it. Both zero is the flat case,
    // which every project written before tilt existed is.
    tilt: vec2f,
}

@group(0) @binding(0) var source_texture: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: LayerUniforms;

// How far the eye sits from the plane, as a multiple of the layer's longer side.
//
// This is the whole look of a tilt and it is not an authored number, on purpose: an agent that
// can set both an angle and a focal length can produce a 3 degree tilt that fisheyes and a 40
// degree one that stays flat, and then the angle no longer means anything. Fixed here so a
// tilt of 10 degrees is the same picture in every project. 1.25 puts roughly 15% between the
// near and far edges at 10 degrees — the depth reads, and straight edges stay believable.
const EYE_DISTANCE: f32 = 1.25;

fn rotate_inverse(point: vec2f, angle: f32) -> vec2f {
    let c = cos(angle);
    let s = sin(angle);
    return vec2f(
        point.x * c + point.y * s,
        -point.x * s + point.y * c,
    );
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let pixel = input.tex_coord * uniforms.resolution;
    let local = rotate_inverse(pixel - uniforms.center, uniforms.rotation_radians);

    // Un-project before un-scaling. Forward, a point on the card is tilted out of the screen
    // and then divided by its depth; the inverse of that divide is what makes the far edge
    // narrow and the near edge wide. Because the projected scale `s` turns out to be *linear*
    // in screen coordinates, the inverse needs no iteration:
    //
    //   s = 1 - (x*tan(tiltY) - y*tan(tiltX)) / d
    //
    // and the point on the card is the screen point divided by s, then un-foreshortened by the
    // cosine of each angle.
    //
    // The minus on the y term is the sign convention, not an accident: screen y runs downward,
    // and this makes a positive tiltX lean the TOP away from the eye — the same direction CSS
    // `rotateX` goes. Every reference an author is likely to be copying an angle out of speaks
    // that dialect, so a tilt of -10 here is the -10 they meant.
    var card = local;
    if (uniforms.tilt.x != 0.0 || uniforms.tilt.y != 0.0) {
        let d = EYE_DISTANCE * max(uniforms.size.x, uniforms.size.y);
        let s = 1.0 - (local.x * tan(uniforms.tilt.y) - local.y * tan(uniforms.tilt.x)) / d;
        // At or behind the eye there is no picture to sample — the card has turned past edge-on.
        if (s <= 0.0001) {
            return vec4f(0.0, 0.0, 0.0, 0.0);
        }
        card = vec2f(
            local.x / s / cos(uniforms.tilt.y),
            local.y / s / cos(uniforms.tilt.x),
        );
    }

    let uv = vec2f(
        card.x / uniforms.size.x + 0.5,
        card.y / uniforms.size.y + 0.5,
    );

    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        return vec4f(0.0, 0.0, 0.0, 0.0);
    }

    let sample_uv = vec2f(
        select(uv.x, 1.0 - uv.x, uniforms.flip_x > 0.5),
        select(uv.y, 1.0 - uv.y, uniforms.flip_y > 0.5),
    );
    // Reframe rather than squash: the quad still covers its own box, but it reads only the
    // kept region of the source. An uncropped layer has offset 0 and size 1, so this is the
    // identity for everything that came before crops existed.
    let cropped_uv = uniforms.crop_offset + sample_uv * uniforms.crop_size;
    let color = textureSampleLevel(source_texture, source_sampler, cropped_uv, 0.0);
    return vec4f(color.rgb, color.a * uniforms.opacity);
}
