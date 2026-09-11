//! `cover_fit` — the geometry that lets a picture fill a panel instead of letterboxing inside it.
//!
//! Asserted against `fit_contain`, because the two are one claim: crop the source to the panel's
//! aspect, and contain now fills. If these ever disagree the montage grows black bars nobody
//! asked for.

use bay_preview::{cover_fit, fit_contain_for_test};

const W: u32 = 1080;
const H: u32 = 1920;

/// What the panel actually renders as, given the insets and scale `cover_fit` chose.
fn rendered(natural: (u32, u32), panel_w: f32, panel_h: f32) -> (f32, f32) {
    let (left, top, right, bottom, scale) = cover_fit(Some(natural), panel_w, panel_h, W, H);
    let cropped = (
        (natural.0 as f32 * (1.0 - left - right)).round() as u32,
        (natural.1 as f32 * (1.0 - top - bottom)).round() as u32,
    );
    fit_contain_for_test(Some(cropped), scale * W as f32, scale * H as f32)
}

/// The case the three videos were built on: a full-width, slightly-short panel.
#[test]
fn a_landscape_source_fills_a_nearly_square_panel() {
    let (w, h) = rendered((800, 553), 1.0, 0.584);
    assert!((w - W as f32).abs() < 2.0, "width {w}");
    assert!((h - 0.584 * H as f32).abs() < 2.0, "height {h}");
}

#[test]
fn a_portrait_source_fills_the_same_panel() {
    let (w, h) = rendered((540, 783), 1.0, 0.584);
    assert!((w - W as f32).abs() < 2.0, "width {w}");
    assert!((h - 0.584 * H as f32).abs() < 2.0, "height {h}");
}

/// A tall panel is limited by height rather than width, and the scale has to follow.
#[test]
fn a_tall_panel_is_filled_too() {
    let (w, h) = rendered((4000, 3000), 0.6, 0.9);
    assert!((w - 0.6 * W as f32).abs() < 2.0, "width {w}");
    assert!((h - 0.9 * H as f32).abs() < 2.0, "height {h}");
}

#[test]
fn a_source_already_the_panel_shape_is_not_cropped() {
    let (left, top, right, bottom, _) = cover_fit(Some((1080, 1121)), 1.0, 0.584, W, H);
    assert_eq!((left, top, right, bottom), (0.0, 0.0, 0.0, 0.0));
}

/// Only one axis is ever trimmed. Cropping both would throw away more than it had to.
#[test]
fn only_the_overhanging_axis_is_trimmed() {
    let (left, top, right, bottom, _) = cover_fit(Some((4000, 1000)), 1.0, 0.584, W, H);
    assert!(left > 0.0 && right > 0.0, "a wide source loses its sides");
    assert_eq!((top, bottom), (0.0, 0.0));

    let (left, top, right, bottom, _) = cover_fit(Some((1000, 4000)), 1.0, 0.584, W, H);
    assert!(
        top > 0.0 && bottom > 0.0,
        "a tall source loses top and bottom"
    );
    assert_eq!((left, right), (0.0, 0.0));
}

/// The insets are symmetric — a cover crop takes the middle, never a corner.
#[test]
fn the_crop_is_centred() {
    let (left, _, right, _, _) = cover_fit(Some((4000, 1000)), 1.0, 0.584, W, H);
    assert!((left - right).abs() < 1e-6);
    let (_, top, _, bottom, _) = cover_fit(Some((1000, 4000)), 1.0, 0.584, W, H);
    assert!((top - bottom).abs() < 1e-6);
}

/// Degenerate input must produce a usable transform rather than a NaN that reaches the
/// compositor — the render path is not allowed to panic on bad input.
#[test]
fn nothing_degenerate_produces_a_crop() {
    for natural in [None, Some((0, 100)), Some((100, 0))] {
        let (left, top, right, bottom, scale) = cover_fit(natural, 1.0, 0.584, W, H);
        assert_eq!((left, top, right, bottom), (0.0, 0.0, 0.0, 0.0));
        assert!(scale.is_finite() && scale > 0.0);
    }
    for (pw, ph) in [(0.0, 0.5), (0.5, 0.0), (-1.0, 0.5)] {
        let (_, _, _, _, scale) = cover_fit(Some((800, 600)), pw, ph, W, H);
        assert!(scale.is_finite());
    }
    let (_, _, _, _, scale) = cover_fit(Some((800, 600)), 1.0, 0.5, 0, 0);
    assert!(scale.is_finite());
}

/// A full-frame cover is the common case and must need no thought: scale 1, fill the canvas.
#[test]
fn covering_the_whole_canvas_scales_to_one() {
    let (_, _, _, _, scale) = cover_fit(Some((1920, 1080)), 1.0, 1.0, W, H);
    assert!((scale - 1.0).abs() < 1e-6);
    let (w, h) = rendered((1920, 1080), 1.0, 1.0);
    assert!(
        (w - W as f32).abs() < 2.0 && (h - H as f32).abs() < 2.0,
        "{w}x{h}"
    );
}
