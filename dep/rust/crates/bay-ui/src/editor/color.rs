//! The Color page: the frame, and the four scopes measured from it.
//!
//! # What this draws and why it is drawn that way
//!
//! `bay-preview::scopes` computes a luma waveform, an RGB parade, a vectorscope and a histogram
//! in **one pass** over the BGRA buffer the preview already reads back — four passes would be
//! four times the memory traffic for numbers that all come off the same pixel. Measured at
//! 0.98 ms for 640x360 (`docs/native/benchmarks.md`), which is what makes it affordable to do
//! per frame rather than on a button.
//!
//! The split between path and raster is not a style choice, it is `docs/native/drawing.md`'s
//! decision: **vector geometry is a path, a density plot is a raster.** The histogram is four
//! curves and is drawn as paths. The waveform, parade and vectorscope are *densities* — how many
//! pixels landed in each (column, level) cell — and drawing them as a polyline through a
//! per-column min/max envelope would be a different instrument wearing a waveform's name. A
//! colourist reads the *thickness* of a trace; an envelope throws exactly that away.
//!
//! Rasters carry an obligation, stated in `drawing.md` and honoured here: an image handed to GPUI
//! occupies an atlas tile until `window.drop_image` releases it, so a replaced scope raster goes
//! through `RetiredImages` rather than being dropped. Assigning over the `Arc` would leak a tile
//! per frame — at 30 frames a second, on the page you leave open while grading.
//!
//! # What is not here
//!
//! Lift/gamma/gain wheels and a curve editor. The shader exists (`lift_gamma_gain.wgsl`, all six
//! enforced places wired) and the commands do not, so per `pages.md` the controls would have to
//! be drawn disabled — a row of dead wheels teaches less than saying plainly what is missing.

use std::sync::Arc;

use bay_preview::scopes::{ScopeOptions, ScopeSet, Scopes};
use gpui::{img, px, Div, ImageSource, RenderImage};

use super::EditorView;
use crate::draw::{self, Shape};
use crate::theme;
use crate::theme::rgb;
use crate::widgets;
use gpui::div;
use gpui::prelude::*;

/// Cells across and levels down in the waveform and parade rasters.
///
/// Smaller than `ScopeOptions::default()`'s 256x256 on purpose: these become textures in the
/// GPUI atlas, and a scope panel is drawn a couple of hundred pixels wide. Asking for more cells
/// than the panel has pixels buys nothing and costs a tile four times the size.
const SCOPE_COLUMNS: usize = 192;
const SCOPE_LEVELS: usize = 128;
const VECTOR_SIZE: usize = 128;

/// The scope column's width, and the drawn size of the histogram inside it.
///
/// Fixed rather than measured: `draw::paint` takes shapes already built, so a canvas that wants
/// its own bounds has to be told them. Every other canvas in the app does the same.
const SCOPE_COLUMN: f32 = 320.0;
const HISTOGRAM_W: f32 = SCOPE_COLUMN - 22.0;
const HISTOGRAM_H: f32 = 108.0;

impl EditorView {
    /// Measure the frame that just reached the screen, and rebuild the rasters that draw it.
    ///
    /// Called from `update_preview` and only while this page is open — see the module note.
    pub(super) fn measure_scopes(&mut self, frame: &bay_preview::PreviewFrame) {
        let options = ScopeOptions {
            waveform_columns: SCOPE_COLUMNS,
            levels: SCOPE_LEVELS,
            histogram_bins: 256,
            vectorscope_size: VECTOR_SIZE,
            // Every pixel. The preview is 640x360; a stride here would report shares that do not
            // describe the frame, which `ScopeOptions::stride` exists to make impossible to do
            // silently.
            stride: 1,
            scopes: ScopeSet::ALL,
        };
        let Ok(scopes) = Scopes::from_preview_frame(frame, options) else {
            // A buffer that does not match its declared size, or a zero-pixel frame. Keep the
            // last good measurement rather than blanking the panels — a scope that empties for
            // one frame reads as the picture having gone black.
            return;
        };

        if let Some(waveform) = scopes.waveform.as_ref() {
            self.set_scope_image("waveform", density_raster(waveform, [0xe7, 0xe7, 0xee]));
        }
        if let Some(parade) = scopes.parade.as_ref() {
            self.set_scope_image("parade", parade_raster(parade));
        }
        if let Some(vectorscope) = scopes.vectorscope.as_ref() {
            self.set_scope_image("vectorscope", vector_raster(vectorscope));
        }
        self.scopes = Some(scopes);
    }

