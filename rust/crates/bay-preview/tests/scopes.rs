//! Known frames, known scopes.
//!
//! Every case here is a frame whose correct reading can be worked out on paper, so a wrong
//! answer is wrong rather than merely different. No GPU, no ffmpeg, no window: these are pure
//! reductions over a `Vec<u8>` and nothing in this file can skip.

use bay_preview::scopes::{
    ScopeError, ScopeOptions, Scopes, chroma_pair, luma_code, relative_luminance,
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
    assert_eq!(sole_occupied_bin(&scopes.histogram.luma), 0);
    assert_eq!(sole_occupied_bin(&scopes.histogram.red), 0);
    for column in 0..scopes.waveform.columns {
        assert_eq!(
            sole_occupied_bin(scopes.waveform.column(column)),
            0,
            "every waveform column traces at black"
        );
    }
    assert_eq!(summary.black_clipped_share, 1.0);
    assert_eq!(summary.white_clipped_share, 0.0);
    // Black is neutral: no chroma, therefore no hue to report.
    assert_eq!(summary.mean_saturation, 0.0);
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
    assert_eq!(sole_occupied_bin(&scopes.histogram.luma), 255);
    for channel in [
        &scopes.histogram.red,
        &scopes.histogram.green,
        &scopes.histogram.blue,
    ] {
        assert_eq!(sole_occupied_bin(channel), 255);
    }
    for column in 0..scopes.parade.red.columns {
        assert_eq!(sole_occupied_bin(scopes.parade.red.column(column)), 255);
        assert_eq!(sole_occupied_bin(scopes.parade.green.column(column)), 255);
        assert_eq!(sole_occupied_bin(scopes.parade.blue.column(column)), 255);
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
    assert_eq!(sole_occupied_bin(&scopes.histogram.luma), 128);
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
    assert_eq!(summary.mean_saturation, 0.0);
}

/// Saturated red. Its luma is `0.2126 * 255 = 54.2`, and its vectorscope angle is the R target.
#[test]
fn a_saturated_primary_lands_where_rec709_puts_it() {
    let scopes = measure([255, 0, 0]);
    let summary = scopes.summary();

    assert_eq!(summary.luma_min, 54, "0.2126 * 255 rounds to 54");
    assert_eq!(summary.luma_max, 54);
    assert_eq!(sole_occupied_bin(&scopes.histogram.luma), 54);
    assert_eq!(sole_occupied_bin(&scopes.histogram.red), 255);
    assert_eq!(sole_occupied_bin(&scopes.histogram.green), 0);
    assert_eq!(sole_occupied_bin(&scopes.histogram.blue), 0);

    // The parade is what separates a primary from a grey of the same luma: the traces split.
    assert_eq!(sole_occupied_bin(scopes.parade.red.column(0)), 255);
    assert_eq!(sole_occupied_bin(scopes.parade.green.column(0)), 0);
    assert_eq!(sole_occupied_bin(scopes.parade.blue.column(0)), 0);

    assert_eq!(summary.channel_mean, [255.0, 0.0, 0.0]);
    assert!(
        summary.peak_saturation > 0.5,
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
        let centre = scopes.vectorscope.size / 2;
        assert_eq!(
            scopes.vectorscope.cells[centre * scopes.vectorscope.size + centre],
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

    let columns = scopes.waveform.columns;
    assert_eq!(sole_occupied_bin(scopes.waveform.column(0)), 0);
    assert_eq!(sole_occupied_bin(scopes.waveform.column(columns - 1)), 255);

    // The histogram sees an even split and nothing about where it is.
    assert_eq!(scopes.histogram.luma[0], scopes.histogram.luma[255]);
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
        },
    )
    .expect("clamped options still measure");
    assert_eq!(scopes.waveform.columns, 1);
    assert_eq!(scopes.waveform.levels, 1);
    assert_eq!(scopes.histogram.bins, 1);
    assert_eq!(scopes.vectorscope.size, 1);
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

/// Not an assertion — a measurement, printed for the record.
///
/// The plan assumed scopes over a preview-sized buffer "is fine" at interactive rates. That was
/// an assumption; this prints the number on whatever machine is running, so it can be checked
/// rather than believed. It deliberately asserts nothing about time: a loaded CI box would fail
/// a timing assertion for reasons that have nothing to do with this code.
#[test]
fn scope_cost_is_reported() {
    let cases = [
        ("854x480 preview", 854u32, 480u32, 1usize),
        ("1920x1080", 1920, 1080, 1),
        ("3840x2160 source", 3840, 2160, 1),
        ("3840x2160 stride 4", 3840, 2160, 4),
    ];
    println!("scope cost (this machine, this profile):");
    for (label, width, height, stride) in cases {
        // A gradient rather than a flat fill: a flat frame touches one histogram bin repeatedly
        // and measures a cache that a real frame does not get.
        let bgra: Vec<u8> = (0..width as usize * height as usize)
            .flat_map(|index| {
                let x = (index % width as usize) as u8;
                let y = (index / width as usize) as u8;
                [x, y, x.wrapping_add(y), 255]
            })
            .collect();
        let options = ScopeOptions {
            stride,
            ..ScopeOptions::default()
        };
        let started = std::time::Instant::now();
        let scopes = Scopes::from_bgra(&bgra, width, height, options).expect("measures");
        let elapsed = started.elapsed();
        println!(
            "  {label:>22}: {:>8.3} ms  ({} px sampled)",
            elapsed.as_secs_f64() * 1000.0,
            scopes.sampled_pixels
        );
    }
}
