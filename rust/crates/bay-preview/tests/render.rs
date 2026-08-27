//! The preview renderer composites scenes to non-empty BGRA frames on a real GPU (skips if
//! none — set `BAY_REQUIRE_GPU=1` / `BAY_REQUIRE_FFMPEG=1` to turn those skips into failures).

use bay_preview::{CollectedFrame, PreviewRenderer};
use bay_project::{
    AudioRole, Effect, Element, ElementSource, ImageElement, MediaAsset, MediaTime, Project,
    Transform, VideoElement,
};
use bay_test_support::{require_ffmpeg, require_ffmpeg_step, require_gpu_backed};

#[test]
fn renders_starter_scene_to_a_nonempty_frame() {
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let project = Project::starter();
    let (width, height) = (128, 72);
    let frame = renderer
        .render(
            project.active_scene(),
            MediaTime::ZERO,
            width,
            height,
            &project.settings.background,
            &project.media,
        )
        .expect("the GPU produced a frame");

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
        renderer
            .render(
                project.active_scene(),
                at,
                width,
                height,
                &project.settings.background,
                &project.media,
            )
            .expect("the GPU produced a frame");
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
            asset: None,
        });
    }
    let (width, height) = (128, 72);
    let frame = renderer
        .render(
            project.active_scene(),
            MediaTime::ZERO,
            width,
            height,
            &project.settings.background,
            &project.media,
        )
        .expect("the GPU produced a frame");
    assert_eq!(frame.bgra.len() as u32, width * height * 4);
}

#[test]
fn renders_contrast_saturation_blur_and_drop_shadow_on_gpu() {
    // Exercises the new effect shaders end-to-end (WGSL compiles + runs on the real GPU).
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    for effect_type in ["contrast", "saturation", "blur", "drop-shadow"] {
        let mut project = Project::starter();
        if let Element::Text(title) = &mut project.active_scene_mut().tracks.main.elements[0] {
            title.effects.push(Effect {
                id: format!("fx-{effect_type}"),
                effect_type: effect_type.into(),
                enabled: true,
                params: if effect_type == "drop-shadow" {
                    bay_core::blocks::default_effect_params("drop-shadow")
                } else {
                    [("amount".to_string(), 1.5)].into_iter().collect()
                },
                asset: None,
            });
        }
        let (width, height) = (128, 72);
        let frame = renderer
            .render(
                project.active_scene(),
                MediaTime::ZERO,
                width,
                height,
                &project.settings.background,
                &project.media,
            )
            .expect("the GPU produced a frame");
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
    let path = std::env::temp_dir().join(format!("bay-test-image-{}.png", std::process::id()));
    image::RgbaImage::from_pixel(4, 4, image::Rgba([200, 30, 30, 255]))
        .save(&path)
        .unwrap();

    let mut project = Project::starter();
    project.media.push(MediaAsset::new(
        "m1",
        "Pic",
        path.to_string_lossy().into_owned(),
    ));
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
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            media_id: "m1".into(),
            transform: Transform::default(),
            effects: Vec::new(),
            animations: Default::default(),
            blend_mode: Default::default(),
            mask: None,
            source: Default::default(),
            role: Default::default(),
        }));

    let frame = renderer
        .render(
            project.active_scene(),
            MediaTime::ZERO,
            64,
            36,
            &project.settings.background,
            &project.media,
        )
        .expect("the GPU produced a frame");
    assert_eq!(frame.bgra.len(), 64 * 36 * 4);

    let _ = std::fs::remove_file(&path);
}

#[test]
fn renders_a_real_video_frame_via_ffmpeg() {
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };

    // Generate a short red test clip via ffmpeg; skip if ffmpeg isn't available.
    let path = std::env::temp_dir().join(format!("bay-test-video-{}.mp4", std::process::id()));
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
    project.media.push(MediaAsset::new(
        "v1",
        "Vid",
        path.to_string_lossy().into_owned(),
    ));
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
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            media_id: "v1".into(),
            trim_start: MediaTime::ZERO,
            trim_end: MediaTime::from_ticks(120_000),
            speed: 1.0,
            freeze: None,
            transform: Transform::default(),
            effects: Vec::new(),
            animations: Default::default(),
            blend_mode: Default::default(),
            mask: None,
            source: Default::default(),
            role: Default::default(),
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
    let mut frame = renderer
        .render(
            project.active_scene(),
            MediaTime::ZERO,
            64,
            36,
            &project.settings.background,
            &project.media,
        )
        .expect("the GPU produced a frame");
    while renderer.has_pending_decodes() && std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(20));
        frame = renderer
            .render(
                project.active_scene(),
                MediaTime::ZERO,
                64,
                36,
                &project.settings.background,
                &project.media,
            )
            .expect("the GPU produced a frame");
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
fn frame_checks_match_on_cold_and_warmed_video_projects() {
    let Some(mut cold_renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new)
    else {
        return;
    };
    let Some(mut warm_renderer) =
        require_gpu_backed("a second PreviewRenderer", PreviewRenderer::new)
    else {
        return;
    };
    let path =
        std::env::temp_dir().join(format!("bay-frame-check-decode-{}.mp4", std::process::id()));
    let generated = std::process::Command::new("ffmpeg")
        .args([
            "-nostdin",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=64x64:d=2:r=10",
            "-pix_fmt",
            "yuv420p",
            path.to_str().unwrap(),
        ])
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if !require_ffmpeg_step(generated, "generate frame-check video") {
        return;
    }

    let mut project = Project::starter();
    let mut asset = MediaAsset::new("video", "video.mp4", path.to_string_lossy());
    asset.duration_seconds = Some(2.0);
    project.media = vec![asset];
    {
        let scene = project.active_scene_mut();
        scene.tracks.overlay.clear();
        scene.tracks.main.elements = vec![Element::Video(VideoElement {
            id: "video".into(),
            name: "Video".into(),
            start: MediaTime::ZERO,
            duration: MediaTime::from_seconds_f64(2.0).unwrap(),
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            media_id: "video".into(),
            trim_start: MediaTime::ZERO,
            trim_end: MediaTime::from_seconds_f64(2.0).unwrap(),
            speed: 1.0,
            freeze: None,
            transform: Transform::default(),
            effects: Vec::new(),
            animations: Default::default(),
            blend_mode: Default::default(),
            mask: None,
            source: Default::default(),
            role: Default::default(),
        })];
    }

    let cold = bay_preview::frame_check::check_frames(&project, &mut cold_renderer, None);
    warm_renderer
        .render(
            project.active_scene(),
            MediaTime::ZERO,
            64,
            64,
            &project.settings.background,
            &project.media,
        )
        .expect("the GPU produced a warm-up frame");
    warm_renderer.await_decodes(project.active_scene(), &project.media);
    let warm = bay_preview::frame_check::check_frames(&project, &mut warm_renderer, None);

    assert_ne!(cold["status"], "unevaluated", "{cold:#}");
    assert_eq!(cold, warm, "decode warmth must not change frame evidence");
    let _ = std::fs::remove_file(&path);
}

#[test]
fn exports_a_short_video_via_ffmpeg() {
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let project = Project::starter();
    let out = std::env::temp_dir().join(format!("bay-export-{}.mp4", std::process::id()));
    let ok = renderer.export_video(
        project.active_scene(),
        0.5,  // seconds
        10.0, // fps → 5 frames
        64,
        36,
        &project.settings.background,
        &project.media,
        out.to_str().unwrap(),
        &bay_preview::ExportSettings::default(),
    );
    if !require_ffmpeg_step(ok.is_ok(), "encode the exported mp4") {
        return;
    }
    let size = std::fs::metadata(&out).map(|m| m.len()).unwrap_or(0);
    assert!(size > 0, "exported video should be non-empty");

    // A finished export leaves nothing behind. The `.part` staging file is the mechanism that
    // keeps a half-written file off the destination path, so it must not survive success.
    let leftovers = strays_beside(&out);
    assert!(
        leftovers.is_empty(),
        "a successful export should leave no staging files, found {leftovers:?}"
    );
    let _ = std::fs::remove_file(&out);
}

#[test]
fn saved_narration_survives_its_temporary_source_and_exports() {
    if !require_ffmpeg() {
        return;
    }
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let root = std::env::temp_dir().join(format!(
        "bay-portable-narration-{}-{}",
        std::process::id(),
        std::thread::current().name().unwrap_or("test")
    ));
    std::fs::create_dir_all(&root).unwrap();
    let temporary_narration = root.join("bay-narration-temporary.wav");
    let made = std::process::Command::new("ffmpeg")
        .args([
            "-nostdin",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1",
            temporary_narration.to_str().unwrap(),
        ])
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if !require_ffmpeg_step(made, "generate temporary narration") {
        return;
    }

    let mut project = Project::starter();
    project.media = vec![MediaAsset::new(
        "narration",
        "bay-narration-temporary.wav",
        temporary_narration.to_string_lossy(),
    )];
    let Element::Audio(narration) = &mut project.active_scene_mut().tracks.audio[0].elements[0]
    else {
        panic!("starter audio lane should contain audio")
    };
    narration.media_id = "narration".into();
    narration.source = ElementSource::Tool;
    narration.role = AudioRole::Speech;
    narration.duration = MediaTime::from_seconds_f64(1.0).unwrap();

    let saved = root.join("portable.project.json");
    bay_project::library::write_project(&saved, &project).unwrap();
    std::fs::remove_file(&temporary_narration).unwrap();
    let loaded = bay_project::library::read_project(&saved).unwrap();
    assert!(
        std::path::Path::new(&loaded.media[0].path).is_file(),
        "reload should resolve the narration copy beside the project"
    );

    let out = root.join("portable.mp4");
    let result = renderer.export_video(
        loaded.active_scene(),
        0.5,
        10.0,
        64,
        36,
        &loaded.settings.background,
        &loaded.media,
        out.to_str().unwrap(),
        &bay_preview::ExportSettings::default(),
    );
    assert!(
        result.is_ok(),
        "reloaded project should export after its temporary narration is deleted: {result:?}"
    );
    assert!(std::fs::metadata(&out).is_ok_and(|metadata| metadata.len() > 0));
    let _ = std::fs::remove_dir_all(&root);
}

/// Any staging file sitting next to `out`. The suffix is infixed before the extension
/// (`out.1234.part.mp4`), because ffmpeg picks its container from the filename.
fn strays_beside(out: &std::path::Path) -> Vec<String> {
    let Some(dir) = out.parent() else {
        return Vec::new();
    };
    let stem = out.file_stem().and_then(|n| n.to_str()).unwrap_or_default();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|f| f.starts_with(stem) && f.contains(".part"))
        .collect()
}

