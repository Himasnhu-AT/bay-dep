//! P0-GPU-02 — native texture I/O + compositor round-trip on a real GPU device.
//!
//! These are the executable proofs for the Phase-0 GPU-upload gate: a CPU-side RGBA8
//! buffer is uploaded into a wgpu texture (native format swizzle + row pitch), rendered
//! through the *reused* `Compositor::render_frame_to_texture`, and read back — validating
//! format, alignment, and the layer pipeline end-to-end with no browser/Canvas path.
//!
//! Runs headless on any backend wgpu can reach (Metal / Vulkan / DX12). If no adapter is
//! available (e.g. a GPU-less CI runner), each test skips rather than failing so the suite
//! stays green until the Phase-0 CI matrix (P0-MED-03) provisions GPU runners — set
//! `BAY_REQUIRE_GPU=1` (as CI does on a GPU runner) to turn that skip into a hard failure.

use bay_compositor::{
    BlendMode, CanvasClearDescriptor, Compositor, FrameDescriptor, FrameItemDescriptor,
    LayerDescriptor, QuadTransformDescriptor,
};
use bay_test_support::require_gpu;

/// A per-pixel RGBA gradient — distinct in every channel and every row so a stride/padding
/// or channel-swizzle bug cannot accidentally pass.
fn gradient_rgba(width: u32, height: u32) -> Vec<u8> {
    let mut buf = Vec::with_capacity((width * height * 4) as usize);
    for y in 0..height {
        for x in 0..width {
            buf.push((x * 16) as u8); // R
            buf.push((y * 16) as u8); // G
            buf.push(((x + y) * 8) as u8); // B
            buf.push(255); // A
        }
    }
    buf
}

/// Upload → read back must reproduce the source bytes exactly. Exercises the 256-byte
/// row-pitch padding (an 8-wide RGBA row is 32 bytes, padded to 256) and the BGRA swizzle
/// (applied on upload, reversed on readback), so the identity here proves both.
#[test]
fn native_rgba_upload_readback_is_identity() {
    let Some(ctx) = require_gpu() else { return };

    let (width, height) = (8u32, 8u32);
    let source = gradient_rgba(width, height);

    let texture = ctx
        .upload_rgba_texture(&source, width, height, "test-upload")
        .expect("a correctly sized buffer uploads");
    let read_back = ctx
        .read_texture_rgba(&texture, width, height)
        .expect("readback succeeds on a live device");

    assert_eq!(read_back.len(), source.len());
    assert_eq!(
        read_back, source,
        "native upload→readback round-trip changed pixel bytes (swizzle or row-pitch bug)"
    );
}

/// Upload an opaque solid color, composite it as a single full-frame layer via the reused
/// compositor, read back, and assert the fill matches. `Normal` blend of an opaque layer
/// resolves to exactly the layer color, so this is deterministic within unorm8 rounding.
#[test]
fn native_render_frame_to_texture_fills_with_layer_color() {
    let Some(ctx) = require_gpu() else { return };

    let (width, height) = (16u32, 16u32);
    let color = [200u8, 100u8, 50u8, 255u8];
    let source: Vec<u8> = std::iter::repeat_n(color, (width * height) as usize)
        .flatten()
        .collect();

    let mut compositor = Compositor::new(&ctx);
    let texture = ctx
        .upload_rgba_texture(&source, width, height, "test-layer-source")
        .expect("a correctly sized buffer uploads");
    compositor.upsert_texture("layer-0".to_string(), texture);

    let frame = FrameDescriptor {
        width,
        height,
        clear: CanvasClearDescriptor {
            color: [0.0, 0.0, 0.0, 1.0],
        },
        items: vec![FrameItemDescriptor::Layer(LayerDescriptor {
            texture_id: "layer-0".to_string(),
            transform: QuadTransformDescriptor {
                center_x: width as f32 / 2.0,
                center_y: height as f32 / 2.0,
                width: width as f32,
                height: height as f32,
                rotation_degrees: 0.0,
                flip_x: false,
                flip_y: false,
            },
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            effect_pass_groups: Vec::new(),
            mask: None,
        })],
    };

    let scene = compositor
        .render_frame_to_texture(&ctx, &frame)
        .expect("render_frame_to_texture should succeed");
    let pixels = ctx
        .read_texture_rgba(&scene, width, height)
        .expect("readback succeeds on a live device");

    // Sample the center pixel — away from any quad-edge interpolation.
    let cx = width / 2;
    let cy = height / 2;
    let idx = ((cy * width + cx) * 4) as usize;
    let center = &pixels[idx..idx + 4];

    for (channel, (&got, &want)) in center.iter().zip(color.iter()).enumerate() {
        let delta = (got as i16 - want as i16).abs();
        assert!(
            delta <= 1,
            "center pixel channel {channel}: got {got}, want {want} (delta {delta} > 1)"
        );
    }
}

/// `CLAUDE.md`: the render path cannot panic on bad input. `upload_rgba_texture` used to
/// `assert_eq!` the buffer length against `width * height * 4`, so a rasterizer that handed back
/// a short buffer aborted the whole editor instead of costing one layer.
///
/// Table-driven over every way the input can disagree with itself. Each case must return `None`
/// and leave the device usable, which the final upload proves.
#[test]
fn a_mis_sized_buffer_is_refused_instead_of_aborting() {
    let Some(ctx) = require_gpu() else { return };

    let (width, height) = (8u32, 8u32);
    let correct = gradient_rgba(width, height);

    let cases: [(&str, Vec<u8>, u32, u32); 5] = [
        (
            "one byte short",
            correct[..correct.len() - 1].to_vec(),
            8,
            8,
        ),
        ("one byte long", [correct.clone(), vec![0]].concat(), 8, 8),
        ("empty", Vec::new(), 8, 8),
        ("zero width", correct.clone(), 0, 8),
        ("zero height", correct.clone(), 8, 0),
    ];

    for (what, buffer, w, h) in cases {
        assert!(
            ctx.upload_rgba_texture(&buffer, w, h, "test-bad-upload")
                .is_none(),
            "{what}: a buffer that disagrees with {w}x{h} must be refused, not asserted on"
        );
    }

    assert!(
        ctx.upload_rgba_texture(&correct, width, height, "test-good-upload")
            .is_some(),
        "the device must still be usable after refusing bad input"
    );
}
