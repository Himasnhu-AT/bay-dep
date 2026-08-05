//! The preview renderer composites scenes to non-empty BGRA frames on a real GPU (skips if
//! none — set `VII_REQUIRE_GPU=1` / `VII_REQUIRE_FFMPEG=1` to turn those skips into failures).

use opencut_preview::PreviewRenderer;
use opencut_project::{
    Effect, Element, ImageElement, MediaAsset, MediaTime, Project, Transform, VideoElement,
};
use test_support::{require_ffmpeg, require_ffmpeg_step, require_gpu_backed};

#[test]
fn renders_starter_scene_to_a_nonempty_frame() {
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let project = Project::starter();
    let (width, height) = (128, 72);
    let frame = renderer.render(
        project.active_scene(),
        MediaTime::ZERO,
        width,
        height,
        &project.settings.background,
        &project.media,
    );

    assert_eq!(frame.bgra.len() as u32, width * height * 4);
    let corner = &frame.bgra[0..4];
    assert!(
        frame.bgra.chunks_exact(4).any(|texel| texel != corner),
        "expected the composited title layer to differ from the background"
    );
}

#[test]
fn reuses_cached_text_rasters_across_frames() {
    // Re-rendering the same scene must not re-rasterise (and re-cache) unchanged text.
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let project = Project::starter();
    let (width, height) = (128, 72);
    let render_once = |renderer: &mut PreviewRenderer, at: MediaTime| {
        renderer.render(
            project.active_scene(),
            at,
            width,
            height,
            &project.settings.background,
            &project.media,
        );
    };

    render_once(&mut renderer, MediaTime::ZERO);
    let after_first = renderer.text_cache_len();
    assert!(
        after_first > 0,
        "starter scene has text; something should be cached"
    );

    // A second render at the same time re-draws identical text → no new cache entries.
    render_once(&mut renderer, MediaTime::ZERO);
    assert_eq!(
        renderer.text_cache_len(),
        after_first,
        "identical text should be served from the cache, not re-rasterised"
    );
}

#[test]
fn renders_a_clip_with_a_brightness_effect_without_error() {
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let mut project = Project::starter();
    if let Element::Text(title) = &mut project.active_scene_mut().tracks.main.elements[0] {
        title.effects.push(Effect {
            id: "fx1".into(),
            effect_type: "brightness".into(),
            enabled: true,
            params: [("amount".to_string(), 0.5)].into_iter().collect(),
        });
    }
    let (width, height) = (128, 72);
    let frame = renderer.render(
        project.active_scene(),
        MediaTime::ZERO,
        width,
        height,
        &project.settings.background,
        &project.media,
    );
    assert_eq!(frame.bgra.len() as u32, width * height * 4);
}

#[test]
fn renders_contrast_saturation_and_blur_on_gpu() {
    // Exercises the new effect shaders end-to-end (WGSL compiles + runs on the real GPU).
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    for effect_type in ["contrast", "saturation", "blur"] {
        let mut project = Project::starter();
        if let Element::Text(title) = &mut project.active_scene_mut().tracks.main.elements[0] {
            title.effects.push(Effect {
                id: format!("fx-{effect_type}"),
                effect_type: effect_type.into(),
                enabled: true,
                params: [("amount".to_string(), 1.5)].into_iter().collect(),
            });
        }
        let (width, height) = (128, 72);
        let frame = renderer.render(
            project.active_scene(),
            MediaTime::ZERO,
            width,
            height,
            &project.settings.background,
            &project.media,
        );
        assert_eq!(
            frame.bgra.len() as u32,
            width * height * 4,
            "{effect_type} produced a malformed frame"
        );
    }
}

#[test]
fn renders_a_real_image_element_from_disk() {
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };

    // Write a small solid-red PNG to a unique temp path.
    let path = std::env::temp_dir().join(format!("vii-test-image-{}.png", std::process::id()));
    image::RgbaImage::from_pixel(4, 4, image::Rgba([200, 30, 30, 255]))
        .save(&path)
        .unwrap();

    let mut project = Project::starter();
    project.media.push(MediaAsset {
        id: "m1".into(),
        name: "Pic".into(),
        path: path.to_string_lossy().into_owned(),
    });
    project
        .active_scene_mut()
        .tracks
        .main
        .elements
        .push(Element::Image(ImageElement {
            id: "img1".into(),
            name: "Pic".into(),
            start: MediaTime::ZERO,
            duration: MediaTime::from_ticks(120_000),
            media_id: "m1".into(),
            transform: Transform::default(),
            effects: Vec::new(),
            animations: Default::default(),
            blend_mode: Default::default(),
        }));

    let frame = renderer.render(
        project.active_scene(),
        MediaTime::ZERO,
        64,
        36,
        &project.settings.background,
        &project.media,
    );
    assert_eq!(frame.bgra.len(), 64 * 36 * 4);

    let _ = std::fs::remove_file(&path);
}

