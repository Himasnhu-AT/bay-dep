//! Known frames, known scopes.
//!
//! Every case here is a frame whose correct reading can be worked out on paper, so a wrong
//! answer is wrong rather than merely different. No GPU, no ffmpeg, no window: these are pure
//! reductions over a `Vec<u8>` and nothing in this file can skip.
//!
//! The four scopes are `Option`: a scope outside the requested [`ScopeSet`] never ran. Except
//! where a case says otherwise these ask for the default, `ScopeSet::ALL`, so the `unwrap`s below
//! are that default holding — and a change that quietly stopped computing one fails here.

use bay_preview::scopes::{
    ScopeError, ScopeOptions, ScopeSet, Scopes, chroma_pair, luma_code, relative_luminance,
};

/// A `width * height` BGRA buffer of one repeated colour, given as RGB.
fn flat(rgb: [u8; 3], width: u32, height: u32) -> Vec<u8> {
    (0..width as usize * height as usize)
        .flat_map(|_| [rgb[2], rgb[1], rgb[0], 255])
        .collect()
}

/// Measure a 16x16 flat frame with one waveform bucket per image column, so "every column
/// traces at X" is a statement about pixels rather than about empty buckets.
fn measure(rgb: [u8; 3]) -> Scopes {
    let options = ScopeOptions {
        waveform_columns: 16,
        ..ScopeOptions::default()
    };
    Scopes::from_bgra(&flat(rgb, 16, 16), 16, 16, options)
        .expect("a well-formed flat frame measures")
}

/// The only level with any count in it, or a panic naming what was found instead.
fn sole_occupied_bin(bins: &[u32]) -> usize {
    let occupied: Vec<usize> = bins
        .iter()
        .enumerate()
        .filter(|(_, count)| **count > 0)
        .map(|(index, _)| index)
        .collect();
    assert_eq!(
        occupied.len(),
        1,
        "a flat frame occupies exactly one bin, found {occupied:?}"
    );
    occupied[0]
}

#[test]
fn a_black_frame_sits_on_the_floor_of_every_scope() {
    let scopes = measure([0, 0, 0]);
    let summary = scopes.summary();

    assert_eq!((summary.luma_min, summary.luma_max), (0, 0));
    assert_eq!(summary.luma_mean, 0.0);
    assert_eq!(
        sole_occupied_bin(&scopes.histogram.as_ref().unwrap().luma),
        0
    );
    assert_eq!(
        sole_occupied_bin(&scopes.histogram.as_ref().unwrap().red),
        0
    );
    for column in 0..scopes.waveform.as_ref().unwrap().columns {
        assert_eq!(
            sole_occupied_bin(scopes.waveform.as_ref().unwrap().column(column)),
            0,
            "every waveform column traces at black"
        );
    }
    assert_eq!(summary.black_clipped_share, 1.0);
    assert_eq!(summary.white_clipped_share, 0.0);
    // Black is neutral: no chroma, therefore no hue to report.
    assert_eq!(summary.mean_saturation, Some(0.0));
    assert_eq!(summary.dominant_hue_degrees, None);
    // Code 0 is below the 16..=235 studio window, so a black frame is entirely outside it.
    assert_eq!(summary.outside_legal_range_share, 1.0);
}