/// A failed export must leave **nothing** at the destination.
///
/// It used to `break` out of the frame loop on a broken pipe and return whatever ffmpeg had
/// managed to write — a truncated MP4 sitting at the real output path, with nothing to
/// distinguish it from a good one. The failure is forced with an unwritable directory, which
/// makes ffmpeg exit non-zero without needing a corrupt input.
#[test]
fn a_failed_export_leaves_no_file_behind() {
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    if !require_ffmpeg() {
        return;
    }
    let project = Project::starter();
    // A directory that does not exist: ffmpeg cannot create the output, so it fails after we
    // have already started feeding it frames.
    let missing = std::env::temp_dir()
        .join(format!("bay-no-such-dir-{}", std::process::id()))
        .join("out.mp4");

    let result = renderer.export_video(
        project.active_scene(),
        0.3,
        10.0,
        64,
        36,
        &project.settings.background,
        &project.media,
        missing.to_str().unwrap(),
        &bay_preview::ExportSettings::default(),
    );

    assert!(
        result.is_err(),
        "an export that cannot be written must report failure, got Ok"
    );
    assert!(
        !missing.exists(),
        "a failed export must not leave a file at the destination"
    );
    assert!(
        strays_beside(&missing).is_empty(),
        "a failed export must clean up its staging file"
    );
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
    let backdrop = bay_project::Background::Color {
        color: "#808080".to_string(),
    };

    let render_with = |renderer: &mut PreviewRenderer, mode: bay_project::BlendMode| {
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
            .expect("the GPU produced a frame")
            .bgra
    };

    let normal = render_with(&mut renderer, bay_project::BlendMode::Normal);
    let difference = render_with(&mut renderer, bay_project::BlendMode::Difference);
    let multiply = render_with(&mut renderer, bay_project::BlendMode::Multiply);

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
    let (w, h) = bay_preview::fit_contain_for_test(Some((1920, 1080)), 100.0, 100.0);
    assert!((w - 100.0).abs() < 0.01, "w={w}");
    assert!((h - 56.25).abs() < 0.01, "h={h}");

    // Portrait source into a wide box -> full height, pillarboxed width.
    let (w, h) = bay_preview::fit_contain_for_test(Some((1080, 1920)), 200.0, 100.0);
    assert!((h - 100.0).abs() < 0.01, "h={h}");
    assert!((w - 56.25).abs() < 0.01, "w={w}");

    // Aspect is preserved in both cases.
    let (w, h) = bay_preview::fit_contain_for_test(Some((640, 480)), 300.0, 300.0);
    assert!(((w / h) - (640.0 / 480.0)).abs() < 0.001);

    // No intrinsic size (text raster / solid placeholder) fills the box exactly.
    assert_eq!(
        bay_preview::fit_contain_for_test(None, 80.0, 40.0),
        (80.0, 40.0)
    );
    // Degenerate sources fall back to filling rather than dividing by zero.
    assert_eq!(
        bay_preview::fit_contain_for_test(Some((0, 10)), 80.0, 40.0),
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
    let dir = std::env::temp_dir().join(format!("bay-aspect-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("wide.png");
    // A 64x16 (4:1) solid red image.
    let mut img = image::RgbaImage::new(64, 16);
    for pixel in img.pixels_mut() {
        *pixel = image::Rgba([255, 0, 0, 255]);
    }
    img.save(&path).expect("write test png");

    let mut project = Project::starter();
    project.media.push(MediaAsset::new(
        "wide",
        "wide.png",
        path.to_string_lossy().to_string(),
    ));
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
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            media_id: "wide".into(),
            transform: Transform::default(), // centered, scale 1.0 => full-canvas box
            effects: Vec::new(),
            animations: Default::default(),
            blend_mode: Default::default(),
            mask: None,
            source: Default::default(),
            role: Default::default(),
        }));

    let size = 64; // square canvas
    let frame = renderer
        .render(
            project.active_scene(),
            MediaTime::ZERO,
            size,
            size,
            &project.settings.background,
            &project.media,
        )
        .expect("the GPU produced a frame");

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
    let backdrop = bay_project::Background::Color {
        color: "#2060c0".to_string(), // saturated blue
    };

    let mut rendered = Vec::new();
    for mode in bay_project::BlendMode::ALL {
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
        let frame = renderer
            .render(
                project.active_scene(),
                MediaTime::ZERO,
                width,
                height,
                &backdrop,
                &project.media,
            )
            .expect("the GPU produced a frame");
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
    let path = std::env::temp_dir().join(format!("bay-async-{}.mp4", std::process::id()));
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
    project.media.push(MediaAsset::new(
        "async1",
        "Async",
        path.to_string_lossy().into_owned(),
    ));
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
                fade_in: MediaTime::ZERO,
                fade_out: MediaTime::ZERO,
                media_id: "async1".into(),
                trim_start: MediaTime::ZERO,
                trim_end: MediaTime::from_seconds_f64(3.0).unwrap(),
                speed: 1.0,
                freeze: None,
                transform: Transform::default(),
                effects: Vec::new(),
                animations: Default::default(),
                blend_mode: Default::default(),
                mask: None,
                source: Default::default(),
                role: Default::default(),
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
        .expect("the GPU produced a frame")
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
    project.media.push(MediaAsset::new(
        "gone",
        "Missing",
        "/nonexistent/definitely-not-here.mp4",
    ));
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
                fade_in: MediaTime::ZERO,
                fade_out: MediaTime::ZERO,
                media_id: "gone".into(),
                trim_start: MediaTime::ZERO,
                trim_end: MediaTime::from_seconds_f64(1.0).unwrap(),
                speed: 1.0,
                freeze: None,
                transform: Transform::default(),
                effects: Vec::new(),
                animations: Default::default(),
                blend_mode: Default::default(),
                mask: None,
                source: Default::default(),
                role: Default::default(),
            }));
    }

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    loop {
        let frame = renderer
            .render(
                project.active_scene(),
                MediaTime::ZERO,
                32,
                32,
                &project.settings.background,
                &project.media,
            )
            .expect("the GPU produced a frame");
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
            ..Transform::default()
        };
    }
    let frame = renderer
        .render(
            project.active_scene(),
            MediaTime::ZERO,
            64,
            36,
            &project.settings.background,
            &project.media,
        )
        .expect("the GPU produced a frame");
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
        let frame = renderer
            .render(
                project.active_scene(),
                MediaTime::ZERO,
                w,
                h,
                &project.settings.background,
                &project.media,
            )
            .expect("the GPU produced a frame");
        assert_eq!(frame.bgra.len() as u32, w * h * 4, "{w}x{h} canvas");
    }
}

// --------------------------------------------------------------------------------------
// Shapes, per-axis scale and anchors — the primitives a data graphic is built from.
// --------------------------------------------------------------------------------------

/// Read the RGB of one pixel from a BGRA frame.
fn pixel(frame: &bay_preview::PreviewFrame, x: u32, y: u32) -> [u8; 3] {
    let index = ((y * frame.width + x) * 4) as usize;
    [
        frame.bgra[index + 2],
        frame.bgra[index + 1],
        frame.bgra[index],
    ]
}

fn shape_scene(shape: bay_project::ShapeElement) -> Project {
    let mut project = Project::starter();
    let scene = project.active_scene_mut();
    scene.tracks.main.elements = vec![Element::Shape(shape)];
    scene.tracks.overlay.clear();
    project.settings.background = bay_project::Background::Color {
        color: "#000000".into(),
    };
    project
}

fn bar(scale_x: f32, anchor_x: f32) -> bay_project::ShapeElement {
    bay_project::ShapeElement {
        id: "bar".into(),
        name: "Bar".into(),
        start: MediaTime::ZERO,
        duration: MediaTime::from_ticks(120_000),
        fade_in: MediaTime::ZERO,
        fade_out: MediaTime::ZERO,
        shape: bay_project::ShapeKind::Rect { radius: 0.0 },
        color: "#ff0000".into(),
        gradient: None,
        stroke: None,
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
            ..Transform::default()
        },
        effects: Vec::new(),
        animations: Default::default(),
        blend_mode: Default::default(),
        mask: None,
        source: Default::default(),
        role: Default::default(),
    }
}