#[test]
fn renders_a_real_video_frame_via_ffmpeg() {
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };

    // Generate a short red test clip via ffmpeg; skip if ffmpeg isn't available.
    let path = std::env::temp_dir().join(format!("vii-test-video-{}.mp4", std::process::id()));
    let generated = std::process::Command::new("ffmpeg")
        .args([
            "-nostdin",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=32x32:d=1:r=10",
            "-frames:v",
            "10",
            "-pix_fmt",
            "yuv420p",
            path.to_str().unwrap(),
        ])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !require_ffmpeg_step(generated, "generate the h264 test clip") {
        return;
    }

    let mut project = Project::starter();
    project.media.push(MediaAsset {
        id: "v1".into(),
        name: "Vid".into(),
        path: path.to_string_lossy().into_owned(),
    });
    project
        .active_scene_mut()
        .tracks
        .main
        .elements
        .push(Element::Video(VideoElement {
            id: "vid1".into(),
            name: "Vid".into(),
            start: MediaTime::ZERO,
            duration: MediaTime::from_ticks(120_000),
            media_id: "v1".into(),
            trim_start: MediaTime::ZERO,
            trim_end: MediaTime::from_ticks(120_000),
            transform: Transform::default(),
            effects: Vec::new(),
            animations: Default::default(),
            blend_mode: Default::default(),
        }));

    // Clear the starter content so only the video clip is on screen; otherwise the title text
    // would satisfy any "something rendered" assertion and this test would pass with a broken
    // decoder (it previously asserted only buffer LENGTH, which held even for a missing file).
    {
        let scene = project.active_scene_mut();
        scene.tracks.overlay.clear();
        scene.tracks.main.elements.retain(|e| e.id() == "vid1");
    }

    // Decoding runs on a worker thread, so drive frames until it lands before asserting on
    // pixels (a single render would legitimately show the placeholder).
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    let mut frame = renderer.render(
        project.active_scene(),
        MediaTime::ZERO,
        64,
        36,
        &project.settings.background,
        &project.media,
    );
    while renderer.has_pending_decodes() && std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(20));
        frame = renderer.render(
            project.active_scene(),
            MediaTime::ZERO,
            64,
            36,
            &project.settings.background,
            &project.media,
        );
    }
    assert!(!renderer.has_pending_decodes(), "decode never completed");

    assert_eq!(frame.bgra.len(), 64 * 36 * 4);
    // The clip is solid red; decoded frames must actually reach the canvas.
    let red_texels = frame
        .bgra
        .chunks_exact(4)
        .filter(|t| t[2] > 150 && t[0] < 90 && t[1] < 90)
        .count();
    assert!(
        red_texels > 100,
        "expected the decoded red clip to fill the canvas, found {red_texels} red texels"
    );
    let _ = std::fs::remove_file(&path);
}

#[test]
fn exports_a_short_video_via_ffmpeg() {
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let project = Project::starter();
    let out = std::env::temp_dir().join(format!("vii-export-{}.mp4", std::process::id()));
    let ok = renderer.export_video(
        project.active_scene(),
        0.5,  // seconds
        10.0, // fps → 5 frames
        64,
        36,
        &project.settings.background,
        &project.media,
        out.to_str().unwrap(),
    );
    if !require_ffmpeg_step(ok, "encode the exported mp4") {
        return;
    }
    let size = std::fs::metadata(&out).map(|m| m.len()).unwrap_or(0);
    assert!(size > 0, "exported video should be non-empty");
    let _ = std::fs::remove_file(&out);
}

#[test]
fn blend_modes_actually_change_the_composited_frame() {
    // The 17-mode WGSL blend shader was previously unreachable (the preview hardcoded Normal).
    // Render the same scene under different modes and require the pixels to differ.
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    // Big enough that the title actually rasterizes, over a MID-GREY backdrop: on the default
    // black background every mode collapses to the same result (e.g. Difference(0,s) == s), so a
    // black backdrop would make this test vacuously pass-or-fail for the wrong reason.
    let (width, height) = (128, 72);
    let backdrop = opencut_project::Background::Color {
        color: "#808080".to_string(),
    };

    let render_with = |renderer: &mut PreviewRenderer, mode: opencut_project::BlendMode| {
        let mut project = Project::starter();
        if let Element::Text(title) = &mut project.active_scene_mut().tracks.main.elements[0] {
            title.blend_mode = mode;
        }
        renderer
            .render(
                project.active_scene(),
                MediaTime::ZERO,
                width,
                height,
                &backdrop,
                &project.media,
            )
            .bgra
    };

    let normal = render_with(&mut renderer, opencut_project::BlendMode::Normal);
    let difference = render_with(&mut renderer, opencut_project::BlendMode::Difference);
    let multiply = render_with(&mut renderer, opencut_project::BlendMode::Multiply);

    assert_eq!(normal.len(), (width * height * 4) as usize);
    // Guard: if the title never rasterized, every frame would be flat backdrop and the
    // comparisons below would be meaningless.
    let corner = &normal[0..4];
    assert!(
        normal.chunks_exact(4).any(|texel| texel != corner),
        "the title layer must actually be visible for this test to mean anything"
    );

    assert_ne!(
        normal, difference,
        "Difference must not composite identically to Normal"
    );
    assert_ne!(
        normal, multiply,
        "Multiply must not composite identically to Normal"
    );
}

