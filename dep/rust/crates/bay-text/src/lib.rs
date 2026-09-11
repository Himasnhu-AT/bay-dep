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

#[derive(Debug, Clone, Copy)]
pub struct StrokeStyle<'a> {
    pub width: f32,
    pub color: &'a str,
}

#[derive(Debug, Clone, Copy)]
pub struct ShadowStyle<'a> {
    pub offset_x: f32,
    pub offset_y: f32,
    pub blur: f32,
    pub color: &'a str,
}

#[derive(Debug, Clone, Copy)]
pub struct PlateStyle<'a> {
    pub color: &'a str,
    pub padding_x: f32,
    pub padding_y: f32,
    pub radius: f32,
}

/// A byte range in the source string rendered in a second colour.
#[derive(Debug, Clone, Copy)]
pub struct HighlightStyle<'a> {
    pub start: usize,
    pub end: usize,
    pub color: &'a str,
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
    pub stroke: Option<StrokeStyle<'a>>,
    pub shadow: Option<ShadowStyle<'a>>,
    pub plate: Option<PlateStyle<'a>>,
    pub highlight: Option<HighlightStyle<'a>>,
}

impl Default for TextStyle<'_> {
    fn default() -> Self {
        Self {
            family: None,
            weight: 400,
            align: TextAlign::Left,
            letter_spacing: 0.0,
            line_height: 1.2,
            stroke: None,
            shadow: None,
            plate: None,
            highlight: None,
        }
    }
}

impl TextStyle<'_> {
    /// A cache key fragment that changes whenever any style field changes. Two different
    /// styles MUST NOT collide here — a collision would serve the wrong raster from the LRU.
    pub fn cache_key(&self) -> String {
        format!(
            "{}|{}|{:?}|{}|{}|{:?}|{:?}|{:?}|{:?}",
            self.family.unwrap_or(""),
            self.weight,
            self.align,
            self.letter_spacing.to_bits(),
            self.line_height.to_bits(),
            self.stroke
                .map(|v| (v.width.to_bits(), v.color.to_string())),
            self.shadow.map(|v| (
                v.offset_x.to_bits(),
                v.offset_y.to_bits(),
                v.blur.to_bits(),
                v.color.to_string()
            )),
            self.plate.map(|v| (
                v.padding_x.to_bits(),
                v.padding_y.to_bits(),
                v.radius.to_bits(),
                v.color.to_string()
            )),
            self.highlight
                .map(|v| (v.start, v.end, v.color.to_string())),
        )
    }

    /// Symmetric pixels needed around the layout box for all decorations.
    pub fn margins(&self) -> (u32, u32) {
        let stroke = self.stroke.map_or(0.0, |value| value.width.max(0.0));
        let (shadow_x, shadow_y) = self.shadow.map_or((0.0, 0.0), |value| {
            (
                value.offset_x.abs() + value.blur.max(0.0) * 2.0,
                value.offset_y.abs() + value.blur.max(0.0) * 2.0,
            )
        });
        let (plate_x, plate_y) = self.plate.map_or((0.0, 0.0), |value| {
            (value.padding_x.max(0.0), value.padding_y.max(0.0))
        });
        (
            stroke.max(shadow_x).max(plate_x).ceil() as u32 + 2,
            stroke.max(shadow_y).max(plate_y).ceil() as u32 + 2,
        )
    }
}

/// A rasterized text image (tightly-packed RGBA8, `width * height * 4` bytes, premultiplied by
/// coverage over a transparent background).
pub struct TextImage {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    /// Per-pixel coverage of shaped glyph ink, before stroke, shadow, or plate decoration.
    ///
    /// Kept alongside [`Self::ink_bounds`] so an occlusion check can distinguish a shape that
    /// crosses the empty corner of an ink bounding box from one that actually hides letterforms.
    pub glyph_alpha: Vec<u8>,
    /// Symmetric expansion around the original layout box.
    pub margin_x: u32,
    pub margin_y: u32,
    /// Tight bounds of the shaped glyph ink inside this image, before stroke, shadow, or plate
    /// decoration is applied. Collision checks use ink because two plates may intentionally
    /// overlap while two glyph runs occupying the same pixels are not legible.
    pub ink_bounds: Option<InkBounds>,
}