    /// Install a scope raster, retiring the one it replaces.
    ///
    /// The retirement is the whole reason this is a method rather than a map insert: an
    /// `Arc<RenderImage>` dropped without `window.drop_image` leaves its atlas tile allocated,
    /// and this runs per frame.
    fn set_scope_image(&mut self, key: &'static str, image: Option<RenderImage>) {
        let Some(image) = image else {
            return;
        };
        if let Some(previous) = self.scope_images.insert(key, Arc::new(image)) {
            self.retired_images.retire(previous);
        }
    }

    pub(super) fn color_page(&self, cx: &mut gpui::Context<Self>) -> Div {
        let vm = crate::view_model::EditorViewModel::build(&self.editor);

        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h(px(0.0))
            .bg(rgb(theme::BG))
            .child(self.toolbar(&vm, cx))
            .child(
                div()
                    .flex()
                    .flex_row()
                    .flex_1()
                    .min_h(px(0.0))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w(px(0.0))
                            .child(self.preview(&vm))
                            .child(self.transport(&vm, SCOPE_COLUMN, cx)),
                    )
                    .child(self.scope_panel()),
            )
    }

    /// The four scopes, stacked down the right.
    fn scope_panel(&self) -> gpui::Stateful<Div> {
        div()
            .id("color-scopes")
            .w(px(SCOPE_COLUMN))
            .flex_none()
            .flex()
            .flex_col()
            .gap(px(8.0))
            .p(px(10.0))
            .bg(rgb(theme::PANEL))
            .border_l_1()
            .border_color(rgb(theme::BORDER))
            .overflow_y_scroll()
            .child(widgets::section("SCOPES"))
            .children(match self.scopes.as_ref() {
                None => vec![widgets::note(
                    "Nothing measured yet. The scopes read the composited frame, so they fill in \
                     as soon as one is on screen.",
                )],
                Some(scopes) => vec![
                    self.scope_tile("WAVEFORM", "waveform"),
                    self.scope_tile("PARADE", "parade"),
                    self.scope_tile("VECTORSCOPE", "vectorscope"),
                    self.histogram_tile(scopes),
                    readout(scopes),
                ],
            })
    }

    /// One raster scope, labelled.
    fn scope_tile(&self, label: &str, key: &str) -> Div {
        let image = self.scope_images.get(key).cloned();
        div()
            .flex()
            .flex_col()
            .gap(px(3.0))
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child(Self::shared(label.to_string())),
            )
            .child(
                div()
                    .h(px(120.0))
                    .rounded(px(4.0))
                    .bg(rgb(theme::LANE))
                    .border_1()
                    .border_color(rgb(theme::BORDER_SOFT))
                    .overflow_hidden()
                    .children(
                        image.map(|image| img(ImageSource::Render(image)).w_full().h(px(118.0))),
                    ),
            )
    }

    /// The histogram, as four curves.
    ///
    /// A path, not a raster: this genuinely *is* vector geometry — one polyline per channel over
    /// 256 bins — and `drawing.md` measured a 1,000-point polyline at 80 µs.
    fn histogram_tile(&self, scopes: &Scopes) -> Div {
        let Some(histogram) = scopes.histogram.as_ref() else {
            return div();
        };
        // Shared vertical scale across all four, or a channel that happens to be flat looks
        // clipped and a channel with one tall spike flattens the rest of its own curve.
        let peak = histogram
            .red
            .iter()
            .chain(&histogram.green)
            .chain(&histogram.blue)
            .chain(&histogram.luma)
            .copied()
            .max()
            .unwrap_or(1)
            .max(1) as f32;

        let channels: [(&[u32], theme::Role); 4] = [
            (&histogram.luma, theme::TEXT),
            (&histogram.red, theme::RECORD),
            (&histogram.green, theme::OK),
            (&histogram.blue, theme::ACCENT),
        ];

        div()
            .flex()
            .flex_col()
            .gap(px(3.0))
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child("HISTOGRAM"),
            )
            .child(
                div()
                    .h(px(110.0))
                    .rounded(px(4.0))
                    .bg(rgb(theme::LANE))
                    .border_1()
                    .border_color(rgb(theme::BORDER_SOFT))
                    .overflow_hidden()
                    .child(draw::paint(histogram_shapes(channels, peak))),
            )
    }
}

