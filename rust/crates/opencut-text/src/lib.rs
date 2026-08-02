//! Text rasterization: a string → a tightly-packed RGBA8 image, using cosmic-text (system fonts,
//! shaping, swash glyph rendering). Transparent background; the glyphs are drawn in the given
//! color. Intended to feed a compositor texture for text timeline elements.

use cosmic_text::{Attrs, Buffer, Color, FontSystem, Metrics, Shaping, SwashCache};

/// A rasterized text image (tightly-packed RGBA8, `width * height * 4` bytes, premultiplied by
/// coverage over a transparent background).
pub struct TextImage {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// Owns the (expensive to build) font system + glyph cache; reuse across renders.
pub struct TextRaster {
    font_system: FontSystem,
    cache: SwashCache,
}

impl Default for TextRaster {
    fn default() -> Self {
        Self::new()
    }
}

impl TextRaster {
    pub fn new() -> Self {
        Self {
            font_system: FontSystem::new(),
            cache: SwashCache::new(),
        }
    }

    /// Rasterize `text` at `font_size` px in `#rrggbb` `color` into a `width × height` RGBA image.
    pub fn render(
        &mut self,
        text: &str,
        font_size: f32,
        color: &str,
        width: u32,
        height: u32,
    ) -> TextImage {
        let metrics = Metrics::new(font_size.max(1.0), font_size.max(1.0) * 1.2);
        let mut buffer = Buffer::new(&mut self.font_system, metrics);
        buffer.set_size(
            &mut self.font_system,
            Some(width as f32),
            Some(height as f32),
        );
        buffer.set_text(&mut self.font_system, text, Attrs::new(), Shaping::Advanced);
        buffer.shape_until_scroll(&mut self.font_system, false);

        let [r, g, b] = hex_to_rgb(color);
        let text_color = Color::rgb(r, g, b);

        let mut rgba = vec![0u8; (width * height * 4) as usize];
        buffer.draw(
            &mut self.font_system,
            &mut self.cache,
            text_color,
            |x, y, w, h, color| {
                let alpha = color.a();
                if alpha == 0 {
                    return;
                }
                for dy in 0..h as i32 {
                    for dx in 0..w as i32 {
                        let px = x + dx;
                        let py = y + dy;
                        if px < 0 || py < 0 || px >= width as i32 || py >= height as i32 {
                            continue;
                        }
                        let idx = ((py as u32 * width + px as u32) * 4) as usize;
                        let a = alpha as f32 / 255.0;
                        rgba[idx] = blend(rgba[idx], color.r(), a);
                        rgba[idx + 1] = blend(rgba[idx + 1], color.g(), a);
                        rgba[idx + 2] = blend(rgba[idx + 2], color.b(), a);
                        rgba[idx + 3] = rgba[idx + 3].max(alpha);
                    }
                }
            },
        );

        TextImage {
            width,
            height,
            rgba,
        }
    }
}

fn blend(dst: u8, src: u8, alpha: f32) -> u8 {
    (src as f32 * alpha + dst as f32 * (1.0 - alpha)).round() as u8
}

fn hex_to_rgb(hex: &str) -> [u8; 3] {
    let value = u32::from_str_radix(hex.trim_start_matches('#'), 16).unwrap_or(0xffffff);
    [
        ((value >> 16) & 0xff) as u8,
        ((value >> 8) & 0xff) as u8,
        (value & 0xff) as u8,
    ]
}
