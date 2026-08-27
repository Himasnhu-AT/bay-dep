//! Waveform, RGB parade, vectorscope and histogram — measured off a composited frame.
//!
//! A scope is a pure reduction from a pixel buffer to counts. Nothing here draws, allocates a
//! GPU resource, or knows a window exists: the Color page reads these structures and paints
//! them, and a headless client or a test reads exactly the same numbers.
//!
//! **Not for the interactive render path.** [`Scopes::from_bgra`] is a full pass over the
//! buffer: ~2.3 ms at preview size and ~44 ms at 4K (see [`SCOPE_BUDGET_NOTE`]). That is work
//! proportional to pixel count, and it belongs on the same footing as decode — computed when
//! something asks for it, never once per `render()`.
//!
//! ## Two luma functions, on purpose
//!
//! [`relative_luminance`] is CIE relative luminance: sRGB code values are linearised, then
//! weighted by Rec.709. It answers "how bright is this, physically" and is what a contrast ratio
//! needs — `frame_check` uses it for exactly that.
//!
//! [`luma_code`] is Rec.709 luma Y', the same weights applied to the *gamma-encoded* code values
//! without linearising. It answers "where does a waveform monitor put this trace".
//!
//! They are not interchangeable and collapsing them would be a real bug in one direction or the
//! other: 18% mid-grey sits at code 118 on a waveform and at 0.18 in linear light. A waveform
//! drawn from linear luminance would put every midtone far too low and make a correctly exposed
//! shot look crushed. Both share [`REC709_LUMA`], so the coefficients exist once.

use crate::PreviewFrame;

/// Rec.709 luma coefficients, R G B. Shared by [`relative_luminance`] and [`luma_code`] so the
/// two encodings cannot drift in their weights, only in their transfer function.
pub const REC709_LUMA: [f32; 3] = [0.2126, 0.7152, 0.0722];

/// The per-frame budget this reduction is held to, and what it actually costs.
///
/// **Budget: one scope pass over a preview-sized buffer fits inside a 16.6 ms frame**, sharing
/// that frame with the composite it measures. The plan assumed this was fine; these are the
/// numbers, not the assumption. Apple M5 Pro, macOS 26.5, release build, single thread, all four
/// scopes in one pass, eight runs (system load ~10, so a quiet machine is this or better):
///
/// - 854×480 (preview size): 2.17–2.58 ms. **Fits** — about a seventh of the frame.
/// - 1920×1080: 10.4–15.1 ms. **Marginal**: two thirds to nine tenths of one 60 fps frame.
/// - 3840×2160 (source): 42.6–44.8 ms. **Does not fit** — two and a half frames per pass.
/// - 3840×2160 at [`ScopeOptions::stride`] 4: 2.64–2.84 ms. Fits, reading 1/16 of the pixels.
///
/// Cost is linear in sampled pixels, at roughly 5.3 ns each, so any size not listed can be read
/// off that.
///
/// The preview path never reaches the 4K case — the preview cache is ≤480px by design. A caller
/// reading scopes off a source-resolution frame does, and must pass a stride. That is a
/// parameter and not an automatic fallback on purpose: a scope that quietly sampled would report
/// clipping shares that describe a sixteenth of the frame while looking like they describe all
/// of it. [`Scopes::sampled_pixels`] is reported for the same reason.
///
/// `tests/scopes.rs::scope_cost_is_reported` prints these on whatever machine runs it. It
/// asserts nothing about time — a timing assertion on a loaded box fails for reasons that have
/// nothing to do with this code.
pub const SCOPE_BUDGET_NOTE: &str =
    "854x480 2.2-2.6ms (fits 16.6ms); 3840x2160 42.6-44.8ms (does not); 2.6-2.8ms at stride 4";

/// CIE relative luminance of an sRGB triple (linearised, Rec.709 weighted), 0.0..=1.0.
///
/// This is the quantity a WCAG contrast ratio is defined over. For where a waveform monitor
/// would place the pixel, use [`luma_code`].
pub fn relative_luminance(rgb: [u8; 3]) -> f32 {
    let channel = |value: u8| {
        let value = f32::from(value) / 255.0;
        if value <= 0.04045 {
            value / 12.92
        } else {
            ((value + 0.055) / 1.055).powf(2.4)
        }
    };
    REC709_LUMA[0] * channel(rgb[0])
        + REC709_LUMA[1] * channel(rgb[1])
        + REC709_LUMA[2] * channel(rgb[2])
}