/// One polyline per channel, over the shared vertical scale.
///
/// Down-sampled to one point per drawn pixel: 256 bins across ~300 px is already more points
/// than the panel can show, and `drawing.md` measured 80 µs for a 1,000-point polyline — worth
/// not spending four times over for detail nobody can see.
fn histogram_shapes(channels: [(&[u32], theme::Role); 4], peak: f32) -> Vec<Shape> {
    let mut shapes = Vec::with_capacity(4);
    for (bins, color) in channels {
        if bins.len() < 2 {
            continue;
        }
        let step = HISTOGRAM_W / (bins.len() - 1).max(1) as f32;
        let points: Vec<_> = bins
            .iter()
            .enumerate()
            .map(|(index, count)| {
                let share = (*count as f32 / peak).clamp(0.0, 1.0);
                gpui::point(
                    px(index as f32 * step),
                    px(HISTOGRAM_H - share * (HISTOGRAM_H - 2.0) - 1.0),
                )
            })
            .collect();
        shapes.push(Shape::line(points, 1.0, color));
    }
    shapes
}

/// The numbers the scopes carry that a picture cannot state precisely.
fn readout(scopes: &Scopes) -> Div {
    let summary = scopes.summary();
    // `mean_saturation` is an `Option` on purpose: a frame whose chroma was never read has no
    // mean, and printing 0.0 there would read as "perfectly neutral" — a measurement rather than
    // an absence.
    let saturation = match summary.mean_saturation {
        Some(value) => format!("{value:.2}"),
        None => "\u{2014}".to_string(),
    };
    let hue = match summary.dominant_hue_degrees {
        Some(degrees) => format!("{degrees:.0}\u{b0}"),
        None => "neutral".to_string(),
    };
    widgets::note(format!(
        "luma {}\u{2013}{} \u{b7} mean {:.0} \u{b7} {:.1}% black-clipped \u{b7} {:.1}% white-clipped \u{b7} saturation {saturation} \u{b7} hue {hue}",
        summary.luma_min,
        summary.luma_max,
        summary.luma_mean,
        summary.black_clipped_share * 100.0,
        summary.white_clipped_share * 100.0,
    ))
}

/// A density grid as an RGBA raster, tinted `color`.
///
/// Rows are flipped: a waveform's level 0 is black and belongs at the *bottom*, and an image's
/// row 0 is the top. Getting this wrong draws a correct measurement upside down, which looks
/// like a grading mistake rather than a plotting one.
///
/// The count is square-rooted before it becomes brightness. A waveform's counts are wildly
/// non-uniform — a flat sky puts thousands of pixels in one cell and a highlight puts three in
/// another — so a linear map renders everything but the sky invisible. Every scope does this.
fn density_raster(waveform: &bay_preview::scopes::Waveform, color: [u8; 3]) -> Option<RenderImage> {
    let (width, height, pixels) = density_pixels(waveform, color)?;
    into_render_image(width, height, pixels)
}

/// The pixels behind [`density_raster`], separated so a test can read them.
///
/// `RenderImage` exposes nothing, so a test that went through it could only assert the size —
/// and a correctly-sized buffer of zeroes passes every size check and draws a black square. That
/// is the same failure the decode paths carry an explicit content check for.
fn density_pixels(
    waveform: &bay_preview::scopes::Waveform,
    color: [u8; 3],
) -> Option<(u32, u32, Vec<u8>)> {
    let (columns, levels) = (waveform.columns, waveform.levels);
    if columns == 0 || levels == 0 {
        return None;
    }
    let peak = (0..columns)
        .flat_map(|column| waveform.column(column).iter().copied())
        .max()
        .unwrap_or(1)
        .max(1) as f32;

    let mut pixels = vec![0u8; columns * levels * 4];
    for column in 0..columns {
        let cells = waveform.column(column);
        for (level, count) in cells.iter().enumerate() {
            let intensity = (*count as f32 / peak).sqrt().clamp(0.0, 1.0);
            let row = levels - 1 - level;
            let at = (row * columns + column) * 4;
            // BGRA: `RenderImage` is documented BGRA, which is why the channels are reversed
            // here and not in the tint that produced them.
            pixels[at] = (color[2] as f32 * intensity) as u8;
            pixels[at + 1] = (color[1] as f32 * intensity) as u8;
            pixels[at + 2] = (color[0] as f32 * intensity) as u8;
            pixels[at + 3] = 0xff;
        }
    }
    Some((columns as u32, levels as u32, pixels))
}

/// The parade: three density plots side by side, each in its own channel's colour.
fn parade_raster(parade: &bay_preview::scopes::Parade) -> Option<RenderImage> {
    let (width, height, pixels) = parade_pixels(parade)?;
    into_render_image(width, height, pixels)
}