#[test]
fn fit_contain_preserves_source_aspect_ratio() {
    // Pure geometry check of the fix for the stretch bug: a source is fitted into the scale
    // box, never distorted. Exercised through the public render path by the test below.
    // 16:9 source into a square box -> full width, letterboxed height.
    let (w, h) = opencut_preview::fit_contain_for_test(Some((1920, 1080)), 100.0, 100.0);
    assert!((w - 100.0).abs() < 0.01, "w={w}");
    assert!((h - 56.25).abs() < 0.01, "h={h}");

    // Portrait source into a wide box -> full height, pillarboxed width.
    let (w, h) = opencut_preview::fit_contain_for_test(Some((1080, 1920)), 200.0, 100.0);
    assert!((h - 100.0).abs() < 0.01, "h={h}");
    assert!((w - 56.25).abs() < 0.01, "w={w}");

    // Aspect is preserved in both cases.
    let (w, h) = opencut_preview::fit_contain_for_test(Some((640, 480)), 300.0, 300.0);
    assert!(((w / h) - (640.0 / 480.0)).abs() < 0.001);

    // No intrinsic size (text raster / solid placeholder) fills the box exactly.
    assert_eq!(
        opencut_preview::fit_contain_for_test(None, 80.0, 40.0),
        (80.0, 40.0)
    );
    // Degenerate sources fall back to filling rather than dividing by zero.
    assert_eq!(
        opencut_preview::fit_contain_for_test(Some((0, 10)), 80.0, 40.0),
        (80.0, 40.0)
    );
}