/// Rec.709 luma Y' of a gamma-encoded sRGB triple, as an 8-bit code value.
///
/// Grey in gives the same code back — `luma_code([128, 128, 128]) == 128` — which is the property
/// that makes a waveform readable as IRE. See the module note on why this is not
/// [`relative_luminance`].
pub fn luma_code(rgb: [u8; 3]) -> u8 {
    let luma = REC709_LUMA[0] * f32::from(rgb[0])
        + REC709_LUMA[1] * f32::from(rgb[1])
        + REC709_LUMA[2] * f32::from(rgb[2]);
    luma.round().clamp(0.0, 255.0) as u8
}

/// Rec.709 colour-difference pair, each in -0.5..=0.5, from a gamma-encoded sRGB triple.
///
/// This is what a vectorscope plots: neutral pixels land at the origin whatever their
/// brightness, so the display shows only chroma. Grey of any level returns `(0.0, 0.0)`.
pub fn chroma_pair(rgb: [u8; 3]) -> (f32, f32) {
    let r = f32::from(rgb[0]) / 255.0;
    let g = f32::from(rgb[1]) / 255.0;
    let b = f32::from(rgb[2]) / 255.0;
    let y = REC709_LUMA[0] * r + REC709_LUMA[1] * g + REC709_LUMA[2] * b;
    ((b - y) / 1.8556, (r - y) / 1.5748)
}

/// Which of the four reductions to run.
///
/// A scope not in the set costs nothing and comes back `None` — not an empty structure, which a
/// display would draw as a black frame, and not a zeroed count, which a summary would report as a
/// measurement. `None` is the only honest answer to "what did the vectorscope say" when the
/// vectorscope never ran.
///
/// This exists because the four do not cost the same (see [`SCOPE_BUDGET_NOTE`]): the vectorscope
/// is most of the pass, and a page showing a waveform and a histogram should not pay for it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScopeSet {
    pub waveform: bool,
    pub parade: bool,
    pub vectorscope: bool,
    pub histogram: bool,
}

impl ScopeSet {
    /// All four. What a scopes panel showing every quadrant asks for, and the default.
    pub const ALL: Self = Self {
        waveform: true,
        parade: true,
        vectorscope: true,
        histogram: true,
    };
    /// None of them — the frame is still walked for the exposure and clipping numbers in
    /// [`ScopeSummary`], which is the cheapest reading that is still a reading.
    pub const NONE: Self = Self {
        waveform: false,
        parade: false,
        vectorscope: false,
        histogram: false,
    };
    pub const WAVEFORM: Self = Self {
        waveform: true,
        parade: false,
        vectorscope: false,
        histogram: false,
    };
    pub const PARADE: Self = Self {
        waveform: false,
        parade: true,
        vectorscope: false,
        histogram: false,
    };
    pub const VECTORSCOPE: Self = Self {
        waveform: false,
        parade: false,
        vectorscope: true,
        histogram: false,
    };
    pub const HISTOGRAM: Self = Self {
        waveform: false,
        parade: false,
        vectorscope: false,
        histogram: true,
    };
}

impl Default for ScopeSet {
    fn default() -> Self {
        Self::ALL
    }
}

/// What the caller wants measured, and how finely.
///
/// The defaults are what a scope display needs: 256 luma levels is one row per code value, and
/// 256 columns is more than any panel is wide.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScopeOptions {
    /// Horizontal buckets in the waveform and parade. Image columns are folded into these.
    pub waveform_columns: usize,
    /// Vertical resolution of the waveform and parade traces.
    pub levels: usize,
    /// Bins per channel in the histogram.
    pub histogram_bins: usize,
    /// Edge length of the square vectorscope cell grid.
    pub vectorscope_size: usize,
    /// Sample every `stride`-th pixel in each axis. `1` reads every pixel; `4` reads 1/16 of
    /// them. Present so a caller that cannot afford a full 4K pass says so, rather than a scope
    /// quietly sampling and reporting shares that do not describe the frame.
    pub stride: usize,
    /// Which reductions to run. Anything left out is `None` on the result rather than empty.
    pub scopes: ScopeSet,
}

