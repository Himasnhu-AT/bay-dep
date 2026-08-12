//! Text rasterization: a string → a tightly-packed RGBA8 image, using cosmic-text (system fonts,
//! shaping, swash glyph rendering). Transparent background; the glyphs are drawn in the given
//! color. Intended to feed a compositor texture for text timeline elements.

use cosmic_text::{
    Align, Attrs, Buffer, Color, Family, FontSystem, Metrics, Shaping, SwashCache, Weight,
};

/// The face a `(family, weight)` request actually shaped with.
///
/// Read off a real shaping run rather than inferred from the font database, because the database
/// answers "does this face exist" and the question that matters is "what will the renderer draw".
/// Those differ: cosmic-text does not snap to the nearest weight, it drops the family and
/// substitutes a different one, and nothing downstream of that point can tell.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedFace {
    /// The family the shaper used — the first name the face declares.
    pub family: String,
    /// That face's own weight, which is not necessarily the one that was asked for.
    pub weight: u16,
    /// Whether the resolved face is monospaced. The nearest thing to a metric class the font
    /// itself asserts, rather than one guessed from the family name.
    pub monospaced: bool,
    /// Cap height as a fraction of the em, measured from the face. `fontSize` is not a size;
    /// this is the number that turns one into the other.
    pub cap_per_em: Option<f32>,
    /// Every name this face answers to. A face carries its family name once per language, so a
    /// request has to be matched against all of them or a localised name reads as a substitution.
    pub aliases: Vec<String>,
}

impl ResolvedFace {
    /// Whether this is the family that was asked for. Case- and alias-insensitive, because a
    /// face declares several names and the request may match any of them.
    pub fn is(&self, family: &str) -> bool {
        self.family.eq_ignore_ascii_case(family)
            || self
                .aliases
                .iter()
                .any(|name| name.eq_ignore_ascii_case(family))
    }

    /// Whether this face is monospaced or proportional, for a generated table.
    pub fn metric_class(&self) -> &'static str {
        if self.monospaced {
            "monospace"
        } else {
            "proportional"
        }
    }
}

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

    /// Whether `family` has an upright face at exactly `weight`.
    ///
    /// The pair, not the family, is what either exists or does not. cosmic-text does **not** snap
    /// to the nearest weight: a miss drops the family and substitutes another face entirely —
    /// `Avenir` at 700 comes back as Menlo Bold, `Baskerville` at 900 as Apple SD Gothic Neo
    /// Heavy. A style kit that names a weight its family does not have therefore renders the
    /// whole project in a face nobody chose, and nothing downstream can tell.
    ///
    /// Upright and normal-stretch only: bay never sets `Attrs::style` or `Attrs::stretch`, so an
    /// italic-only or condensed-only cut is not reachable and must not report as available.
    pub fn has_face(&mut self, family: &str, weight: u16) -> bool {
        self.font_system.db().faces().any(|face| {
            face.weight.0 == weight
                && face.style == cosmic_text::fontdb::Style::Normal
                && face.stretch == cosmic_text::fontdb::Stretch::Normal
                && face.families.iter().any(|(name, _)| name == family)
        })
    }

    /// What a `(family, weight)` request **actually shapes with** on this machine.
    ///
    /// This is the authoritative answer and [`has_face`](Self::has_face) is only a good guess:
    /// the database is asked whether a face exists, this asks the shaper what it did. One glyph
    /// is laid out with exactly the attributes the renderer will use, and the face id on the
    /// resulting [`cosmic_text::LayoutGlyph`] is reported back.
    ///
    /// `None` only if nothing at all could be shaped, which means no fonts are installed.
    pub fn resolve_face(&mut self, family: &str, weight: u16) -> Option<ResolvedFace> {
        // A Latin capital, because cap height is what the ramp is quoted in and a family that
        // cannot draw an `H` cannot set the type in this project either.
        const PROBE: &str = "H";
        let mut buffer = Buffer::new(&mut self.font_system, Metrics::new(64.0, 76.8));
        buffer.set_size(&mut self.font_system, Some(4096.0), Some(256.0));
        let attrs = Attrs::new()
            .family(Family::Name(family))
            .weight(Weight(weight));
        buffer.set_text(&mut self.font_system, PROBE, &attrs, Shaping::Advanced);
        buffer.shape_until_scroll(&mut self.font_system, false);
        let id = buffer
            .layout_runs()
            .flat_map(|run| run.glyphs.iter())
            .map(|glyph| glyph.font_id)
            .next()?;
        drop(buffer);
        self.describe_face(id)
    }

    /// Whether `family` at `weight` shapes in the family it names.
    ///
    /// The one question every caller actually has. A `false` here means the renderer will draw
    /// something nobody chose — see [`resolve_face`](Self::resolve_face) for what.
    pub fn resolves(&mut self, family: &str, weight: u16) -> bool {
        self.resolve_face(family, weight)
            .is_some_and(|face| face.is(family))
    }

    /// Every CSS weight `family` can actually be set in, out of the nine standard steps.
    ///
    /// Generated rather than declared: a table of which weights a family has is a fact about the
    /// machine, and the only way to state it correctly is to ask.
    pub fn resolvable_weights(&mut self, family: &str) -> Vec<u16> {
        const STEPS: [u16; 9] = [100, 200, 300, 400, 500, 600, 700, 800, 900];
        STEPS
            .into_iter()
            .filter(|weight| self.resolves(family, *weight))
            .collect()
    }

    fn describe_face(&mut self, id: cosmic_text::fontdb::ID) -> Option<ResolvedFace> {
        let info = self.font_system.db().face(id)?;
        let aliases: Vec<String> = info.families.iter().map(|(name, _)| name.clone()).collect();
        let family = aliases.first().cloned().unwrap_or_default();
        let weight = info.weight.0;
        let monospaced = info.monospaced;
        // Read off the face, not off a table keyed by family name: a substituted face has to be
        // able to report its own metrics or the substitution is invisible in the numbers too.
        let cap_per_em = self.font_system.get_font(id).and_then(|font| {
            let face = font.rustybuzz();
            let em = face.units_per_em() as f32;
            if em <= 0.0 {
                return None;
            }
            let cap = face
                .capital_height()
                .filter(|height| *height > 0)
                .map(f32::from)
                .or_else(|| {
                    // Not every face fills in OS/2 `sCapHeight`; the top of an `H` is the same
                    // measurement taken the long way.
                    let glyph = face.glyph_index('H')?;
                    face.glyph_bounding_box(glyph)
                        .map(|bbox| f32::from(bbox.y_max))
                })?;
            Some(cap / em)
        });
        Some(ResolvedFace {
            family,
            weight,
            monospaced,
            cap_per_em,
            aliases,
        })
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
