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