impl Default for ScopeOptions {
    fn default() -> Self {
        Self {
            waveform_columns: 256,
            levels: 256,
            histogram_bins: 256,
            vectorscope_size: 128,
            stride: 1,
            scopes: ScopeSet::ALL,
        }
    }
}

impl ScopeOptions {
    /// Clamp every field to something a reduction can actually run with. A zero bucket count is
    /// a division by zero one loop down, and a stride of zero never advances.
    fn sanitised(self) -> Self {
        Self {
            waveform_columns: self.waveform_columns.max(1),
            levels: self.levels.clamp(1, 256),
            histogram_bins: self.histogram_bins.clamp(1, 256),
            vectorscope_size: self.vectorscope_size.max(1),
            stride: self.stride.max(1),
            scopes: self.scopes,
        }
    }
}

/// Luma waveform: for each horizontal bucket, how many sampled pixels sat at each level.
///
/// `cells` is `waveform_columns * levels`, indexed `column * levels + level`. Level 0 is black.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Waveform {
    pub columns: usize,
    pub levels: usize,
    pub cells: Vec<u32>,
}

impl Waveform {
    /// Counts for one horizontal bucket, lowest level first.
    pub fn column(&self, column: usize) -> &[u32] {
        &self.cells[column * self.levels..(column + 1) * self.levels]
    }
}

/// The same trace split per channel — the parade. Three [`Waveform`]s that share a shape.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Parade {
    pub red: Waveform,
    pub green: Waveform,
    pub blue: Waveform,
}

/// Chroma distribution on the Cb/Cr plane.
///
/// `cells` is `size * size`, indexed `row * size + column`; column runs Cb from -0.5 to +0.5 and
/// row runs Cr the same way, so row 0 is the most negative Cr. Neutral pixels pile up at the
/// centre. Hue angles are reported by [`Vectorscope::dominant_hue_degrees`] as
/// `atan2(Cr, Cb)` normalised to 0..360 — the convention that puts pure red near 103°, matching
/// the R target on a standard graticule.
#[derive(Debug, Clone, PartialEq)]
pub struct Vectorscope {
    pub size: usize,
    pub cells: Vec<u32>,
    /// Sum of `sqrt(Cb² + Cr²)` over sampled pixels, for the mean without a second pass.
    saturation_sum: f64,
    /// Largest `sqrt(Cb² + Cr²)` seen. 0.0 for a fully neutral frame.
    peak_saturation: f64,
    /// Chroma-weighted mean direction, as summed Cb and Cr. Weighting by chroma is what keeps a
    /// frame that is 95% grey from reporting whatever hue its noise floor happened to lean.
    hue_cb_sum: f64,
    hue_cr_sum: f64,
    sampled: u64,
}

impl Vectorscope {
    /// Mean distance from neutral over sampled pixels, 0.0..~0.5.
    pub fn mean_saturation(&self) -> f64 {
        if self.sampled == 0 {
            return 0.0;
        }
        self.saturation_sum / self.sampled as f64
    }

    /// Largest distance from neutral seen.
    pub fn peak_saturation(&self) -> f64 {
        self.peak_saturation
    }

    /// The frame's overall hue lean in degrees, or `None` when there is no chroma to lean.
    ///
    /// `None` rather than `0.0` because a neutral frame has no hue, and a scope that answers
    /// "red" for a greyscale shot is worse than one that declines.
    pub fn dominant_hue_degrees(&self) -> Option<f64> {
        let magnitude = self.hue_cb_sum.hypot(self.hue_cr_sum);
        if magnitude < 1e-6 {
            return None;
        }
        let degrees = self.hue_cr_sum.atan2(self.hue_cb_sum).to_degrees();
        Some(if degrees < 0.0 {
            degrees + 360.0
        } else {
            degrees
        })
    }
}

