//! The preview renderer composites the starter scene to a non-empty BGRA frame on a real GPU.
//! Skips if no adapter is available.

use opencut_preview::PreviewRenderer;
use opencut_project::{Effect, Element, MediaTime, Project};

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
        MediaTime::ZERO, // the title layer is on screen at t=0
        width,
        height,
        &project.settings.background,
    );

    assert_eq!(frame.bgra.len() as u32, width * height * 4);
    // The top-left corner is background; some interior pixels are the title layer.
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
    // Attach a brightness effect to the title element.
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
    );
    assert_eq!(frame.bgra.len() as u32, width * height * 4);
}