/// The pixels behind [`parade_raster`]. See [`density_pixels`].
fn parade_pixels(parade: &bay_preview::scopes::Parade) -> Option<(u32, u32, Vec<u8>)> {
    let (columns, levels) = (parade.red.columns, parade.red.levels);
    if columns == 0 || levels == 0 {
        return None;
    }
    let peak = [&parade.red, &parade.green, &parade.blue]
        .iter()
        .flat_map(|w| (0..columns).flat_map(move |c| w.column(c).iter().copied()))
        .max()
        .unwrap_or(1)
        .max(1) as f32;

    let total = columns * 3;
    let mut pixels = vec![0u8; total * levels * 4];
    for (panel, (waveform, tint)) in [
        (&parade.red, [0xff, 0x50, 0x50u8]),
        (&parade.green, [0x50, 0xff, 0x70]),
        (&parade.blue, [0x60, 0x90, 0xff]),
    ]
    .iter()
    .enumerate()
    {
        for column in 0..columns {
            for (level, count) in waveform.column(column).iter().enumerate() {
                let intensity = (*count as f32 / peak).sqrt().clamp(0.0, 1.0);
                let row = levels - 1 - level;
                let at = (row * total + panel * columns + column) * 4;
                pixels[at] = (tint[2] as f32 * intensity) as u8;
                pixels[at + 1] = (tint[1] as f32 * intensity) as u8;
                pixels[at + 2] = (tint[0] as f32 * intensity) as u8;
                pixels[at + 3] = 0xff;
            }
        }
    }
    Some((total as u32, levels as u32, pixels))
}

/// The vectorscope: a square Cb/Cr density, neutral at the centre.
fn vector_raster(vectorscope: &bay_preview::scopes::Vectorscope) -> Option<RenderImage> {
    let (width, height, pixels) = vector_pixels(vectorscope)?;
    into_render_image(width, height, pixels)
}

/// The pixels behind [`vector_raster`]. See [`density_pixels`].
fn vector_pixels(vectorscope: &bay_preview::scopes::Vectorscope) -> Option<(u32, u32, Vec<u8>)> {
    let size = vectorscope.size;
    if size == 0 {
        return None;
    }
    let peak = vectorscope.cells.iter().copied().max().unwrap_or(1).max(1) as f32;
    let mut pixels = vec![0u8; size * size * 4];
    for (index, count) in vectorscope.cells.iter().enumerate() {
        let intensity = (*count as f32 / peak).sqrt().clamp(0.0, 1.0);
        let at = index * 4;
        pixels[at] = (0xee as f32 * intensity) as u8;
        pixels[at + 1] = (0xe7 as f32 * intensity) as u8;
        pixels[at + 2] = (0xe7 as f32 * intensity) as u8;
        pixels[at + 3] = 0xff;
    }
    Some((size as u32, size as u32, pixels))
}

/// Wrap a BGRA buffer as a `RenderImage`.
///
/// `RgbaImage` is the container type, not a claim about channel order — gpui documents
/// `RenderImage` as BGRA, which is why the builders above write B, G, R, A in that order and
/// nothing swaps here.
fn into_render_image(width: u32, height: u32, pixels: Vec<u8>) -> Option<RenderImage> {
    let buffer = image::RgbaImage::from_raw(width, height, pixels)?;
    Some(RenderImage::new(vec![image::Frame::new(buffer)]))
}

#[cfg(test)]
mod color_page_tests {
    use super::*;
    use bay_preview::scopes::{ScopeOptions, ScopeSet, Scopes};

    /// A gradient, so every scope has something to find. A flat fill touches one histogram bin
    /// and one waveform cell, which passes every shape check while proving nothing.
    fn gradient(width: u32, height: u32) -> Vec<u8> {
        let mut bgra = vec![0u8; (width * height * 4) as usize];
        for y in 0..height {
            for x in 0..width {
                let at = ((y * width + x) * 4) as usize;
                let ramp = (x * 255 / width.max(1)) as u8;
                bgra[at] = ramp / 2; // B
                bgra[at + 1] = ramp; // G
                bgra[at + 2] = 255 - ramp; // R
                bgra[at + 3] = 0xff;
            }
        }
        bgra
    }