/// Per-channel and luma code distributions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Histogram {
    pub bins: usize,
    pub red: Vec<u32>,
    pub green: Vec<u32>,
    pub blue: Vec<u32>,
    pub luma: Vec<u32>,
}

/// Everything the four scopes found, from one pass over the buffer.
#[derive(Debug, Clone, PartialEq)]
pub struct Scopes {
    pub width: u32,
    pub height: u32,
    /// How many pixels were actually read. Equal to `width * height` unless
    /// [`ScopeOptions::stride`] was above 1 — reported so every share below can be read as a
    /// share *of what was measured*, not of the frame it was assumed to describe.
    pub sampled_pixels: u64,
    pub stride: usize,
    /// Which reductions ran. Every `Some` below is one of these; every `None` was not asked for.
    pub computed: ScopeSet,
    pub waveform: Option<Waveform>,
    pub parade: Option<Parade>,
    pub vectorscope: Option<Vectorscope>,
    pub histogram: Option<Histogram>,
    luma_min: u8,
    luma_max: u8,
    luma_sum: u64,
    channel_sums: [u64; 3],
    black_clipped: u64,
    white_clipped: u64,
    outside_legal: u64,
}

/// Why a buffer could not be measured. The only failure mode is a buffer that does not match the
/// dimensions it claims — everything else is arithmetic.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScopeError {
    /// `bgra.len()` was not `width * height * 4`.
    SizeMismatch { expected: usize, actual: usize },
    /// A zero-pixel frame. There is nothing to reduce, and reporting zeroed scopes for it would
    /// look like a black frame rather than an absent one.
    Empty,
}

impl std::fmt::Display for ScopeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SizeMismatch { expected, actual } => write!(
                f,
                "frame buffer is {actual} bytes, but {expected} are needed for its declared size"
            ),
            Self::Empty => write!(f, "a frame with no pixels has no scopes"),
        }
    }
}

impl std::error::Error for ScopeError {}

impl Scopes {
    /// Measure a composited frame.
    pub fn from_preview_frame(
        frame: &PreviewFrame,
        options: ScopeOptions,
    ) -> Result<Self, ScopeError> {
        Self::from_bgra(&frame.bgra, frame.width, frame.height, options)
    }