#[test]
fn a_white_frame_sits_at_the_ceiling_of_every_scope() {
    let scopes = measure([255, 255, 255]);
    let summary = scopes.summary();

    assert_eq!((summary.luma_min, summary.luma_max), (255, 255));
    assert_eq!(summary.luma_mean, 255.0);
    assert_eq!(
        sole_occupied_bin(&scopes.histogram.as_ref().unwrap().luma),
        255
    );
    for channel in [
        &scopes.histogram.as_ref().unwrap().red,
        &scopes.histogram.as_ref().unwrap().green,
        &scopes.histogram.as_ref().unwrap().blue,
    ] {
        assert_eq!(sole_occupied_bin(channel), 255);
    }
    for column in 0..scopes.parade.as_ref().unwrap().red.columns {
        assert_eq!(
            sole_occupied_bin(scopes.parade.as_ref().unwrap().red.column(column)),
            255
        );
        assert_eq!(
            sole_occupied_bin(scopes.parade.as_ref().unwrap().green.column(column)),
            255
        );
        assert_eq!(
            sole_occupied_bin(scopes.parade.as_ref().unwrap().blue.column(column)),
            255
        );
    }
    assert_eq!(summary.white_clipped_share, 1.0);
    assert_eq!(summary.black_clipped_share, 0.0);
    assert_eq!(summary.dominant_hue_degrees, None, "white has no hue");
}

/// Mid-grey is where the two luma functions visibly disagree, which is the whole reason both
/// exist. Code 128 traces at 128 on a waveform; its linear luminance is about 0.216, and a
/// waveform drawn from that number would put mid-grey at IRE 21 instead of 50.
#[test]
fn mid_grey_traces_at_its_code_value_not_at_its_linear_luminance() {
    let scopes = measure([128, 128, 128]);
    let summary = scopes.summary();

    assert_eq!(summary.luma_mean, 128.0);
    assert_eq!(
        sole_occupied_bin(&scopes.histogram.as_ref().unwrap().luma),
        128
    );
    assert_eq!(luma_code([128, 128, 128]), 128);

    let linear = relative_luminance([128, 128, 128]);
    assert!(
        (linear - 0.2158).abs() < 0.001,
        "linear luminance of mid-grey is ~0.216, got {linear}"
    );
    assert!(
        (f32::from(luma_code([128, 128, 128])) / 255.0 - linear).abs() > 0.25,
        "the two must not have quietly become the same function"
    );

    assert_eq!(summary.black_clipped_share, 0.0);
    assert_eq!(summary.white_clipped_share, 0.0);
    assert_eq!(summary.outside_legal_range_share, 0.0, "128 is legal range");
    assert_eq!(summary.dominant_hue_degrees, None, "grey has no hue");
    assert_eq!(summary.mean_saturation, Some(0.0));
}

/// Saturated red. Its luma is `0.2126 * 255 = 54.2`, and its vectorscope angle is the R target.
#[test]
fn a_saturated_primary_lands_where_rec709_puts_it() {
    let scopes = measure([255, 0, 0]);
    let summary = scopes.summary();

    assert_eq!(summary.luma_min, 54, "0.2126 * 255 rounds to 54");
    assert_eq!(summary.luma_max, 54);
    assert_eq!(
        sole_occupied_bin(&scopes.histogram.as_ref().unwrap().luma),
        54
    );
    assert_eq!(
        sole_occupied_bin(&scopes.histogram.as_ref().unwrap().red),
        255
    );
    assert_eq!(
        sole_occupied_bin(&scopes.histogram.as_ref().unwrap().green),
        0
    );
    assert_eq!(
        sole_occupied_bin(&scopes.histogram.as_ref().unwrap().blue),
        0
    );

    // The parade is what separates a primary from a grey of the same luma: the traces split.
    assert_eq!(
        sole_occupied_bin(scopes.parade.as_ref().unwrap().red.column(0)),
        255
    );
    assert_eq!(
        sole_occupied_bin(scopes.parade.as_ref().unwrap().green.column(0)),
        0
    );
    assert_eq!(
        sole_occupied_bin(scopes.parade.as_ref().unwrap().blue.column(0)),
        0
    );

    assert_eq!(summary.channel_mean, [255.0, 0.0, 0.0]);
    assert!(
        summary.peak_saturation.expect("the vectorscope ran") > 0.5,
        "a primary is far from neutral"
    );
}