/// Tight, half-open pixel bounds of shaped glyph ink.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InkBounds {
    pub left: u32,
    pub top: u32,
    pub right: u32,
    pub bottom: u32,
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

    /// Every upright family installed on this machine, sorted, deduplicated.
    ///
    /// So a kit can be *chosen* rather than guessed at. `fonts_check` has always been able to
    /// answer "is this one here?", which is only useful once you already have a name in mind —
    /// and a name guessed wrong is not a refusal but a substitution: cosmic-text drops the
    /// family and shapes in something else entirely, so a project can render in a face nobody
    /// picked with nothing downstream able to tell.
    ///
    /// Italic-only and condensed-only cuts are left out for the same reason they are left out
    /// of [`has_face`](Self::has_face): bay never sets style or stretch, so they are not
    /// reachable and listing them would offer a choice that cannot be taken.
    pub fn families(&mut self) -> Vec<String> {
        let mut names: Vec<String> = self
            .font_system
            .db()
            .faces()
            .filter(|face| {
                face.style == cosmic_text::fontdb::Style::Normal
                    && face.stretch == cosmic_text::fontdb::Stretch::Normal
            })
            .flat_map(|face| face.families.iter().map(|(name, _)| name.clone()))
            .collect();
        names.sort_unstable();
        names.dedup();
        names
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
        let align = match style.align {
            TextAlign::Left => Align::Left,
            TextAlign::Center => Align::Center,
            TextAlign::Right => Align::Right,
        };
        let [r, g, b, _] = hex_to_rgba(color);
        if let Some(highlight) = style
            .highlight
            .filter(|highlight| highlight.start < highlight.end && highlight.end <= text.len())
        {
            let [hr, hg, hb, _] = hex_to_rgba(highlight.color);
            let spans = [
                (
                    &text[..highlight.start],
                    attrs.clone().color(Color::rgb(r, g, b)),
                ),
                (
                    &text[highlight.start..highlight.end],
                    attrs.clone().color(Color::rgb(hr, hg, hb)),
                ),
                (
                    &text[highlight.end..],
                    attrs.clone().color(Color::rgb(r, g, b)),
                ),
            ];
            buffer.set_rich_text(
                &mut self.font_system,
                spans,
                &attrs,
                Shaping::Advanced,
                Some(align),
            );
        } else {
            buffer.set_text(&mut self.font_system, text, &attrs, Shaping::Advanced);
            for line in buffer.lines.iter_mut() {
                line.set_align(Some(align));
            }
        }
        buffer.shape_until_scroll(&mut self.font_system, false);

        let text_color = Color::rgb(r, g, b);

        let (margin_x, margin_y) = style.margins();
        let out_width = width.saturating_add(margin_x.saturating_mul(2)).max(1);
        let out_height = height.saturating_add(margin_y.saturating_mul(2)).max(1);
        let mut glyphs = vec![0u8; (out_width * out_height * 4) as usize];
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
                        let px = x + dx + margin_x as i32;
                        let py = y + dy + margin_y as i32;
                        if px < 0 || py < 0 || px >= out_width as i32 || py >= out_height as i32 {
                            continue;
                        }
                        let idx = ((py as u32 * out_width + px as u32) * 4) as usize;
                        let a = alpha as f32 / 255.0;
                        glyphs[idx] = blend(glyphs[idx], color.r(), a);
                        glyphs[idx + 1] = blend(glyphs[idx + 1], color.g(), a);
                        glyphs[idx + 2] = blend(glyphs[idx + 2], color.b(), a);
                        glyphs[idx + 3] = glyphs[idx + 3].max(alpha);
                    }
                }
            },
        );

        let alpha: Vec<u8> = glyphs.chunks_exact(4).map(|pixel| pixel[3]).collect();
        let ink_bounds =
            alpha_bounds(&alpha, out_width, out_height).map(|(left, top, right, bottom)| {
                InkBounds {
                    left,
                    top,
                    right,
                    bottom,
                }
            });
        let mut rgba = vec![0u8; glyphs.len()];

        if let Some(plate) = style.plate
            && let Some(InkBounds {
                left,
                top,
                right,
                bottom,
            }) = ink_bounds
        {
            draw_rounded_plate(
                &mut rgba,
                out_width,
                out_height,
                (
                    left as f32 - plate.padding_x.max(0.0),
                    top as f32 - plate.padding_y.max(0.0),
                    right as f32 + plate.padding_x.max(0.0),
                    bottom as f32 + plate.padding_y.max(0.0),
                ),
                plate.radius.max(0.0),
                hex_to_rgba(plate.color),
            );
        }
        if let Some(shadow) = style.shadow {
            let blurred = box_blur_alpha(
                &alpha,
                out_width,
                out_height,
                shadow.blur.max(0.0).ceil() as u32,
            );
            composite_mask(
                &mut rgba,
                out_width,
                out_height,
                &blurred,
                shadow.offset_x.round() as i32,
                shadow.offset_y.round() as i32,
                hex_to_rgba(shadow.color),
            );
        }
        if let Some(stroke) = style.stroke {
            let expanded = dilate_alpha(
                &alpha,
                out_width,
                out_height,
                stroke.width.max(0.0).ceil() as u32,
            );
            composite_mask(
                &mut rgba,
                out_width,
                out_height,
                &expanded,
                0,
                0,
                hex_to_rgba(stroke.color),
            );
        }
        composite_rgba(&mut rgba, &glyphs);

        TextImage {
            width: out_width,
            height: out_height,
            rgba,
            glyph_alpha: alpha,
            margin_x,
            margin_y,
            ink_bounds,
        }
    }
}