    /// Measure a tightly-packed BGRA8 buffer — the layout [`PreviewFrame`] carries and the
    /// compositor reads back.
    ///
    /// One pass computes all four scopes. Four passes would be four times the memory traffic for
    /// numbers that all come off the same pixel.
    pub fn from_bgra(
        bgra: &[u8],
        width: u32,
        height: u32,
        options: ScopeOptions,
    ) -> Result<Self, ScopeError> {
        if width == 0 || height == 0 {
            return Err(ScopeError::Empty);
        }
        let expected = width as usize * height as usize * 4;
        if bgra.len() != expected {
            return Err(ScopeError::SizeMismatch {
                expected,
                actual: bgra.len(),
            });
        }
        let options = options.sanitised();
        let wanted = options.scopes;
        let (columns, levels) = (options.waveform_columns, options.levels);
        let bins = options.histogram_bins;
        let size = options.vectorscope_size;

        // A scope that was not asked for allocates nothing and is never indexed.
        let blank = |asked: bool, len: usize| if asked { vec![0u32; len] } else { Vec::new() };
        let trace_cells = columns * levels;
        let mut waveform = blank(wanted.waveform, trace_cells);
        let mut red_trace = blank(wanted.parade, trace_cells);
        let mut green_trace = blank(wanted.parade, trace_cells);
        let mut blue_trace = blank(wanted.parade, trace_cells);
        let mut vector_cells = blank(wanted.vectorscope, size * size);
        let mut histogram = [
            blank(wanted.histogram, bins),
            blank(wanted.histogram, bins),
            blank(wanted.histogram, bins),
            blank(wanted.histogram, bins),
        ];

        let mut luma_min = u8::MAX;
        let mut luma_max = u8::MIN;
        let mut luma_sum = 0u64;
        let mut channel_sums = [0u64; 3];
        let (mut black_clipped, mut white_clipped, mut outside_legal) = (0u64, 0u64, 0u64);
        let mut saturation_sum = 0.0f64;
        let mut peak_saturation = 0.0f64;
        let (mut hue_cb_sum, mut hue_cr_sum) = (0.0f64, 0.0f64);
        let mut sampled = 0u64;

        let stride = options.stride;
        let row_bytes = width as usize * 4;
        let mut y = 0usize;
        while y < height as usize {
            let row = &bgra[y * row_bytes..(y + 1) * row_bytes];
            let mut x = 0usize;
            while x < width as usize {
                let pixel = &row[x * 4..x * 4 + 4];
                // Readback is BGRA; every helper here takes RGB.
                let rgb = [pixel[2], pixel[1], pixel[0]];
                let luma = luma_code(rgb);

                // The column index is the one piece of work the waveform and the parade share,
                // so it is computed once and only when one of them wants it.
                if wanted.waveform || wanted.parade {
                    let column = x * columns / width as usize;
                    if wanted.waveform {
                        waveform[column * levels + usize::from(luma) * levels / 256] += 1;
                    }
                    if wanted.parade {
                        for (trace, value) in [
                            (&mut red_trace, rgb[0]),
                            (&mut green_trace, rgb[1]),
                            (&mut blue_trace, rgb[2]),
                        ] {
                            trace[column * levels + usize::from(value) * levels / 256] += 1;
                        }
                    }
                }

                if wanted.histogram {
                    for (channel, value) in rgb.iter().enumerate() {
                        histogram[channel][usize::from(*value) * bins / 256] += 1;
                    }
                    histogram[3][usize::from(luma) * bins / 256] += 1;
                }

                if wanted.vectorscope {
                    let (cb, cr) = chroma_pair(rgb);
                    let cell_x = (((cb + 0.5) * size as f32) as usize).min(size - 1);
                    let cell_y = (((cr + 0.5) * size as f32) as usize).min(size - 1);
                    vector_cells[cell_y * size + cell_x] += 1;
                    // `hypot` and not `sqrt` is the right call when a magnitude can overflow
                    // its square. This one cannot: cb and cr are bounded to ±0.5, the smallest
                    // non-zero either can hold is ~0.002 (one code value of an 8-bit channel),
                    // and the guard costs a libm call per pixel — 27% of the whole four-scope
                    // pass, measured, which is the difference between 49 ms and 36 ms at 4K.
                    let saturation = f64::from(cb * cb + cr * cr).sqrt();
                    saturation_sum += saturation;
                    peak_saturation = peak_saturation.max(saturation);
                    hue_cb_sum += f64::from(cb);
                    hue_cr_sum += f64::from(cr);
                }

                for (channel, value) in rgb.iter().enumerate() {
                    channel_sums[channel] += u64::from(*value);
                }
                luma_min = luma_min.min(luma);
                luma_max = luma_max.max(luma);
                luma_sum += u64::from(luma);
                if luma <= 1 {
                    black_clipped += 1;
                }
                if luma >= 254 {
                    white_clipped += 1;
                }
                if !(16..=235).contains(&luma) {
                    outside_legal += 1;
                }
                sampled += 1;
                x += stride;
            }
            y += stride;
        }

        let trace = |cells: Vec<u32>| Waveform {
            columns,
            levels,
            cells,
        };
        let [red_bins, green_bins, blue_bins, luma_bins] = histogram;
        Ok(Self {
            width,
            height,
            sampled_pixels: sampled,
            stride,
            computed: wanted,
            waveform: wanted.waveform.then(|| trace(waveform)),
            parade: wanted.parade.then(|| Parade {
                red: trace(red_trace),
                green: trace(green_trace),
                blue: trace(blue_trace),
            }),
            vectorscope: wanted.vectorscope.then_some(Vectorscope {
                size,
                cells: vector_cells,
                saturation_sum,
                peak_saturation,
                hue_cb_sum,
                hue_cr_sum,
                sampled,
            }),
            histogram: wanted.histogram.then_some(Histogram {
                bins,
                red: red_bins,
                green: green_bins,
                blue: blue_bins,
                luma: luma_bins,
            }),
            luma_min,
            luma_max,
            luma_sum,
            channel_sums,
            black_clipped,
            white_clipped,
            outside_legal,
        })
    }