/// The vectorscope's angle convention, pinned against the six graticule targets. `atan2(Cr, Cb)`
/// normalised to 0..360 puts red at ~103°, and each secondary opposite its primary.
#[test]
fn the_vectorscope_places_each_primary_at_its_graticule_angle() {
    let angle = |rgb: [u8; 3]| {
        measure(rgb)
            .vectorscope
            .as_ref()
            .unwrap()
            .dominant_hue_degrees()
            .expect("a primary has a hue")
    };

    // Worked out from Rec.709 by hand: Cb = (B'-Y')/1.8556, Cr = (R'-Y')/1.5748, angle
    // atan2(Cr, Cb). Red at 102.9° is the R target on a standard graticule.
    let cases = [
        ([255u8, 0, 0], 102.917),
        ([0, 255, 0], 229.680),
        ([0, 0, 255], 354.761),
        ([0, 255, 255], 282.917),
        ([255, 0, 255], 49.680),
        ([255, 255, 0], 174.761),
    ];
    for (rgb, expected) in cases {
        let measured = angle(rgb);
        assert!(
            (measured - expected).abs() < 0.5,
            "{rgb:?} should sit at {expected}°, measured {measured}°"
        );
    }

    // Each secondary is its primary's complement: 180° apart, by construction.
    for (primary, secondary) in [
        ([255u8, 0, 0], [0u8, 255, 255]),
        ([0, 255, 0], [255, 0, 255]),
        ([0, 0, 255], [255, 255, 0]),
    ] {
        let separation = (angle(primary) - angle(secondary)).abs();
        let separation = if separation > 180.0 {
            360.0 - separation
        } else {
            separation
        };
        assert!(
            (separation - 180.0).abs() < 0.5,
            "{primary:?} and {secondary:?} are complements, measured {separation}° apart"
        );
    }
}

/// Neutral pixels of any brightness collapse to the centre cell — that is what makes a
/// vectorscope readable as chroma alone.
#[test]
fn every_grey_lands_on_the_vectorscope_origin() {
    for level in [0u8, 32, 128, 200, 255] {
        let (cb, cr) = chroma_pair([level, level, level]);
        assert!(
            cb.abs() < 1e-6 && cr.abs() < 1e-6,
            "grey {level} should be neutral, got ({cb}, {cr})"
        );
        let scopes = measure([level, level, level]);
        let centre = scopes.vectorscope.as_ref().unwrap().size / 2;
        assert_eq!(
            scopes.vectorscope.as_ref().unwrap().cells
                [centre * scopes.vectorscope.as_ref().unwrap().size + centre],
            scopes.sampled_pixels as u32,
            "every pixel of a grey frame belongs in the centre cell"
        );
    }
}

/// A frame split black-left / white-right proves the waveform is positional at all: a histogram
/// cannot tell the two halves apart, and a waveform must.
#[test]
fn the_waveform_separates_a_split_frame_by_column() {
    let (width, height) = (64u32, 8u32);
    let mut bgra = Vec::with_capacity(width as usize * height as usize * 4);
    for _ in 0..height {
        for x in 0..width {
            let value = if x < width / 2 { 0 } else { 255 };
            bgra.extend_from_slice(&[value, value, value, 255]);
        }
    }
    let options = ScopeOptions {
        waveform_columns: width as usize,
        ..ScopeOptions::default()
    };
    let scopes = Scopes::from_bgra(&bgra, width, height, options).unwrap();

    let columns = scopes.waveform.as_ref().unwrap().columns;
    assert_eq!(
        sole_occupied_bin(scopes.waveform.as_ref().unwrap().column(0)),
        0
    );
    assert_eq!(
        sole_occupied_bin(scopes.waveform.as_ref().unwrap().column(columns - 1)),
        255
    );

    // The histogram sees an even split and nothing about where it is.
    assert_eq!(
        scopes.histogram.as_ref().unwrap().luma[0],
        scopes.histogram.as_ref().unwrap().luma[255]
    );
    let summary = scopes.summary();
    assert_eq!(summary.luma_mean, 127.5);
    assert_eq!(summary.black_clipped_share, 0.5);
    assert_eq!(summary.white_clipped_share, 0.5);
}

