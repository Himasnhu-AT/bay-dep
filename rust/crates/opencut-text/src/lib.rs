//! Text rasterization: a string → a tightly-packed RGBA8 image, using cosmic-text (system fonts,
//! shaping, swash glyph rendering). Transparent background; the glyphs are drawn in the given
//! color. Intended to feed a compositor texture for text timeline elements.

use cosmic_text::{
    Align, Attrs, Buffer, Color, Family, FontSystem, Metrics, Shaping, SwashCache, Weight,
};

/// Horizontal alignment of a line within the raster box.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TextAlign {
    #[default]
    Left,
    Center,
    Right,
}

/// Typographic controls beyond size and colour. Infographic type lives or dies on these: a
/// letterspaced mono kicker and a centred display headline are different typefaces of the same
/// string, and neither is expressible with size alone.
#[derive(Debug, Clone, Copy)]
pub struct TextStyle<'a> {
    /// System font family name (e.g. `"Helvetica Neue"`). `None` uses the shaper's default.
    pub family: Option<&'a str>,
    /// CSS numeric weight (400 regular, 700 bold).
    pub weight: u16,
    pub align: TextAlign,
    /// Extra tracking in em.
    pub letter_spacing: f32,
    /// Line box height as a multiple of the font size.
    pub line_height: f32,
}

impl Default for TextStyle<'_> {
    fn default() -> Self {
        Self {
            family: None,
            weight: 400,
            align: TextAlign::Left,
            letter_spacing: 0.0,
            line_height: 1.2,
        }
    }
}

