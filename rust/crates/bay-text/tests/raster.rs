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
