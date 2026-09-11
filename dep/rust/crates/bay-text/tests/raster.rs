//! Rasterizing non-empty text must produce some opaque (glyph-covered) pixels.

use bay_text::TextRaster;

#[test]
fn renders_visible_glyphs_for_nonempty_text() {
    let mut raster = TextRaster::new();
    let image = raster.render("Hello", 48.0, "#ffffff", 256, 64);

    assert_eq!(image.rgba.len() as u32, image.width * image.height * 4);
    let covered = image
        .rgba
        .chunks_exact(4)
        .filter(|texel| texel[3] > 0)
        .count();
    assert!(covered > 0, "expected some glyph pixels to be drawn");
}

#[test]
fn empty_text_is_fully_transparent() {
    let mut raster = TextRaster::new();
    let image = raster.render("", 48.0, "#ffffff", 64, 32);
    assert!(image.rgba.chunks_exact(4).all(|texel| texel[3] == 0));
}

/// A family nobody has still shapes — in something else. That is the whole problem: there is no
/// error, no blank frame, and nothing downstream of the shaper can tell.
#[test]
fn an_invented_family_shapes_in_a_substitute_rather_than_failing() {
    let mut raster = TextRaster::new();
    let resolved = raster
        .resolve_face("Definitely Not A Real Typeface 9000", 400)
        .expect("something always shapes, which is exactly the danger");
    assert!(
        !resolved.is("Definitely Not A Real Typeface 9000"),
        "an invented family cannot be the face that carried the glyph: {resolved:?}"
    );
    assert!(
        !raster.resolves("Definitely Not A Real Typeface 9000", 400),
        "…so the gate must say no"
    );
    assert!(
        raster
            .resolvable_weights("Definitely Not A Real Typeface 9000")
            .is_empty()
    );
}

/// The face reports its own metrics, so a substitution is visible in the numbers too.
#[test]
fn a_resolved_face_reports_its_own_metrics() {
    let mut raster = TextRaster::new();
    if !raster.has_family("Menlo") {
        eprintln!("skipping: no macOS system font set on this machine");
        return;
    }
    let menlo = raster.resolve_face("Menlo", 400).expect("Menlo shapes");
    assert!(menlo.is("Menlo"), "{menlo:?}");
    assert_eq!(menlo.weight, 400);
    assert!(menlo.monospaced, "Menlo is a terminal face: {menlo:?}");
    assert_eq!(menlo.metric_class(), "monospace");
    let cap = menlo.cap_per_em.expect("cap height is read off the face");
    assert!(
        (0.4..0.95).contains(&cap),
        "an implausible cap height: {cap}"
    );
}
