//! `parse_ffprobe_json` is pure, so these run without ffmpeg installed. One case per shape we
//! actually see in the wild, including every "optional field absent" path.

use bay_preview::probe::{ProbeError, parse_ffprobe_json};

#[test]
fn parses_an_mp4_with_video_and_audio() {
    let json = r#"{
      "streams": [
        {"codec_type":"video","width":1920,"height":1080,"r_frame_rate":"30/1"},
        {"codec_type":"audio","channels":2}
      ],
      "format": {"duration":"12.500000"}
    }"#;
    let meta = parse_ffprobe_json(json).unwrap();
    assert_eq!(meta.width, 1920);
    assert_eq!(meta.height, 1080);
    assert!(meta.has_audio);
    assert!(meta.has_video);
    assert_eq!(meta.fps.numerator, 30);
    assert_eq!(meta.fps.denominator, 1);
    assert!((meta.duration.to_seconds_f64() - 12.5).abs() < 1e-6);
    assert_eq!(meta.rotation, 0);
}

#[test]
fn parses_an_mp4_without_audio() {
    let json = r#"{
      "streams": [{"codec_type":"video","width":640,"height":480,"r_frame_rate":"25/1"}],
      "format": {"duration":"3.0"}
    }"#;
    let meta = parse_ffprobe_json(json).unwrap();
    assert!(!meta.has_audio, "no audio stream means has_audio is false");
    assert!(meta.has_video);
}

#[test]
fn keeps_ntsc_frame_rates_rational() {
    // 30000/1001 must not be flattened to 29.97 — that drifts over long timelines.
    let json = r#"{
      "streams": [{"codec_type":"video","width":1280,"height":720,"r_frame_rate":"30000/1001"}],
      "format": {"duration":"1.0"}
    }"#;
    let meta = parse_ffprobe_json(json).unwrap();
    assert_eq!(meta.fps.numerator, 30000);
    assert_eq!(meta.fps.denominator, 1001);
}

#[test]
fn reads_rotation_from_side_data_and_from_legacy_tags() {
    let side_data = r#"{
      "streams": [{"codec_type":"video","width":1080,"height":1920,"r_frame_rate":"30/1",
                   "side_data_list":[{"rotation":-90}]}],
      "format": {"duration":"5.0"}
    }"#;
    // ffmpeg reports -90 for a 90 degree clockwise display rotation; we normalise to 0..360.
    assert_eq!(parse_ffprobe_json(side_data).unwrap().rotation, 270);

    let legacy = r#"{
      "streams": [{"codec_type":"video","width":1080,"height":1920,"r_frame_rate":"30/1",
                   "tags":{"rotate":"180"}}],
      "format": {"duration":"5.0"}
    }"#;
    assert_eq!(parse_ffprobe_json(legacy).unwrap().rotation, 180);
}

#[test]
fn accepts_duration_as_a_number_as_well_as_a_string() {
    // Some ffprobe builds emit numbers unquoted.
    let json = r#"{
      "streams": [{"codec_type":"audio","channels":2}],
      "format": {"duration": 7.25}
    }"#;
    let meta = parse_ffprobe_json(json).unwrap();
    assert!((meta.duration.to_seconds_f64() - 7.25).abs() < 1e-6);
    assert!(!meta.has_video);
}

#[test]
fn falls_back_to_stream_duration_when_the_container_has_none() {
    let json = r#"{
      "streams": [{"codec_type":"audio","channels":1,"duration":"2.5"}],
      "format": {}
    }"#;
    assert!((parse_ffprobe_json(json).unwrap().duration.to_seconds_f64() - 2.5).abs() < 1e-6);
}

#[test]
fn a_still_image_has_no_duration_and_that_is_not_an_error() {
    // PNGs report a video stream with no duration; the caller supplies a default still length.
    let json = r#"{
      "streams": [{"codec_type":"video","width":800,"height":600}],
      "format": {}
    }"#;
    let meta = parse_ffprobe_json(json).unwrap();
    assert_eq!(meta.duration.as_ticks(), 0);
    assert_eq!(meta.width, 800);
    // An absent r_frame_rate keeps the default rather than dividing by zero.
    assert_eq!(meta.fps.numerator, 30);
}