/// A stride reads fewer pixels and says so. The shares stay shares *of what was sampled*, which
/// is why `sampled_pixels` is reported rather than assumed equal to the frame.
#[test]
fn a_stride_reports_what_it_actually_read() {
    let (width, height) = (64u32, 64u32);
    let full = Scopes::from_bgra(
        &flat([200, 100, 50], width, height),
        width,
        height,
        ScopeOptions::default(),
    )
    .unwrap();
    let strided = Scopes::from_bgra(
        &flat([200, 100, 50], width, height),
        width,
        height,
        ScopeOptions {
            stride: 4,
            ..ScopeOptions::default()
        },
    )
    .unwrap();

    assert_eq!(full.sampled_pixels, 64 * 64);
    assert_eq!(strided.sampled_pixels, 16 * 16);
    assert_eq!(strided.stride, 4);
    // A flat frame reads identically either way — the stride costs resolution, not correctness.
    assert_eq!(full.summary().luma_mean, strided.summary().luma_mean);
    assert_eq!(full.summary().channel_mean, strided.summary().channel_mean);
}

#[test]
fn a_buffer_that_does_not_match_its_dimensions_is_refused() {
    let short = vec![0u8; 4 * 4 * 4 - 1];
    assert_eq!(
        Scopes::from_bgra(&short, 4, 4, ScopeOptions::default()),
        Err(ScopeError::SizeMismatch {
            expected: 64,
            actual: 63
        })
    );
    assert_eq!(
        Scopes::from_bgra(&[], 0, 0, ScopeOptions::default()),
        Err(ScopeError::Empty),
        "a frame with no pixels is absent, not black"
    );
}

/// Degenerate options must clamp rather than divide by zero. A panel collapsed to nothing asks
/// for zero columns, and the render path cannot panic on bad input.
#[test]
fn degenerate_options_clamp_instead_of_panicking() {
    let scopes = Scopes::from_bgra(
        &flat([10, 20, 30], 4, 4),
        4,
        4,
        ScopeOptions {
            waveform_columns: 0,
            levels: 0,
            histogram_bins: 0,
            vectorscope_size: 0,
            stride: 0,
            scopes: ScopeSet::ALL,
        },
    )
    .expect("clamped options still measure");
    assert_eq!(scopes.waveform.as_ref().unwrap().columns, 1);
    assert_eq!(scopes.waveform.as_ref().unwrap().levels, 1);
    assert_eq!(scopes.histogram.as_ref().unwrap().bins, 1);
    assert_eq!(scopes.vectorscope.as_ref().unwrap().size, 1);
    assert_eq!(scopes.sampled_pixels, 16, "stride 0 still advances");
}

/// The wire shape an agent reads. Pinned because it is a contract, not a debug dump.
#[test]
fn the_summary_json_names_what_a_colourist_would_ask_for() {
    let json = measure([255, 0, 0]).summary().to_json();
    assert_eq!(json["width"], 16);
    assert_eq!(json["luma"]["min"], 54);
    assert_eq!(json["luma"]["mean"], 54.0);
    assert_eq!(json["channelMean"]["red"], 255.0);
    assert_eq!(json["channelMean"]["green"], 0.0);
    assert_eq!(json["clipping"]["blackShare"], 0.0);
    assert!(
        (json["chroma"]["dominantHueDegrees"].as_f64().unwrap() - 102.9).abs() < 0.5,
        "the wire carries the same angle the scope measured"
    );

    // A neutral frame reports no hue rather than an arbitrary one.
    let grey = measure([128, 128, 128]).summary().to_json();
    assert!(grey["chroma"]["dominantHueDegrees"].is_null());
}