#[test]
fn a_shape_renders_its_own_fill_colour() {
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let project = shape_scene(bar(1.0, 0.5));
    let frame = renderer
        .render(
            project.active_scene(),
            MediaTime::ZERO,
            200,
            200,
            &project.settings.background,
            &project.media,
        )
        .expect("the GPU produced a frame");
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
        let frame = renderer
            .render(
                project.active_scene(),
                MediaTime::ZERO,
                200,
                200,
                &project.settings.background,
                &project.media,
            )
            .expect("the GPU produced a frame");
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
        let frame = renderer
            .render(
                project.active_scene(),
                MediaTime::ZERO,
                200,
                200,
                &project.settings.background,
                &project.media,
            )
            .expect("the GPU produced a frame");
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
    let frame = renderer
        .render(
            project.active_scene(),
            MediaTime::ZERO,
            64,
            64,
            &project.settings.background,
            &project.media,
        )
        .expect("the GPU produced a frame");
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
    let rgba = bay_preview::rasterize_shape_for_test(
        &bay_project::ShapeKind::Rect { radius: 0.5 },
        "#ffffff",
        None,
        None,
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
    let rgba = bay_preview::rasterize_shape_for_test(
        &bay_project::ShapeKind::Rect { radius: 0.0 },
        "#ffffff",
        None,
        None,
        16,
        16,
    );
    let alpha = |x: u32, y: u32| rgba[((y * 16 + x) * 4 + 3) as usize];
    assert_eq!(alpha(0, 0), 255, "radius 0 means square corners");
    assert_eq!(alpha(15, 15), 255);
}

#[test]
fn an_ellipse_is_round() {
    let rgba = bay_preview::rasterize_shape_for_test(
        &bay_project::ShapeKind::Ellipse,
        "#ffffff",
        None,
        None,
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
    let (w, h) = bay_preview::shape_raster_dimensions_for_test(390.0 / 24.0);
    assert!(
        w > h * 4,
        "a 16:1 bar should get a wide raster, got {w}x{h}"
    );

    let rgba = bay_preview::rasterize_shape_for_test(
        &bay_project::ShapeKind::Rect { radius: 0.5 },
        "#ffffff",
        None,
        None,
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
        .map(|i| bay_preview::shape_raster_dimensions_for_test(i as f32 * 0.08))
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
        let (w, h) = bay_preview::shape_raster_dimensions_for_test(aspect);
        assert!(w >= 2 && h >= 2, "aspect {aspect} gave a {w}x{h} raster");
    }
}

#[test]
fn easing_changes_the_midpoint_but_never_the_endpoints() {
    use bay_project::{AnimationChannel, Easing, Keyframe};
    let channel = |easing| AnimationChannel {
        keys: vec![
            Keyframe::new(MediaTime::ZERO, 0.0),
            Keyframe::new(MediaTime::from_ticks(120_000), 1.0),
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
    project.settings.background = bay_project::Background::Color {
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
            text.align = bay_project::TextAlign::Center;
            text.transform = Transform {
                scale: 0.9,
                ..Transform::default()
            };
            text.duration = MediaTime::from_ticks(240_000);
            let mut animations = std::collections::BTreeMap::new();
            animations.insert(
                "scale".to_string(),
                bay_project::AnimationChannel {
                    keys: vec![
                        bay_project::Keyframe::new(MediaTime::ZERO, 0.45),
                        bay_project::Keyframe::new(MediaTime::from_ticks(120_000), 0.9),
                    ],
                    easing: bay_project::Easing::Linear,
                },
            );
            text.animations = animations;
        }
    }

    let ink = |renderer: &mut PreviewRenderer, at: i64| {
        let frame = renderer
            .render(
                project.active_scene(),
                MediaTime::from_ticks(at),
                300,
                300,
                &project.settings.background,
                &project.media,
            )
            .expect("the GPU produced a frame");
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
    use bay_project::{AudioElement, MediaAsset, Track, TrackKind};
    let mut project = Project::starter();
    let scene = project.active_scene_mut();
    let clip = |id: &str, media: &str, muted: bool, volume: f32, duration: i64| {
        Element::Audio(AudioElement {
            id: id.into(),
            name: id.into(),
            start: MediaTime::ZERO,
            duration: MediaTime::from_ticks(duration),
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            media_id: media.into(),
            trim_start: MediaTime::ZERO,
            muted,
            volume,
            speed: 1.0,
            prosody: None,
            dialogue_chain: None,
            animations: Default::default(),
            source: Default::default(),
            role: Default::default(),
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

    let media = vec![MediaAsset::new("m-ok", "ok.mp3", "/tmp/ok.mp3")];
    let clips = bay_preview::audible_clips_for_test(project.active_scene(), &media);
    assert_eq!(
        clips.len(),
        1,
        "only the one audible clip survives: {clips:?}"
    );
    assert_eq!(clips[0].path, "/tmp/ok.mp3");
}

/// The in-point has to reach the export mixer, or a bed trimmed to start at the drop still
/// exports from bar one — the edit would look right in the timeline and be wrong in the file.
#[test]
fn an_audio_clips_in_point_reaches_the_mixer() {
    use bay_project::{AudioElement, MediaAsset, Track, TrackKind};
    let mut project = Project::starter();
    let scene = project.active_scene_mut();
    let mut track = Track::new("t-audio", "Audio", TrackKind::Audio);
    track.elements = vec![Element::Audio(AudioElement {
        id: "bed".into(),
        name: "bed".into(),
        start: MediaTime::from_ticks(120_000),
        duration: MediaTime::from_ticks(2 * 120_000),
        fade_in: MediaTime::ZERO,
        fade_out: MediaTime::ZERO,
        media_id: "m-ok".into(),
        muted: false,
        volume: 1.0,
        speed: 1.0,
        prosody: None,
        dialogue_chain: None,
        animations: Default::default(),
        trim_start: MediaTime::from_ticks(30 * 120_000),
        source: Default::default(),
        role: Default::default(),
    })];
    scene.tracks.audio = vec![track];

    let media = vec![MediaAsset::new("m-ok", "ok.mp3", "/tmp/ok.mp3")];
    let clips = bay_preview::audible_clips_for_test(project.active_scene(), &media);
    assert_eq!(clips.len(), 1);
    assert_eq!(clips[0].trim_start_seconds, 30.0);
    assert_eq!(clips[0].start_seconds, 1.0);
}

#[test]
fn an_exported_video_carries_its_soundtrack() {
    if !require_ffmpeg() {
        return;
    }
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let dir = std::env::temp_dir().join("bay-audio-export-test");
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
    project.media = vec![bay_project::MediaAsset::new(
        "media-music",
        "tone.wav",
        tone.to_str().unwrap(),
    )];
    {
        let scene = project.active_scene_mut();
        scene.tracks.audio[0].elements = vec![Element::Audio(bay_project::AudioElement {
            id: "bed".into(),
            name: "Bed".into(),
            start: MediaTime::ZERO,
            duration: MediaTime::from_ticks(240_000),
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            media_id: "media-music".into(),
            muted: false,
            volume: 1.0,
            speed: 1.0,
            prosody: None,
            dialogue_chain: None,
            animations: Default::default(),
            trim_start: MediaTime::ZERO,
            source: Default::default(),
            role: Default::default(),
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
        &bay_preview::ExportSettings::default(),
    );
    assert!(
        ok.is_ok(),
        "export_video should succeed with an audio bed: {ok:?}"
    );

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
    project.settings.background = bay_project::Background::Color {
        color: "#000000".into(),
    };
    {
        let scene = project.active_scene_mut();
        scene.tracks.overlay.clear();
        // 140 distinct rasters on screen at once: every text has unique content, and every
        // shape a unique colour, so no two share a cache key.
        let mut elements = Vec::new();
        for i in 0..70 {
            elements.push(Element::Text(bay_project::TextElement {
                id: format!("text-{i}"),
                name: format!("text-{i}"),
                start: MediaTime::ZERO,
                duration: MediaTime::from_ticks(240_000),
                fade_in: MediaTime::ZERO,
                fade_out: MediaTime::ZERO,
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
                mask: None,
                font_family: None,
                font_weight: 400,
                align: Default::default(),
                letter_spacing: 0.0,
                line_height: 1.2,
                decorations: None,
                karaoke: None,
                type_on: None,
                source: Default::default(),
                role: Default::default(),
            }));
            elements.push(Element::Shape(bay_project::ShapeElement {
                id: format!("shape-{i}"),
                name: format!("shape-{i}"),
                start: MediaTime::ZERO,
                duration: MediaTime::from_ticks(240_000),
                fade_in: MediaTime::ZERO,
                fade_out: MediaTime::ZERO,
                shape: bay_project::ShapeKind::Rect { radius: 0.4 },
                // A unique colour per shape forces a unique cache key.
                color: format!("#{:02x}20a0", 40 + i * 3),
                gradient: None,
                stroke: None,
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
                mask: None,
                source: Default::default(),
                role: Default::default(),
            }));
        }
        scene.tracks.main.elements = elements;
    }

    // Render twice: the second pass exercises the cache in its post-eviction steady state.
    for pass in 0..2 {
        let frame = renderer
            .render(
                project.active_scene(),
                MediaTime::ZERO,
                240,
                420,
                &project.settings.background,
                &project.media,
            )
            .expect("the GPU produced a frame");
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

// --------------------------------------------------------------------------------------
// Export decodes at source resolution — the fix for "a 4K export is a 480px cache upscaled".
// --------------------------------------------------------------------------------------

/// Decode the first frame of `path` as 8-bit luma at its own size.
fn first_frame_luma(path: &std::path::Path) -> Option<Vec<u8>> {
    let out = std::process::Command::new("ffmpeg")
        .args([
            "-nostdin",
            "-loglevel",
            "error",
            "-i",
            path.to_str()?,
            "-frames:v",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "gray",
            "pipe:1",
        ])
        .output()
        .ok()?;
    out.status.success().then_some(out.stdout)
}

/// Population standard deviation of a luma plane. A picture that still has its detail scores
/// high; one that has been averaged into flat grey scores near zero.
fn luma_stddev(luma: &[u8]) -> f64 {
    if luma.is_empty() {
        return 0.0;
    }
    let n = luma.len() as f64;
    let mean = luma.iter().map(|&v| v as f64).sum::<f64>() / n;
    (luma.iter().map(|&v| (v as f64 - mean).powi(2)).sum::<f64>() / n).sqrt()
}

/// **The export-quality regression test.**
///
/// The source is 1-pixel-wide vertical stripes at 960x540, exported onto a 960x540 canvas — so
/// the clip maps 1:1 and nothing about the geometry can excuse a loss of detail.
///
/// 1px stripes have a period of 2, so an exact 2:1 downscale to the preview budget's 480px puts
/// them below Nyquist and averages them into flat grey. Upscaling back to 960 cannot undo that.
/// The width matters: 2px stripes land *exactly* on Nyquist and survive the downscale as 1px
/// stripes, so a coarser pattern would have made this test pass against the very bug it exists
/// to catch — it was written that way first, and measured.
///
/// Measured on this path: source 127.5, old behaviour 1.5, streamed source-resolution 126.2.
/// The threshold sits far from both, so this is not a judgement call about sharpness.
#[test]
fn an_export_keeps_detail_the_preview_budget_would_have_destroyed() {
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    if !require_ffmpeg() {
        return;
    }

    let dir = std::env::temp_dir().join(format!("bay-export-detail-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    let stripes_png = dir.join("stripes.png");
    let source_mp4 = dir.join("stripes.mp4");
    let out_mp4 = dir.join("exported.mp4");

    // 2px vertical stripes: the finest pattern that survives a 960-wide frame and is annihilated
    // by a 2:1 downscale.
    let (sw, sh) = (960u32, 540u32);
    let stripes = image::RgbaImage::from_fn(sw, sh, |x, _| {
        if x % 2 == 0 {
            image::Rgba([255, 255, 255, 255])
        } else {
            image::Rgba([0, 0, 0, 255])
        }
    });
    stripes.save(&stripes_png).expect("write the stripe source");

    // Lossless h264 so the SOURCE is not what loses the detail.
    let encoded = std::process::Command::new("ffmpeg")
        .args([
            "-nostdin",
            "-loglevel",
            "error",
            "-y",
            "-loop",
            "1",
            "-i",
            stripes_png.to_str().unwrap(),
            "-t",
            "1",
            "-r",
            "10",
            "-c:v",
            "libx264",
            "-qp",
            "0",
            "-pix_fmt",
            "yuv420p",
            source_mp4.to_str().unwrap(),
        ])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !require_ffmpeg_step(encoded, "encode the lossless stripe source") {
        let _ = std::fs::remove_dir_all(&dir);
        return;
    }

    // Sanity: the source itself must actually carry the detail we are about to look for.
    let source_detail = first_frame_luma(&source_mp4)
        .map(|luma| luma_stddev(&luma))
        .unwrap_or(0.0);
    assert!(
        source_detail > 90.0,
        "precondition: the stripe source should be high-contrast, scored {source_detail:.1}"
    );

    let mut project = Project::starter();
    project.settings.canvas = bay_project::CanvasSize {
        width: sw,
        height: sh,
    };
    project.media.push(MediaAsset::new(
        "stripes",
        "Stripes",
        source_mp4.to_string_lossy().into_owned(),
    ));
    let scene = project.active_scene_mut();
    scene.tracks.main.elements = vec![Element::Video(VideoElement {
        id: "clip1".into(),
        name: "Stripes".into(),
        start: MediaTime::ZERO,
        duration: MediaTime::from_ticks(120_000),
        fade_in: MediaTime::ZERO,
        fade_out: MediaTime::ZERO,
        media_id: "stripes".into(),
        trim_start: MediaTime::ZERO,
        speed: 1.0,
        freeze: None,
        transform: Transform::default(),
        effects: Vec::new(),
        animations: Default::default(),
        blend_mode: Default::default(),
        mask: None,
        trim_end: MediaTime::ZERO,
        source: Default::default(),
        role: Default::default(),
    })];

    let result = renderer.export_video(
        project.active_scene(),
        0.3,
        10.0,
        sw,
        sh,
        &project.settings.background,
        &project.media,
        out_mp4.to_str().unwrap(),
        &bay_preview::ExportSettings::default(),
    );
    assert!(result.is_ok(), "export should succeed: {result:?}");

    let exported = first_frame_luma(&out_mp4).expect("the exported file should decode");
    let detail = luma_stddev(&exported);
    let _ = std::fs::remove_dir_all(&dir);

    assert!(
        detail > 40.0,
        "the exported frame lost the source's detail (stddev {detail:.1}, source \
         {source_detail:.1}). Decoding at the preview budget's 480px averages 1px stripes into \
         flat grey and scores ~1.5; decoding at source resolution scores ~126."
    );
}

/// `trim_start` must land on the frame the author trimmed to.
///
/// The cached path applies trim by *indexing into decoded frames*, which is exact. A streamed
/// export seeks instead, and `-ss` before `-i` is an input seek that lands on the nearest
/// keyframe — up to a whole GOP away. That would shift every trimmed clip in every export by a
/// fraction of a second: a quieter bug than the one being fixed, and a worse one.
///
/// The source is a counter: each second is a solid, distinct grey. Trimming to 2.5s must
/// therefore export the third band, and reading the exported frame's luma says plainly which
/// band arrived. Keyframes are forced 3s apart, so the keyframe before a 2.5s target is at 0s:
/// a naive input-only seek lands on luma 20 instead of 120. Verified by trying it.
#[test]
fn a_trimmed_clip_exports_from_the_frame_it_was_trimmed_to() {
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    if !require_ffmpeg() {
        return;
    }

    let dir = std::env::temp_dir().join(format!("bay-export-trim-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    let source = dir.join("bands.mp4");
    let out = dir.join("trimmed.mp4");

    // Five one-second bands: luma 20, 70, 120, 170, 220. Distinct enough that an off-by-a-second
    // seek is unmistakable, and flat so the encode reproduces them faithfully.
    const BANDS: [u8; 5] = [20, 70, 120, 170, 220];
    let frames_dir = dir.join("frames");
    let _ = std::fs::create_dir_all(&frames_dir);
    for (second, level) in BANDS.iter().enumerate() {
        for frame in 0..10 {
            let index = second * 10 + frame;
            let img =
                image::RgbaImage::from_pixel(320, 180, image::Rgba([*level, *level, *level, 255]));
            img.save(frames_dir.join(format!("f{index:04}.png")))
                .unwrap();
        }
    }
    let encoded = std::process::Command::new("ffmpeg")
        .args([
            "-nostdin",
            "-loglevel",
            "error",
            "-y",
            "-framerate",
            "10",
            "-i",
            frames_dir.join("f%04d.png").to_str().unwrap(),
            "-c:v",
            "libx264",
            "-qp",
            "0",
            // Keyframes only every 30 frames (3s), so the keyframe preceding a 2.5s target is
            // at 0s — a whole two bands away. -sc_threshold 0 is load-bearing: without it x264
            // inserts an IDR at every band change, which puts a keyframe at the start of the
            // band containing the target and lets an inaccurate seek land correctly by luck.
            "-g",
            "30",
            "-keyint_min",
            "30",
            "-sc_threshold",
            "0",
            "-pix_fmt",
            "yuv420p",
            source.to_str().unwrap(),
        ])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !require_ffmpeg_step(encoded, "encode the banded trim source") {
        let _ = std::fs::remove_dir_all(&dir);
        return;
    }

    let mut project = Project::starter();
    project.settings.canvas = bay_project::CanvasSize {
        width: 320,
        height: 180,
    };
    project.media.push(MediaAsset::new(
        "bands",
        "Bands",
        source.to_string_lossy().into_owned(),
    ));
    // Trim to 2.5s — the middle of the third band (luma 120), and deliberately not on a keyframe.
    let scene = project.active_scene_mut();
    scene.tracks.main.elements = vec![Element::Video(VideoElement {
        id: "clip1".into(),
        name: "Bands".into(),
        start: MediaTime::ZERO,
        duration: MediaTime::from_ticks(120_000),
        fade_in: MediaTime::ZERO,
        fade_out: MediaTime::ZERO,
        media_id: "bands".into(),
        trim_start: MediaTime::from_seconds_f64(2.5).unwrap(),
        trim_end: MediaTime::ZERO,
        speed: 1.0,
        freeze: None,
        transform: Transform::default(),
        effects: Vec::new(),
        animations: Default::default(),
        blend_mode: Default::default(),
        mask: None,
        source: Default::default(),
        role: Default::default(),
    })];

    let result = renderer.export_video(
        project.active_scene(),
        0.2,
        10.0,
        320,
        180,
        &project.settings.background,
        &project.media,
        out.to_str().unwrap(),
        &bay_preview::ExportSettings::default(),
    );
    assert!(result.is_ok(), "export should succeed: {result:?}");

    let luma = first_frame_luma(&out).expect("the exported file should decode");
    let mean = luma.iter().map(|&v| v as f64).sum::<f64>() / luma.len().max(1) as f64;
    let _ = std::fs::remove_dir_all(&dir);

    let expected = BANDS[2] as f64; // 2.5s falls in the third band
    assert!(
        (mean - expected).abs() < 12.0,
        "trimming to 2.5s should export the band at luma {expected}, got {mean:.1}. \
         A nearby band means the seek landed on a keyframe instead of the trimmed frame."
    );
}

/// Two video clips on screen at once, each streamed independently.
///
/// A single shared decoder would be a plausible-looking implementation that works fine on every
/// one-clip timeline and produces the wrong picture the moment a project overlays two. Each clip
/// here is a distinct flat colour, so a frame containing both proves two decoders ran with their
/// own positions.
#[test]
fn overlapping_clips_each_get_their_own_stream() {
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    if !require_ffmpeg() {
        return;
    }

    let dir = std::env::temp_dir().join(format!("bay-export-two-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    let out = dir.join("both.mp4");

    // Two solid sources: pure red and pure blue.
    let mut made = true;
    for (name, colour) in [("red", "red"), ("blue", "blue")] {
        made &= std::process::Command::new("ffmpeg")
            .args([
                "-nostdin",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                &format!("color=c={colour}:s=160x90:d=2:r=10"),
                "-c:v",
                "libx264",
                "-qp",
                "0",
                "-pix_fmt",
                "yuv420p",
                dir.join(format!("{name}.mp4")).to_str().unwrap(),
            ])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
    }
    if !require_ffmpeg_step(made, "encode the two overlapping sources") {
        let _ = std::fs::remove_dir_all(&dir);
        return;
    }

    let mut project = Project::starter();
    project.settings.canvas = bay_project::CanvasSize {
        width: 160,
        height: 90,
    };
    for name in ["red", "blue"] {
        project.media.push(MediaAsset::new(
            name,
            name,
            dir.join(format!("{name}.mp4"))
                .to_string_lossy()
                .into_owned(),
        ));
    }

    let clip = |id: &str, media: &str, scale: f32, x: f32| {
        Element::Video(VideoElement {
            id: id.into(),
            name: media.into(),
            start: MediaTime::ZERO,
            duration: MediaTime::from_ticks(120_000),
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            media_id: media.into(),
            trim_start: MediaTime::ZERO,
            trim_end: MediaTime::ZERO,
            speed: 1.0,
            freeze: None,
            transform: Transform {
                x,
                scale,
                ..Transform::default()
            },
            effects: Vec::new(),
            animations: Default::default(),
            blend_mode: Default::default(),
            mask: None,
            source: Default::default(),
            role: Default::default(),
        })
    };
    // Side by side, each at a quarter width, so both survive into the same frame.
    let scene = project.active_scene_mut();
    scene.tracks.main.elements = vec![
        clip("red-clip", "red", 0.4, 0.25),
        clip("blue-clip", "blue", 0.4, 0.75),
    ];

    let result = renderer.export_video(
        project.active_scene(),
        0.2,
        10.0,
        160,
        90,
        &project.settings.background,
        &project.media,
        out.to_str().unwrap(),
        &bay_preview::ExportSettings::default(),
    );
    assert!(result.is_ok(), "export should succeed: {result:?}");

    // Decode the exported frame as RGB and look at one pixel inside each clip.
    let decoded = std::process::Command::new("ffmpeg")
        .args([
            "-nostdin",
            "-loglevel",
            "error",
            "-i",
            out.to_str().unwrap(),
            "-frames:v",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "pipe:1",
        ])
        .output()
        .expect("decode the exported frame");
    let rgb = decoded.stdout;
    let at = |x: u32, y: u32| {
        let i = ((y * 160 + x) * 3) as usize;
        (rgb[i] as i32, rgb[i + 1] as i32, rgb[i + 2] as i32)
    };
    let left = at(40, 45);
    let right = at(120, 45);
    let _ = std::fs::remove_dir_all(&dir);

    assert!(
        left.0 > 120 && left.2 < 90,
        "the left clip should be red, got {left:?}"
    );
    assert!(
        right.2 > 120 && right.0 < 90,
        "the right clip should be blue, got {right:?}"
    );
}

/// A cancelled export leaves nothing behind.
///
/// The staging file is what makes this possible: an export that stops halfway has written real
/// bytes somewhere, and before staging existed those bytes were at the destination path with
/// nothing to mark them as partial. Cancelling has to be as clean as failing.
#[test]
fn a_cancelled_export_leaves_no_file_behind() {
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    if !require_ffmpeg() {
        return;
    }
    let dir = std::env::temp_dir().join(format!("bay-export-cancel-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    let out = dir.join("cancelled.mp4");

    let project = Project::starter();
    let mut seen = 0u64;
    let result = renderer.export_video_observed(
        project.active_scene(),
        2.0,
        30.0, // 60 frames
        64,
        36,
        &project.settings.background,
        &project.media,
        out.to_str().unwrap(),
        // Stop a few frames in, while ffmpeg definitely still has work to do.
        &bay_preview::ExportSettings::default(),
        &mut |done, _total| {
            seen = done;
            done < 5
        },
    );

    assert!(
        seen >= 5,
        "the observer should have seen frames, saw {seen}"
    );
    assert!(
        result.is_err(),
        "a cancelled export must report that it did not finish"
    );
    assert!(
        !out.exists(),
        "a cancelled export must not leave a file at the destination"
    );
    assert!(
        strays_beside(&out).is_empty(),
        "a cancelled export must clean up its staging file"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// Progress reaches the last frame on a successful export.
#[test]
fn an_export_reports_progress_to_the_last_frame() {
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let project = Project::starter();
    let out = std::env::temp_dir().join(format!("bay-progress-{}.mp4", std::process::id()));

    let mut last = (0u64, 0u64);
    let result = renderer.export_video_observed(
        project.active_scene(),
        0.5,
        10.0, // 5 frames
        64,
        36,
        &project.settings.background,
        &project.media,
        out.to_str().unwrap(),
        &bay_preview::ExportSettings::default(),
        &mut |done, total| {
            last = (done, total);
            true
        },
    );
    if !require_ffmpeg_step(result.is_ok(), "encode the progress-reporting export") {
        let _ = std::fs::remove_file(&out);
        return;
    }
    assert_eq!(
        last,
        (5, 5),
        "a finished export should have reported every frame"
    );
    let _ = std::fs::remove_file(&out);
}

/// Reading a stream backwards lands on the frame asked for, not one further on.
///
/// Export walks the timeline forward, so `ClipStream`'s backward-seek branch has no route
/// through `export_video`. It was still wrong: after respawning ffmpeg at the new position the
/// code kept the frame index it had computed against the *old* origin, so it skipped that many
/// frames into the fresh stream and returned a frame from somewhere else entirely. An
/// unreachable branch is still a branch — and this one would have become reachable the moment
/// two-stage seek or a reversed clip landed.
#[test]
fn a_stream_read_backwards_returns_the_frame_asked_for() {
    if !require_ffmpeg() {
        return;
    }
    let dir = std::env::temp_dir().join(format!("bay-stream-seek-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    let frames_dir = dir.join("frames");
    let _ = std::fs::create_dir_all(&frames_dir);
    let source = dir.join("bands.mp4");

    // Five one-second bands, distinct grey levels, at 10fps.
    const BANDS: [u8; 5] = [20, 70, 120, 170, 220];
    for (second, level) in BANDS.iter().enumerate() {
        for frame in 0..10 {
            let index = second * 10 + frame;
            image::RgbaImage::from_pixel(160, 90, image::Rgba([*level, *level, *level, 255]))
                .save(frames_dir.join(format!("f{index:04}.png")))
                .unwrap();
        }
    }
    let encoded = std::process::Command::new("ffmpeg")
        .args([
            "-nostdin",
            "-loglevel",
            "error",
            "-y",
            "-framerate",
            "10",
            "-i",
            frames_dir.join("f%04d.png").to_str().unwrap(),
            "-c:v",
            "libx264",
            "-qp",
            "0",
            "-g",
            "30",
            "-keyint_min",
            "30",
            "-sc_threshold",
            "0",
            "-pix_fmt",
            "yuv420p",
            source.to_str().unwrap(),
        ])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !require_ffmpeg_step(encoded, "encode the banded seek source") {
        let _ = std::fs::remove_dir_all(&dir);
        return;
    }

    // Forward to the fourth band, then BACK to the second — the branch under test.
    let samples =
        bay_preview::clip_stream_samples_for_test(source.to_str().unwrap(), 10.0, &[0.5, 3.5, 1.5]);
    let _ = std::fs::remove_dir_all(&dir);

    let expected = [BANDS[0] as f64, BANDS[3] as f64, BANDS[1] as f64];
    for (index, (got, want)) in samples.iter().zip(expected.iter()).enumerate() {
        let got = got.unwrap_or_else(|| panic!("no frame for request {index}"));
        assert!(
            (got - want).abs() < 12.0,
            "request {index} should have landed on the band at luma {want}, got {got:.1}"
        );
    }
}

/// The level curve has to survive the trip into ffmpeg's expression language, because a slip
/// there is not a wrong sound — it is a filtergraph that fails to parse and an export with no
/// audio at all.
#[test]
fn a_moving_level_becomes_an_ffmpeg_expression() {
    let flat = bay_preview::AudibleClip {
        path: "/tmp/a.mp3".into(),
        start_seconds: 0.0,
        trim_start_seconds: 0.0,
        duration_seconds: 4.0,
        volume: 0.5,
        speed: 1.0,
        dialogue_chain: None,
        gain_points: vec![(0.0, 0.5)],
        fade_in_seconds: 0.0,
        fade_out_seconds: 0.0,
    };
    assert_eq!(bay_preview::volume_filter_for_test(&flat), "volume=0.5000");

    let ducked = bay_preview::AudibleClip {
        gain_points: vec![(0.0, 1.0), (1.0, 0.2), (3.0, 0.2), (4.0, 1.0)],
        fade_in_seconds: 0.0,
        fade_out_seconds: 0.0,
        ..flat
    };
    let filter = bay_preview::volume_filter_for_test(&ducked);
    assert!(filter.starts_with("volume='"), "{filter}");
    assert!(filter.ends_with(":eval=frame"), "{filter}");
    // Every comma inside the expression must be escaped, or the filtergraph parser reads it
    // as the end of the filter and the whole graph fails.
    let expression = filter
        .trim_start_matches("volume='")
        .trim_end_matches("':eval=frame");
    for (index, character) in expression.char_indices() {
        if character == ',' {
            assert!(
                index > 0 && expression.as_bytes()[index - 1] == b'\\',
                "unescaped comma at {index} in {expression}"
            );
        }
    }
    // Three segments → three conditionals.
    assert_eq!(expression.matches("if(lt(t").count(), 3, "{expression}");
}

/// The whole reason a bed came to be chopped into 13 clips instead of ducked.
///
/// `Element::gain_points` subdivides every eased segment into 16 steps and
/// `AudibleClip::volume_filter` renders them as a nested `if()` chain; ffmpeg's expression
/// parser accepts **97** points and rejects 98. Six eased volume keys made 82 points and
/// exported; **seven made 98 and the whole encode failed**, so ducking past a single narration
/// line was impossible — which is a sufficient explanation for the stepped-gain hack, and makes
/// the point budget a prerequisite for `duck` rather than an optimisation.
#[test]
fn a_six_line_duck_fits_inside_the_expression_budget() {
    use bay_project::duck::{DuckParams, duck};
    use bay_project::{AudioElement, AudioRole, Element as El, MediaTime as MT};

    let audio = |id: &str, start: f64, duration: f64, volume: f32, role| {
        El::Audio(AudioElement {
            id: id.into(),
            name: id.into(),
            start: MT::from_seconds_f64(start).expect("representable"),
            duration: MT::from_seconds_f64(duration).expect("representable"),
            fade_in: MT::ZERO,
            fade_out: MT::ZERO,
            media_id: "m".into(),
            muted: false,
            volume,
            speed: 1.0,
            prosody: None,
            dialogue_chain: None,
            animations: Default::default(),
            trim_start: MT::ZERO,
            source: Default::default(),
            role,
        })
    };

    let mut bed = audio("bed", 0.0, 61.0, 0.85, AudioRole::Bed);
    let lines: Vec<Element> = (0..6)
        .map(|index| {
            audio(
                &format!("line-{index}"),
                2.0 + index as f64 * 10.0,
                5.0,
                1.0,
                AudioRole::Speech,
            )
        })
        .collect();
    let refs: Vec<&Element> = lines.iter().collect();
    let ducked = duck(&bed, &refs, &DuckParams::default()).expect("a six-line duck");
    assert_eq!(
        ducked.keys.len(),
        25,
        "four keys a line plus a leading hold"
    );
    bed.animations_mut()
        .expect("audio animates")
        .insert("volume".into(), ducked.channel);

    let points = bed.gain_points();
    assert!(
        points.len() > bay_preview::GAIN_EXPRESSION_LIMIT,
        "the model emits {} points — if this stops being over the budget the test below proves \
         nothing",
        points.len()
    );
    let decimated = bay_preview::decimate_gain_points_for_test(&points);
    assert!(
        decimated.len() <= bay_preview::GAIN_EXPRESSION_LIMIT,
        "{} points is more than ffmpeg's parser will take",
        decimated.len()
    );

    // …and it is still the same duck. Every point of the full curve has to be within 0.3 dB of
    // what the decimated polyline says at that instant, or the export is quieter than the room.
    for (at, gain) in &points {
        let approximated = interpolate(&decimated, *at);
        let apart = 20.0 * (gain.max(1e-4) / approximated.max(1e-4)).log10().abs();
        assert!(
            apart <= 0.35,
            "at {at:.3}s the export says {approximated:.4} where the model says {gain:.4} \
             ({apart:.2} dB apart)"
        );
    }
    // The depth survives: the decimation may lose the shape of a ramp, never its destination.
    let bottom = decimated
        .iter()
        .map(|(_, g)| *g)
        .fold(f32::INFINITY, f32::min);
    assert!(
        (20.0 * (0.85 / bottom).log10() - 8.0).abs() < 0.1,
        "8 dB was asked for, the exported curve reaches {bottom}"
    );
}

/// Read a level polyline at `at`, the way ffmpeg's expression does.
fn interpolate(points: &[(f64, f32)], at: f64) -> f32 {
    match points.iter().position(|(t, _)| *t >= at) {
        None => points.last().map(|(_, g)| *g).unwrap_or(0.0),
        Some(0) => points[0].1,
        Some(index) => {
            let ((ta, va), (tb, vb)) = (points[index - 1], points[index]);
            if (tb - ta).abs() < 1e-9 {
                vb
            } else {
                va + (vb - va) * ((at - ta) / (tb - ta)) as f32
            }
        }
    }
}

/// A fade on an audio clip has to reach the export, not only the preview.
///
/// It arrives as `fade_in_seconds`/`fade_out_seconds` rather than inside `gain_points`, which
/// is what it used to be. Folding it into the gain polyline meant it was applied by the ffmpeg
/// `volume` expression, evaluated once per ~21 ms audio frame — fine for a fade of a second,
/// and a hole rather than a ramp for the tens of milliseconds a dialogue join wants. The
/// numbers are the same; only the resolution they are applied at changed.
#[test]
fn an_audio_fade_reaches_the_export_mixer() {
    use bay_project::{AudioElement, MediaAsset, Track, TrackKind};
    let mut project = Project::starter();
    {
        let scene = project.active_scene_mut();
        let mut track = Track::new("t-audio", "Audio", TrackKind::Audio);
        let mut clip = Element::Audio(AudioElement {
            id: "bed".into(),
            name: "bed".into(),
            start: MediaTime::ZERO,
            duration: MediaTime::from_ticks(4 * 120_000),
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            media_id: "m-ok".into(),
            muted: false,
            volume: 1.0,
            speed: 1.0,
            prosody: None,
            dialogue_chain: None,
            trim_start: MediaTime::ZERO,
            animations: Default::default(),
            source: Default::default(),
            role: Default::default(),
        });
        clip.set_fades(
            MediaTime::from_ticks(120_000),
            MediaTime::from_ticks(120_000),
        );
        track.elements = vec![clip];
        scene.tracks.audio = vec![track];
    }
    let media = vec![MediaAsset::new("m-ok", "ok.mp3", "/tmp/ok.mp3")];
    let clips = bay_preview::audible_clips_for_test(project.active_scene(), &media);
    assert_eq!(clips.len(), 1);
    assert_eq!(
        clips[0].fade_in_seconds, 1.0,
        "the head fade reached the mixer"
    );
    assert_eq!(
        clips[0].fade_out_seconds, 1.0,
        "the tail fade reached the mixer"
    );
    // And it is not *also* in the gain polyline, which would apply it twice.
    assert_eq!(
        clips[0].gain_points,
        vec![(0.0, 1.0)],
        "a clip with no volume keyframes carries a flat gain; the fades are separate"
    );
}

// ---------------------------------------------------------------------------------------
// Export settings: what the file is wrapped in.

#[test]
fn presets_pick_settings_that_match_where_the_file_is_going() {
    use bay_preview::{ExportPreset, VideoCodec};

    let social = ExportPreset::from_wire("tiktok")
        .expect("an alias for social")
        .settings();
    assert_eq!(social.codec, VideoCodec::H264);
    assert_eq!(social.loudness_lufs, Some(-14.0));

    let youtube = ExportPreset::from_wire("youtube").unwrap().settings();
    assert!(
        youtube.quality < social.quality,
        "more bitrate for the platform's re-encode"
    );

    // A master is handed on for more work. Normalising it would bake in a decision the next
    // person has to undo.
    let master = ExportPreset::from_wire("master").unwrap().settings();
    assert_eq!(master.codec, VideoCodec::ProRes);
    assert_eq!(master.loudness_lufs, None);

    assert!(ExportPreset::from_wire("vimeo").is_none());
}

/// A ranged export renumbers time from its start: the sound moves with the picture, or the
/// music lands somewhere else in the file than it did in the room.
#[test]
fn a_range_moves_the_sound_with_the_picture() {
    let clip = |start: f64, duration: f64| bay_preview::AudibleClip {
        path: "/tmp/a.mp3".into(),
        start_seconds: start,
        trim_start_seconds: 0.0,
        duration_seconds: duration,
        volume: 1.0,
        speed: 1.0,
        dialogue_chain: None,
        gain_points: vec![(0.0, 1.0)],
        fade_in_seconds: 0.0,
        fade_out_seconds: 0.0,
    };

    // Exporting 5s..15s of a timeline.
    let kept = bay_preview::clips_in_range_for_test(
        vec![
            clip(0.0, 2.0),  // over before the range starts
            clip(6.0, 3.0),  // wholly inside
            clip(4.0, 4.0),  // straddles the start
            clip(20.0, 2.0), // after the range ends
        ],
        5.0,
        10.0,
    );
    assert_eq!(kept.len(), 2, "{kept:?}");

    let inside = kept
        .iter()
        .find(|c| c.duration_seconds == 3.0)
        .expect("the whole clip");
    assert_eq!(
        inside.start_seconds, 1.0,
        "6s in the timeline is 1s into the file"
    );

    let straddling = kept
        .iter()
        .find(|c| c.start_seconds == 0.0)
        .expect("the straddler");
    assert_eq!(
        straddling.duration_seconds, 3.0,
        "it lost the second before the range"
    );
    assert_eq!(
        straddling.trim_start_seconds, 1.0,
        "and skips that second of its own source, so the sound under frame 0 is the right one"
    );
}

#[test]
fn a_range_of_zero_leaves_every_clip_alone() {
    let clips = vec![bay_preview::AudibleClip {
        path: "/tmp/a.mp3".into(),
        start_seconds: 3.0,
        trim_start_seconds: 1.0,
        duration_seconds: 2.0,
        volume: 1.0,
        speed: 1.0,
        dialogue_chain: None,
        gain_points: vec![(0.0, 1.0)],
        fade_in_seconds: 0.0,
        fade_out_seconds: 0.0,
    }];
    let kept = bay_preview::clips_in_range_for_test(clips.clone(), 0.0, 10.0);
    assert_eq!(kept, clips);
}

/// The encode arguments are what actually reach ffmpeg. A codec that silently fell back to
/// the default would be invisible until someone opened the file.
#[test]
fn each_codec_asks_for_itself() {
    use bay_preview::VideoCodec;
    let args = |codec: VideoCodec| bay_preview::encoder_args_for_test(codec, 20).join(" ");

    let h264 = args(VideoCodec::H264);
    assert!(h264.contains("libx264"), "{h264}");
    assert!(h264.contains("-crf 20"), "{h264}");
    assert!(h264.contains("yuv420p"), "{h264}");

    let hevc = args(VideoCodec::Hevc);
    assert!(hevc.contains("libx265"), "{hevc}");
    // QuickTime will not open an HEVC file without this tag.
    assert!(hevc.contains("hvc1"), "{hevc}");

    let prores = args(VideoCodec::ProRes);
    assert!(prores.contains("prores"), "{prores}");
    assert!(
        prores.contains("yuv422p10le"),
        "10-bit 4:2:2, or ProRes is pointless: {prores}"
    );
}

/// A real encode at a non-default codec. Skipped without ffmpeg or a GPU, and a skip is a
/// skip — it never reads as a pass.
#[test]
fn hevc_actually_encodes() {
    if !require_ffmpeg() {
        return;
    }
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let dir = std::env::temp_dir().join("bay-export-settings-test");
    let _ = std::fs::create_dir_all(&dir);
    let out = dir.join("hevc.mp4");
    let _ = std::fs::remove_file(&out);

    let project = Project::starter();
    let result = renderer.export_video(
        project.active_scene(),
        0.4,
        10.0,
        160,
        90,
        &project.settings.background,
        &project.media,
        out.to_str().unwrap(),
        &bay_preview::ExportSettings {
            codec: bay_preview::VideoCodec::Hevc,
            quality: 30,
            ..bay_preview::ExportSettings::default()
        },
    );
    assert!(result.is_ok(), "hevc export failed: {result:?}");
    let size = std::fs::metadata(&out).expect("the file exists").len();
    assert!(size > 0, "an empty file is not an export");
}

/// A grade has to reach the pixels. This builds a real cube that swaps red and blue, renders a
/// red frame through it, and looks at what comes out — the only way to catch a LUT that parses,
/// uploads, binds, and samples the wrong axis.
#[test]
fn a_lut_actually_grades_the_frame() {
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let dir = std::env::temp_dir().join("bay-lut-test");
    let _ = std::fs::create_dir_all(&dir);
    let cube = dir.join("swap-rb.cube");

    // A 2-cube whose output is the input with red and blue exchanged. Entries are ordered with
    // red varying fastest.
    let mut text = String::from("LUT_3D_SIZE 2\n");
    for b in 0..2 {
        for g in 0..2 {
            for r in 0..2 {
                text.push_str(&format!("{b}.0 {g}.0 {r}.0\n"));
            }
        }
    }
    std::fs::write(&cube, text).expect("write the cube");

    // A full-frame red shape, graded.
    let mut project = Project::starter();
    project.settings.canvas = bay_project::CanvasSize {
        width: 64,
        height: 64,
    };
    {
        let scene = project.active_scene_mut();
        scene.tracks.overlay.clear();
        scene.tracks.audio.clear();
        scene.tracks.main.elements = vec![Element::Shape(bay_project::ShapeElement {
            id: "s".into(),
            name: "s".into(),
            start: MediaTime::ZERO,
            duration: MediaTime::from_ticks(120_000),
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            shape: bay_project::ShapeKind::Rect { radius: 0.0 },
            color: "#ff0000".into(),
            gradient: None,
            stroke: None,
            transform: bay_project::Transform::default(),
            effects: vec![bay_project::Effect {
                id: "fx".into(),
                effect_type: "lut".into(),
                enabled: true,
                params: [("amount".to_string(), 1.0)].into(),
                asset: Some(cube.to_string_lossy().into_owned()),
            }],
            animations: Default::default(),
            blend_mode: Default::default(),
            mask: None,
            source: Default::default(),
            role: Default::default(),
        })];
    }

    let frame = renderer
        .render(
            project.active_scene(),
            MediaTime::ZERO,
            64,
            64,
            &project.settings.background,
            &project.media,
        )
        .expect("a frame");

    // Centre pixel, BGRA.
    let index = ((32 * 64) + 32) * 4;
    let (blue, green, red) = (
        frame.bgra[index],
        frame.bgra[index + 1],
        frame.bgra[index + 2],
    );
    assert!(
        blue > 200 && red < 60,
        "the grade swapped red for blue: got r={red} g={green} b={blue}"
    );
}

/// An effect naming a .cube that is not there must leave the clip alone rather than take the
/// frame down with it — the missing file is `check`'s job to report, not the renderer's.
#[test]
fn a_missing_lut_file_leaves_the_frame_standing() {
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let mut project = Project::starter();
    if let Some(element) = project.active_scene_mut().tracks.main.elements.first_mut()
        && let Some(effects) = element.effects_mut()
    {
        {
            effects.push(bay_project::Effect {
                id: "fx".into(),
                effect_type: "lut".into(),
                enabled: true,
                params: [("amount".to_string(), 1.0)].into(),
                asset: Some("/tmp/definitely-not-here.cube".into()),
            });
        }
    }
    assert!(
        renderer
            .render(
                project.active_scene(),
                MediaTime::ZERO,
                64,
                64,
                &project.settings.background,
                &project.media,
            )
            .is_some(),
        "a missing grade must not cost the whole frame"
    );
}

/// Crop is the difference between reframing and squashing: it must move which *part* of the
/// source is on screen, not stretch what was already there.
#[test]
fn a_crop_shows_a_different_part_of_the_source() {
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let dir = std::env::temp_dir().join("bay-crop-test");
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("halves.png");

    // Left half red, right half blue.
    let mut image = image::RgbaImage::new(64, 64);
    for (x, _y, pixel) in image.enumerate_pixels_mut() {
        *pixel = if x < 32 {
            image::Rgba([255, 0, 0, 255])
        } else {
            image::Rgba([0, 0, 255, 255])
        };
    }
    image.save(&path).expect("write the test image");

    let framed = |crop_left: f32, crop_right: f32| {
        let mut project = Project::starter();
        project.settings.canvas = bay_project::CanvasSize {
            width: 64,
            height: 64,
        };
        project.media.push(bay_project::MediaAsset::new(
            "m",
            "halves.png",
            path.to_string_lossy(),
        ));
        {
            let scene = project.active_scene_mut();
            scene.tracks.overlay.clear();
            scene.tracks.audio.clear();
            scene.tracks.main.elements = vec![Element::Image(bay_project::ImageElement {
                id: "img".into(),
                name: "img".into(),
                start: MediaTime::ZERO,
                duration: MediaTime::from_ticks(120_000),
                fade_in: MediaTime::ZERO,
                fade_out: MediaTime::ZERO,
                media_id: "m".into(),
                transform: bay_project::Transform {
                    crop_left,
                    crop_right,
                    ..bay_project::Transform::default()
                },
                effects: Vec::new(),
                animations: Default::default(),
                blend_mode: Default::default(),
                mask: None,
                source: Default::default(),
                role: Default::default(),
            })];
        }
        project
    };

    // Keep only the right half: the centre of the frame must now be blue.
    let project = framed(0.5, 0.0);
    let frame = renderer
        .render(
            project.active_scene(),
            MediaTime::ZERO,
            64,
            64,
            &project.settings.background,
            &project.media,
        )
        .expect("a frame");
    let index = ((32 * 64) + 32) * 4;
    let (blue, red) = (frame.bgra[index], frame.bgra[index + 2]);
    assert!(
        blue > 200 && red < 60,
        "cropping to the right half should show blue: r={red} b={blue}"
    );
}

/// A mask limits where a clip shows. The pipeline behind it has been in the tree, tested and
/// switched off, since before any element could ask for one.
#[test]
fn a_mask_hides_what_falls_outside_it() {
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let mut project = Project::starter();
    project.settings.canvas = bay_project::CanvasSize {
        width: 64,
        height: 64,
    };
    {
        let scene = project.active_scene_mut();
        scene.tracks.overlay.clear();
        scene.tracks.audio.clear();
        scene.tracks.main.elements = vec![Element::Shape(bay_project::ShapeElement {
            id: "s".into(),
            name: "s".into(),
            start: MediaTime::ZERO,
            duration: MediaTime::from_ticks(120_000),
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            shape: bay_project::ShapeKind::Rect { radius: 0.0 },
            color: "#ffffff".into(),
            gradient: None,
            stroke: None,
            transform: bay_project::Transform::default(),
            effects: Vec::new(),
            animations: Default::default(),
            blend_mode: Default::default(),
            // A small circle in the middle of a full-frame white rectangle.
            mask: Some(bay_project::Mask {
                shape: bay_project::MaskShape::Ellipse,
                x: 0.5,
                y: 0.5,
                width: 0.4,
                height: 0.4,
                feather: 0.0,
                inverted: false,
            }),
            source: Default::default(),
            role: Default::default(),
        })];
    }

    let frame = renderer
        .render(
            project.active_scene(),
            MediaTime::ZERO,
            64,
            64,
            &project.settings.background,
            &project.media,
        )
        .expect("a frame");

    let alpha_at = |x: usize, y: usize| frame.bgra[((y * 64) + x) * 4 + 1];
    assert!(alpha_at(32, 32) > 200, "the middle is inside the mask");
    assert!(
        alpha_at(4, 4) < 60,
        "the corner is outside it and must be dark, got {}",
        alpha_at(4, 4)
    );
}

/// The mask raster itself: white inside, transparent outside, and an edge that is neither.
#[test]
fn a_mask_raster_covers_its_shape_and_nothing_else() {
    let mask = bay_project::Mask {
        shape: bay_project::MaskShape::Rect,
        x: 0.5,
        y: 0.5,
        width: 0.5,
        height: 0.5,
        feather: 0.0,
        inverted: false,
    };
    let rgba = bay_preview::rasterize_mask_for_test(&mask, 32, 32);
    let alpha = |x: usize, y: usize| rgba[((y * 32) + x) * 4 + 3];
    assert_eq!(alpha(16, 16), 255, "the centre is inside");
    assert_eq!(alpha(0, 0), 0, "the corner is outside");
    assert_eq!(alpha(16, 0), 0, "and so is directly above it");
}

/// `loudnorm` runs internally at 192 kHz and returns 96 kHz, and `amix` takes its channel layout
/// from its FIRST input — so a chain ending on `loudnorm`, fed a mono narration clip before the
/// bed, delivered 96 kHz **mono**. Both were measured in files that shipped. The export chain now
/// pins the delivery format after everything that could have changed it; this is the test that
/// says so, because the symptom is invisible until someone probes the file.
#[test]
fn an_export_delivers_48k_stereo_however_the_mix_was_assembled() {
    use bay_project::{AudioElement, Track};

    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    if !require_ffmpeg() {
        return;
    }
    let dir = std::env::temp_dir();
    let pid = std::process::id();

    // A mono 24 kHz voice and a stereo 48 kHz bed, with the MONO one first — the order that
    // collapsed the mix in the shipped file.
    let voice = dir.join(format!("bay-voice-{pid}.wav"));
    let bed = dir.join(format!("bay-bed-{pid}.wav"));
    for (path, args) in [
        (&voice, ["sine=f=440:d=2:r=24000", "1"]),
        (&bed, ["sine=f=220:d=2:r=48000", "2"]),
    ] {
        let made = std::process::Command::new("ffmpeg")
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                args[0],
            ])
            .args(["-ac", args[1], "-y"])
            .arg(path)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !require_ffmpeg_step(made, "generate a test tone") {
            return;
        }
    }

    let mut project = Project::starter();
    for (index, (id, path)) in [("voice", &voice), ("bed", &bed)].into_iter().enumerate() {
        project
            .media
            .push(MediaAsset::new(id, id, path.to_str().unwrap()));
        let mut track = Track::new(
            format!("audio-{index}"),
            format!("Audio {index}"),
            bay_project::TrackKind::Audio,
        );
        track.elements.push(Element::Audio(AudioElement {
            id: id.into(),
            name: id.into(),
            start: MediaTime::ZERO,
            duration: MediaTime::from_seconds_f64(2.0).unwrap(),
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            media_id: id.into(),
            muted: false,
            volume: 1.0,
            speed: 1.0,
            prosody: None,
            dialogue_chain: None,
            animations: Default::default(),
            trim_start: MediaTime::ZERO,
            source: Default::default(),
            role: Default::default(),
        }));
        project.active_scene_mut().tracks.audio.push(track);
    }

    let out = dir.join(format!("bay-fmt-{pid}.mp4"));
    let ok = renderer.export_video(
        project.active_scene(),
        1.0,
        10.0,
        64,
        36,
        &project.settings.background,
        &project.media,
        out.to_str().unwrap(),
        &bay_preview::ExportSettings::default(),
    );
    if !require_ffmpeg_step(ok.is_ok(), "encode the mixed export") {
        return;
    }

    let probe = std::process::Command::new("ffprobe")
        .args(["-v", "error", "-select_streams", "a:0"])
        .args(["-show_entries", "stream=sample_rate,channels"])
        .args(["-of", "default=nw=1"])
        .arg(&out)
        .output()
        .expect("ffprobe runs");
    let text = String::from_utf8_lossy(&probe.stdout);
    assert!(
        text.contains("sample_rate=48000"),
        "loudnorm hands back 96 kHz unless the chain resamples after it; got {text}"
    );
    assert!(
        text.contains("channels=2"),
        "amix takes its layout from its first input, and the mono voice is first; got {text}"
    );

    for path in [&voice, &bed, &out] {
        let _ = std::fs::remove_file(path);
    }
}

/// The bug this guards: an audio clip that stops before the picture does used to truncate the
/// whole export to the audio's end, and ffmpeg reported success.
///
/// A silent 0.7 s stinger at 4.85 s on an 8 s reel produced a 5.6 s file with the end card
/// missing. Nothing failed, nothing was logged; the only way to find it was to decode the
/// output and count. So this test decodes the output and counts.
#[test]
fn an_audio_clip_that_ends_early_does_not_truncate_the_export() {
    if !require_ffmpeg() {
        return;
    }
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let root = std::env::temp_dir().join(format!(
        "bay-short-audio-{}-{}",
        std::process::id(),
        std::thread::current().name().unwrap_or("test")
    ));
    std::fs::create_dir_all(&root).unwrap();

    // A one-second tone, to sit near the head of a four-second picture.
    let tone = root.join("stinger.wav");
    let made = std::process::Command::new("ffmpeg")
        .args([
            "-nostdin",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1",
            tone.to_str().unwrap(),
        ])
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if !require_ffmpeg_step(made, "generate the stinger") {
        return;
    }

    const PICTURE_SECONDS: f64 = 8.0;
    const FPS: u32 = 30;

    let mut project = Project::starter();
    project.media = vec![MediaAsset::new(
        "stinger",
        "stinger.wav",
        tone.to_string_lossy(),
    )];
    // One audio clip, one second long, finishing well before the picture does.
    let Element::Audio(stinger) = &mut project.active_scene_mut().tracks.audio[0].elements[0]
    else {
        panic!("the starter audio lane should contain audio")
    };
    // Placed late and finishing early, which is the shape that broke: the mixed bed's last
    // sample lands at 2.5 s on a 4 s picture.
    stinger.media_id = "stinger".into();
    stinger.start = MediaTime::from_seconds_f64(4.85).unwrap();
    stinger.duration = MediaTime::from_seconds_f64(0.7).unwrap();
    project.active_scene_mut().tracks.audio[0]
        .elements
        .truncate(1);

    let out = root.join("short-audio.mp4");
    let result = renderer.export_video(
        project.active_scene(),
        PICTURE_SECONDS,
        f64::from(FPS),
        1920,
        1080,
        &project.settings.background,
        &project.media,
        out.to_str().unwrap(),
        &bay_preview::ExportSettings::default(),
    );
    // Asserted, not gated. `require_ffmpeg_step` turns a failure into a *skip*, and the failure
    // mode here — ffmpeg quitting early and the pipe breaking — is precisely what this test
    // exists to catch. Gating it made the test skip on the bug and report a pass.
    assert!(
        result.is_ok(),
        "the export failed outright, which is the truncation showing up as a broken pipe: \
         {result:?}"
    );

    // Count decoded frames, not container metadata: a truncated file can still carry a header
    // that claims the full duration, and it was the decode that exposed this in the first place.
    let probe = std::process::Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-count_frames",
            "-show_entries",
            "stream=nb_read_frames",
            "-of",
            "default=nw=1:nk=1",
            out.to_str().unwrap(),
        ])
        .output();
    let Ok(probe) = probe else {
        let _ = std::fs::remove_dir_all(&root);
        return;
    };
    if !require_ffmpeg_step(probe.status.success(), "probe the short-audio mp4") {
        let _ = std::fs::remove_dir_all(&root);
        return;
    }
    let frames: u32 = String::from_utf8_lossy(&probe.stdout)
        .trim()
        .parse()
        .unwrap_or(0);

    let expected = (PICTURE_SECONDS * f64::from(FPS)).round() as u32;
    assert_eq!(
        frames, expected,
        "the export was cut to the audio clip's end: {frames} frames on disk, {expected} expected \
         for {PICTURE_SECONDS}s at {FPS}fps"
    );
    let _ = std::fs::remove_dir_all(&root);
}

/// A short audio fade must reach the file as a ramp, not as a hole.
///
/// Fades used to be folded into the `volume` expression, which the export evaluates once per
/// audio frame — about 21 ms — and holds. A fade of a second survives that; a fade of a few
/// tens of milliseconds *is* one frame, and the frame it lands on is multiplied by the value
/// at the very start of the curve, which for a fade-in is zero. So the crossfade that smooths
/// a dialogue join arrived as ~21 ms of digital silence on each side of it: two clips butt
/// joined with 35 ms fades measured 67 ms of exact zero, and the same two clips with the fades
/// removed measured none. A smoothing that produces a hole is worse than the seam it replaced.
///
/// The fades are `afade` now, which works on samples. This renders the shape that broke and
/// asserts the file has no digital silence in it at all.
#[test]
fn a_short_audio_fade_renders_as_a_ramp_rather_than_a_hole() {
    let Some(mut renderer) = bay_test_support::require_gpu_backed(
        "a PreviewRenderer",
        bay_preview::PreviewRenderer::new,
    ) else {
        return;
    };
    let dir = std::env::temp_dir().join("bay-short-fade");
    let _ = std::fs::create_dir_all(&dir);
    let tone = dir.join("tone.wav");
    let out = dir.join("short-fade.mp4");

    let made = std::process::Command::new("ffmpeg")
        .args([
            "-nostdin",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=4",
            tone.to_str().unwrap(),
        ])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !require_ffmpeg_step(made, "synthesize a test tone") {
        return;
    }

    // 35 ms, the length a dialogue join wants — and under two audio frames.
    let fade = MediaTime::from_seconds_f64(0.035).expect("35 ms");
    let mut project = Project::starter();
    project.media = vec![bay_project::MediaAsset::new(
        "tone",
        "tone.wav",
        tone.to_str().unwrap(),
    )];
    {
        let scene = project.active_scene_mut();
        let one = |id: &str, start: f64, trim: f64, fade_in, fade_out| {
            Element::Audio(bay_project::AudioElement {
                id: id.into(),
                name: id.into(),
                start: MediaTime::from_seconds_f64(start).expect("a start"),
                duration: MediaTime::from_seconds_f64(1.0).expect("a second"),
                fade_in,
                fade_out,
                media_id: "tone".into(),
                muted: false,
                volume: 1.0,
                speed: 1.0,
                prosody: None,
                dialogue_chain: None,
                animations: Default::default(),
                trim_start: MediaTime::from_seconds_f64(trim).expect("a trim"),
                source: Default::default(),
                role: Default::default(),
            })
        };
        scene.tracks.audio[0].elements = vec![
            one("a", 0.0, 0.0, MediaTime::ZERO, fade),
            one("b", 1.0, 2.0, fade, MediaTime::ZERO),
        ];
    }

    let rendered = renderer.export_video(
        project.active_scene(),
        2.0,
        30.0,
        320,
        180,
        &project.settings.background,
        &project.media,
        out.to_str().unwrap(),
        &bay_preview::ExportSettings {
            loudness_lufs: None,
            ..Default::default()
        },
    );
    assert!(rendered.is_ok(), "the export failed: {rendered:?}");

    // Decode and look for exact zero. A sine through a linear crossfade never reaches it.
    let pcm = std::process::Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-i",
            out.to_str().unwrap(),
            "-ac",
            "1",
            "-ar",
            "48000",
            "-f",
            "f32le",
            "-",
        ])
        .output()
        .expect("decode the rendered audio");
    let samples: Vec<f32> = pcm
        .stdout
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect();
    assert!(!samples.is_empty(), "the render carried no audio at all");

    // The longest run of silence anywhere but the very ends.
    let mut longest = 0usize;
    let mut run = 0usize;
    for (index, sample) in samples.iter().enumerate() {
        if sample.abs() < 1e-7 {
            run += 1;
            if index + 1 < samples.len() && index > 480 {
                longest = longest.max(run);
            }
        } else {
            run = 0;
        }
    }
    let seconds = longest as f64 / 48000.0;
    assert!(
        seconds < 0.005,
        "a {:.0} ms hole in the middle of a crossfade — the fade was quantised to an audio \
         frame instead of applied to samples",
        seconds * 1000.0
    );
}

/// A gradient fill reaches the pixels, and the texture cache tells two ramps apart.
///
/// Both halves matter. The ramp is the point — a flat orb on a flat ground is what this format
/// looks like without it — and the cache is where it would silently go wrong: shape textures are
/// keyed and reused, so a key that does not carry the fill hands the second shape the first
/// one's picture, which looks like the gradient working until the moment two of them differ.
#[test]
fn a_gradient_fills_across_the_shape_and_is_not_shared_between_ramps() {
    use bay_project::{Gradient, ShapeKind};

    let (w, h) = (64u32, 64u32);
    let read = |rgba: &[u8], x: u32, y: u32| {
        let i = ((y * w + x) * 4) as usize;
        [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]
    };

    // Black to white, left to right, across a square-cornered rect that fills the raster.
    let ramp = Gradient {
        from: "#000000".into(),
        to: "#FFFFFF".into(),
        angle: 0.0,
    };
    let shape = ShapeKind::Rect { radius: 0.0 };
    let filled = bay_preview::rasterize_shape_for_test(&shape, "#FF0000", Some(&ramp), None, w, h);

    let mid_y = h / 2;
    let left = read(&filled, 2, mid_y);
    let centre = read(&filled, w / 2, mid_y);
    let right = read(&filled, w - 3, mid_y);
    assert!(
        left[3] > 0 && right[3] > 0,
        "the shape is opaque where it is filled"
    );
    assert!(
        left[0] < centre[0] && centre[0] < right[0],
        "the ramp runs dark to light across the shape: {left:?} {centre:?} {right:?}"
    );
    assert!(
        left[0] < 40,
        "the near edge is close to the first stop: {left:?}"
    );
    assert!(
        right[0] > 215,
        "the far edge is close to the second stop: {right:?}"
    );
    assert!(
        (i16::from(centre[0]) - 128).abs() < 24,
        "the middle is about halfway: {centre:?}"
    );

    // Turned 90 degrees the ramp runs down the frame instead, and across it is flat.
    let down = Gradient {
        angle: 90.0,
        ..ramp.clone()
    };
    let vertical =
        bay_preview::rasterize_shape_for_test(&shape, "#FF0000", Some(&down), None, w, h);
    let top = read(&vertical, w / 2, 2);
    let bottom = read(&vertical, w / 2, h - 3);
    assert!(
        top[0] < bottom[0],
        "90 degrees runs top to bottom: {top:?} {bottom:?}"
    );
    let across = (
        read(&vertical, 2, mid_y)[0],
        read(&vertical, w - 3, mid_y)[0],
    );
    assert!(
        (i16::from(across.0) - i16::from(across.1)).abs() < 8,
        "and is flat across the other axis: {across:?}"
    );

    // The flat fill is untouched when no gradient is given.
    let solid = bay_preview::rasterize_shape_for_test(&shape, "#FF0000", None, None, w, h);
    assert_eq!(read(&solid, 2, mid_y)[..3], [255, 0, 0]);
    assert_eq!(read(&solid, w - 3, mid_y)[..3], [255, 0, 0]);
}

/// A stroke draws the outline, and a dash breaks it along the long axis.
///
/// Both fall out of the distance field the rasteriser already builds — an outline is the band
/// either side of the boundary — which is why a rounded rect and an ellipse both get one
/// without either being special-cased. The dash exists for one thing: the connector between two
/// nodes in a diagram, which is a long thin rect.
#[test]
fn a_stroke_outlines_the_shape_and_a_dash_breaks_it_up() {
    use bay_project::{ShapeKind, Stroke};

    let (w, h) = (64u32, 64u32);
    let alpha = |rgba: &[u8], x: u32, y: u32| rgba[((y * w + x) * 4 + 3) as usize];
    let square = ShapeKind::Rect { radius: 0.0 };

    // Outlined: the edge is drawn, the middle is not.
    let outline = Stroke {
        color: "#ffffff".into(),
        width: 0.06,
        dash: None,
        gap: None,
    };
    let stroked =
        bay_preview::rasterize_shape_for_test(&square, "#ff0000", None, Some(&outline), w, h);
    assert!(alpha(&stroked, w / 2, 1) > 200, "the top edge is drawn");
    assert!(alpha(&stroked, 1, h / 2) > 200, "the left edge is drawn");
    assert_eq!(alpha(&stroked, w / 2, h / 2), 0, "the middle is hollow");

    // The same shape with no stroke is solid through the middle.
    let solid = bay_preview::rasterize_shape_for_test(&square, "#ff0000", None, None, w, h);
    assert!(alpha(&solid, w / 2, h / 2) > 200, "a fill is still a fill");

    // A long thin bar, dashed: the run along it alternates rather than being continuous.
    let (bw, bh) = (256u32, 8u32);
    let dashed = Stroke {
        color: "#ffffff".into(),
        width: 0.9,
        dash: Some(0.05),
        gap: Some(0.05),
    };
    let bar =
        bay_preview::rasterize_shape_for_test(&square, "#ffffff", None, Some(&dashed), bw, bh);
    let row: Vec<u8> = (0..bw)
        .map(|x| bar[(((bh / 2) * bw + x) * 4 + 3) as usize])
        .collect();
    let on = row.iter().filter(|a| **a > 128).count();
    let off = row.iter().filter(|a| **a < 32).count();
    assert!(on > 20, "some of the line is drawn: {on} of {bw}");
    assert!(off > 20, "and some of it is gap: {off} of {bw}");
    let changes = row
        .windows(2)
        .filter(|w| (w[0] > 128) != (w[1] > 128))
        .count();
    assert!(
        changes >= 6,
        "a dashed line alternates several times, not once: {changes}"
    );
}

/// A stroked shape and a filled one of the same colour must not share a cached texture.
///
/// This shipped broken: `shape_raster_key` carried the shape, its radius, its fill and the
/// raster size, but not the stroke. In the film that found it, a red rule and an outlined red
/// boundary box were both square-cornered rects on an 8x8 tile, so the boundary drew as a solid
/// red plate across the whole frame; a stroked ellipse and a solid one of the same red swapped
/// the other way and the solid mark rendered as a ring. No error, no warning — just the wrong
/// picture, and only when a project contained both.
#[test]
fn a_stroked_shape_does_not_borrow_a_filled_one_s_texture() {
    use bay_preview::shape_raster_key;
    use bay_project::{ShapeKind, Stroke};

    let outline = Stroke {
        color: "#C42A18".into(),
        width: 0.004,
        dash: None,
        gap: None,
    };
    for shape in [ShapeKind::Rect { radius: 0.0 }, ShapeKind::Ellipse] {
        let filled = shape_raster_key(&shape, "#C42A18", None, None, 8, 8);
        let stroked = shape_raster_key(&shape, "#C42A18", None, Some(&outline), 8, 8);
        assert_ne!(filled, stroked, "{shape:?}: fill and outline share a key");
    }

    // And a dash is a different picture from a continuous line of the same width.
    let dashed = Stroke {
        dash: Some(0.02),
        gap: Some(0.01),
        ..outline.clone()
    };
    assert_ne!(
        shape_raster_key(
            &ShapeKind::Rect { radius: 0.0 },
            "#C42A18",
            None,
            Some(&outline),
            8,
            8
        ),
        shape_raster_key(
            &ShapeKind::Rect { radius: 0.0 },
            "#C42A18",
            None,
            Some(&dashed),
            8,
            8
        ),
    );
}

/// A tilted card is a trapezoid, and which end is wide says which way it leans.
///
/// The check that matters is the *asymmetry*, not the presence of an edge: a renderer that
/// ignored the tilt entirely would still draw a rectangle with a top and a bottom, and every
/// row would be the same width. Measuring both ends and comparing them is what distinguishes
/// "the projection ran" from "the uniform was uploaded and never read".
///
/// The rows are found rather than assumed, because a tilt also *shortens* the card — leaning
/// away foreshortens by the cosine of the angle — so a pair of fixed rows that framed the flat
/// card falls outside the tilted one and reads as a renderer that drew nothing.
#[test]
fn a_tilted_card_foreshortens_the_edge_that_leans_away() {
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };

    // The width of the card at its top and bottom edges, and the rows they were found on.
    let mut ends = |tilt_x: f32| -> (u32, u32) {
        let mut shape = bar(0.6, 0.5);
        shape.transform.scale_y = 0.6;
        shape.transform.tilt_x = tilt_x;
        let project = shape_scene(shape);
        let frame = renderer
            .render(
                project.active_scene(),
                MediaTime::ZERO,
                320,
                180,
                &project.settings.background,
                &project.media,
            )
            .expect("a frame");
        let width_at = |y: u32| {
            (0..frame.width)
                .filter(|x| pixel(&frame, *x, y) != [0, 0, 0])
                .count() as u32
        };
        let rows: Vec<u32> = (0..frame.height).filter(|y| width_at(*y) > 0).collect();
        assert!(
            rows.len() > 8,
            "tilt {tilt_x} left only {} rows of card to measure",
            rows.len()
        );
        // Two rows in from each edge, so a single row of antialiasing cannot decide the test.
        (width_at(rows[2]), width_at(rows[rows.len() - 3]))
    };

    let (flat_top, flat_bottom) = ends(0.0);
    assert!(
        flat_top.abs_diff(flat_bottom) <= 2,
        "an untilted card is a rectangle: {flat_top} vs {flat_bottom}"
    );

    // Leaning the top away from the eye: the top edge must come out narrower than the bottom.
    let (top, bottom) = ends(30.0);
    assert!(
        bottom > top + 4,
        "a card leaning away at the top should be narrower there: top {top}, bottom {bottom}"
    );

    // The opposite sign is the mirror image, which rules out a one-way fudge in the shader.
    let (top_b, bottom_b) = ends(-30.0);
    assert!(
        top_b > bottom_b + 4,
        "the opposite tilt should widen the top: top {top_b}, bottom {bottom_b}"
    );
    assert!(
        top_b.abs_diff(bottom) <= 3 && bottom_b.abs_diff(top) <= 3,
        "equal and opposite tilts should mirror: {top}/{bottom} vs {top_b}/{bottom_b}"
    );
}

/// A tilt past edge-on cannot be projected, and a NaN one is not a number the shader can
/// compare against. Both have to land somewhere harmless rather than painting the layer over
/// the whole canvas or crashing the editor.
#[test]
fn an_impossible_tilt_still_renders_a_card() {
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    for tilt in [f32::NAN, f32::INFINITY, 179.0, -4000.0] {
        let mut shape = bar(0.6, 0.5);
        shape.transform.scale_y = 0.6;
        shape.transform.tilt_x = tilt;
        let project = shape_scene(shape);
        let frame = renderer
            .render(
                project.active_scene(),
                MediaTime::ZERO,
                320,
                180,
                &project.settings.background,
                &project.media,
            )
            .expect("a frame even for a tilt that cannot be projected");
        let covered = (0..frame.width * frame.height)
            .filter(|i| pixel(&frame, i % frame.width, i / frame.width) != [0, 0, 0])
            .count();
        let share = covered as f64 / (frame.width * frame.height) as f64;
        assert!(
            share < 0.9,
            "tilt {tilt} painted {:.0}% of the canvas — a non-finite angle reached the shader",
            share * 100.0
        );
    }
}

/// A typed line arrives a character at a time, and the picture proves it.
///
/// Asserted on rendered ink rather than on the string the model returns, because the two can
/// disagree in the one way that matters: the raster cache is keyed by content, and a cache that
/// ignored the prefix would serve the finished line at every frame while `revealed()` kept
/// returning the right substring. Ink at three moments, strictly increasing, is what rules that
/// out.
#[test]
fn a_typed_line_reaches_the_frame_one_character_at_a_time() {
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let mut project = Project::starter();
    {
        let scene = project.active_scene_mut();
        scene.tracks.overlay.clear();
        scene.tracks.main.elements = vec![Element::Text(bay_project::TextElement {
            id: "typed".into(),
            name: "typed".into(),
            start: MediaTime::ZERO,
            duration: MediaTime::from_ticks(120_000 * 8),
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            content: "the editor is the api".into(),
            font_size: 64.0,
            color: "#ffffff".into(),
            transform: Transform {
                scale: 0.9,
                ..Transform::default()
            },
            effects: Vec::new(),
            animations: Default::default(),
            blend_mode: Default::default(),
            mask: None,
            font_family: None,
            font_weight: 400,
            align: bay_project::TextAlign::Left,
            letter_spacing: 0.0,
            line_height: 1.2,
            decorations: None,
            karaoke: None,
            type_on: Some(bay_project::TypeOn {
                chars_per_second: 10.0,
                caret: false,
            }),
            source: Default::default(),
            role: Default::default(),
        })];
    }
    project.settings.background = bay_project::Background::Color {
        color: "#000000".into(),
    };

    let mut ink_at = |seconds: f64| -> usize {
        let frame = renderer
            .render(
                project.active_scene(),
                MediaTime::from_seconds_f64(seconds).expect("a playhead"),
                320,
                180,
                &project.settings.background,
                &project.media,
            )
            .expect("a frame");
        (0..frame.width * frame.height)
            .filter(|i| pixel(&frame, i % frame.width, i / frame.width) != [0, 0, 0])
            .count()
    };

    // 21 characters at 10/s: nothing at all before the first lands, a fraction mid-way, the
    // whole line once it has run.
    let early = ink_at(0.05);
    let middle = ink_at(1.0);
    let full = ink_at(2.5);
    assert_eq!(
        early, 0,
        "nothing should be typed yet at 0.05s, found {early}"
    );
    assert!(
        middle > 0 && middle < full,
        "half-typed should be some but not all of the line: {middle} of {full}"
    );
    assert!(full > 0, "the finished line should have ink");

    // And it stays finished — a reveal that wrapped back to nothing would still pass the above.
    let later = ink_at(7.0);
    assert_eq!(
        later, full,
        "a line that has finished typing should stay whole"
    );
}

/// The shadow has to be *visible*, and its dial has to move it.
///
/// The GPU test above only proves the shader compiles and the pass runs; a shadow that packed
/// its uniforms perfectly and composited nothing would pass it. This renders the same frame
/// twice with only `amount` changed and compares total luminance, so it needs no knowledge of
/// where the layer landed — a black shadow can only ever make the frame darker, and a stronger
/// one has to make it darker still.
#[test]
fn a_stronger_drop_shadow_darkens_the_frame() {
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };

    let luminance_at = |renderer: &mut PreviewRenderer, amount: f32| -> f64 {
        let mut project = Project::starter();
        // A black shadow on the starter's black background is invisible, and the test would
        // pass or fail on rounding noise. White ground, ink shadow — which is also the only
        // arrangement in which anyone would notice a shadow at all.
        project.settings.background = bay_project::Background::Color {
            color: "#ffffff".to_string(),
        };
        if let Element::Text(title) = &mut project.active_scene_mut().tracks.main.elements[0] {
            let mut params = bay_core::blocks::default_effect_params("drop-shadow");
            params.insert("amount".to_string(), amount);
            title.effects.push(Effect {
                id: "fx-shadow".into(),
                effect_type: "drop-shadow".into(),
                enabled: true,
                params,
                asset: None,
            });
        }
        // Sampled after the title's fade-in, not at zero. At t=0 the starter title's gain is
        // still 0, so the compositor multiplies the whole layer — shadow included — down to
        // nothing, and both renders come back as bare background.
        let (width, height) = (160, 90);
        let frame = renderer
            .render(
                project.active_scene(),
                MediaTime::from_seconds_f64(1.0).expect("one second is representable"),
                width,
                height,
                &project.settings.background,
                &project.media,
            )
            .expect("the GPU produced a frame");
        // Luminance from the colour bytes only. BGRA's fourth byte is alpha, and a shadow
        // raises alpha while lowering colour, so summing all four can cancel the very thing
        // this asserts.
        frame
            .bgra
            .chunks_exact(4)
            .map(|px| px[0] as f64 + px[1] as f64 + px[2] as f64)
            .sum()
    };

    let faint = luminance_at(&mut renderer, 0.05);
    let strong = luminance_at(&mut renderer, 0.9);
    assert!(
        strong < faint,
        "a stronger shadow should darken the frame: faint={faint}, strong={strong}"
    );
}

/// Render a project file to a PNG so a migration can be *looked at*.
///
/// Gated on env vars, and inert without them. A project that deserializes is not a project that
/// renders correctly — geometry, text metrics and effect params can all be well-formed and
/// still put the type in the wrong place, which is only visible in a frame.
///
/// `BAY_LOAD_PROJECT=p.json BAY_RENDER_FRAME=195 BAY_RENDER_OUT=out.png \
///   cargo test -p bay-preview --test render render_external_project -- --nocapture`
#[test]
fn render_external_project() {
    let (Ok(path), Ok(out)) = (
        std::env::var("BAY_LOAD_PROJECT"),
        std::env::var("BAY_RENDER_OUT"),
    ) else {
        return;
    };
    let frame: i64 = std::env::var("BAY_RENDER_FRAME")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let raw = std::fs::read_to_string(&path).expect("the project file is readable");
    let project: bay_project::Project = serde_json::from_str(&raw).expect("it is a project");
    let (width, height) = (
        project.settings.canvas.width,
        project.settings.canvas.height,
    );
    let rendered = renderer
        .render(
            project.active_scene(),
            MediaTime::from_ticks(frame * 4_000),
            width,
            height,
            &project.settings.background,
            &project.media,
        )
        .expect("the GPU produced a frame");

    // The compositor hands back BGRA; PNG wants RGBA.
    let mut rgba = rendered.bgra.clone();
    for px in rgba.chunks_exact_mut(4) {
        px.swap(0, 2);
    }
    image::save_buffer(&out, &rgba, width, height, image::ColorType::Rgba8)
        .expect("the PNG is written");
    println!("RENDERED {out} at frame {frame} ({width}x{height})");
}

// ---------------------------------------------------------------------------------------------
// The pipelined preview path: composite on one tick, collect on a later one.
// ---------------------------------------------------------------------------------------------

/// Drive `collect_composite` until it stops saying `Pending`, the way the editor's
/// animation-frame loop does. Bounded so a wedged readback fails the test instead of hanging it.
fn collect_until_ready(renderer: &mut PreviewRenderer) -> bay_preview::PreviewFrame {
    for _ in 0..10_000 {
        match renderer.collect_composite() {
            CollectedFrame::Ready(frame) => return frame,
            CollectedFrame::Pending => continue,
            CollectedFrame::Idle => panic!("nothing was in flight to collect"),
            CollectedFrame::Failed => panic!("the readback failed"),
        }
    }
    panic!("the composite never finished");
}

#[test]
fn a_pipelined_composite_produces_the_same_pixels_as_a_blocking_one() {
    // The whole point of the pipelined path is that it is only a *timing* change. If it ever
    // renders something different from `render`, the preview has stopped showing what an export
    // of the same frame would produce.
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let project = Project::starter();
    let (width, height) = (128, 72);

    let blocking = renderer
        .render(
            project.active_scene(),
            MediaTime::ZERO,
            width,
            height,
            &project.settings.background,
            &project.media,
        )
        .expect("the GPU produced a frame");

    assert!(
        renderer.submit_composite(
            project.active_scene(),
            MediaTime::ZERO,
            width,
            height,
            &project.settings.background,
            &project.media,
        ),
        "the composite went to the GPU"
    );
    let pipelined = collect_until_ready(&mut renderer);

    assert_eq!((pipelined.width, pipelined.height), (width, height));
    assert_eq!(
        pipelined.bgra, blocking.bgra,
        "the pipelined path composited a different picture than the blocking one"
    );
}

#[test]
fn a_second_composite_is_refused_while_one_is_still_in_flight() {
    // There is one staging buffer. Submitting again before collecting would have the GPU writing
    // into the buffer the previous frame is being read out of.
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let project = Project::starter();
    let submit = |renderer: &mut PreviewRenderer| {
        renderer.submit_composite(
            project.active_scene(),
            MediaTime::ZERO,
            64,
            36,
            &project.settings.background,
            &project.media,
        )
    };

    assert!(submit(&mut renderer), "the first composite was accepted");
    assert!(renderer.has_pending_readback());
    assert!(
        !submit(&mut renderer),
        "a second composite must be refused while the first is uncollected"
    );

    let _ = collect_until_ready(&mut renderer);
    assert!(!renderer.has_pending_readback());
    assert!(
        submit(&mut renderer),
        "once collected, the renderer accepts work again"
    );
}

#[test]
fn collecting_nothing_is_idle_rather_than_a_failure() {
    // `Idle` and `Failed` drive different behaviour in the editor — one is "nothing to do", the
    // other clears the frame signature to force a re-composite. A fresh renderer is the former.
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    assert!(matches!(renderer.collect_composite(), CollectedFrame::Idle));
    assert!(!renderer.has_pending_readback());
}

#[test]
fn a_discarded_composite_is_not_delivered_to_the_next_collect() {
    // Opening a different project discards whatever is in flight. If those pixels survived, the
    // previous project's last frame would appear as the new project's first.
    let Some(mut renderer) = require_gpu_backed("a PreviewRenderer", PreviewRenderer::new) else {
        return;
    };
    let project = Project::starter();
    assert!(renderer.submit_composite(
        project.active_scene(),
        MediaTime::ZERO,
        64,
        36,
        &project.settings.background,
        &project.media,
    ));

    renderer.discard_composite();
    assert!(!renderer.has_pending_readback());
    assert!(
        matches!(renderer.collect_composite(), CollectedFrame::Idle),
        "a discarded composite must not be collectable"
    );

    // The staging buffer must be reusable afterwards, not left mapped.
    assert!(renderer.submit_composite(
        project.active_scene(),
        MediaTime::ZERO,
        64,
        36,
        &project.settings.background,
        &project.media,
    ));
    let frame = collect_until_ready(&mut renderer);
    assert_eq!(frame.bgra.len(), 64 * 36 * 4);
}