fn blend(dst: u8, src: u8, alpha: f32) -> u8 {
    (src as f32 * alpha + dst as f32 * (1.0 - alpha)).round() as u8
}

fn hex_to_rgba(hex: &str) -> [u8; 4] {
    let digits = hex.trim_start_matches('#');
    let value = u32::from_str_radix(digits, 16).unwrap_or(0xffff_ffff);
    if digits.len() == 8 {
        [
            ((value >> 24) & 0xff) as u8,
            ((value >> 16) & 0xff) as u8,
            ((value >> 8) & 0xff) as u8,
            (value & 0xff) as u8,
        ]
    } else {
        [
            ((value >> 16) & 0xff) as u8,
            ((value >> 8) & 0xff) as u8,
            (value & 0xff) as u8,
            255,
        ]
    }
}

fn alpha_bounds(alpha: &[u8], width: u32, height: u32) -> Option<(u32, u32, u32, u32)> {
    let mut bounds: Option<(u32, u32, u32, u32)> = None;
    for y in 0..height {
        for x in 0..width {
            if alpha[(y * width + x) as usize] == 0 {
                continue;
            }
            bounds = Some(match bounds {
                None => (x, y, x + 1, y + 1),
                Some((left, top, right, bottom)) => {
                    (left.min(x), top.min(y), right.max(x + 1), bottom.max(y + 1))
                }
            });
        }
    }
    bounds
}

fn composite_pixel(dst: &mut [u8], color: [u8; 4], coverage: u8) {
    let src_alpha = (color[3] as f32 / 255.0) * (coverage as f32 / 255.0);
    if src_alpha <= 0.0 {
        return;
    }
    let dst_alpha = dst[3] as f32 / 255.0;
    let out_alpha = src_alpha + dst_alpha * (1.0 - src_alpha);
    for channel in 0..3 {
        let src = color[channel] as f32 / 255.0;
        let old = dst[channel] as f32 / 255.0;
        let out = (src * src_alpha + old * dst_alpha * (1.0 - src_alpha)) / out_alpha.max(0.0001);
        dst[channel] = (out * 255.0).round() as u8;
    }
    dst[3] = (out_alpha * 255.0).round() as u8;
}