impl TextStyle<'_> {
    /// A cache key fragment that changes whenever any style field changes. Two different
    /// styles MUST NOT collide here — a collision would serve the wrong raster from the LRU.
    pub fn cache_key(&self) -> String {
        format!(
            "{}|{}|{:?}|{}|{}",
            self.family.unwrap_or(""),
            self.weight,
            self.align,
            self.letter_spacing.to_bits(),
            self.line_height.to_bits(),
        )
    }
}

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

    /// Rasterize `text` at `font_size` px in `#rrggbb` `color` into a `width × height` RGBA
    /// image, using the shaper's default family at regular weight, flush left.
    pub fn render(
        &mut self,
        text: &str,
        font_size: f32,
        color: &str,
        width: u32,
        height: u32,
    ) -> TextImage {
        self.render_styled(text, font_size, color, width, height, &TextStyle::default())
    }

    /// Whether `family` resolves to an installed font. Callers should check before relying on
    /// a family name: cosmic-text silently falls back, so an unavailable family is otherwise
    /// invisible until someone looks at the rendered frame.
    pub fn has_family(&mut self, family: &str) -> bool {
        self.font_system
            .db()
            .faces()
            .any(|face| face.families.iter().any(|(name, _)| name == family))
    }

    /// Rasterize `text` with full typographic control. See [`TextStyle`].
    pub fn render_styled(
        &mut self,
        text: &str,
        font_size: f32,
        color: &str,
        width: u32,
        height: u32,
        style: &TextStyle<'_>,
    ) -> TextImage {
        let font_size = font_size.max(1.0);
        let line_height = (font_size * style.line_height.max(0.1)).max(1.0);
        let metrics = Metrics::new(font_size, line_height);
        let mut buffer = Buffer::new(&mut self.font_system, metrics);
        buffer.set_size(
            &mut self.font_system,
            Some(width as f32),
            Some(height as f32),
        );

        let mut attrs = Attrs::new().weight(Weight(style.weight));
        if let Some(family) = style.family {
            attrs = attrs.family(Family::Name(family));
        }
        if style.letter_spacing != 0.0 {
            // cosmic-text adds this straight onto a glyph's advance while the advance is still
            // in EM (`x_advance / font_scale`), before layout multiplies by the font size — so
            // the value is em, not pixels. Scaling it by `font_size` here inflated tracking by
            // the font size itself (~30x at display sizes) and wrapped every kicker.
            attrs = attrs.letter_spacing(style.letter_spacing);
        }
        buffer.set_text(&mut self.font_system, text, &attrs, Shaping::Advanced);

        let align = match style.align {
            TextAlign::Left => Align::Left,
            TextAlign::Center => Align::Center,
            TextAlign::Right => Align::Right,
        };
        for line in buffer.lines.iter_mut() {
            line.set_align(Some(align));
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Rightmost lit column of a raster — how wide the text actually drew.
    fn ink_width(image: &TextImage) -> u32 {
        let mut widest = 0;
        for y in 0..image.height {
            for x in 0..image.width {
                if image.rgba[((y * image.width + x) * 4 + 3) as usize] > 8 {
                    widest = widest.max(x + 1);
                }
            }
        }
        widest
    }

    fn ink_rows(image: &TextImage) -> usize {
        (0..image.height)
            .filter(|y| {
                (0..image.width).any(|x| image.rgba[((y * image.width + x) * 4 + 3) as usize] > 8)
            })
            .count()
    }

    #[test]
    fn letter_spacing_is_em_not_pixels() {
        let mut raster = TextRaster::new();
        let font_size = 40.0;
        let word = "KICKER";
        let plain =
            raster.render_styled(word, font_size, "#ffffff", 1600, 200, &TextStyle::default());
        let tracked = raster.render_styled(
            word,
            font_size,
            "#ffffff",
            1600,
            200,
            &TextStyle {
                letter_spacing: 0.2,
                ..TextStyle::default()
            },
        );
        let (plain_w, tracked_w) = (ink_width(&plain), ink_width(&tracked));
        assert!(
            plain_w > 0 && tracked_w > plain_w,
            "tracking must widen the line"
        );

        // 0.2em across 6 glyphs is ~0.2 * 40px * 6 = 48px of extra advance. Treating the value
        // as pixels instead would add 0.2 * 40 * 40 = 320px — an order of magnitude more, which
        // is what used to wrap every kicker onto three lines.
        let extra = tracked_w - plain_w;
        let expected = (0.2 * font_size * word.len() as f32) as u32;
        assert!(
            extra < expected * 2,
            "tracking added {extra}px where ~{expected}px was expected — the value is being \
             scaled by the font size again"
        );
    }

    #[test]
    fn a_tracked_kicker_stays_on_one_line() {
        let mut raster = TextRaster::new();
        let image = raster.render_styled(
            "VOLATILITY DRAG",
            34.0,
            "#ffffff",
            804,
            200,
            &TextStyle {
                letter_spacing: 0.18,
                weight: 600,
                ..TextStyle::default()
            },
        );
        // One line of 34px type covers well under 60 rows; a wrapped one covers far more.
        assert!(
            ink_rows(&image) < 60,
            "a 15-character kicker must fit one line in an 804px box, but it drew across {} rows",
            ink_rows(&image)
        );
    }

    #[test]
    fn alignment_moves_the_ink() {
        let mut raster = TextRaster::new();
        let left = raster.render_styled("hi", 40.0, "#ffffff", 600, 100, &TextStyle::default());
        let centred = raster.render_styled(
            "hi",
            40.0,
            "#ffffff",
            600,
            100,
            &TextStyle {
                align: TextAlign::Center,
                ..TextStyle::default()
            },
        );
        let first_lit = |image: &TextImage| {
            (0..image.width)
                .find(|x| {
                    (0..image.height)
                        .any(|y| image.rgba[((y * image.width + x) * 4 + 3) as usize] > 8)
                })
                .expect("something was drawn")
        };
        assert!(
            first_lit(&centred) > first_lit(&left) + 100,
            "centred text should start much further right than left-aligned text"
        );
    }

    #[test]
    fn line_height_spaces_the_lines() {
        let mut raster = TextRaster::new();
        let tight = raster.render_styled(
            "a\nb",
            30.0,
            "#ffffff",
            400,
            400,
            &TextStyle {
                line_height: 1.0,
                ..TextStyle::default()
            },
        );
        let loose = raster.render_styled(
            "a\nb",
            30.0,
            "#ffffff",
            400,
            400,
            &TextStyle {
                line_height: 2.5,
                ..TextStyle::default()
            },
        );
        let lowest = |image: &TextImage| {
            (0..image.height)
                .rev()
                .find(|y| {
                    (0..image.width)
                        .any(|x| image.rgba[((y * image.width + x) * 4 + 3) as usize] > 8)
                })
                .expect("something was drawn")
        };
        assert!(
            lowest(&loose) > lowest(&tight) + 20,
            "a taller line height must push the second line further down"
        );
    }

    #[test]
    fn an_invented_family_is_not_reported_as_available() {
        let mut raster = TextRaster::new();
        assert!(
            !raster.has_family("Definitely Not A Real Typeface 9000"),
            "an invented family must not report as available"
        );
    }
}
