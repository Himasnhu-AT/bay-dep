//! The preview renderer composites the starter scene to a non-empty BGRA frame on a real GPU.
//! Skips if no adapter is available.

use opencut_preview::PreviewRenderer;
use opencut_project::{MediaTime, Project};

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