/// What one scope pass costs, per scope and in total, on whatever machine runs it.
///
/// This is a report, not a benchmark and not a gate: it prints under `--nocapture` and asserts
/// only a ceiling an order of magnitude above the measured figure. A tight timing assertion fails
/// on a loaded machine for reasons that have nothing to do with this code, and a test that fails
/// for outside reasons teaches people to re-run until green.
///
/// **The numbers are only meaningful in a release build** — an unoptimized reduction is not the
/// one that ships, and it runs some thirty times slower. So the full matrix runs under
/// `--release` only; a debug run times one case, prints it as the non-measurement it is, and
/// keeps a ceiling loose enough that only an algorithmic regression trips it.
///
/// Best-of-N rather than a mean: the fastest run is the one least interrupted, and therefore the
/// closest thing to the idle number. The spread against the median says how loaded the box was.
///
/// Per scope as well as in total, because the four do not cost the same and the expensive one is
/// the one to drop or stride. Each scope is timed alone, and `ScopeSet::NONE` — the buffer walk
/// plus the always-computed exposure and clipping stats — is timed as the floor every one of them
/// pays. A scope's own cost is its alone-figure minus that floor; the four alone-figures sum to
/// more than the fused pass because they each pay the floor once.
#[test]
fn scope_cost_is_reported() {
    let optimized = !cfg!(debug_assertions);
    // Enough runs to find a clean one, few enough that 4K does not dominate the suite.
    let runs: u32 = if optimized { 7 } else { 3 };

    // A gradient rather than a flat fill: a flat frame touches one histogram bin repeatedly and
    // measures a cache that a real frame does not get.
    fn gradient(width: u32, height: u32) -> Vec<u8> {
        (0..width as usize * height as usize)
            .flat_map(|index| {
                let x = (index % width as usize) as u8;
                let y = (index / width as usize) as u8;
                [x, y, x.wrapping_add(y), 255]
            })
            .collect()
    }

    /// Milliseconds for the fastest and the middle run.
    fn time(bgra: &[u8], width: u32, height: u32, options: ScopeOptions, runs: u32) -> (f64, f64) {
        let mut timings: Vec<f64> = (0..runs)
            .map(|_| {
                let started = std::time::Instant::now();
                let scopes = Scopes::from_bgra(bgra, width, height, options)
                    .expect("a sized buffer measures");
                let elapsed = started.elapsed().as_secs_f64() * 1000.0;
                // Keep the result alive past the clock read so the reduction cannot be elided.
                std::hint::black_box(&scopes);
                elapsed
            })
            .collect();
        timings.sort_by(f64::total_cmp);
        (timings[0], timings[timings.len() / 2])
    }

    let preview = gradient(854, 480);
    let all_four = ScopeOptions::default();
    let (preview_best, preview_median) = time(&preview, 854, 480, all_four, runs);

    if !optimized {
        println!(
            "scope cost, 854x480, all four: {preview_best:.2} ms best / {preview_median:.2} median \
             — DEBUG BUILD, so this is not the cost of anything that ships. \
             `cargo test --release -p bay-preview --test scopes -- --nocapture scope_cost` \
             prints the real matrix."
        );
        assert!(
            preview_best < 400.0,
            "all four scopes over a 854x480 frame took {preview_best:.2} ms even unoptimized, \
             which is far past anything this reduction has cost — something regressed"
        );
        return;
    }

    let per_scope = [
        ("frame walk + stats only", ScopeSet::NONE),
        ("+ waveform", ScopeSet::WAVEFORM),
        ("+ parade", ScopeSet::PARADE),
        ("+ vectorscope", ScopeSet::VECTORSCOPE),
        ("+ histogram", ScopeSet::HISTOGRAM),
        ("all four", ScopeSet::ALL),
    ];

    println!("scope cost — release build, best of {runs}, milliseconds:");
    for (label, width, height) in [
        ("854x480 preview", 854u32, 480u32),
        ("1920x1080", 1920, 1080),
        ("3840x2160 source", 3840, 2160),
    ] {
        let bgra = gradient(width, height);
        println!("  {label}:");
        for (name, scopes) in per_scope {
            let options = ScopeOptions {
                scopes,
                ..ScopeOptions::default()
            };
            let (best, median) = time(&bgra, width, height, options, runs);
            println!("    {name:>24}: {best:>7.2}  (median {median:>7.2})");
        }
        for stride in [2usize, 4] {
            let options = ScopeOptions {
                stride,
                ..ScopeOptions::default()
            };
            let (best, median) = time(&bgra, width, height, options, runs);
            let name = format!("all four, stride {stride}");
            println!("    {name:>24}: {best:>7.2}  (median {median:>7.2})");
        }
    }

    assert!(
        preview_best < 25.0,
        "all four scopes over a 854x480 frame took {preview_best:.2} ms, an order of magnitude \
         past what this reduction has ever cost — a preview-sized pass no longer fits a frame"
    );
}