fn composite_mask(
    rgba: &mut [u8],
    width: u32,
    height: u32,
    mask: &[u8],
    offset_x: i32,
    offset_y: i32,
    color: [u8; 4],
) {
    for y in 0..height {
        for x in 0..width {
            let coverage = mask[(y * width + x) as usize];
            if coverage == 0 {
                continue;
            }
            let dx = x as i32 + offset_x;
            let dy = y as i32 + offset_y;
            if dx < 0 || dy < 0 || dx >= width as i32 || dy >= height as i32 {
                continue;
            }
            let index = ((dy as u32 * width + dx as u32) * 4) as usize;
            composite_pixel(&mut rgba[index..index + 4], color, coverage);
        }
    }
}

fn composite_rgba(dst: &mut [u8], src: &[u8]) {
    for (dst, src) in dst.chunks_exact_mut(4).zip(src.chunks_exact(4)) {
        composite_pixel(dst, [src[0], src[1], src[2], src[3]], 255);
    }
}

fn dilate_alpha(alpha: &[u8], width: u32, height: u32, radius: u32) -> Vec<u8> {
    if radius == 0 {
        return alpha.to_vec();
    }
    let mut horizontal = vec![0u8; alpha.len()];
    for y in 0..height {
        for x in 0..width {
            let start = x.saturating_sub(radius);
            let end = x.saturating_add(radius).min(width - 1);
            horizontal[(y * width + x) as usize] = (start..=end)
                .map(|sample_x| alpha[(y * width + sample_x) as usize])
                .max()
                .unwrap_or(0);
        }
    }
    let mut vertical = vec![0u8; alpha.len()];
    for y in 0..height {
        for x in 0..width {
            let start = y.saturating_sub(radius);
            let end = y.saturating_add(radius).min(height - 1);
            vertical[(y * width + x) as usize] = (start..=end)
                .map(|sample_y| horizontal[(sample_y * width + x) as usize])
                .max()
                .unwrap_or(0);
        }
    }
    vertical
}

fn box_blur_alpha(alpha: &[u8], width: u32, height: u32, radius: u32) -> Vec<u8> {
    if radius == 0 {
        return alpha.to_vec();
    }
    let mut horizontal = vec![0u8; alpha.len()];
    for y in 0..height {
        for x in 0..width {
            let start = x.saturating_sub(radius);
            let end = x.saturating_add(radius).min(width - 1);
            let count = end - start + 1;
            let sum: u32 = (start..=end)
                .map(|sample_x| u32::from(alpha[(y * width + sample_x) as usize]))
                .sum();
            horizontal[(y * width + x) as usize] = (sum / count) as u8;
        }
    }
    let mut vertical = vec![0u8; alpha.len()];
    for y in 0..height {
        for x in 0..width {
            let start = y.saturating_sub(radius);
            let end = y.saturating_add(radius).min(height - 1);
            let count = end - start + 1;
            let sum: u32 = (start..=end)
                .map(|sample_y| u32::from(horizontal[(sample_y * width + x) as usize]))
                .sum();
            vertical[(y * width + x) as usize] = (sum / count) as u8;
        }
    }
    vertical
}

fn draw_rounded_plate(
    rgba: &mut [u8],
    width: u32,
    height: u32,
    bounds: (f32, f32, f32, f32),
    radius: f32,
    color: [u8; 4],
) {
    let (left, top, right, bottom) = bounds;
    let radius = radius
        .min((right - left).max(0.0) / 2.0)
        .min((bottom - top).max(0.0) / 2.0);
    for y in 0..height {
        for x in 0..width {
            let px = x as f32 + 0.5;
            let py = y as f32 + 0.5;
            let qx = (px - (left + right) / 2.0).abs() - ((right - left) / 2.0 - radius);
            let qy = (py - (top + bottom) / 2.0).abs() - ((bottom - top) / 2.0 - radius);
            let distance =
                (qx.max(0.0).powi(2) + qy.max(0.0).powi(2)).sqrt() + qx.max(qy).min(0.0) - radius;
            let coverage = ((0.5 - distance).clamp(0.0, 1.0) * 255.0).round() as u8;
            if coverage > 0 {
                let index = ((y * width + x) * 4) as usize;
                composite_pixel(&mut rgba[index..index + 4], color, coverage);
            }
        }
    }
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