#[test]
fn a_non_square_image_is_not_stretched_to_the_canvas() {
    // End-to-end: render a deliberately wide image into a SQUARE canvas. Before the fix every
    // source was stretched to the full canvas box, so the top and bottom rows would be image
    // pixels. With contain-fit they must remain background.
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let dir = std::env::temp_dir().join(format!("vii-aspect-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("wide.png");
    // A 64x16 (4:1) solid red image.
    let mut img = image::RgbaImage::new(64, 16);
    for pixel in img.pixels_mut() {
        *pixel = image::Rgba([255, 0, 0, 255]);
    }
    img.save(&path).expect("write test png");

    let mut project = Project::starter();
    project.media.push(MediaAsset {
        id: "wide".into(),
        name: "wide.png".into(),
        path: path.to_string_lossy().to_string(),
    });
    let scene = project.active_scene_mut();
    scene.tracks.main.elements.clear();
    scene.tracks.overlay.clear();
    scene
        .tracks
        .main
        .elements
        .push(Element::Image(ImageElement {
            id: "el-wide".into(),
            name: "wide".into(),
            start: MediaTime::ZERO,
            duration: MediaTime::from_seconds_f64(2.0).unwrap(),
            media_id: "wide".into(),
            transform: Transform::default(), // centered, scale 1.0 => full-canvas box
            effects: Vec::new(),
            animations: Default::default(),
            blend_mode: Default::default(),
        }));

    let size = 64; // square canvas
    let frame = renderer.render(
        project.active_scene(),
        MediaTime::ZERO,
        size,
        size,
        &project.settings.background,
        &project.media,
    );

    let row_has_red = |row: u32| {
        (0..size).any(|x| {
            let i = ((row * size + x) * 4) as usize;
            // BGRA: red is B=0,G=0,R=255
            frame.bgra[i + 2] > 200 && frame.bgra[i] < 60 && frame.bgra[i + 1] < 60
        })
    };

    assert!(
        row_has_red(size / 2),
        "the image must be visible mid-canvas"
    );
    assert!(
        !row_has_red(0) && !row_has_red(size - 1),
        "a 4:1 image in a square canvas must be letterboxed, not stretched to the edges"
    );

    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_dir(&dir);
}

#[test]
fn every_blend_mode_reaches_the_gpu_over_a_chromatic_backdrop() {
    // The narrower test uses white-on-grey, where several modes are mathematically degenerate
    // (Luminosity == Normal; Hue/Saturation/Color coincide) — so it cannot prove all 17 are
    // wired. Use a coloured layer over a differently-coloured backdrop instead, and require
    // that the set of rendered results is mostly distinct.
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let (width, height) = (48, 48);
    let backdrop = opencut_project::Background::Color {
        color: "#2060c0".to_string(), // saturated blue
    };

    let mut rendered = Vec::new();
    for mode in opencut_project::BlendMode::ALL {
        let mut project = Project::starter();
        {
            let scene = project.active_scene_mut();
            scene.tracks.overlay.clear();
            scene.tracks.main.elements.retain(|e| e.id() == "el-title");
        }
        if let Element::Text(title) = &mut project.active_scene_mut().tracks.main.elements[0] {
            title.blend_mode = mode;
            title.color = "#e0a020".into(); // saturated orange: differs in hue AND luma
        }
        let frame = renderer.render(
            project.active_scene(),
            MediaTime::ZERO,
            width,
            height,
            &backdrop,
            &project.media,
        );
        assert_eq!(frame.bgra.len(), (width * height * 4) as usize, "{mode:?}");
        rendered.push((mode, frame.bgra));
    }

    assert_eq!(rendered.len(), 17, "all 17 modes must render");

    // Most modes must produce a genuinely different composite. Some coincidences are correct
    // blend maths for a given colour pair, so require a strong majority rather than all-distinct.
    let unique: std::collections::HashSet<&Vec<u8>> = rendered.iter().map(|(_, b)| b).collect();
    assert!(
        unique.len() >= 12,
        "expected most of the 17 modes to differ, got {} distinct results",
        unique.len()
    );

    // And Normal must not be the universal answer: at least 10 modes differ from it.
    let normal = &rendered[0].1;
    let differing = rendered.iter().skip(1).filter(|(_, b)| b != normal).count();
    assert!(
        differing >= 10,
        "only {differing} of 16 non-Normal modes changed the output"
    );
}

#[test]
fn decode_runs_off_the_render_path_and_is_cached() {
    // Regression: decode_video_clip used to run inline in render(), blocking the UI thread for
    // the whole decode (~33s for a 10-minute clip). It now runs on a worker; the first render
    // must return promptly with a placeholder and the clip must appear once the worker lands.
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let path = std::env::temp_dir().join(format!("vii-async-{}.mp4", std::process::id()));
    let generated = std::process::Command::new("ffmpeg")
        .args([
            "-nostdin",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=64x64:d=3:r=25",
            "-pix_fmt",
            "yuv420p",
            path.to_str().unwrap(),
        ])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !require_ffmpeg_step(generated, "generate the async decode fixture") {
        return;
    }

    let mut project = Project::starter();
    project.media.push(MediaAsset {
        id: "async1".into(),
        name: "Async".into(),
        path: path.to_string_lossy().into_owned(),
    });
    {
        let scene = project.active_scene_mut();
        scene.tracks.overlay.clear();
        scene.tracks.main.elements.clear();
        scene
            .tracks
            .main
            .elements
            .push(Element::Video(VideoElement {
                id: "vid-async".into(),
                name: "Async".into(),
                start: MediaTime::ZERO,
                duration: MediaTime::from_seconds_f64(3.0).unwrap(),
                media_id: "async1".into(),
                trim_start: MediaTime::ZERO,
                trim_end: MediaTime::from_seconds_f64(3.0).unwrap(),
                transform: Transform::default(),
                effects: Vec::new(),
                animations: Default::default(),
                blend_mode: Default::default(),
            }));
    }

    let render_once = |r: &mut PreviewRenderer, p: &Project| {
        r.render(
            p.active_scene(),
            MediaTime::ZERO,
            48,
            48,
            &p.settings.background,
            &p.media,
        )
    };

    // First render kicks off the worker and must NOT block for the decode.
    let started = std::time::Instant::now();
    let _ = render_once(&mut renderer, &project);
    let first_render = started.elapsed();
    assert!(
        first_render < std::time::Duration::from_millis(1500),
        "first render blocked for {first_render:?} — decode is back on the render path"
    );

    // Drive frames until the worker lands (bounded, so a hang fails rather than spins).
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    while renderer.has_pending_decodes() && std::time::Instant::now() < deadline {
        let _ = render_once(&mut renderer, &project);
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    assert!(!renderer.has_pending_decodes(), "decode never completed");

    let frame = render_once(&mut renderer, &project);
    let red = frame
        .bgra
        .chunks_exact(4)
        .filter(|t| t[2] > 150 && t[0] < 90 && t[1] < 90)
        .count();
    assert!(
        red > 100,
        "decoded clip should be on screen, found {red} red texels"
    );

    // Decoded bytes are accounted for, and stay inside the global ceiling.
    assert!(renderer.video_cache_bytes() > 0);
    assert!(renderer.video_cache_bytes() <= 384 * 1024 * 1024);

    let _ = std::fs::remove_file(&path);
}

#[test]
fn a_missing_media_file_fails_once_and_does_not_crash() {
    // Regression: a failed decode was retried on every rendered frame, respawning ffmpeg.
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let mut project = Project::starter();
    project.media.push(MediaAsset {
        id: "gone".into(),
        name: "Missing".into(),
        path: "/nonexistent/definitely-not-here.mp4".into(),
    });
    {
        let scene = project.active_scene_mut();
        scene.tracks.overlay.clear();
        scene.tracks.main.elements.clear();
        scene
            .tracks
            .main
            .elements
            .push(Element::Video(VideoElement {
                id: "vid-missing".into(),
                name: "Missing".into(),
                start: MediaTime::ZERO,
                duration: MediaTime::from_seconds_f64(1.0).unwrap(),
                media_id: "gone".into(),
                trim_start: MediaTime::ZERO,
                trim_end: MediaTime::from_seconds_f64(1.0).unwrap(),
                transform: Transform::default(),
                effects: Vec::new(),
                animations: Default::default(),
                blend_mode: Default::default(),
            }));
    }

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    loop {
        let frame = renderer.render(
            project.active_scene(),
            MediaTime::ZERO,
            32,
            32,
            &project.settings.background,
            &project.media,
        );
        assert_eq!(
            frame.bgra.len(),
            32 * 32 * 4,
            "must render a placeholder, not panic"
        );
        if !renderer.has_pending_decodes() || std::time::Instant::now() > deadline {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    assert!(
        !renderer.has_pending_decodes(),
        "failure should be terminal"
    );
    assert_eq!(
        renderer.video_cache_bytes(),
        0,
        "a failure caches no frames"
    );
}

#[test]
fn a_non_finite_transform_does_not_panic_the_renderer() {
    // Regression: NaN reaching f32::clamp panicked and took the whole editor down.
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let mut project = Project::starter();
    if let Element::Text(title) = &mut project.active_scene_mut().tracks.main.elements[0] {
        title.transform = Transform {
            x: f32::NAN,
            y: f32::INFINITY,
            scale: f32::NAN,
            rotation: f32::NEG_INFINITY,
            opacity: f32::NAN,
            scale_x: f32::NAN,
            scale_y: f32::INFINITY,
            anchor_x: f32::NAN,
            anchor_y: f32::NEG_INFINITY,
        };
    }
    let frame = renderer.render(
        project.active_scene(),
        MediaTime::ZERO,
        64,
        36,
        &project.settings.background,
        &project.media,
    );
    assert_eq!(frame.bgra.len(), 64 * 36 * 4);
}

#[test]
fn a_tiny_canvas_does_not_panic() {
    // Regression: `clamp(16.0, width)` panics when width < 16 (min > max).
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let project = Project::starter();
    for (w, h) in [(1u32, 1u32), (8, 4), (2, 16)] {
        let frame = renderer.render(
            project.active_scene(),
            MediaTime::ZERO,
            w,
            h,
            &project.settings.background,
            &project.media,
        );
        assert_eq!(frame.bgra.len() as u32, w * h * 4, "{w}x{h} canvas");
    }
}

// --------------------------------------------------------------------------------------
// Shapes, per-axis scale and anchors — the primitives a data graphic is built from.
// --------------------------------------------------------------------------------------

/// Read the RGB of one pixel from a BGRA frame.
fn pixel(frame: &opencut_preview::PreviewFrame, x: u32, y: u32) -> [u8; 3] {
    let index = ((y * frame.width + x) * 4) as usize;
    [
        frame.bgra[index + 2],
        frame.bgra[index + 1],
        frame.bgra[index],
    ]
}

fn shape_scene(shape: opencut_project::ShapeElement) -> Project {
    let mut project = Project::starter();
    let scene = project.active_scene_mut();
    scene.tracks.main.elements = vec![Element::Shape(shape)];
    scene.tracks.overlay.clear();
    project.settings.background = opencut_project::Background::Color {
        color: "#000000".into(),
    };
    project
}

fn bar(scale_x: f32, anchor_x: f32) -> opencut_project::ShapeElement {
    opencut_project::ShapeElement {
        id: "bar".into(),
        name: "Bar".into(),
        start: MediaTime::ZERO,
        duration: MediaTime::from_ticks(120_000),
        shape: opencut_project::ShapeKind::Rect { radius: 0.0 },
        color: "#ff0000".into(),
        transform: Transform {
            x: 0.5,
            y: 0.5,
            scale: 1.0,
            rotation: 0.0,
            opacity: 1.0,
            scale_x,
            scale_y: 0.1,
            anchor_x,
            anchor_y: 0.5,
        },
        effects: Vec::new(),
        animations: Default::default(),
        blend_mode: Default::default(),
    }
}

#[test]
fn a_shape_renders_its_own_fill_colour() {
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let project = shape_scene(bar(1.0, 0.5));
    let frame = renderer.render(
        project.active_scene(),
        MediaTime::ZERO,
        200,
        200,
        &project.settings.background,
        &project.media,
    );
    // Dead centre is inside a full-width bar 10% of the canvas tall.
    assert_eq!(
        pixel(&frame, 100, 100),
        [255, 0, 0],
        "the shape's own colour should reach the canvas"
    );
    // Well above the bar is untouched background.
    assert_eq!(
        pixel(&frame, 100, 10),
        [0, 0, 0],
        "outside the bar is background"
    );
}

#[test]
fn anchor_x_zero_grows_a_bar_rightward_from_a_fixed_origin() {
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    // Two widths, same anchored origin at x = 0.25 of a 200px canvas => 50px.
    let mut left_edges = Vec::new();
    let mut right_edges = Vec::new();
    for scale_x in [0.2_f32, 0.4] {
        let mut shape = bar(scale_x, 0.0);
        shape.transform.x = 0.25;
        let project = shape_scene(shape);
        let frame = renderer.render(
            project.active_scene(),
            MediaTime::ZERO,
            200,
            200,
            &project.settings.background,
            &project.media,
        );
        let row: Vec<u32> = (0..200)
            .filter(|x| pixel(&frame, *x, 100)[0] > 128)
            .collect();
        assert!(
            !row.is_empty(),
            "the bar should be visible at scaleX={scale_x}"
        );
        left_edges.push(*row.first().unwrap());
        right_edges.push(*row.last().unwrap());
    }
    // The LEFT edge is pinned (that is what anchorX = 0 means) while the right edge moves.
    assert!(
        left_edges[0].abs_diff(left_edges[1]) <= 2,
        "left edge must stay put: {left_edges:?}"
    );
    assert!(
        right_edges[1] > right_edges[0] + 20,
        "doubling scaleX must extend the bar rightward: {right_edges:?}"
    );
    // And it really is anchored where we asked (0.25 * 200 = 50), not centred on it.
    assert!(
        left_edges[0].abs_diff(50) <= 2,
        "left edge should sit at x=50, got {}",
        left_edges[0]
    );
}

#[test]
fn anchor_y_one_grows_a_column_upward_from_its_baseline() {
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let mut bottoms = Vec::new();
    let mut tops = Vec::new();
    for scale_y in [0.2_f32, 0.5] {
        let mut shape = bar(0.1, 0.5);
        shape.transform.scale_y = scale_y;
        shape.transform.y = 0.9;
        shape.transform.anchor_y = 1.0;
        let project = shape_scene(shape);
        let frame = renderer.render(
            project.active_scene(),
            MediaTime::ZERO,
            200,
            200,
            &project.settings.background,
            &project.media,
        );
        let column: Vec<u32> = (0..200)
            .filter(|y| pixel(&frame, 100, *y)[0] > 128)
            .collect();
        assert!(
            !column.is_empty(),
            "the column should be visible at scaleY={scale_y}"
        );
        tops.push(*column.first().unwrap());
        bottoms.push(*column.last().unwrap());
    }
    assert!(
        bottoms[0].abs_diff(bottoms[1]) <= 2,
        "the baseline must stay put: {bottoms:?}"
    );
    assert!(
        tops[1] + 20 < tops[0],
        "a taller column must extend upward: {tops:?}"
    );
}

#[test]
fn scale_x_of_zero_draws_nothing_rather_than_a_stray_line() {
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let project = shape_scene(bar(0.0, 0.0));
    let frame = renderer.render(
        project.active_scene(),
        MediaTime::ZERO,
        64,
        64,
        &project.settings.background,
        &project.media,
    );
    assert!(
        frame
            .bgra
            .chunks_exact(4)
            .all(|p| p[0] == 0 && p[1] == 0 && p[2] == 0),
        "frame 0 of a grow animation must be empty, not a 1px sliver"
    );
}

#[test]
fn a_rounded_rect_has_transparent_corners_and_a_solid_middle() {
    let rgba = opencut_preview::rasterize_shape_for_test(
        &opencut_project::ShapeKind::Rect { radius: 0.5 },
        "#ffffff",
        64,
        64,
    );
    let alpha = |x: u32, y: u32| rgba[((y * 64 + x) * 4 + 3) as usize];
    assert_eq!(alpha(32, 32), 255, "the middle is filled");
    assert_eq!(alpha(0, 0), 0, "a fully rounded corner is empty");
    assert_eq!(alpha(63, 0), 0, "every corner, not just one");
}

#[test]
fn a_square_rect_fills_its_corners() {
    let rgba = opencut_preview::rasterize_shape_for_test(
        &opencut_project::ShapeKind::Rect { radius: 0.0 },
        "#ffffff",
        16,
        16,
    );
    let alpha = |x: u32, y: u32| rgba[((y * 16 + x) * 4 + 3) as usize];
    assert_eq!(alpha(0, 0), 255, "radius 0 means square corners");
    assert_eq!(alpha(15, 15), 255);
}

#[test]
fn an_ellipse_is_round() {
    let rgba = opencut_preview::rasterize_shape_for_test(
        &opencut_project::ShapeKind::Ellipse,
        "#ffffff",
        64,
        64,
    );
    let alpha = |x: u32, y: u32| rgba[((y * 64 + x) * 4 + 3) as usize];
    assert_eq!(alpha(32, 32), 255, "centre is filled");
    assert_eq!(alpha(1, 1), 0, "corners are outside the circle");
    assert_eq!(alpha(32, 1), 255, "the top of the circle is filled");
}

/// A pill drawn for a wide bar must have SEMICIRCULAR ends, not pointed ones.
///
/// This is the regression that shipped a visibly wrong frame: every shape was rasterized into
/// a square buffer, so `radius: 0.5` was a circle, and stretching that circle to a 390x24 bar
/// produced a pointed lens. The giveaway is the flat top — a true pill is full-height across
/// its whole middle section, whereas a stretched circle is full-height only at its centre.
#[test]
fn a_wide_pill_has_a_flat_top_not_a_pointed_lens() {
    let (w, h) = opencut_preview::shape_raster_dimensions_for_test(390.0 / 24.0);
    assert!(
        w > h * 4,
        "a 16:1 bar should get a wide raster, got {w}x{h}"
    );

    let rgba = opencut_preview::rasterize_shape_for_test(
        &opencut_project::ShapeKind::Rect { radius: 0.5 },
        "#ffffff",
        w,
        h,
    );
    let alpha = |x: u32, y: u32| rgba[((y * w + x) * 4 + 3) as usize];

    // Top edge: opaque across the whole middle of the bar, not just at the centre column.
    let top = 0;
    let quarter = w / 4;
    for x in [quarter, w / 2, w - quarter] {
        assert!(
            alpha(x, top) > 200,
            "the top edge should be solid at x={x} of {w} (a lens would taper away here),              got alpha {}",
            alpha(x, top)
        );
    }
    // The rounded ends are still rounded: the extreme corners stay empty.
    assert_eq!(alpha(0, 0), 0, "the left end is rounded");
    assert_eq!(alpha(w - 1, h - 1), 0, "the right end is rounded");
    // And the vertical middle is opaque right to the very ends.
    assert!(
        alpha(0, h / 2) > 200,
        "the pill reaches its left extreme at mid-height"
    );
}

/// The raster size must be stable enough that a growing bar reuses textures rather than
/// demanding a fresh rasterization every frame.
#[test]
fn shape_raster_sizes_are_quantized() {
    let sizes: std::collections::HashSet<(u32, u32)> = (1..200)
        .map(|i| opencut_preview::shape_raster_dimensions_for_test(i as f32 * 0.08))
        .collect();
    assert!(
        sizes.len() < 40,
        "200 distinct aspects produced {} rasters — a growing bar would thrash the cache",
        sizes.len()
    );
}

#[test]
fn a_degenerate_aspect_still_produces_a_usable_raster() {
    for aspect in [0.0, f32::NAN, f32::INFINITY, -3.0] {
        let (w, h) = opencut_preview::shape_raster_dimensions_for_test(aspect);
        assert!(w >= 2 && h >= 2, "aspect {aspect} gave a {w}x{h} raster");
    }
}

#[test]
fn easing_changes_the_midpoint_but_never_the_endpoints() {
    use opencut_project::{AnimationChannel, Easing, Keyframe};
    let channel = |easing| AnimationChannel {
        keys: vec![
            Keyframe {
                time: MediaTime::ZERO,
                value: 0.0,
            },
            Keyframe {
                time: MediaTime::from_ticks(120_000),
                value: 1.0,
            },
        ],
        easing,
    };
    let midpoint = MediaTime::from_ticks(60_000);
    let linear = channel(Easing::Linear).sample(midpoint).unwrap();
    let power = channel(Easing::PowerOut).sample(midpoint).unwrap();
    assert!(
        (linear - 0.5).abs() < 1e-5,
        "linear halfway is 0.5, got {linear}"
    );
    assert!(
        power > 0.8,
        "power-out should be most of the way there at halftime, got {power}"
    );
    // Whatever the curve, the ends are exact — an entrance that never reaches 1.0 would leave
    // an element permanently short of its intended size.
    for easing in [
        Easing::Linear,
        Easing::EaseIn,
        Easing::EaseOut,
        Easing::EaseInOut,
        Easing::PowerOut,
        Easing::ExpoOut,
        Easing::BackOut,
        Easing::Hold,
    ] {
        let c = channel(easing);
        assert_eq!(c.sample(MediaTime::ZERO).unwrap(), 0.0, "{easing:?} start");
        assert_eq!(
            c.sample(MediaTime::from_ticks(120_000)).unwrap(),
            1.0,
            "{easing:?} end"
        );
    }
}

#[test]
fn an_animated_scale_actually_changes_a_texts_rendered_size() {
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let mut project = Project::starter();
    project.settings.background = opencut_project::Background::Color {
        color: "#000000".into(),
    };
    {
        let scene = project.active_scene_mut();
        scene.tracks.overlay.clear();
        scene
            .tracks
            .main
            .elements
            .retain(|e| matches!(e, Element::Text(_)));
        if let Element::Text(text) = &mut scene.tracks.main.elements[0] {
            text.content = "WIDE".into();
            text.font_size = 200.0;
            text.color = "#ffffff".into();
            text.align = opencut_project::TextAlign::Center;
            text.transform = Transform {
                scale: 0.9,
                ..Transform::default()
            };
            text.duration = MediaTime::from_ticks(240_000);
            let mut animations = std::collections::BTreeMap::new();
            animations.insert(
                "scale".to_string(),
                opencut_project::AnimationChannel {
                    keys: vec![
                        opencut_project::Keyframe {
                            time: MediaTime::ZERO,
                            value: 0.45,
                        },
                        opencut_project::Keyframe {
                            time: MediaTime::from_ticks(120_000),
                            value: 0.9,
                        },
                    ],
                    easing: opencut_project::Easing::Linear,
                },
            );
            text.animations = animations;
        }
    }

    let ink = |renderer: &mut PreviewRenderer, at: i64| {
        let frame = renderer.render(
            project.active_scene(),
            MediaTime::from_ticks(at),
            300,
            300,
            &project.settings.background,
            &project.media,
        );
        frame
            .bgra
            .chunks_exact(4)
            .filter(|p| p[0] > 60 || p[1] > 60 || p[2] > 60)
            .count()
    };
    let small = ink(&mut renderer, 0);
    let large = ink(&mut renderer, 120_000);
    assert!(
        small > 0 && large > 0,
        "the text must be visible at both times"
    );
    // This is the regression that mattered: `scale` used to size the text's WRAP BOX, so
    // animating it reflowed the paragraph instead of scaling the glyphs — the ink count could
    // even shrink as the box grew. Doubling the scale must roughly quadruple the ink.
    assert!(
        large > small * 2,
        "doubling scale must visibly enlarge the text: {small} -> {large} lit pixels"
    );
}

#[test]
fn audible_clips_skips_everything_that_would_contribute_no_sound() {
    use opencut_project::{AudioElement, MediaAsset, Track, TrackKind};
    let mut project = Project::starter();
    let scene = project.active_scene_mut();
    let clip = |id: &str, media: &str, muted: bool, volume: f32, duration: i64| {
        Element::Audio(AudioElement {
            id: id.into(),
            name: id.into(),
            start: MediaTime::ZERO,
            duration: MediaTime::from_ticks(duration),
            media_id: media.into(),
            muted,
            volume,
        })
    };
    let mut track = Track::new("t-audio", "Audio", TrackKind::Audio);
    track.elements = vec![
        clip("good", "m-ok", false, 1.0, 120_000),
        clip("muted", "m-ok", true, 1.0, 120_000),
        clip("silent", "m-ok", false, 0.0, 120_000),
        clip("zero-length", "m-ok", false, 1.0, 0),
        clip("unresolvable", "m-missing", false, 1.0, 120_000),
    ];
    let mut muted_track = Track::new("t-muted", "Muted", TrackKind::Audio);
    muted_track.muted = true;
    muted_track.elements = vec![clip("on-muted-track", "m-ok", false, 1.0, 120_000)];
    scene.tracks.audio = vec![track, muted_track];

    let media = vec![MediaAsset {
        id: "m-ok".into(),
        name: "ok.mp3".into(),
        path: "/tmp/ok.mp3".into(),
    }];
    let clips = opencut_preview::audible_clips_for_test(project.active_scene(), &media);
    assert_eq!(
        clips.len(),
        1,
        "only the one audible clip survives: {clips:?}"
    );
    assert_eq!(clips[0].path, "/tmp/ok.mp3");
}

#[test]
fn an_exported_video_carries_its_soundtrack() {
    if !require_ffmpeg() {
        return;
    }
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let dir = std::env::temp_dir().join("vii-audio-export-test");
    let _ = std::fs::create_dir_all(&dir);
    let tone = dir.join("tone.wav");
    let out = dir.join("with-sound.mp4");

    // A real 2-second tone, so the mux has genuine samples to carry.
    let made = std::process::Command::new("ffmpeg")
        .args([
            "-nostdin",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=2",
            tone.to_str().unwrap(),
        ])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    assert!(made, "could not synthesize a test tone");

    let mut project = Project::starter();
    project.media = vec![opencut_project::MediaAsset {
        id: "media-music".into(),
        name: "tone.wav".into(),
        path: tone.to_str().unwrap().into(),
    }];
    {
        let scene = project.active_scene_mut();
        scene.tracks.audio[0].elements = vec![Element::Audio(opencut_project::AudioElement {
            id: "bed".into(),
            name: "Bed".into(),
            start: MediaTime::ZERO,
            duration: MediaTime::from_ticks(240_000),
            media_id: "media-music".into(),
            muted: false,
            volume: 1.0,
        })];
    }

    let ok = renderer.export_video(
        project.active_scene(),
        1.0,
        10.0,
        64,
        64,
        &project.settings.background,
        &project.media,
        out.to_str().unwrap(),
    );
    assert!(ok, "export_video should succeed with an audio bed");

    // The whole point: ffprobe must find an audio stream in the output. Before the mux
    // existed, export_video piped one rawvideo input and this file was silent.
    let probe = std::process::Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "a",
            "-show_entries",
            "stream=codec_type",
            "-of",
            "csv=p=0",
            out.to_str().unwrap(),
        ])
        .output()
        .expect("ffprobe runs");
    let streams = String::from_utf8_lossy(&probe.stdout);
    assert!(
        streams.contains("audio"),
        "the exported MP4 has no audio stream (ffprobe said {streams:?})"
    );
}

/// A single frame may legitimately reference more distinct CPU rasters than the cache holds.
///
/// This crashed the renderer outright: eviction ran while the frame was still being assembled,
/// so the earliest layers' textures were released before the draw and the compositor failed
/// with `MissingTexture` — taking the whole process down mid-render.
#[test]
fn a_frame_with_more_rasters_than_the_cache_cap_still_renders() {
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let mut project = Project::starter();
    project.settings.background = opencut_project::Background::Color {
        color: "#000000".into(),
    };
    {
        let scene = project.active_scene_mut();
        scene.tracks.overlay.clear();
        // 140 distinct rasters on screen at once: every text has unique content, and every
        // shape a unique colour, so no two share a cache key.
        let mut elements = Vec::new();
        for i in 0..70 {
            elements.push(Element::Text(opencut_project::TextElement {
                id: format!("text-{i}"),
                name: format!("text-{i}"),
                start: MediaTime::ZERO,
                duration: MediaTime::from_ticks(240_000),
                content: format!("unique string {i}"),
                font_size: 20.0,
                color: "#ffffff".into(),
                transform: Transform {
                    x: 0.5,
                    y: (i as f32 % 10.0) / 10.0,
                    scale: 0.4,
                    ..Transform::default()
                },
                effects: Vec::new(),
                animations: Default::default(),
                blend_mode: Default::default(),
                font_family: None,
                font_weight: 400,
                align: Default::default(),
                letter_spacing: 0.0,
                line_height: 1.2,
            }));
            elements.push(Element::Shape(opencut_project::ShapeElement {
                id: format!("shape-{i}"),
                name: format!("shape-{i}"),
                start: MediaTime::ZERO,
                duration: MediaTime::from_ticks(240_000),
                shape: opencut_project::ShapeKind::Rect { radius: 0.4 },
                // A unique colour per shape forces a unique cache key.
                color: format!("#{:02x}20a0", 40 + i * 3),
                transform: Transform {
                    x: 0.5,
                    y: (i as f32 % 10.0) / 10.0,
                    scale: 0.2,
                    scale_x: 0.5,
                    scale_y: 0.05,
                    ..Transform::default()
                },
                effects: Vec::new(),
                animations: Default::default(),
                blend_mode: Default::default(),
            }));
        }
        scene.tracks.main.elements = elements;
    }

    // Render twice: the second pass exercises the cache in its post-eviction steady state.
    for pass in 0..2 {
        let frame = renderer.render(
            project.active_scene(),
            MediaTime::ZERO,
            240,
            420,
            &project.settings.background,
            &project.media,
        );
        let lit = frame
            .bgra
            .chunks_exact(4)
            .filter(|p| p[0] > 20 || p[1] > 20 || p[2] > 20)
            .count();
        assert!(lit > 0, "pass {pass} rendered an empty frame");
    }

    // The cache must still be bounded once nothing is in flight — a fix that simply never
    // evicted would pass the assertions above while leaking every texture ever uploaded.
    let cached = renderer.text_cache_len();
    assert!(
        cached <= 160,
        "raster cache grew to {cached} entries; eviction is not running at all"
    );
}
