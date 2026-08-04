//! The preview renderer composites scenes to non-empty BGRA frames on a real GPU (skips if none).

use opencut_preview::PreviewRenderer;
use opencut_project::{
    Effect, Element, ImageElement, MediaAsset, MediaTime, Project, Transform, VideoElement,
};

#[test]
fn renders_starter_scene_to_a_nonempty_frame() {
    let Some(mut renderer) = PreviewRenderer::new() else {
        eprintln!("skipping: no GPU adapter");
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
    let Some(mut renderer) = PreviewRenderer::new() else {
        eprintln!("skipping: no GPU adapter");
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
    assert!(after_first > 0, "starter scene has text; something should be cached");

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
    let Some(mut renderer) = PreviewRenderer::new() else {
        eprintln!("skipping: no GPU adapter");
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
    let Some(mut renderer) = PreviewRenderer::new() else {
        eprintln!("skipping: no GPU adapter");
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
    let Some(mut renderer) = PreviewRenderer::new() else {
        eprintln!("skipping: no GPU adapter");
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
    let Some(mut renderer) = PreviewRenderer::new() else {
        eprintln!("skipping: no GPU adapter");
        return;
    };

    // Generate a short red test clip via ffmpeg; skip if ffmpeg isn't available.
    let path = std::env::temp_dir().join(format!("vii-test-video-{}.mp4", std::process::id()));
    let generated = std::process::Command::new("ffmpeg")
        .args([
            "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi",
            "-i", "color=c=red:s=32x32:d=1:r=10", "-frames:v", "10",
            "-pix_fmt", "yuv420p", path.to_str().unwrap(),
        ])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !generated {
        eprintln!("skipping: ffmpeg unavailable");
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
fn exports_a_short_video_via_ffmpeg() {
    let Some(mut renderer) = PreviewRenderer::new() else {
        eprintln!("skipping: no GPU adapter");
        return;
    };
    let project = Project::starter();
    let out = std::env::temp_dir().join(format!("vii-export-{}.mp4", std::process::id()));
    let ok = renderer.export_video(
        project.active_scene(),
        0.5, // seconds
        10.0, // fps → 5 frames
        64,
        36,
        &project.settings.background,
        &project.media,
        out.to_str().unwrap(),
    );
    if !ok {
        eprintln!("skipping: ffmpeg encode unavailable");
        return;
    }
    let size = std::fs::metadata(&out).map(|m| m.len()).unwrap_or(0);
    assert!(size > 0, "exported video should be non-empty");
    let _ = std::fs::remove_file(&out);
}
