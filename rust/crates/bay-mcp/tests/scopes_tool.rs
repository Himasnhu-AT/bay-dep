//! `scopes_read` end to end: a project with a known background, measured through the wire.
//!
//! The reduction itself is pinned in `bay-preview`'s own tests, which need no GPU. What this
//! adds is the part only the server can prove — that the tool composites the right frame, at the
//! right time, and hands back the numbers rather than a placeholder. It needs an adapter, so it
//! skips without one and fails under `BAY_REQUIRE_GPU`. A skip here is not a pass.

use bay_mcp::{Studio, tools};
use serde_json::{Value, json};

fn call(studio: &mut Studio, name: &str, args: Value) -> Value {
    tools::dispatch(studio, name, &args).unwrap_or_else(|error| panic!("{name}: {error}"))
}

/// A studio holding a canvas of one flat colour and nothing else, or `None` once the GPU gate
/// has skipped.
fn flat_background(tag: &str, background: &str) -> Option<Studio> {
    bay_test_support::require_gpu()?;
    let root = std::env::temp_dir().join(format!("bay-scopes-{tag}-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let mut studio = Studio::with_library_root(Some(root));
    call(
        &mut studio,
        "project_create",
        json!({
            "name": "Scope fixture",
            "width": 640,
            "height": 360,
            "fps": 30,
            "background": background
        }),
    );
    Some(studio)
}

#[test]
fn a_flat_red_canvas_reads_as_red_through_the_wire() {
    let Some(mut studio) = flat_background("red", "#FF0000") else {
        return;
    };
    let report = call(
        &mut studio,
        "scopes_read",
        json!({ "at": 0.0, "scale": 1.0 }),
    );

    assert_eq!(report["status"], "measured");
    assert_eq!(report["atSeconds"], 0.0);
    assert_eq!(report["width"], 640);
    assert_eq!(report["height"], 360);
    assert_eq!(report["sampledPixels"], 640 * 360);
    assert_eq!(report["stride"], 1);

    // Rec.709 luma of pure red is 0.2126 * 255 = 54.
    assert_eq!(report["luma"]["min"], 54, "pure red traces at 54");
    assert_eq!(report["luma"]["max"], 54);
    assert_eq!(report["channelMean"]["red"], 255.0);
    assert_eq!(report["channelMean"]["green"], 0.0);
    assert_eq!(report["channelMean"]["blue"], 0.0);
    let hue = report["chroma"]["dominantHueDegrees"]
        .as_f64()
        .expect("a red frame has a hue");
    assert!(
        (hue - 102.917).abs() < 0.5,
        "red sits at the R graticule target, measured {hue}°"
    );
}

/// A neutral canvas must report no hue. A scope that names a colour for a grey frame is worse
/// than one that declines, because the note it produces sends someone correcting nothing.
#[test]
fn a_neutral_canvas_reports_no_hue_and_no_clipping() {
    let Some(mut studio) = flat_background("grey", "#808080") else {
        return;
    };
    let report = call(
        &mut studio,
        "scopes_read",
        json!({ "at": 0.0, "scale": 1.0 }),
    );

    assert_eq!(report["status"], "measured");
    assert_eq!(report["luma"]["min"], 128);
    assert_eq!(report["luma"]["max"], 128);
    assert!(
        report["chroma"]["dominantHueDegrees"].is_null(),
        "grey has no hue to report"
    );
    assert_eq!(report["chroma"]["meanSaturation"], 0.0);
    assert_eq!(report["clipping"]["blackShare"], 0.0);
    assert_eq!(report["clipping"]["whiteShare"], 0.0);
    assert_eq!(
        report["clipping"]["outsideLegalRangeShare"], 0.0,
        "code 128 is inside the 16..=235 window"
    );
}

/// A black canvas is the case a scope must not confuse with a failure to measure: every share
/// pegged at black, and a `measured` status saying it looked.
#[test]
fn a_black_canvas_reads_as_crushed_rather_than_as_unevaluated() {
    let Some(mut studio) = flat_background("black", "#000000") else {
        return;
    };
    let report = call(
        &mut studio,
        "scopes_read",
        json!({ "at": 0.0, "scale": 1.0 }),
    );

    assert_eq!(report["status"], "measured");
    assert_eq!(report["luma"]["max"], 0);
    assert_eq!(report["clipping"]["blackShare"], 1.0);
    assert_eq!(report["clipping"]["whiteShare"], 0.0);
}

/// The stride reaches the reduction and is reported back, so a share can be read as a share of
/// what was sampled rather than of the frame.
#[test]
fn a_stride_reduces_the_sample_and_says_so() {
    let Some(mut studio) = flat_background("stride", "#808080") else {
        return;
    };
    let report = call(
        &mut studio,
        "scopes_read",
        json!({ "at": 0.0, "scale": 1.0, "stride": 4 }),
    );

    assert_eq!(report["stride"], 4);
    assert_eq!(report["sampledPixels"], (640 / 4) * (360 / 4));
    // The frame is flat, so a quarter-resolution read gives the identical answer.
    assert_eq!(report["luma"]["mean"], 128.0);
}