    /// The handful of numbers worth reading without a display: exposure, clipping, colour lean.
    pub fn summary(&self) -> ScopeSummary {
        let sampled = self.sampled_pixels.max(1) as f64;
        ScopeSummary {
            width: self.width,
            height: self.height,
            sampled_pixels: self.sampled_pixels,
            stride: self.stride,
            luma_min: self.luma_min,
            luma_max: self.luma_max,
            luma_mean: self.luma_sum as f64 / sampled,
            channel_mean: [
                self.channel_sums[0] as f64 / sampled,
                self.channel_sums[1] as f64 / sampled,
                self.channel_sums[2] as f64 / sampled,
            ],
            black_clipped_share: self.black_clipped as f64 / sampled,
            white_clipped_share: self.white_clipped as f64 / sampled,
            outside_legal_range_share: self.outside_legal as f64 / sampled,
            mean_saturation: self.vectorscope.as_ref().map(Vectorscope::mean_saturation),
            peak_saturation: self.vectorscope.as_ref().map(Vectorscope::peak_saturation),
            dominant_hue_degrees: self
                .vectorscope
                .as_ref()
                .and_then(Vectorscope::dominant_hue_degrees),
        }
    }
}

/// A scope reading small enough to put on the wire, and to read.
///
/// Exists because the full structures are tens of thousands of counts — a display's input, not an
/// answer. This is the answer: where the exposure sits, what is clipped, which way the colour
/// leans.
#[derive(Debug, Clone, PartialEq)]
pub struct ScopeSummary {
    pub width: u32,
    pub height: u32,
    pub sampled_pixels: u64,
    pub stride: usize,
    pub luma_min: u8,
    pub luma_max: u8,
    pub luma_mean: f64,
    /// Mean R, G, B code value. Three numbers that disagree are a cast.
    pub channel_mean: [f64; 3],
    pub black_clipped_share: f64,
    pub white_clipped_share: f64,
    /// Share of sampled pixels whose luma falls outside the 16..=235 studio-swing window.
    ///
    /// bay composites full-range, so this is never a gamut error — it is a delivery note for a
    /// destination that expects legal range, and a full-range frame legitimately has a high one.
    pub outside_legal_range_share: f64,
    /// `None` when [`ScopeSet::vectorscope`] was not asked for — a frame whose chroma was never
    /// read has no mean saturation, and reporting 0.0 there would read as "perfectly neutral".
    pub mean_saturation: Option<f64>,
    pub peak_saturation: Option<f64>,
    /// `None` for a frame with no chroma at all, and for one whose vectorscope did not run. See
    /// [`Vectorscope::dominant_hue_degrees`].
    pub dominant_hue_degrees: Option<f64>,
}

impl ScopeSummary {
    /// The wire shape. Kept here rather than in the MCP crate so the contract an agent reads is
    /// covered by this crate's tests, which need no server and no window.
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "width": self.width,
            "height": self.height,
            "sampledPixels": self.sampled_pixels,
            "stride": self.stride,
            "luma": {
                "min": self.luma_min,
                "max": self.luma_max,
                "mean": round4(self.luma_mean),
            },
            "channelMean": {
                "red": round4(self.channel_mean[0]),
                "green": round4(self.channel_mean[1]),
                "blue": round4(self.channel_mean[2]),
            },
            "clipping": {
                "blackShare": round4(self.black_clipped_share),
                "whiteShare": round4(self.white_clipped_share),
                "outsideLegalRangeShare": round4(self.outside_legal_range_share),
            },
            "chroma": {
                "meanSaturation": self.mean_saturation.map(round4),
                "peakSaturation": self.peak_saturation.map(round4),
                "dominantHueDegrees": self.dominant_hue_degrees.map(round4),
            },
        })
    }
}

/// Four decimals is past what any of these numbers mean and short enough to read. Without it the
/// wire carries seventeen digits of a mean that is uncertain in the third.
fn round4(value: f64) -> f64 {
    (value * 10_000.0).round() / 10_000.0
}