/// A scope outside the requested set never ran, and says so. The alternative — an empty structure
/// and a zeroed summary — reads as a measurement of a neutral black frame, which is exactly the
/// lie a scopes panel must not tell.
#[test]
fn a_scope_that_was_not_asked_for_is_absent_rather_than_empty() {
    let options = ScopeOptions {
        scopes: ScopeSet::HISTOGRAM,
        ..ScopeOptions::default()
    };
    let scopes = Scopes::from_bgra(&flat([200, 40, 40], 8, 8), 8, 8, options).expect("measures");

    assert!(scopes.histogram.is_some(), "the histogram was asked for");
    assert!(scopes.waveform.is_none());
    assert!(scopes.parade.is_none());
    assert!(scopes.vectorscope.is_none());
    assert_eq!(scopes.computed, ScopeSet::HISTOGRAM);

    // The exposure and clipping numbers come off the same walk and are always available; the
    // chroma numbers came from the vectorscope, which did not run.
    let summary = scopes.summary();
    assert_eq!(summary.luma_min, summary.luma_max, "a flat frame");
    assert_eq!(summary.channel_mean, [200.0, 40.0, 40.0]);
    assert_eq!(summary.mean_saturation, None);
    assert_eq!(summary.peak_saturation, None);
    assert_eq!(
        summary.dominant_hue_degrees, None,
        "a saturated frame still reports no hue when nothing measured its chroma"
    );
    assert!(summary.to_json()["chroma"]["meanSaturation"].is_null());
}

/// Dropping a scope must not change what the others say. A shared loop is exactly where a gate
/// added for cost can accidentally skip work another scope depended on.
#[test]
fn a_narrowed_set_reports_the_same_numbers_as_the_full_pass() {
    let bgra: Vec<u8> = (0..64 * 64)
        .flat_map(|index: usize| {
            [
                (index % 251) as u8,
                (index % 199) as u8,
                (index % 97) as u8,
                255,
            ]
        })
        .collect();
    let full = Scopes::from_bgra(&bgra, 64, 64, ScopeOptions::default()).expect("measures");
    for set in [
        ScopeSet::WAVEFORM,
        ScopeSet::PARADE,
        ScopeSet::VECTORSCOPE,
        ScopeSet::HISTOGRAM,
    ] {
        let options = ScopeOptions {
            scopes: set,
            ..ScopeOptions::default()
        };
        let narrowed = Scopes::from_bgra(&bgra, 64, 64, options).expect("measures");
        assert_eq!(narrowed.sampled_pixels, full.sampled_pixels);
        assert_eq!(narrowed.summary().luma_mean, full.summary().luma_mean);
        assert_eq!(narrowed.summary().channel_mean, full.summary().channel_mean);
        if set.waveform {
            assert_eq!(narrowed.waveform, full.waveform);
        }
        if set.parade {
            assert_eq!(narrowed.parade, full.parade);
        }
        if set.vectorscope {
            assert_eq!(narrowed.vectorscope, full.vectorscope);
        }
        if set.histogram {
            assert_eq!(narrowed.histogram, full.histogram);
        }
    }
}