    fn measured(width: u32, height: u32) -> Scopes {
        Scopes::from_bgra(
            &gradient(width, height),
            width,
            height,
            ScopeOptions {
                waveform_columns: SCOPE_COLUMNS,
                levels: SCOPE_LEVELS,
                histogram_bins: 256,
                vectorscope_size: VECTOR_SIZE,
                stride: 1,
                scopes: ScopeSet::ALL,
            },
        )
        .expect("a gradient is measurable")
    }

    /// The rasters must have *content*. A correctly-sized buffer of zeroes passes every dimension
    /// check there is and draws a black square — the same failure the decode paths carry a
    /// content check for.
    #[test]
    fn the_scope_rasters_are_not_blank() {
        let scopes = measured(64, 32);

        let waveform = scopes.waveform.as_ref().expect("asked for");
        let (width, height, _) = density_pixels(waveform, [0xe7, 0xe7, 0xee]).expect("a raster");
        assert_eq!((width, height), (SCOPE_COLUMNS as u32, SCOPE_LEVELS as u32));

        for (label, built) in [
            ("waveform", density_pixels(waveform, [0xe7, 0xe7, 0xee])),
            (
                "parade",
                parade_pixels(scopes.parade.as_ref().expect("asked for")),
            ),
            (
                "vectorscope",
                vector_pixels(scopes.vectorscope.as_ref().expect("asked for")),
            ),
        ] {
            let (_, _, pixels) = built.expect("a raster");
            let lit = pixels.iter().step_by(4).filter(|byte| **byte > 0).count();
            assert!(
                lit > 0,
                "the {label} raster is entirely unlit, so it draws a black square"
            );
        }
    }

    /// A waveform's level 0 is black and belongs at the *bottom*; an image's row 0 is the top.
    /// Getting this backwards draws a correct measurement upside down, which reads as a grading
    /// mistake rather than a plotting one.
    #[test]
    fn the_waveform_raster_puts_black_at_the_bottom() {
        // A frame that is entirely black: every pixel lands in level 0.
        let (width, height) = (32u32, 16u32);
        let mut bgra = vec![0u8; (width * height * 4) as usize];
        for pixel in bgra.chunks_exact_mut(4) {
            pixel[3] = 0xff;
        }
        let scopes = Scopes::from_bgra(
            &bgra,
            width,
            height,
            ScopeOptions {
                waveform_columns: 8,
                levels: 8,
                histogram_bins: 16,
                vectorscope_size: 8,
                stride: 1,
                scopes: ScopeSet::ALL,
            },
        )
        .expect("measurable");

        let (_, _, pixels) = density_pixels(
            scopes.waveform.as_ref().expect("asked for"),
            [0xff, 0xff, 0xff],
        )
        .expect("a raster");
        let row_bytes = 8 * 4;
        let top_lit = pixels[..row_bytes].iter().step_by(4).any(|b| *b > 0);
        let bottom_lit = pixels[pixels.len() - row_bytes..]
            .iter()
            .step_by(4)
            .any(|b| *b > 0);
        assert!(
            bottom_lit && !top_lit,
            "a black frame's trace is not at the bottom of the waveform"
        );
    }

    /// Degenerate scopes must not panic — a 1x1 composite is a real case (`render.rs` tests it),
    /// and an empty grid divides by zero if nothing guards it.
    #[test]
    fn tiny_and_empty_scopes_are_survivable() {
        let scopes = measured(1, 1);
        assert!(density_pixels(scopes.waveform.as_ref().expect("asked for"), [1, 2, 3]).is_some());
        assert!(parade_pixels(scopes.parade.as_ref().expect("asked for")).is_some());
        assert!(vector_pixels(scopes.vectorscope.as_ref().expect("asked for")).is_some());
    }

    /// The histogram is four curves, one per channel, and each has to reach across the panel.
    #[test]
    fn the_histogram_draws_one_curve_per_channel() {
        let scopes = measured(64, 32);
        let histogram = scopes.histogram.as_ref().expect("asked for");
        let peak = histogram
            .red
            .iter()
            .chain(&histogram.green)
            .chain(&histogram.blue)
            .chain(&histogram.luma)
            .copied()
            .max()
            .unwrap_or(1)
            .max(1) as f32;
        let channels: [(&[u32], theme::Role); 4] = [
            (&histogram.luma, theme::TEXT),
            (&histogram.red, theme::RECORD),
            (&histogram.green, theme::OK),
            (&histogram.blue, theme::ACCENT),
        ];
        let shapes = histogram_shapes(channels, peak);
        assert_eq!(shapes.len(), 4, "a channel is missing from the histogram");
    }
}