#[test]
fn an_unknown_frame_rate_of_zero_over_zero_keeps_the_default() {
    let json = r#"{
      "streams": [{"codec_type":"video","width":10,"height":10,"r_frame_rate":"0/0"}],
      "format": {"duration":"1.0"}
    }"#;
    assert_eq!(parse_ffprobe_json(json).unwrap().fps.numerator, 30);
}

#[test]
fn corrupt_and_empty_inputs_return_typed_errors() {
    assert!(matches!(
        parse_ffprobe_json("not json at all"),
        Err(ProbeError::Malformed(_))
    ));
    assert!(matches!(
        parse_ffprobe_json(""),
        Err(ProbeError::Malformed(_))
    ));
    // Valid JSON describing nothing usable.
    assert_eq!(
        parse_ffprobe_json(r#"{"streams":[],"format":{}}"#),
        Err(ProbeError::NoStreams)
    );
    assert_eq!(
        parse_ffprobe_json(r#"{"streams":[{"codec_type":"subtitle"}]}"#),
        Err(ProbeError::NoStreams)
    );
    assert_eq!(
        parse_ffprobe_json(r#"{"format":{"duration":"1.0"}}"#),
        Err(ProbeError::NoStreams)
    );
}

#[test]
fn probes_a_real_generated_clip() {
    // Integration: needs ffmpeg+ffprobe. Skips gracefully when absent.
    let path = std::env::temp_dir().join(format!("bay-probe-{}.mp4", std::process::id()));
    let generated = std::process::Command::new("ffmpeg")
        .args([
            "-nostdin",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=320x240:duration=2:rate=25",
            "-pix_fmt",
            "yuv420p",
            path.to_str().unwrap(),
        ])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !generated {
        eprintln!("skipping: ffmpeg unavailable");
        return;
    }

    match bay_preview::probe::probe_media(path.to_str().unwrap()) {
        Ok(meta) => {
            assert_eq!((meta.width, meta.height), (320, 240));
            assert!(
                (meta.duration.to_seconds_f64() - 2.0).abs() < 0.2,
                "expected ~2s, got {}",
                meta.duration.to_seconds_f64()
            );
            assert!(meta.has_video);
            assert_eq!(meta.fps.numerator, 25);
        }
        Err(ProbeError::Unavailable(_)) => eprintln!("skipping: ffprobe unavailable"),
        Err(other) => panic!("probe failed: {other}"),
    }
    let _ = std::fs::remove_file(&path);
}

// -- Decode budget planning ----------------------------------------------------------------

#[test]
fn short_clips_decode_at_full_rate_and_source_aspect() {
    // A 5s 1920x1080 clip fits the budget easily: full 30fps, downscaled keeping 16:9.
    let (w, h, fps, frames) = bay_preview::plan_decode_for_test((1920, 1080), 0, 5.0);
    assert_eq!(w, 480, "downscaled to the preview width budget");
    assert_eq!(
        h, 270,
        "16:9 preserved (was hardcoded 320x180 regardless of source)"
    );
    assert!((fps - 30.0).abs() < 0.01, "fps={fps}");
    assert_eq!(frames, 150);
}

#[test]
fn portrait_clips_keep_their_aspect() {
    let (w, h, _, _) = bay_preview::plan_decode_for_test((1080, 1920), 0, 3.0);
    assert!(h > w, "a portrait source must decode portrait, got {w}x{h}");
    assert!(((w as f32 / h as f32) - (1080.0 / 1920.0)).abs() < 0.02);
}

#[test]
fn long_clips_span_their_whole_duration_instead_of_freezing() {
    // The old fixed 450-frame cap meant a 10-minute clip decoded only its first 15 seconds and
    // then showed the last decoded frame forever. The budget must now cover the full duration.
    let duration = 600.0; // 10 minutes
    let (w, h, fps, frames) = bay_preview::plan_decode_for_test((1920, 1080), 0, duration);
    let covered = frames as f64 / fps as f64;
    assert!(
        (covered - duration).abs() < 1.0,
        "decoded window covers {covered:.1}s of a {duration}s clip"
    );
    // And it must stay inside the memory budget.
    let bytes = frames as usize * (w as usize) * (h as usize) * 4;
    assert!(
        bytes <= 192 * 1024 * 1024,
        "decode plan would use {} MB",
        bytes / 1024 / 1024
    );
}

#[test]
fn decode_plan_is_always_sane() {
    // Degenerate inputs must never produce a zero-size or zero-frame plan.
    for (natural, duration) in [
        ((0, 0), 1.0),
        ((1, 1), 0.0),
        ((4000, 3000), 3600.0),
        ((16, 9), 0.001),
    ] {
        let (w, h, fps, frames) = bay_preview::plan_decode_for_test(natural, 0, duration);
        assert!(w >= 2 && h >= 2, "{natural:?}/{duration} -> {w}x{h}");
        assert!(w % 2 == 0 && h % 2 == 0, "ffmpeg needs even dimensions");
        assert!(fps > 0.0 && frames >= 1);
    }
}

#[test]
fn rotated_phone_footage_is_planned_at_its_display_size() {
    // Regression: ffmpeg autorotates on decode, so a portrait phone clip (coded 1920x1080 with
    // a 90-degree display matrix) arrives as 1080x1920. Planning against the CODED size
    // squashed it into a landscape buffer — the exact stretch bug this work set out to fix.
    let (w, h, _, _) = bay_preview::plan_decode_for_test((1920, 1080), 90, 5.0);
    assert!(h > w, "a 90-rotated source must plan portrait, got {w}x{h}");
    assert!(
        ((w as f32 / h as f32) - (1080.0 / 1920.0)).abs() < 0.02,
        "display aspect must be 9:16, got {w}x{h}"
    );

    // 270 behaves the same; 180 does not transpose.
    let (w270, h270, _, _) = bay_preview::plan_decode_for_test((1920, 1080), 270, 5.0);
    assert!(h270 > w270);
    let (w180, h180, _, _) = bay_preview::plan_decode_for_test((1920, 1080), 180, 5.0);
    assert!(w180 > h180, "180 is not a transpose");
}

#[test]
fn the_decode_plan_never_exceeds_the_memory_budget() {
    // Regression: `frames` is fixed by the coverage promise and was computed BEFORE the
    // resolution shrink, so ordinary inputs (1080p/60s) overshot the ceiling. Sweep a wide
    // range rather than trusting one hand-picked case.
    const BUDGET: usize = 192 * 1024 * 1024;
    for &(nw, nh) in &[(1920u32, 1080u32), (3840, 2160), (1080, 1920), (640, 480)] {
        for &secs in &[0.5f64, 5.0, 30.0, 60.0, 120.0, 600.0, 3600.0] {
            for &rot in &[0i32, 90] {
                let (w, h, fps, frames) = bay_preview::plan_decode_for_test((nw, nh), rot, secs);
                let bytes = frames as usize * (w as usize) * (h as usize) * 4;
                assert!(
                    bytes <= BUDGET,
                    "{nw}x{nh} rot{rot} {secs}s -> {w}x{h} @{fps}fps x{frames} = {} MB > budget",
                    bytes / 1024 / 1024
                );
                // Coverage must still hold: the cache spans the whole clip.
                let covered = frames as f64 / fps as f64;
                assert!(
                    covered + 0.5 >= secs.max(0.05),
                    "{nw}x{nh} {secs}s only covered {covered:.2}s"
                );
            }
        }
    }
}

// -- Export decode intent ------------------------------------------------------------------
//
// The preview budget is a memory ceiling for frames held in RAM. It silently became the ceiling
// for the delivered file too, so every export was composited from a <=480px cache and upscaled.
// These pin the two plans apart.

#[test]
fn an_export_decodes_at_source_resolution_not_the_preview_budget() {
    let plan = bay_preview::plan_export_decode_for_test((1920, 1080), 0, 5.0, 30.0);
    assert_eq!(
        (plan.width, plan.height),
        (1920, 1080),
        "export must decode the source as it is, not at the preview's 480px budget"
    );
    assert!(
        plan.max_frames.is_none(),
        "an export streams, so nothing caps its frame count"
    );

    let (preview_w, _, _, _) = bay_preview::plan_decode_for_test((1920, 1080), 0, 5.0);
    assert_eq!(preview_w, 480, "the preview budget itself must not change");
}

#[test]
fn a_long_export_keeps_the_delivered_frame_rate() {
    // The case that made the defect visible: at 600s the preview plan drops toward
    // VIDEO_MIN_FPS to keep the whole clip resident, so the same decoded frame was repeated for
    // up to half a second of a 30fps export.
    let preview = bay_preview::plan_decode_for_test((1920, 1080), 0, 600.0);
    assert!(
        preview.2 < 10.0,
        "precondition: the preview plan lowers fps on a long clip, got {}",
        preview.2
    );

    let plan = bay_preview::plan_export_decode_for_test((1920, 1080), 0, 600.0, 30.0);
    assert!(
        (plan.fps - 30.0).abs() < 0.01,
        "export must decode at the delivered rate, got {}",
        plan.fps
    );
    assert_eq!((plan.width, plan.height), (1920, 1080));
}

#[test]
fn a_rotated_export_is_planned_at_its_display_size() {
    // ffmpeg autorotates on decode, so a 90-degree clip arrives transposed. Export must plan
    // against what it will actually receive, exactly as the preview does.
    let plan = bay_preview::plan_export_decode_for_test((1920, 1080), 90, 5.0, 30.0);
    assert_eq!(
        (plan.width, plan.height),
        (1080, 1920),
        "a rotated source must be planned at its display size"
    );
}

#[test]
fn export_dimensions_stay_even_for_the_encoder() {
    // yuv420p needs even dimensions; an odd source must not produce an odd plan.
    for natural in [(1919, 1081), (3, 3), (0, 0)] {
        let plan = bay_preview::plan_export_decode_for_test(natural, 0, 4.0, 30.0);
        assert_eq!(plan.width % 2, 0, "{natural:?} -> width {}", plan.width);
        assert_eq!(plan.height % 2, 0, "{natural:?} -> height {}", plan.height);
        assert!(plan.width >= 2 && plan.height >= 2, "{natural:?}");
    }
}

/// A corrupt file's *claimed* dimensions must not size a buffer.
///
/// Export deliberately plans at source resolution with no downscale, and those numbers come
/// from ffprobe reading container metadata — a claim, not a measurement. A crafted file can
/// declare 100000x100000, which sizes a ~40 GB frame buffer and aborts the process. That breaks
/// the same rule the rest of this branch enforces: the render path degrades on bad input, it
/// does not abort. The preview plan was never exposed because it clamped to 480 regardless.
#[test]
fn an_absurd_declared_size_is_clamped_rather_than_allocated() {
    for natural in [(100_000u32, 100_000u32), (u32::MAX, u32::MAX), (65_536, 4)] {
        let plan = bay_preview::plan_export_decode_for_test(natural, 0, 5.0, 30.0);
        assert!(
            plan.width <= 16_384 && plan.height <= 16_384,
            "{natural:?} planned {}x{}, which is not a size any codec produces",
            plan.width,
            plan.height
        );
        // The buffer that would be allocated has to stay computable and sane.
        let bytes = (plan.width as usize)
            .checked_mul(plan.height as usize)
            .and_then(|p| p.checked_mul(4))
            .expect("a clamped frame size must not overflow");
        assert!(
            bytes <= 16_384 * 16_384 * 4,
            "{natural:?} would allocate {bytes} bytes per frame"
        );
    }
}

/// An ordinary source is untouched by that ceiling.
#[test]
fn the_export_ceiling_does_not_touch_real_footage() {
    for natural in [(1920u32, 1080u32), (3840, 2160), (1080, 1920)] {
        let plan = bay_preview::plan_export_decode_for_test(natural, 0, 5.0, 30.0);
        assert_eq!(
            (plan.width, plan.height),
            natural,
            "real footage must still export at its own size"
        );
    }
}
